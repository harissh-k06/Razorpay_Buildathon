import os
import json
import time
import re
import sys
import asyncio
import pandas as pd
from pathlib import Path

# Add standardisation folder to sys.path for local module imports
script_dir = Path(__file__).resolve().parent
if str(script_dir) not in sys.path:
    sys.path.insert(0, str(script_dir))

from dotenv import load_dotenv
from typing import Dict, List, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from fastmcp import Client
    from fastmcp.client.transports import StdioTransport
except Exception:
    Client = None
    StdioTransport = None

from mydeepseek_client import DeepSeekStandardizer
from dateutil import parser

# Load .env from standardisation directory
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

# Deterministic exchange rates relative to USD
EXCHANGE_RATES = {
    "USD": 1.0,
    "INR": 95.78,
    "EUR": 0.86,
    "GBP": 0.73,
    "SGD": 1.27,
    "AED": 3.67,
    "MYR": 4.04,
    "CAD": 1.38,
    "AUD": 1.40,
    "JPY": 159.08,
    "CNY": 6.72,
}

# Currency detection by symbol
CURRENCY_SYMBOLS = {
    "$": "USD",
    "₹": "INR",
    "€": "EUR",
    "£": "GBP",
    "S$": "SGD",
    "د.إ": "AED",
    "RM": "MYR",
    "C$": "CAD",
    "A$": "AUD",
    "¥": "JPY",
    "元": "CNY",
}

def convert_currency(amount: float, from_currency: str, to_currency: str, precision: int = 6) -> float:
    """Deterministic currency conversion using EXCHANGE_RATES with high internal precision."""
    from_curr = str(from_currency).upper().strip() if from_currency else "USD"
    to_curr = str(to_currency).upper().strip() if to_currency else "USD"
    if from_curr == to_curr:
        return round(float(amount), precision)

    rate_from = EXCHANGE_RATES.get(from_curr, 1.0)
    rate_to = EXCHANGE_RATES.get(to_curr, 1.0)
    amount_in_usd = float(amount) / rate_from
    return round(amount_in_usd * rate_to, precision)

def convert_user_format_to_strftime(format_str: Optional[str]) -> str:
    """
    Converts any arbitrary user-defined or LLM date format string (e.g. 'DD-MMM-YY', 'YYYYMMDD', 'DD/MM/YYYY', 'YYYY-MM-DD')
    into a valid Python strftime format pattern.
    """
    if not format_str:
        return "%Y-%m-%d"

    s = str(format_str).strip()
    if "%" in s:
        return s

    # Exact standard mappings (case-insensitive)
    exact_map = {
        "YYYY-MM-DD": "%Y-%m-%d",
        "YYYY/MM/DD": "%Y/%m/%d",
        "YYYY.MM.DD": "%Y.%m.%d",
        "YYYYMMDD": "%Y%m%d",
        
        "DD/MM/YYYY": "%d/%m/%Y",
        "DD-MM-YYYY": "%d-%m-%Y",
        "DD.MM.YYYY": "%d.%m.%Y",
        "DDMMYYYY": "%d%m%Y",
        
        "DD/MM/YY": "%d/%m/%y",
        "DD-MM-YY": "%d-%m-%y",
        "DD.MM.YY": "%d.%m.%y",
        "DDMMYY": "%d%m%y",
        
        "MM/DD/YYYY": "%m/%d/%Y",
        "MM-DD-YYYY": "%m-%d-%Y",
        "MM.DD.YYYY": "%m.%d.%Y",
        "MMDDYYYY": "%m%d%Y",
        
        "MM/DD/YY": "%m/%d/%y",
        "MM-DD-YY": "%m-%d-%y",
        "MM.DD.YY": "%m.%d.%y",
        
        "DD-MMM-YY": "%d-%b-%y",
        "DD-MMM-YYYY": "%d-%b-%Y",
        "DD/MMM/YY": "%d/%b/%y",
        "DD/MMM/YYYY": "%d/%b/%Y",
        "DD.MMM.YY": "%d.%b.%y",
        "DD.MMM.YYYY": "%d.%b.%Y",
        "DD MMM YY": "%d %b %y",
        "DD MMM YYYY": "%d %b %Y",
        "DD MMMM YYYY": "%d %B %Y",
        
        "MMM-DD-YY": "%b-%d-%y",
        "MMM-DD-YYYY": "%b-%d-%Y",
        "MMM/DD/YYYY": "%b/%d/%Y",
        "MMM DD, YYYY": "%b %d, %Y",
        "MMMM DD, YYYY": "%B %d, %Y",
        
        "YYYY-MMM-DD": "%Y-%b-%d",
        "YYYY/MMM/DD": "%Y/%b/%d",
    }
    
    clean_upper = s.upper().replace(" ", " ")
    if clean_upper in exact_map:
        return exact_map[clean_upper]

    # Universal token parser for arbitrary formats
    token_patterns = [
        (r'(?i)\bYYYY\b', '%Y'),
        (r'(?i)\bYY\b', '%y'),
        (r'(?i)\bMMMM\b', '%B'),
        (r'(?i)\bMMM\b', '%b'),
        (r'(?i)\bMM\b', '%m'),
        (r'(?i)\bDD\b', '%d'),
    ]
    
    res = s
    for pat, rep in token_patterns:
        res = re.sub(pat, rep, res)
        
    # If no % produced (e.g. continuous tokens like YYYYMMDD without word boundaries), replace substrings
    if "%" not in res:
        tmp = s.upper()
        tmp = tmp.replace("YYYY", "%Y")
        tmp = tmp.replace("YY", "%y")
        tmp = tmp.replace("MMMM", "%B")
        tmp = tmp.replace("MMM", "%b")
        tmp = tmp.replace("MM", "%m")
        tmp = tmp.replace("DD", "%d")
        if "%" in tmp:
            res = tmp
            
    return res if "%" in res else "%Y-%m-%d"

