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

def convert_currency(amount: float, from_currency: str, to_currency: str) -> float:
    """Deterministic currency conversion using EXCHANGE_RATES."""
    from_curr = str(from_currency).upper().strip() if from_currency else "USD"
    to_curr = str(to_currency).upper().strip() if to_currency else "USD"
    if from_curr == to_curr:
        return round(float(amount), 2)

    rate_from = EXCHANGE_RATES.get(from_curr, 1.0)
    rate_to = EXCHANGE_RATES.get(to_curr, 1.0)
    amount_in_usd = float(amount) / rate_from
    return round(amount_in_usd * rate_to, 2)

def standardize_date_deterministic(date_val: Any) -> str:
    """Convert any date representation to YYYY-MM-DD."""
    if pd.isna(date_val) or date_val is None or str(date_val).strip() == "":
        return ""

    date_str = str(date_val).strip()

    # If already ISO format (YYYY-MM-DD), return as-is
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return date_str

    # Try dateutil parser
    try:
        dt = parser.parse(date_str, fuzzy=True)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass

    # Try pandas datetime
    try:
        dt = pd.to_datetime(date_str)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass

    # If it's a Unix timestamp (seconds)
    try:
        num = float(date_str)
        if num > 1e9:
            dt = pd.to_datetime(num, unit='s')
            return dt.strftime("%Y-%m-%d")
    except Exception:
        pass

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
    High-performance data standardizer using a two-stage pipeline:
    1. Fast Serial MCP Ingestion: Parses CSVs into canonical JSON structures via MCP Server.
    2. Parallel LLM & Deterministic Standardization: Standardizes vendor names, descriptions,
       dates, amounts, and currencies concurrently across all sources using ThreadPoolExecutor.
    """

    def __init__(self, base_currency: str = "INR", deepseek_api_key: str = None):
        self.base_currency = base_currency.upper().strip()
        self.standardizer = DeepSeekStandardizer()

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

    def _standardize_dataframe(self, df: pd.DataFrame, source_key: str) -> pd.DataFrame:
        """
        Core standardization logic operating exclusively on hard-coded canonical columns:
        - date, description, debit, credit, balance, cheque_number, vendor, amount, currency
        """
        df = df.copy()
        df["source_type"] = source_key

        # ---- VENDORS (LLM Batch) ----
        # Always use canonical "vendor" column if present with values; otherwise extract from "description"
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
        # Always use canonical "description" column
        if "description" in df.columns and df["description"].astype(str).str.strip().ne("").any():
            print(f"   [{source_key}] Summarizing descriptions from 'description' using LLM (DeepSeek)...")
            raw_desc = df["description"].fillna("").astype(str).tolist()
            df["description_standardized"] = self.standardizer.standardize_descriptions_batch(raw_desc)
        else:
            df["description_standardized"] = ""

        # ---- DATES (Deterministic) ----
        # Always standardize canonical "date" column (and "settled_at" if present for Razorpay)
        if "date" in df.columns:
            print(f"   [{source_key}] Standardizing dates from 'date'...")
            df["date_standardized"] = df["date"].apply(standardize_date_deterministic)
        if "settled_at" in df.columns:
            print(f"   [{source_key}] Standardizing dates from 'settled_at'...")
            df["settled_at_standardized"] = df["settled_at"].apply(standardize_date_deterministic)

        # ---- AMOUNTS (Deterministic) ----
        # Clean canonical numeric fields
        for col in ["amount", "credit", "debit", "balance"]:
            if col in df.columns:
                cleaned = df[col].apply(extract_amount_deterministic)
                if source_key == "razorpay":
                    # Razorpay amounts (amount, credit, debit, balance) are always in paise -> divide by 100
                    cleaned = cleaned / 100.0
                df[f"{col}_cleaned"] = cleaned

        # If "amount" column exists and has values (e.g. invoices), use it;
        # otherwise compute net transaction amount from credit - debit (bank statements)
        if "amount_cleaned" in df.columns and (df["amount_cleaned"] != 0).any():
            pass  # amount_cleaned already populated
        elif "credit_cleaned" in df.columns or "debit_cleaned" in df.columns:
            credit = df["credit_cleaned"] if "credit_cleaned" in df.columns else pd.Series(0.0, index=df.index)
            debit = df["debit_cleaned"] if "debit_cleaned" in df.columns else pd.Series(0.0, index=df.index)
            df["amount_cleaned"] = credit - debit

        # ---- CURRENCIES (Deterministic + Bank Override) ----
        if source_key == "bank":
            print(f"   [{source_key}] Bank currency set to INR")
            df["currency_detected"] = "INR"
        elif "currency" in df.columns and df["currency"].astype(str).str.strip().ne("").any():
            print(f"   [{source_key}] Using canonical 'currency' column...")
            df["currency_detected"] = df["currency"].fillna("USD").astype(str).str.upper()
        elif "amount" in df.columns:
            print(f"   [{source_key}] Detecting currency from 'amount' strings...")
            df["currency_detected"] = df["amount"].apply(detect_currency_deterministic)
        else:
            df["currency_detected"] = "USD"

        # ---- CONVERT TO BASE CURRENCY ----
        for col_name in ["amount", "credit", "debit", "balance"]:
            cleaned_col = f"{col_name}_cleaned"
            if cleaned_col in df.columns:
                print(f"   [{source_key}] Converting {col_name} to {self.base_currency}...")
                cleaned_amounts = df[cleaned_col]
                currencies = df["currency_detected"]
                converted = []
                for amt, curr in zip(cleaned_amounts, currencies):
                    if amt is None or pd.isna(amt):
                        converted.append(0.0)
                        continue
                    num_val = float(amt)
                    if source_key in ("bank", "razorpay"):
                        # Both bank and razorpay are already in INR (paise already converted to Rupees)
                        conv = convert_currency(num_val, "INR", self.base_currency)
                    else:
                        conv = convert_currency(num_val, curr, self.base_currency)
                    converted.append(round(conv, 2))
                df[f"{col_name}_converted"] = converted

        df["base_currency"] = self.base_currency

        return df

    def _standardize_and_save(self, source_key: str, df: pd.DataFrame) -> pd.DataFrame:
        """Worker function for parallel LLM & deterministic standardization."""
        print(f"\n--- [Parallel LLM] Standardizing {source_key} ({len(df)} rows) ---")
        df_std = self._standardize_dataframe(df, source_key)

        # Fallback for bank reference number if missing but cheque_number is available
        if source_key == "bank" and "ref_no" not in df_std.columns and "cheque_number" in df_std.columns:
            df_std["ref_no"] = df_std["cheque_number"]

        out_path = self.output_dir / f"{source_key}_standardized.csv"
        df_std.to_csv(out_path, index=False)
        print(f"   Saved: {out_path} ({len(df_std)} rows)")
        return df_std

    def process_files(self):
        """
        Main processing pipeline:
        Stage 1: Serial MCP Ingestion (fast, extracts canonical & preserves original fields)
        Stage 2: Parallel LLM Standardization & Normalization (maximizes throughput)
        """
        start_time = time.time()
        print(f"\nStarting High-Speed Standardization Pipeline (Base Currency: {self.base_currency})")

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
            return

        # 2. Stage 1: Serial MCP Ingestion
        print("\n=== Stage 1: Serial Ingestion via MCP Server ===")
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

        # 3. Stage 2: Parallel LLM & Deterministic Standardization
        print("\n=== Stage 2: Parallel LLM & Normalization Pipeline ===")
        processed_dfs: Dict[str, pd.DataFrame] = {}
        with ThreadPoolExecutor(max_workers=len(parsed_dfs)) as executor:
            futures = {
                executor.submit(self._standardize_and_save, key, df): key
                for key, df in parsed_dfs.items()
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    processed_dfs[key] = future.result()
                except Exception as e:
                    print(f"[Error] Failed to standardize {key}: {e}")

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