def standardize_date_deterministic(date_val: Any, target_format: Optional[str] = None) -> str:
    """Convert any date representation to standard ISO (YYYY-MM-DD) or a specified custom date format."""
    if pd.isna(date_val) or date_val is None or str(date_val).strip() == "" or str(date_val).strip().lower() in ["nan", "none", "null"]:
        return ""

    date_str = str(date_val).strip()

    # Resolve strftime pattern
    strftime_pattern = convert_user_format_to_strftime(target_format) if target_format else "%Y-%m-%d"

    # If already ISO format (YYYY-MM-DD) and no custom format requested, return as-is
    if not target_format and re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return date_str

    dt = None
    # Try dateutil parser
    try:
        dt = parser.parse(date_str, fuzzy=True)
    except Exception:
        pass

    # Try pandas datetime
    if dt is None:
        try:
            dt = pd.to_datetime(date_str)
        except Exception:
            pass

    # If it's a Unix timestamp (seconds or milliseconds)
    if dt is None:
        try:
            num = float(date_str)
            if num > 1e11:
                dt = pd.to_datetime(num, unit='ms')
            elif num > 1e8:
                dt = pd.to_datetime(num, unit='s')
        except Exception:
            pass

    if dt is not None:
        try:
            return dt.strftime(strftime_pattern)
        except Exception:
            return dt.strftime("%Y-%m-%d")

    return date_str

def extract_amount_deterministic(amount_val: Any) -> float:
    """Extract numeric amount from string (remove symbols, commas)."""
    if pd.isna(amount_val) or amount_val is None:
        return 0.0
    text = str(amount_val).strip()
    for sym in CURRENCY_SYMBOLS.keys():
        text = text.replace(sym, "")
    text = text.replace(",", "")
    match = re.search(r'(-?\d+\.?\d*)', text)
    if match:
        return float(match.group(1))
    return 0.0

def detect_currency_deterministic(amount_val: Any) -> str:
    """Detect currency symbol from string."""
    if pd.isna(amount_val) or amount_val is None:
        return "USD"
    text = str(amount_val)
    for sym, code in CURRENCY_SYMBOLS.items():
        if sym in text:
            return code
    for code in EXCHANGE_RATES.keys():
        if code in text.upper():
            return code
    return "USD"

class DataStandardizer:
    """
    Decoupled Two-Phase Data Standardizer with In-Memory LLM Caching:
    
    1. Phase 1 (LLM Processing): Standardizes semantic vendor names and summarizes descriptions via LLM.
       Results are cached in-memory in `self._llm_data`. No intermediate CSV files are written to disk.
    2. Phase 2 (Deterministic Normalisation): Applies date parsing, amount cleaning, currency detection,
       and instant currency conversion to `base_currency`. Writes final `*_standardized.csv` files.
       Can be re-run on demand in milliseconds when changing base currency without invoking the LLM.
    """

    def __init__(self, base_currency: str = "INR", deepseek_api_key: str = None):
        self.base_currency = base_currency.upper().strip()
        self.standardizer = DeepSeekStandardizer()
        self._llm_data: Dict[str, pd.DataFrame] = {}

        # Base directories
        self.script_dir = Path(__file__).resolve().parent
        self.workspace_root = self.script_dir.parent

        self.output_dir = self.script_dir / "data" / "standardized"
        self.mappings_dir = self.script_dir / "data" / "mappings"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.mappings_dir.mkdir(parents=True, exist_ok=True)

    def _call_mcp_parser(self, file_path: Path) -> dict:
        """
        Connect to MCP server (mcp_server/server.py) via FastMCP Client using StdioTransport
        and call parse_financial_file to obtain canonical JSON data.
        """
        # Locate server.py script
        server_script = (self.workspace_root / "mcp_server" / "server.py").resolve()
        if not server_script.exists():
            server_script = (self.script_dir.parent / "mcp_server" / "server.py").resolve()
            if not server_script.exists():
                raise RuntimeError(f"MCP server script not found at {server_script}")

        resolved_file = Path(file_path).resolve()
        if not resolved_file.exists():
            raise RuntimeError(f"Input file not found at {resolved_file}")

        # Check if fastmcp Client is available
        if Client is not None and StdioTransport is not None:
            # Locate Python executable in venv if available
            venv_py_win = self.workspace_root / "venv" / "Scripts" / "python.exe"
            venv_py_unix = self.workspace_root / "venv" / "bin" / "python"
            py_exec = str(venv_py_win) if venv_py_win.exists() else (
                str(venv_py_unix) if venv_py_unix.exists() else sys.executable
            )

            async def _async_call():
                transport = StdioTransport(command=py_exec, args=[str(server_script)])
                async with Client(transport) as client:
                    return await client.call_tool("parse_financial_file", {"file_path": str(resolved_file)})

            try:
                result = asyncio.run(_async_call())
                # Extract parsed JSON data from result
                data = None
                if hasattr(result, "data") and isinstance(result.data, dict) and result.data:
                    data = result.data
                elif hasattr(result, "structured_content") and isinstance(result.structured_content, dict) and result.structured_content:
                    data = result.structured_content
                elif hasattr(result, "content") and result.content:
                    for item in result.content:
                        text = getattr(item, "text", str(item))
                        try:
                            parsed = json.loads(text)
                            if isinstance(parsed, dict):
                                data = parsed
                                break
                        except Exception:
                            continue

                if isinstance(data, dict) and "transactions" in data and "metadata" in data:
                    return data
            except Exception:
                pass  # Fall through to direct tool invocation

        # Direct in-process invocation fallback (100% resilient across all environments)
        if str(self.workspace_root) not in sys.path:
            sys.path.insert(0, str(self.workspace_root))
        try:
            from mcp_server.server import parse_financial_file
            data = parse_financial_file(str(resolved_file))
            if isinstance(data, dict) and "transactions" in data and "metadata" in data:
                return data
            if isinstance(data, dict) and "error" in data:
                raise RuntimeError(f"MCP parser error for '{resolved_file}': {data['error']}")
        except Exception as e:
            raise RuntimeError(f"Failed to parse file '{resolved_file}' via MCP tool: {e}") from e

        raise RuntimeError(f"Unexpected response format from MCP parser for '{resolved_file}'")

    def _standardize_llm(self, df: pd.DataFrame, source_key: str) -> pd.DataFrame:
        """
        Phase 1 Worker: Runs LLM-based vendor standardisation and description summarisation only.
        Does not perform currency conversion, date formatting, or deterministic normalisation.
        """
        df = df.copy()
        df["source_type"] = source_key

        # ---- VENDORS (LLM Batch) ----
        if "vendor" in df.columns and df["vendor"].astype(str).str.strip().ne("").any():
            print(f"   [{source_key}] Standardizing vendors from 'vendor' using LLM (DeepSeek)...")
            raw_vendors = df["vendor"].fillna("").astype(str).tolist()
            df["vendor_standardized"] = self.standardizer.standardize_vendors_batch(raw_vendors)
        elif "description" in df.columns and df["description"].astype(str).str.strip().ne("").any():
            print(f"   [{source_key}] Extracting vendors from 'description' using LLM (DeepSeek)...")
            raw_desc = df["description"].fillna("").astype(str).tolist()
            df["vendor_standardized"] = self.standardizer.standardize_vendors_batch(raw_desc)
        else:
            df["vendor_standardized"] = ""

        # ---- DESCRIPTIONS (LLM Batch) ----
        if "description" in df.columns and df["description"].astype(str).str.strip().ne("").any():
            print(f"   [{source_key}] Summarizing descriptions from 'description' using LLM (DeepSeek)...")
            raw_desc = df["description"].fillna("").astype(str).tolist()
            df["description_standardized"] = self.standardizer.standardize_descriptions_batch(raw_desc)
        else:
            df["description_standardized"] = ""

        return df

    def process_llm(self) -> Dict[str, pd.DataFrame]:
        """
        Phase 1: Ingests raw files via MCP server and executes parallel LLM processing.
        Stores the resulting DataFrames in memory (self._llm_data). Does not write CSV files.
        """
        start_time = time.time()
        print("\n=== Phase 1: Serial Ingestion & Parallel LLM Processing ===")

        # 1. Locate unique file paths
        file_paths: Dict[str, Path] = {}
        sources = {
            "invoice": [
                self.workspace_root / "synthetic data" / "data" / "invoices.csv",
                self.script_dir / "data" / "raw" / "invoices.csv",
            ],
            "razorpay": [
                self.workspace_root / "synthetic data" / "data" / "razorpay_settlements.csv",
                self.script_dir / "data" / "raw" / "razorpay_settlements.csv",
            ],
            "bank": [
                self.workspace_root / "synthetic data" / "data" / "bank.csv",
                self.script_dir / "data" / "raw" / "bank.csv",
            ]
        }
        for source_key, paths in sources.items():
            for p in paths:
                if p.exists():
                    file_paths[source_key] = p.resolve()
                    print(f"   Located {source_key}: {p.resolve()}")
                    break

        if not file_paths:
            print("[Warning] No datasets found in synthetic data/data/ or data/raw/.")
            return {}

        # 2. Serial Ingestion via MCP Server
        parsed_dfs: Dict[str, pd.DataFrame] = {}
        for source_key, path in file_paths.items():
            print(f"   Parsing {source_key} from {path.name}...")
            data = self._call_mcp_parser(path)
            transactions = data.get("transactions", [])

            if transactions and isinstance(transactions[0], dict) and "canonical" in transactions[0]:
                canonical_rows = [t.get("canonical", {}) for t in transactions]
                original_rows = [t.get("original", {}) for t in transactions]
                df_canonical = pd.DataFrame(canonical_rows)
                df_original = pd.DataFrame(original_rows)

                # Merge original columns into df_canonical so all original metadata & identifiers are preserved
                for col in df_original.columns:
                    if col not in df_canonical.columns:
                        df_canonical[col] = df_original[col].values

                parsed_dfs[source_key] = df_canonical
            else:
                parsed_dfs[source_key] = pd.DataFrame(transactions)

            print(f"   -> Extracted {len(parsed_dfs[source_key])} transactions (Metadata: {data.get('metadata', {})})")

        # 3. Parallel LLM Processing
        print("\n=== Running Parallel LLM Work (Vendors & Descriptions) ===")
        llm_results: Dict[str, pd.DataFrame] = {}
        with ThreadPoolExecutor(max_workers=len(parsed_dfs)) as executor:
            futures = {
                executor.submit(self._standardize_llm, df, key): key
                for key, df in parsed_dfs.items()
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    llm_results[key] = future.result()
                except Exception as e:
                    print(f"[Error] Failed LLM standardization for {key}: {e}")

        self._llm_data = llm_results
        total_time = time.time() - start_time
        print(f"\nPhase 1 LLM complete in {total_time:.2f}s (In-Memory Cache keys: {list(self._llm_data.keys())})")
        return self._llm_data

    def load_or_process_llm(self) -> Dict[str, pd.DataFrame]:
        """
        Ensures self._llm_data is populated.
        1. If already in memory, returns immediately.
        2. If empty, checks if standardized CSVs on disk already contain LLM fields (e.g. after server restart)
           and loads them directly into memory in <0.05s.
        3. If no files exist on disk, runs process_llm().
        """
        if self._llm_data:
            return self._llm_data

        loaded = {}
        for key in ["invoice", "razorpay", "bank"]:
            p = self.output_dir / f"{key}_standardized.csv"
            if p.exists():
                try:
                    df = pd.read_csv(p)
                    if "vendor_standardized" in df.columns and "description_standardized" in df.columns:
                        loaded[key] = df
                except Exception:
                    pass

        if len(loaded) == 3:
            print(f"   [Cache Warmup] Loaded existing LLM-standardized data from disk into memory: {list(loaded.keys())}")
            self._llm_data = loaded
            return self._llm_data

        return self.process_llm()

    def _apply_deterministic_df(
        self,
        df: pd.DataFrame,
        source_key: str,
        base_currency: str,
        date_format: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Applies deterministic normalisation to a DataFrame containing LLM-standardized fields:
        - Date formatting
        - Amount cleaning & unit normalisation (paise -> Rupees for Razorpay)
        - Net transaction amount calculation
        - Currency detection & conversion to base_currency
        """
        df = df.copy()

        # ---- DATES (Deterministic) ----
        # Internal standardized dates MUST ALWAYS be in strict ISO format (%Y-%m-%d)
        date_col_candidates = [
            "date", "issue_date", "due_date", "settled_at", "transaction_date", "value_date"
        ]
        for col in date_col_candidates:
            if col in df.columns:
                # Internal matching column -> Always ISO YYYY-MM-DD
                iso_series = df[col].apply(lambda d: standardize_date_deterministic(d, target_format=None))
                df[f"{col}_standardized"] = iso_series
                
                # If custom date_format requested, create a display column for UI formatting
                if date_format:
                    df[f"{col}_display"] = df[col].apply(lambda d: standardize_date_deterministic(d, target_format=date_format))
                elif f"{col}_display" in df.columns:
                    df[f"{col}_display"] = iso_series

        # Ensure all existing *_standardized date columns are in strict ISO format
        for col in df.columns:
            if col.endswith("_standardized") and ("date" in col or "settled_at" in col):
                df[col] = df[col].apply(lambda d: standardize_date_deterministic(d, target_format=None))

        # ---- AMOUNTS (Deterministic) ----
        if source_key == "invoice" and "total" in df.columns and df["total"].notna().any():
            df["amount"] = df["total"]

        for col in ["amount", "credit", "debit", "balance"]:
            if col in df.columns:
                cleaned = df[col].apply(extract_amount_deterministic)
                if source_key == "razorpay":
                    # Razorpay amounts (amount, credit, debit, balance) are in paise -> divide by 100
                    cleaned = cleaned / 100.0
                df[f"{col}_cleaned"] = cleaned

        # Net transaction amount
        if "amount_cleaned" in df.columns and (df["amount_cleaned"] != 0).any():
            pass
        elif "credit_cleaned" in df.columns or "debit_cleaned" in df.columns:
            credit = df["credit_cleaned"] if "credit_cleaned" in df.columns else pd.Series(0.0, index=df.index)
            debit = df["debit_cleaned"] if "debit_cleaned" in df.columns else pd.Series(0.0, index=df.index)
            df["amount_cleaned"] = credit - debit

        # ---- CURRENCIES (Deterministic + Bank Override) ----
        if source_key == "bank":
            df["currency_detected"] = "INR"
        elif "currency" in df.columns and df["currency"].astype(str).str.strip().ne("").any():
            df["currency_detected"] = df["currency"].fillna("USD").astype(str).str.upper()
        elif "amount" in df.columns:
            df["currency_detected"] = df["amount"].apply(detect_currency_deterministic)
        else:
            df["currency_detected"] = "USD"

        # ---- CONVERT TO BASE CURRENCY ----
        for col_name in ["amount", "credit", "debit", "balance", "tax", "subtotal", "fee"]:
            if col_name in df.columns or f"{col_name}_cleaned" in df.columns:
                src_series = df[f"{col_name}_cleaned"] if f"{col_name}_cleaned" in df.columns else df[col_name]
                cleaned_amounts = src_series.apply(extract_amount_deterministic)
                if source_key == "razorpay" and col_name in ("fee", "tax"):
                    cleaned_amounts = cleaned_amounts / 100.0
                currencies = df["currency_detected"]
                converted = []
                for amt, curr in zip(cleaned_amounts, currencies):
                    if amt is None or pd.isna(amt):
                        converted.append(0.0)
                        continue
                    num_val = float(amt)
                    if source_key in ("bank", "razorpay"):
                        conv = convert_currency(num_val, "INR", base_currency, precision=6)
                    else:
                        conv = convert_currency(num_val, curr, base_currency, precision=6)
                    converted.append(round(conv, 2))
                df[f"{col_name}_converted"] = converted

        df["base_currency"] = base_currency

        # Fallback for bank reference number if missing but cheque_number is available
        if source_key == "bank" and "ref_no" not in df.columns and "cheque_number" in df.columns:
            df["ref_no"] = df["cheque_number"]

        return df

    def apply_deterministic(
        self,
        base_currency: Optional[str] = None,
        date_format: Optional[str] = None
    ) -> Dict[str, pd.DataFrame]:
        """
        Phase 2: Reads LLM-standardized data from self._llm_data, applies deterministic
        normalisation, and writes the final *_standardized.csv files to disk.
        Does not mutate self._llm_data and does not re-trigger LLM calls.
        """
        if not self._llm_data:
            self.load_or_process_llm()
            if not self._llm_data:
                raise RuntimeError("No LLM data in memory. Please run process_llm() first.")

        target_curr = (base_currency or self.base_currency).upper().strip()
        self.base_currency = target_curr

        processed_dfs: Dict[str, pd.DataFrame] = {}
        for source_key, df in self._llm_data.items():
            df_std = self._apply_deterministic_df(df, source_key, target_curr, date_format)
            out_path = self.output_dir / f"{source_key}_standardized.csv"
            df_std.to_csv(out_path, index=False)
            processed_dfs[source_key] = df_std
            print(f"   [Deterministic] Saved: {out_path} ({len(df_std)} rows, Base: {target_curr})")

        return processed_dfs

    def process_files(self):
        """
        Full two-phase pipeline (Backward Compatible):
        1. process_llm(): Performs LLM standardisation and caches results in memory.
        2. apply_deterministic(): Applies deterministic normalisation and writes final CSVs.
        """
        start_time = time.time()
        print(f"\nStarting Two-Phase Standardization Pipeline (Base Currency: {self.base_currency})")

        # Phase 1: LLM Processing (cached in memory)
        self.process_llm()

        # Phase 2: Deterministic Normalisation & Output Generation
        processed_dfs = self.apply_deterministic(base_currency=self.base_currency)

        total_time = time.time() - start_time
        print(f"\nAll files processed in {total_time:.2f}s")
        print("\nStandardization Complete:")
        for k, v in processed_dfs.items():
            print(f"   - {k.capitalize()}: {len(v)} rows")
        print(f"   - All amounts converted to base currency: {self.base_currency}")

        self.generate_report(total_time)

    def generate_report(self, total_time: float):
        """Generate summary report."""
        report = {
            "timestamp": pd.Timestamp.now().isoformat(),
            "execution_time_seconds": round(total_time, 2),
            "base_currency": self.base_currency,
            "cache_entries": len(self.standardizer.cache),
            "files_processed": []
        }
        for filename in os.listdir(self.output_dir):
            if filename.endswith(".csv"):
                df = pd.read_csv(self.output_dir / filename)
                standardized_cols = [c for c in df.columns if "_standardized" in c or c == "amount_converted"]
                report["files_processed"].append({
                    "filename": filename,
                    "rows": len(df),
                    "standardized_fields": standardized_cols
                })
        report_path = self.mappings_dir / "standardization_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nStandardization Report (saved to {report_path}):")
        print(json.dumps(report, indent=2))

if __name__ == "__main__":
    import sys
    print("="*60)
    print("Data Standardizer - MCP Canonical Pipeline (DeepSeek)")
    print("="*60)
    # Get currency from CLI args, default to INR if not provided
    if len(sys.argv) > 1 and sys.argv[1].strip():
        base_curr = sys.argv[1].strip().upper()
    else:
        try:
            base_curr = input("Enter base currency [INR]: ").strip().upper()
        except (EOFError, OSError):
            base_curr = "INR"
    base_curr = base_curr if base_curr else "INR"
    standardizer = DataStandardizer(
        base_currency=base_curr,
        deepseek_api_key=os.getenv("deepseek_API_KEY") or os.getenv("API_KEY") or os.getenv("DEEPSEEK_API_KEY")
    )
    standardizer.process_files()