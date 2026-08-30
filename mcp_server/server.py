import os
import sys
import time
import json
import re
import shutil
import pandas as pd
from pathlib import Path
from io import StringIO
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from fastmcp import FastMCP
from dotenv import load_dotenv
# Load .env from project root
root_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=root_env, override=True)
# Optional LLM fallback – only imported when needed
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

# -------------------------------------------------------------------
# FastMCP Server
# -------------------------------------------------------------------
mcp = FastMCP("Financial File Parser (Step 0)")

# -------------------------------------------------------------------
# Agentic Mode State (Segregation of Action/Write vs Read-Only Tools)
# -------------------------------------------------------------------
AGENTIC_STATE_FILE = Path(__file__).resolve().parent.parent / ".agentic_mode.json"
_agentic_mode_enabled = False

def set_agentic_mode(enabled: bool) -> None:
    global _agentic_mode_enabled
    _agentic_mode_enabled = bool(enabled)
    try:
        AGENTIC_STATE_FILE.write_text(json.dumps({"enabled": _agentic_mode_enabled}), encoding="utf-8")
    except Exception:
        pass

def get_agentic_mode() -> bool:
    global _agentic_mode_enabled
    try:
        if AGENTIC_STATE_FILE.exists():
            data = json.loads(AGENTIC_STATE_FILE.read_text(encoding="utf-8"))
            _agentic_mode_enabled = bool(data.get("enabled", False))
    except Exception:
        pass
    return _agentic_mode_enabled

def require_agentic_mode() -> Optional[Dict[str, Any]]:
    """If agentic mode is off (Ask Mode), return an error dict; otherwise None."""
    if not get_agentic_mode():
        return {
            "error": "This is an agentic action. Please turn Agentic Mode ON (green toggle) to proceed."
        }
    return None

# -------------------------------------------------------------------
# Deterministic header detection 
# -------------------------------------------------------------------
HEADER_KEYWORDS = [
    "s no", "sr no", "sr.", "s.", "value date", "transaction date",
    "date", "cheque number", "ref no", "transaction remarks",
    "description", "withdrawal", "deposit", "credit", "debit", "balance",
    "invoice", "vendor", "tax", "subtotal", "total", "amount", "order", "entity_id"
]

def find_header_row(lines: List[str]) -> int:
    """Return the row index that looks like a transaction table header."""
    for i, line in enumerate(lines):
        line_lower = line.lower().strip()
        count = sum(1 for kw in HEADER_KEYWORDS if kw in line_lower)
        if count >= 2:
            return i
    return -1

def find_footer_row(lines: List[str], start_idx: int) -> int:
    """Return the row index where the transaction data ends."""
    footer_keywords = [
        "legend", "end of statement", "end of report", "terms and conditions",
        "customer care", "this is a computer generated", "page generated on",
        "disclaimer", "statement summary"
    ]
    for i in range(start_idx, len(lines)):
        line_lower = lines[i].lower().strip()
        if any(kw in line_lower for kw in footer_keywords):
            return i
    return len(lines)  # no footer found

def extract_metadata(lines: List[str], header_idx: int) -> Dict[str, str]:
    """Extract account number, period, bank from lines before the header."""
    metadata = {
        "account": "",
        "period_start": "",
        "period_end": "",
        "bank": "",
        "file_type": "unknown"
    }
    # Account number
    for line in lines[:header_idx]:
        if "account" in line.lower():
            match = re.search(r'(\d{10,})', line)
            if match:
                metadata["account"] = match.group(1)
                break
    # Date range
    date_pattern = r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})'
    for line in lines[:header_idx]:
        dates = re.findall(date_pattern, line)
        if len(dates) >= 2:
            start = parse_flexible_date(dates[0])
            end = parse_flexible_date(dates[-1])
            if start and end:
                metadata["period_start"] = start
                metadata["period_end"] = end
                break
    return metadata

def parse_flexible_date(date_str: str) -> Optional[str]:
    """Try multiple date formats and return YYYY-MM-DD."""
    if not date_str:
        return None
    date_str = date_str.strip()
    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None

def clean_amount(amount_str: Any) -> float:
    """Convert to float, remove commas and currency symbols."""
    if amount_str is None or pd.isna(amount_str):
        return 0.0
    if isinstance(amount_str, (int, float)):
        return float(amount_str) if not pd.isna(amount_str) else 0.0
    s = str(amount_str).strip()
    s = s.replace(',', '')
    s = re.sub(r'[^\d.-]', '', s)
    try:
        return float(s) if s and s != '-' else 0.0
    except ValueError:
        return 0.0

def parse_transaction_table(df: pd.DataFrame) -> List[Dict]:
    """Convert dataframe rows to canonical dicts."""
    def find_col(patterns: List[str]) -> Optional[str]:
        for p in patterns:
            for col in df.columns:
                col_str = str(col).lower().strip()
                if re.fullmatch(p, col_str, re.I) or (p.startswith(r'^') and re.search(p, col_str, re.I)):
                    return col
        for p in patterns:
            for col in df.columns:
                col_str = str(col).lower().strip()
                if re.search(p, col_str, re.I):
                    return col
        return None

    date_col = find_col([r'^transaction\s*date$', r'^txndate$', r'^value\s*date$', r'^issue_date$', r'^date$', r'transaction\s*date', r'txndate', r'value\s*date', r'date'])
    desc_col = find_col([r'^description$', r'^remark$', r'^narration$', r'^particulars$', r'description', r'remark', r'narration', r'particulars', r'transaction\s*details'])
    debit_col = find_col([r'^debit$', r'^withdrawal$', r'^dr\b', r'withdrawal', r'debit', r'dr\b', r'paid\s*out', r'paid'])
    credit_col = find_col([r'^credit$', r'^deposit$', r'^cr\b', r'deposit', r'credit', r'cr\b', r'received', r'paid\s*in'])
    balance_col = find_col([r'^balance$', r'^closing\s*bal$', r'^closing\s*balance$', r'balance', r'closing\s*bal', r'closing\s*balance'])
    ref_col = find_col([r'^ref_no$', r'^ref$', r'^utr$', r'^cheque$', r'^cheque_number$', r'cheque', r'ref\s*no', r'ref', r'utr', r'chq', r'transaction\s*id'])

    vendor_col = find_col([r'^vendor_name$', r'^vendor$', r'^merchant$', r'vendor_name', r'vendor', r'merchant'])
    amount_col = find_col([r'^total$', r'^amount$', r'^gross_amount$', r'^net_settlement$', r'\btotal\b', r'\bamount\b', r'subtotal'])
    currency_col = find_col([r'^currency$', r'currency'])
    invoice_id_col = find_col([r'^invoice_id$', r'^invoice$', r'invoice_id', r'invoice'])
    order_id_col = find_col([r'^order_id$', r'^order$', r'order_id', r'order'])

    records = []
    for _, row in df.iterrows():
        # Date
        raw_date = row[date_col] if date_col and pd.notna(row.get(date_col)) else ""
        parsed_date = parse_flexible_date(str(raw_date)) or (str(raw_date) if str(raw_date).lower() != 'nan' else "")

        # Description
        desc = str(row[desc_col]).strip() if desc_col and pd.notna(row.get(desc_col)) else ""
        if desc.lower() == "nan":
            desc = ""

        # Debit & Credit
        debit_val = clean_amount(row[debit_col]) if debit_col and pd.notna(row.get(debit_col)) else 0.0
        credit_val = clean_amount(row[credit_col]) if credit_col and pd.notna(row.get(credit_col)) else 0.0

        # Balance
        bal_val = clean_amount(row[balance_col]) if balance_col and pd.notna(row.get(balance_col)) else 0.0

        # Cheque number / reference
        ref_val = str(row[ref_col]).strip() if ref_col and pd.notna(row.get(ref_col)) else ""
        if ref_val.lower() == "nan" or ref_val == "-":
            ref_val = ""

        # Skip rows where everything is blank
        if not parsed_date and not desc and debit_val == 0.0 and credit_val == 0.0:
            continue

        canonical = {
            "date": parsed_date,
            "description": desc,
            "debit": debit_val,
            "credit": credit_val,
            "balance": bal_val,
            "cheque_number": ref_val
        }
        if vendor_col and pd.notna(row.get(vendor_col)):
            canonical["vendor"] = str(row[vendor_col]).strip()
        if amount_col and pd.notna(row.get(amount_col)):
            canonical["amount"] = clean_amount(row[amount_col])
        if currency_col and pd.notna(row.get(currency_col)):
            canonical["currency"] = str(row[currency_col]).strip()
        if invoice_id_col and pd.notna(row.get(invoice_id_col)):
            canonical["invoice_id"] = str(row[invoice_id_col]).strip()
        if order_id_col and pd.notna(row.get(order_id_col)):
            canonical["order_id"] = str(row[order_id_col]).strip()

        original = {str(k): (None if pd.isna(v) else v) for k, v in row.to_dict().items()}

        records.append({
            "canonical": canonical,
            "original": original
        })

    return records

# -------------------------------------------------------------------
# LLM fallback (when deterministic detection fails)
# -------------------------------------------------------------------
def llm_detect_headers(lines: List[str]) -> Dict:
    """Use OpenAI-compatible LLM to find the header row and column mapping."""
    if OpenAI is None:
        raise ImportError("OpenAI library not installed – cannot use LLM fallback.")
    api_key = os.environ.get("MODEL_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("API_KEY")
    base_url = os.environ.get("MODEL_BASE_URL") or os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
    model = os.environ.get("MODEL_NAME") or os.environ.get("DEEPSEEK_MODEL") or "deepseek-chat"
    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )
    sample = "\n".join(lines[:30])  # first 30 lines
    prompt = f"""
Given this CSV-like file (first 30 lines shown below), find the row that contains the transaction table header.
Map the columns to these canonical names: date, description, debit, credit, balance, cheque_number.
Return a JSON with:
- header_row_index (0‑based index of the header row)
- column_mapping: {{"original_column_name": "canonical_name"}}
- start_row_index (row where data begins, usually header_row_index + 1)
- end_row_index (optional, if you detect a footer)

File snippet:
{sample}
"""
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)

# -------------------------------------------------------------------
# The MCP Tool
# -------------------------------------------------------------------
@mcp.tool()
def parse_financial_file(file_path: str) -> Dict[str, Any]:
    """
    Parse a raw financial CSV or bank statement file into standardized records.
    Extracts metadata headers, transaction dates, descriptions, debits, credits, and balances.
    Automatically identifies file type (Invoice, Razorpay, or Bank) with deterministic and LLM fallback parsing.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    try:
        # Read file as text
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            raw_lines = f.readlines()
        lines = [line.strip() for line in raw_lines if line.strip() != '']

        if not lines:
            return {"error": "File is empty"}

        # Try deterministic header detection
        header_idx = find_header_row(lines)

        # If not found, use LLM fallback
        if header_idx == -1:
            try:
                mapping = llm_detect_headers(lines)
                header_idx = mapping.get("header_row_index", -1)
                # We could also use column_mapping here, but we'll rely on the deterministic parser's column detection.
            except Exception as e:
                return {"error": f"LLM fallback failed: {str(e)}"}

        if header_idx == -1:
            return {"error": "Could not find transaction header row."}

        # Extract metadata
        metadata = extract_metadata(lines, header_idx)

        # Find footer
        footer_idx = find_footer_row(lines, header_idx + 1)

        # Extract data block
        data_lines = lines[header_idx:footer_idx]
        if len(data_lines) < 2:
            return {"error": "Not enough data rows"}

        # Parse as CSV
        data_str = "\n".join(data_lines)
        try:
            df = pd.read_csv(StringIO(data_str), engine='python')
        except Exception:
            # Manual fallback: split by commas
            header = data_lines[0].split(',')
            rows = [line.split(',') for line in data_lines[1:]]
            max_cols = len(header)
            rows = [row + [''] * (max_cols - len(row)) for row in rows]
            df = pd.DataFrame(rows, columns=header)

        if df.empty:
            return {"error": "Parsed dataframe is empty"}

        transactions = parse_transaction_table(df)

        # Determine file type (heuristic)
        if 'razorpay' in file_path.lower() or 'settlement' in file_path.lower():
            metadata['file_type'] = 'razorpay'
        elif 'invoice' in file_path.lower() or 'billing' in file_path.lower():
            metadata['file_type'] = 'invoice'
        else:
            metadata['file_type'] = 'bank_statement'

        return {
            "metadata": metadata,
            "transactions": transactions,
            "total_transactions": len(transactions)
        }

    except Exception as e:
        return {"error": f"Parser error: {str(e)}"}

# -------------------------------------------------------------------
# Helpers for PennyWise MCP Tools
# -------------------------------------------------------------------

# Paths to standardized data (Adjust these to your actual system paths)
BASE_DIR = Path(__file__).resolve().parent.parent
STANDARDIZED_DIR = BASE_DIR / "standardisation" / "data" / "standardized"
BACKUP_DIR = BASE_DIR / "standardisation" / "data" / "backup"
RECONCILIATION_DIR = BASE_DIR / "reconciliation" / "data"
RECONCILIATION_BACKUP_DIR = BASE_DIR / "reconciliation" / "backup"

# -------------------------------------------------------------------
# In-Memory Global DataStandardizer Singleton (LLM Cache Persistence)
# -------------------------------------------------------------------
_standardizer = None

def get_standardizer(base_currency: str = "INR"):
    """
    Retrieve or lazily initialize the singleton DataStandardizer instance.
    Keeps LLM-processed DataFrames cached in memory across MCP tool invocations.
    """
    global _standardizer
    if _standardizer is None:
        project_root = Path(__file__).resolve().parent.parent
        std_module_path = project_root / "standardisation"
        if str(std_module_path) not in sys.path:
            sys.path.insert(0, str(std_module_path))
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))
        try:
            from standardisation.standardizer import DataStandardizer
        except ImportError:
            from standardizer import DataStandardizer
        _standardizer = DataStandardizer(base_currency=base_currency)
    return _standardizer

def load_df(source: str) -> pd.DataFrame:
    """Load standardized CSV based on source type."""
    file_map = {
        "invoice": "invoice_standardized.csv",
        "razorpay": "razorpay_standardized.csv",
        "bank": "bank_standardized.csv"
    }
    if source not in file_map:
        raise ValueError(f"Invalid source: {source}. Must be invoice, razorpay, or bank.")
    file_path = STANDARDIZED_DIR / file_map[source]
    if not file_path.exists():
        return pd.DataFrame()  # Empty DataFrame if not found
    return pd.read_csv(file_path)

def save_df(source: str, df: pd.DataFrame):
    """Save standardized CSV back to disk."""
    file_map = {
        "invoice": "invoice_standardized.csv",
        "razorpay": "razorpay_standardized.csv",
        "bank": "bank_standardized.csv"
    }
    file_path = STANDARDIZED_DIR / file_map[source]
    df.to_csv(file_path, index=False)

# -------------------------------------------------------------------
# Helper: Parse Exceptions DataFrame & Detect ID Column
# -------------------------------------------------------------------
def _detect_id_column(df: pd.DataFrame) -> Optional[str]:
    """Dynamically detect ID column in DataFrame."""
    candidates = ['source_id', 'exception_id', 'id', 'invoice_id', 'entity_id', 'ref_no']
    for candidate in candidates:
        for col in df.columns:
            if col.lower() == candidate:
                return col
    for col in df.columns:
        if col.lower().endswith('_id'):
            return col
    return None

def _classify_exception_row(record_type: str, reason: str) -> Tuple[str, str]:
    """
    Classify a record into:
    status_type: 'exception' (High Risk / Missing Cash) or 'unallocated_cash' (Medium Risk / Extra Cash)
    severity: 'High' or 'Medium'
    """
    t = str(record_type).lower().strip()
    r = str(reason).lower().strip()

    # Unallocated Cash (Medium Risk / Extra Cash):
    # - Razorpay records with reason == "No matching invoice" (Extra cash sitting at gateway)
    # - Bank records with reason == "No matching invoice" or "No matching Razorpay settlement or invoice" (Extra cash sitting in bank)
    if t == "razorpay" and ("no matching invoice" in r or "without invoice" in r or "unallocated" in r):
        return "unallocated_cash", "Medium"
    if t == "bank" and ("no matching invoice" in r or "without invoice" in r or "unallocated" in r or "settlement or invoice" in r):
        return "unallocated_cash", "Medium"

    # Exceptions (High Risk / Missing Cash):
    # - Invoices with reason == "No matching Razorpay settlement" (You billed, but gateway didn't capture it)
    # - Razorpay with reason == "No matching Bank deposit" (Gateway settled, but bank didn't receive it)
    # - Bank with reason == "No matching Razorpay settlement" (Bank deposit exists, but no gateway matching it)
    return "exception", "High"

def _get_parsed_exceptions_df() -> pd.DataFrame:
    """Load and parse reconciliation_exceptions.csv into a normalized DataFrame with financial classifications."""
    exceptions_file = RECONCILIATION_DIR / "reconciliation_exceptions.csv"
    if not exceptions_file.exists():
        return pd.DataFrame()
    df = pd.read_csv(exceptions_file)
    if df.empty:
        return pd.DataFrame()

    import ast
    id_col_in_df = _detect_id_column(df)
    parsed_rows = []
    for _, row in df.iterrows():
        rec_val = row.get("record", {})
        rec_dict = {}
        if isinstance(rec_val, dict):
            rec_dict = rec_val
        elif isinstance(rec_val, str):
            cleaned = re.sub(r"Timestamp\('([^']*)'\)", r"'\1'", rec_val)
            try:
                rec_dict = ast.literal_eval(cleaned)
            except Exception:
                try:
                    rec_dict = json.loads(cleaned)
                except Exception:
                    rec_dict = {}

        source_id = rec_dict.get("invoice_id") or rec_dict.get("entity_id") or rec_dict.get("ref_no") or rec_dict.get("source_id") or rec_dict.get("exception_id") or rec_dict.get("id", "")
        if not source_id and id_col_in_df and pd.notna(row.get(id_col_in_df)):
            source_id = str(row[id_col_in_df])

        vendor = rec_dict.get("vendor") or row.get("vendor", "")
        amount = rec_dict.get("amount") or row.get("amount", 0.0)
        try:
            amount = float(amount)
        except Exception:
            amount = 0.0
        date_val = str(rec_dict.get("date") or row.get("date", ""))
        rec_type = row.get("type", "unknown")
        raw_reason = row.get("reason", "")
        status_val = str(row.get("status", "Open")).strip()
        status_type, severity = _classify_exception_row(rec_type, raw_reason)
        if status_val.lower() == "resolved":
            status_type = "resolved"
            severity = "Resolved"

        parsed_rows.append({
            "type": rec_type,
            "source_id": str(source_id) if source_id else "",
            "exception_id": str(source_id) if source_id else "",
            "vendor": vendor,
            "amount": amount,
            "date": date_val,
            "reason": raw_reason,
            "status": status_val,
            "status_type": status_type,
            "severity": severity,
            "resolution_note": row.get("resolution_note", ""),
            "resolved_at": row.get("resolved_at", ""),
            "raw_record": row.get("record", "")
        })
    return pd.DataFrame(parsed_rows)

# -------------------------------------------------------------------
# MCP Tools
# -------------------------------------------------------------------

@mcp.tool()
def get_pipeline_state() -> Dict[str, Any]:
    """
    Check the current execution state of the reconciliation pipeline.
    Returns 'RECONCILED' if results exist, 'STANDARDIZED_ONLY' if data is cleaned, or 'NOT_STARTED'.
    Use this to verify whether reconciliation needs to be run before querying results.
    """
    results_file = RECONCILIATION_DIR / "reconciliation_results.csv"
    if results_file.exists():
        return {"state": "RECONCILED"}
    
    inv_file = STANDARDIZED_DIR / "invoice_standardized.csv"
    if inv_file.exists():
        return {"state": "STANDARDIZED_ONLY"}
    
    return {"state": "NOT_STARTED"}

@mcp.tool()
def query_exceptions(
    type: Optional[str] = None,
    exception_type: Optional[str] = None,
    status_type: Optional[str] = "exception",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    vendor: Optional[str] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    search_term: Optional[str] = None,
    limit: Optional[int] = 50
) -> Dict[str, Any]:
    """
    Query and filter reconciliation exceptions or unallocated cash from the latest reconciliation run.
    Supports filtering by status_type ('exception' for High Risk Missing Cash, 'unallocated_cash' for Medium Risk Extra Cash, or 'all').
    
    Financial Categories:
    - When status_type == 'exception' (High Risk / Missing Cash - money expected but not present):
      - Returns Invoices with reason 'No matching Razorpay settlement' (billed, but gateway didn't capture).
      - Returns Razorpay with reason 'No matching Bank deposit' (gateway settled, but bank didn't receive).
      - Returns Bank with reason 'No matching Razorpay settlement' (deposit exists, but no gateway matching).
    - When status_type == 'unallocated_cash' (Medium Risk / Extra Cash - money present without invoice):
      - Returns Razorpay with reason 'No matching invoice' (extra cash sitting at gateway).
      - Returns Bank with reason 'No matching invoice' or 'No matching Razorpay settlement or invoice' (extra cash sitting in bank).
    
    Supports filtering by source type (invoice, razorpay, bank), date range, vendor name, amount, or ID/search term.
    """
    df = _get_parsed_exceptions_df()
    if df.empty:
        return {"error": "No exceptions found. Run reconciliation first."}
    
    # Filter by status_type (exception vs unallocated_cash vs all)
    if status_type:
        st_clean = str(status_type).strip().lower()
        if st_clean in ["exception", "exceptions", "missing_cash", "high_risk"]:
            df = df[df["status_type"] == "exception"]
        elif st_clean in ["unallocated_cash", "unallocated", "extra_cash", "medium_risk"]:
            df = df[df["status_type"] == "unallocated_cash"]
        elif st_clean not in ["all", "*"]:
            df = df[df["status_type"] == st_clean]
    
    filter_type = exception_type or type
    if filter_type and filter_type.lower() not in ["all", "*"]:
        df = df[df['type'].str.lower() == filter_type.lower()]
    
    if date_from and 'date' in df.columns:
        df = df[df['date'].astype(str) >= date_from]
    
    if date_to and 'date' in df.columns:
        df = df[df['date'].astype(str) <= date_to]
    
    if vendor and 'vendor' in df.columns:
        df = df[df['vendor'].str.lower().str.contains(vendor.lower(), na=False)]
    
    if amount_min is not None and 'amount' in df.columns:
        df = df[df['amount'] >= amount_min]
    
    if amount_max is not None and 'amount' in df.columns:
        df = df[df['amount'] <= amount_max]
    
    if search_term:
        term_clean = str(search_term).lower()
        id_col = _detect_id_column(df) or 'source_id'
        mask = df[id_col].astype(str).str.lower().str.contains(term_clean, na=False)
        if 'raw_record' in df.columns:
            mask |= df['raw_record'].astype(str).str.lower().str.contains(term_clean, na=False)
        if 'vendor' in df.columns:
            mask |= df['vendor'].astype(str).str.lower().str.contains(term_clean, na=False)
        df = df[mask]
    
    records = df.head(limit or 50).to_dict(orient='records')
    return {
        "status_type": status_type,
        "exceptions": records,
        "count": len(records),
        "total_exceptions": len(df)
    }

@mcp.tool()
def get_unallocated_cash(
    type: Optional[str] = None,
    vendor: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    search_term: Optional[str] = None,
    limit: Optional[int] = 50
) -> Dict[str, Any]:
    """
    Retrieve unallocated cash entries (Medium Risk / Extra Cash sitting in Razorpay or Bank without matching billing invoices).
    - Returns Razorpay records with reason 'No matching invoice' (extra funds sitting at gateway).
    - Returns Bank records with reason 'No matching invoice' or 'No matching Razorpay settlement or invoice' (extra funds sitting in bank).
    Filters by source (razorpay, bank), vendor, date range, or amount.
    """
    return query_exceptions(
        type=type,
        status_type="unallocated_cash",
        date_from=date_from,
        date_to=date_to,
        vendor=vendor,
        amount_min=amount_min,
        amount_max=amount_max,
        search_term=search_term,
        limit=limit
    )

def _resolve_column_targets(df: pd.DataFrame, col_name: str) -> List[str]:
    """Resolve column name or aliases to actual matching columns in the DataFrame."""
    col_clean = str(col_name).strip().lower()
    matches = []
    
    # 1. Exact match (case-insensitive)
    for c in df.columns:
        if c.lower() == col_clean:
            matches.append(c)
            
    # 2. Vendor alias resolution: vendor, vendor_name, vendor_standardized
    if col_clean in ["vendor", "vendor_standardized", "vendor_name", "vendor_cleaned"]:
        for alias in ["vendor_standardized", "vendor", "vendor_name"]:
            if alias in df.columns and alias not in matches:
                matches.append(alias)
                
    # 3. Description alias resolution
    elif col_clean in ["description", "description_standardized", "desc"]:
        for alias in ["description_standardized", "description"]:
            if alias in df.columns and alias not in matches:
                matches.append(alias)
                
    # 4. Date alias resolution
    elif col_clean in ["date", "date_standardized", "transaction_date"]:
        for alias in ["date_standardized", "date", "transaction_date"]:
            if alias in df.columns and alias not in matches:
                matches.append(alias)
                
    return matches

@mcp.tool()
def bulk_update_csv(source: str, condition: dict, new_values: dict) -> Dict[str, Any]:
    """
    Update field values in bulk across standardized CSV files (invoice, razorpay, bank).
    Matches records using condition dictionary and updates them with new_values dictionary.
    Supports smart column aliases (e.g. 'vendor' maps to 'vendor_standardized' and 'vendor').
    Creates an automatic timestamped backup file before applying any modifications.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    # Validate source
    if source not in ["invoice", "razorpay", "bank"]:
        return {"error": "Invalid source. Must be invoice, razorpay, or bank."}
    
    # Handle case where condition or new_values are passed as stringified JSON
    if isinstance(condition, str):
        try:
            condition = json.loads(condition)
        except Exception:
            condition = {}
    if isinstance(new_values, str):
        try:
            new_values = json.loads(new_values)
        except Exception:
            new_values = {}
    
    # Load Data
    df = load_df(source)
    if df.empty:
        return {"error": f"No data found for source: {source}"}
    
    # Backup first
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_file = BACKUP_DIR / f"{source}_standardized_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(backup_file, index=False)
    
    # Apply bulk update condition matching
    mask = pd.Series(True, index=df.index)
    has_valid_condition = False
    for key, value in condition.items():
        target_cols = _resolve_column_targets(df, key)
        if target_cols:
            has_valid_condition = True
            col_mask = pd.Series(False, index=df.index)
            for c in target_cols:
                col_mask |= df[c].astype(str).str.contains(str(value), case=False, na=False)
            mask &= col_mask
        else:
            # Specified column does not exist in dataset -> 0 matches
            mask = pd.Series(False, index=df.index)
    
    if not has_valid_condition or mask.sum() == 0:
        return {"error": "No records matched the condition. No changes made.", "backup_file": str(backup_file)}
    
    # Apply new values across matched columns
    updated_fields = []
    for key, value in new_values.items():
        target_cols = _resolve_column_targets(df, key)
        for c in target_cols:
            df.loc[mask, c] = value
            updated_fields.append(c)
    
    # Save
    save_df(source, df)
    
    return {
        "success": True,
        "action": "review",
        "source": source,
        "updated_count": int(mask.sum()),
        "updated_fields": list(set(updated_fields)),
        "backup_file": str(backup_file),
        "message": f"Successfully updated {int(mask.sum())} record(s) in {source} (fields: {', '.join(set(updated_fields))})."
    }

@mcp.tool()
def update_csv_record(source: str, record_id: str, field_to_update: str, new_value: Any) -> Dict[str, Any]:
    """
    Update a specific field in a single transaction record by its unique ID.
    Locates the record in invoice_id, entity_id, or ref_no and modifies the target field.
    Supports smart column aliases (e.g. 'vendor' maps to 'vendor_standardized' and 'vendor').
    Creates an automatic timestamped backup file before saving changes.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    # Validate source
    if source not in ["invoice", "razorpay", "bank"]:
        return {"error": "Invalid source. Must be invoice, razorpay, or bank."}
    
    # Load data
    df = load_df(source)
    if df.empty:
        return {"error": f"No data found for source: {source}"}
    
    # Backup
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_file = BACKUP_DIR / f"{source}_standardized_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(backup_file, index=False)
    
    # Determine ID column
    id_col = "invoice_id" if source == "invoice" else ("entity_id" if source == "razorpay" else "ref_no")
    
    # Find the record
    mask = df[id_col].astype(str) == str(record_id)
    if mask.sum() == 0:
        return {"error": f"Record {record_id} not found in {source}.", "backup_file": str(backup_file)}
    
    # Update target column and aliases
    target_cols = _resolve_column_targets(df, field_to_update)
    if not target_cols:
        return {"error": f"Field '{field_to_update}' not found in {source}.", "backup_file": str(backup_file)}
    
    for c in target_cols:
        df.loc[mask, c] = new_value
    
    # Save
    save_df(source, df)
    
    return {
        "success": True,
        "action": "review",
        "source": source,
        "updated_count": 1,
        "updated_fields": target_cols,
        "backup_file": str(backup_file),
        "message": f"Successfully updated record {record_id} in {source}."
    }

@mcp.tool()
def get_standardized_data_preview(source: str, limit: Optional[int] = 10) -> Dict[str, Any]:
    """
    Preview raw standardized transaction rows and schema columns for a given source dataset.
    Returns column names, total row counts, and sample records for invoice, razorpay, or bank files.
    Use this to inspect column names, formatted dates, and converted amounts.
    """
    df = load_df(source)
    if df.empty:
        return {"error": f"No data found for source: {source}"}
    
    records = df.head(limit).to_dict(orient='records')
    return {"columns": list(df.columns), "preview": records, "total_rows": len(df)}

def _generate_creative_dispute_reason(exc_type: str, raw_reason: str, ids: List[str], vendor: str, amount: float, dates: List[str]) -> Tuple[str, str]:
    """Generate a rich, human-like explanation and specific action items for dispute memos."""
    date_str = dates[0] if dates else "the referenced billing period"
    id_str = ", ".join(ids)
    exc_type_lower = str(exc_type).lower()
    raw_reason_lower = str(raw_reason).lower()

    if "settlement" in raw_reason_lower or exc_type_lower == "invoice":
        explanation = (
            f"During our routine periodic accounts reconciliation, our finance team identified an outstanding invoice "
            f"(Ref: {id_str}) dated {date_str} for the total amount of ₹{amount:,.2f} associated with {vendor}. "
            f"While this invoice has been recognized and entered into our general ledger, our payment gateway records "
            f"(Razorpay) and linked corporate bank statements show no corresponding settlement or credit confirmation. "
            f"This indicates a possible delay in payment gateway settlement, an uncaptured transaction authorization, "
            f"or an offline wire transfer that lacks automated reconciliation tracking metadata."
        )
        action = (
            f"1. Please verify whether invoice {id_str} was settled via an alternative payment method, direct NEFT/RTGS, "
            f"or through a separate merchant account.\n"
            f"2. If payment has been executed, kindly furnish the official Bank UTR / Payment Gateway Transaction ID so our "
            f"accounting team can manually match and clear this ledger entry.\n"
            f"3. If this transaction failed, timed out, or was reversed, please confirm so we may issue an adjusted credit note "
            f"or re-initiate payment."
        )
    elif "unallocated" in raw_reason_lower or exc_type_lower == "razorpay" or "without invoice" in raw_reason_lower:
        explanation = (
            f"Our automated financial reconciliation engine detected an unallocated payment gateway settlement credit "
            f"(Payment ID: {id_str}) processed on {date_str} totaling ₹{amount:,.2f} from {vendor}. "
            f"Although these funds have been settled into our accounts, we have been unable to locate or map a matching "
            f"purchase invoice, purchase order, or billing statement in our internal Enterprise Resource Planning (ERP) system."
        )
        action = (
            f"1. Kindly furnish the official tax invoice / billing receipt corresponding to payment ID {id_str}.\n"
            f"2. Please provide the internal purchase order (PO) number or billing contact details associated with this charge "
            f"so we can allocate this disbursement to the correct cost center."
        )
    elif exc_type_lower == "bank":
        explanation = (
            f"Our bank account statement reflects an unallocated credit entry (UTR: {id_str}) received on {date_str} "
            f"for ₹{amount:,.2f}. This direct bank deposit does not correspond to any known customer invoice batch or "
            f"scheduled Razorpay nodal payout."
        )
        action = (
            f"1. Please provide the remittance advice and invoice breakdown for this transfer.\n"
            f"2. Confirm the customer account or business unit originating this deposit to finalize reconciliation."
        )
    else:
        explanation = (
            f"During our 3-way reconciliation audit between vendor invoices, Razorpay gateway settlements, and bank credits, "
            f"an anomaly was flagged for record {id_str} dated {date_str} totaling ₹{amount:,.2f}. "
            f"The audit system flagged the following variance: '{raw_reason}'. To maintain audit readiness and ensure accurate "
            f"tax and financial reporting, this item requires manual clarification."
        )
        action = (
            f"1. Please review your transactional records for {id_str} and verify if any adjustment, discount, or partial settlement occurred.\n"
            f"2. Provide supporting transaction logs or payment receipts to enable our team to reconcile this record."
        )

    return explanation, action

@mcp.tool()
def draft_dispute_memo(exception_ids: List[str], memo_type: str = "vendor_dispute") -> Dict[str, Any]:
    """
    Generate formal dispute and clarification memorandums for specific exception IDs.
    Groups exception details by vendor and formats net amounts, dates, IDs, and dispute reasons.
    Outputs structured memo text ready to send to vendors, gateway support, or banking partners.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    exceptions_file = RECONCILIATION_DIR / "reconciliation_exceptions.csv"
    if not exceptions_file.exists():
        return {"error": "No exceptions found. Run reconciliation first."}

    if isinstance(exception_ids, str):
        exception_ids = [exception_ids]

    df = _get_parsed_exceptions_df()
    if df.empty:
        return {"error": "No exceptions found. Run reconciliation first."}

    # Dynamically detect the ID column name
    id_col = _detect_id_column(df) or "source_id"

    # Search for IDs in detected id column, source_id, exception_id, or raw_record
    clean_ids = [str(x).strip().lower() for x in exception_ids if str(x).strip()]
    mask = pd.Series(False, index=df.index)

    for col in [id_col, "source_id", "exception_id"]:
        if col in df.columns:
            mask |= df[col].astype(str).str.lower().isin(clean_ids)

    if mask.sum() == 0 and "raw_record" in df.columns:
        # Fallback to search inside raw record text
        for eid in clean_ids:
            mask |= df["raw_record"].astype(str).str.lower().str.contains(eid, na=False)

    filtered = df[mask]
    if filtered.empty:
        return {"error": f"No matching exceptions found for ID(s): {', '.join(exception_ids)}. Please check the exception IDs."}

    # Group by vendor for the memo
    memos = []
    for vendor, group in filtered.groupby("vendor"):
        vendor_display = str(vendor).title() if vendor and str(vendor).strip() else "Unknown Vendor"
        amounts = group["amount"].tolist()
        total_amount = sum(amounts)
        ids = [str(x) for x in group[id_col].tolist() if x] or exception_ids
        dates = group["date"].astype(str).tolist()
        reasons = group["reason"].tolist()
        exc_type = group["type"].iloc[0] if "type" in group.columns else "invoice"

        explanation, action = _generate_creative_dispute_reason(
            exc_type=exc_type,
            raw_reason=reasons[0] if reasons else "No matching Razorpay settlement",
            ids=ids,
            vendor=vendor_display,
            amount=total_amount,
            dates=dates
        )

        today_formatted = datetime.now().strftime("%B %d, %Y")
        
        is_unalloc = (
            "unallocated" in str(reasons).lower() or
            "no matching invoice" in str(reasons).lower() or
            exc_type.lower() in ["razorpay", "bank"]
        )
        
        memo_title = "UNALLOCATED CASH & INVOICE REQUEST MEMORANDUM" if is_unalloc else "FINANCIAL RECONCILIATION DISPUTE & CLARIFICATION MEMORANDUM"
        memo_subject = f"Request for Billing Invoice / Remittance Advice — Unallocated Payment Ref: {', '.join(ids)}" if is_unalloc else f"Urgent: Transaction Dispute & Reconciliation Clarification — Ref: {', '.join(ids)}"
        recon_state = "Unallocated Cash (Medium Risk — Unapplied Funds Received)" if is_unalloc else "Unreconciled Exception (High Risk — Action Required)"

        memo = f"""================================================================================
{memo_title}
================================================================================

MEMORANDUM
To:        {vendor_display} (Accounts Receivable / Finance Department)
From:      Finance Reconciliation & Operations Team
Date:      {today_formatted}
Subject:   {memo_subject}

--------------------------------------------------------------------------------
1. TRANSACTION SUMMARY
--------------------------------------------------------------------------------
• Primary Reference / ID(s):  {', '.join(ids)}
• Vendor / Counterparty:      {vendor_display}
• Transaction Date(s):        {', '.join(dates)}
• Financial Exposure:         ₹{total_amount:,.2f} INR
• Reconciliation State:       {recon_state}

--------------------------------------------------------------------------------
2. DETAILED DISPUTE REASON & BACKGROUND
--------------------------------------------------------------------------------
{explanation}

--------------------------------------------------------------------------------
3. REQUIRED ACTION & NEXT STEPS
--------------------------------------------------------------------------------
{action}

--------------------------------------------------------------------------------
4. SENDER CONTACT & CONFIDENTIALITY
--------------------------------------------------------------------------------
Please reply directly to this notice with the requested documentation or contact:
Finance Operations Team | Automated Reconciliation System
Direct Email: finance-reconciliation@internal.corp

================================================================================"""
        memos.append(memo.strip())

    full_text = "\n\n".join(memos)
    return {
        "memos": memos,
        "full_memo_text": full_text,
        "count": len(memos),
        "matched_exceptions": len(filtered),
        "display_instruction": "PRINT THE FULL VERBATIM MEMO TEXT DIRECTLY IN THE RESPONSE"
    }

@mcp.tool()
def draft_unallocated_cash_memo(
    record_ids: Optional[List[str]] = None,
    vendor: Optional[str] = None,
    source_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate formal Accounting Clarification Memorandums for Unallocated Cash entries (Extra Cash in Razorpay or Bank without invoices).
    Drafts professional letters to counterparty finance teams, customers, or internal sales controllers requesting billing tax invoices, PO numbers, or customer account allocations.
    
    Parameters:
    - record_ids: Optional list of payment IDs (e.g. ['pay_xyz']), settlement UTRs, or bank reference numbers.
    - vendor: Optional vendor name to filter unallocated cash records (e.g. 'slack', 'zoho').
    - source_type: Optional source filter ('razorpay', 'bank', or 'all').
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    df = _get_parsed_exceptions_df()
    if df.empty:
        return {"error": "No reconciliation records found. Run reconciliation first."}

    # Filter for Unallocated Cash (Medium Risk / Extra Cash)
    unalloc_df = df[df["status_type"] == "unallocated_cash"].copy()
    if unalloc_df.empty:
        # Fallback to reason filter
        unalloc_df = df[df["reason"].astype(str).str.lower().str.contains("no matching invoice", na=False)].copy()

    if unalloc_df.empty:
        return {"error": "No unallocated cash records found in current reconciliation results."}

    # Apply optional source filter
    if source_type and source_type.strip().lower() not in ["all", "*"]:
        src_clean = source_type.strip().lower()
        unalloc_df = unalloc_df[unalloc_df["type"].astype(str).str.lower() == src_clean]

    # Apply optional vendor filter
    if vendor and vendor.strip():
        v_clean = vendor.strip().lower()
        unalloc_df = unalloc_df[unalloc_df["vendor"].astype(str).str.lower().str.contains(v_clean, na=False)]

    # Apply optional ID filter
    if record_ids:
        if isinstance(record_ids, str):
            record_ids = [record_ids]
        clean_ids = [str(x).strip().lower() for x in record_ids if str(x).strip()]
        id_col = _detect_id_column(unalloc_df) or "source_id"
        mask = pd.Series(False, index=unalloc_df.index)
        for col in [id_col, "source_id", "exception_id"]:
            if col in unalloc_df.columns:
                mask |= unalloc_df[col].astype(str).str.lower().isin(clean_ids)
        if mask.sum() == 0 and "raw_record" in unalloc_df.columns:
            for eid in clean_ids:
                mask |= unalloc_df["raw_record"].astype(str).str.lower().str.contains(eid, na=False)
        unalloc_df = unalloc_df[mask]

    if unalloc_df.empty:
        return {"error": "No unallocated cash records matched the specified filters."}

    id_col = _detect_id_column(unalloc_df) or "source_id"
    today_formatted = datetime.now().strftime("%B %d, %Y")
    memos = []

    for v, group in unalloc_df.groupby("vendor"):
        vendor_display = str(v).title() if v and str(v).strip() else "Unidentified Counterparty"
        amounts = group["amount"].tolist()
        total_amount = sum(amounts)
        ids = [str(x) for x in group[id_col].tolist() if x] or (record_ids or ["UNALLOCATED-RECEIPT"])
        dates = group["date"].astype(str).tolist()
        src_types = group["type"].unique().tolist()
        src_desc = "/".join(str(s).title() for s in src_types)

        memo = f"""================================================================================
UNALLOCATED CASH ALLOCATION & INVOICE REQUEST MEMORANDUM
================================================================================

MEMORANDUM
To:        {vendor_display} (Accounts Receivable / Finance Department)
From:      Finance Controller & Revenue Accounting Operations
Date:      {today_formatted}
Subject:   Request for Billing Invoice / Remittance Advice — Unallocated Receipt Ref: {', '.join(ids)}

--------------------------------------------------------------------------------
1. UNALLOCATED TRANSACTION SUMMARY
--------------------------------------------------------------------------------
• Primary Reference / ID(s):  {', '.join(ids)}
• Originating Counterparty:   {vendor_display}
• Receipt Channel:            {src_desc} Deposit
• Transaction Date(s):        {', '.join(dates)}
• Unallocated Cash Amount:    ₹{total_amount:,.2f} INR
• Financial State:            Unallocated Cash (Medium Risk — Unapplied Funds Received)

--------------------------------------------------------------------------------
2. AUDIT BACKGROUND & LEDGER STATUS
--------------------------------------------------------------------------------
During our automated 3-way reconciliation audit between customer billing invoices, payment gateway settlements, and bank credits, our revenue accounting system identified unallocated receipts totaling ₹{total_amount:,.2f} INR received from {vendor_display}.

These funds are physically present and credited in our {src_desc} accounts. However, our Enterprise Resource Planning (ERP) billing ledger contains NO matching sales tax invoice, purchase order, or billing schedule corresponding to these receipts.

--------------------------------------------------------------------------------
3. REQUIRED ACTIONS FOR LEDGER ALLOCATION & CLEARING
--------------------------------------------------------------------------------
To ensure statutory compliance, accurate revenue recognition, and clean GST/tax reporting, please provide the following:
1. Official Tax Invoice(s) or Billing Statement(s) covering the reference ID(s) {', '.join(ids)}.
2. The internal Customer Account Number, Project Milestone, or Purchase Order (PO) to which these funds should be allocated.
3. If this receipt represents a customer advance payment or security deposit, please confirm so our accounting team can post it to Customer Advance / Unearned Revenue.

--------------------------------------------------------------------------------
4. FINANCE OPERATIONS CONTACT
--------------------------------------------------------------------------------
Please furnish the requested documentation directly to our revenue operations desk:
Revenue Accounting & Financial Operations | Automated Reconciliation System
Direct Email: revenue-accounting@internal.corp

================================================================================"""
        memos.append(memo.strip())

    full_text = "\n\n".join(memos)
    return {
        "memos": memos,
        "full_memo_text": full_text,
        "count": len(memos),
        "total_unallocated_records": len(unalloc_df),
        "total_unallocated_amount": float(unalloc_df["amount"].sum()),
        "display_instruction": "PRINT THE FULL VERBATIM MEMO TEXT DIRECTLY IN THE RESPONSE"
    }

@mcp.tool()
def explain_standardization(source: str = "all") -> Dict[str, Any]:
    """
    Provide clean, business-friendly explanations of the data standardization and normalization process.
    Explains how vendor names were cleaned, dates were formatted to YYYY-MM-DD, and currencies were converted into base currency.
    Use this when a user asks how data was standardized or cleaned.
    """
    return {
        "summary": "Data was standardized into clean, uniform records across invoices, settlements, and bank deposits.",
        "vendors": "Vendor names were cleaned up and normalized. For example, 'Amazon Web Services' became amazon, 'Slack Technologies' became slack, and 'Zoho Corporation' became zoho.",
        "dates": "All dates were converted into a clean, standardized YYYY-MM-DD format (e.g., 2025-09-08).",
        "currencies": "All invoice, settlement, and bank amounts were converted from their original currencies (USD, EUR, GBP, etc.) to the base currency (e.g., INR).",
        "gateway_fees": "Processing fees and taxes are tracked separately, so the 'Net' amount received is slightly less than the invoice amount.",
        "matching": "The system links your invoices to the payments received (Razorpay settlements) and the money that actually hits your bank account."
    }

@mcp.tool()
def standardize_data(base_currency: Optional[str] = None, config_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Re-standardize all raw financial files (invoice, razorpay, bank) into clean, standardized CSVs in-process.
    Optionally changes the base accounting currency (e.g., INR, USD) and recalculates all converted amounts.
    Creates timestamped backups prior to conversion.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    try:
        project_root = Path(__file__).resolve().parent.parent
        std_dir = project_root / "standardisation" / "data" / "standardized"
        raw_dir = project_root / "standardisation" / "data" / "raw"

        # Ensure standardisation module path is in sys.path
        std_module_path = project_root / "standardisation"
        if str(std_module_path) not in sys.path:
            sys.path.insert(0, str(std_module_path))
        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))

        # Determine the base currency
        curr = (base_currency or "INR").strip().upper()

        # Create backup for all standardized files before running
        backups = []
        backup_dir = project_root / "standardisation" / "data" / "backup"
        backup_dir.mkdir(parents=True, exist_ok=True)
        if std_dir.exists():
            for fname in ["invoice_standardized.csv", "razorpay_standardized.csv", "bank_standardized.csv"]:
                src = std_dir / fname
                if src.exists():
                    backup_file = backup_dir / f"{src.stem}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
                    import shutil
                    shutil.copy2(src, backup_file)
                    backups.append(str(backup_file))

        # Get global standardizer and execute full two-phase pipeline
        standardizer = get_standardizer(base_currency=curr)
        standardizer.base_currency = curr
        standardizer.process_files()

        # Synchronize reconciliation results & exceptions to the new base currency
        try:
            from reconciliation.run_reconciliation import run_reconciliation_pipeline
            run_reconciliation_pipeline(project_root=project_root)
        except Exception as rec_err:
            logger.warning(f"Auto-reconciliation after standardization failed: {rec_err}")

        # Reload standardized CSVs to get the state
        invoices = load_df("invoice")
        razorpay = load_df("razorpay")
        bank = load_df("bank")

        return {
            "success": True,
            "action": "standardize",
            "target": curr,
            "new_currency": curr,
            "files_standardized": {
                "invoice": len(invoices),
                "razorpay": len(razorpay),
                "bank": len(bank)
            },
            "backups_created": backups,
            "output": f"Standardized all files to {curr} successfully. Invoice: {len(invoices)} rows, Razorpay: {len(razorpay)} rows, Bank: {len(bank)} rows."
        }
    except Exception as e:
        return {
            "success": False,
            "action": "standardize",
            "error": f"Standardization in-process execution failed: {str(e)}"
        }

PARAMS_FILE = Path(__file__).resolve().parent.parent / "reconciliation" / "params.json"

DEFAULT_MATCHING_PARAMS = {
    "Transaction Amount Tolerance (%)": 5.0,
    "Settlement Date Window (days)": 7,
    "Strict Vendor Matching": False,
    "Importance of Amount Accuracy (%)": 70,
    "Importance of Date Accuracy (%)": 30,
    "Importance of Vendor Match (%)": 0,
    "Match Confidence Cutoff (score)": 0.40,
    "Allow Split Settlements": True,
    "Maximum Invoices per Settlement": 5,
    "Split Amount Tolerance (%)": 20.0
}

def _load_raw_params() -> Dict[str, Any]:
    try:
        if PARAMS_FILE.exists():
            data = json.loads(PARAMS_FILE.read_text(encoding="utf-8"))
            return data.get("accountant_friendly", data)
    except Exception:
        pass
    return DEFAULT_MATCHING_PARAMS.copy()

def _save_raw_params(params: Dict[str, Any]) -> None:
    try:
        PARAMS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PARAMS_FILE.write_text(json.dumps({"accountant_friendly": params}, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to save params.json: {e}")

def _params_to_frontend_dict(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "date_tolerance_days": int(raw.get("Settlement Date Window (days)", 7)),
        "amount_tolerance_pct": float(raw.get("Transaction Amount Tolerance (%)", 5.0)),
        "strict_vendor_matching": bool(raw.get("Strict Vendor Matching", False)),
        "weight_amount": int(raw.get("Importance of Amount Accuracy (%)", 70)),
        "weight_date": int(raw.get("Importance of Date Accuracy (%)", 30)),
        "weight_vendor": int(raw.get("Importance of Vendor Match (%)", 0)),
        "rejection_threshold": float(raw.get("Match Confidence Cutoff (score)", 0.40)),
        "allow_split": bool(raw.get("Allow Split Settlements", True)),
        "max_invoices_per_settlement": int(raw.get("Maximum Invoices per Settlement", 5)),
        "split_tolerance_pct": float(raw.get("Split Amount Tolerance (%)", 20.0)),
    }

@mcp.tool()
def get_matching_parameters() -> Dict[str, Any]:
    """
    Retrieve the current reconciliation matching parameters and tolerance thresholds.
    """
    raw = _load_raw_params()
    params = _params_to_frontend_dict(raw)
    return {
        "status": "success",
        "params": params,
        "raw": raw
    }

@mcp.tool()
def configure_matching_parameters(
    date_tolerance_days: Optional[int] = None,
    amount_tolerance_pct: Optional[float] = None,
    strict_vendor_matching: Optional[bool] = None,
    weight_amount: Optional[int] = None,
    weight_date: Optional[int] = None,
    weight_vendor: Optional[int] = None,
    rejection_threshold: Optional[float] = None,
    allow_split: Optional[bool] = None,
    max_invoices_per_settlement: Optional[int] = None,
    split_tolerance_pct: Optional[float] = None
) -> Dict[str, Any]:
    """
    Configure matching tolerance thresholds and weights for the reconciliation algorithm without running matching.
    Persists parameters to reconciliation/params.json and broadcasts updates to the UI sliders.

    Parameters:
    - date_tolerance_days: Max days allowable between invoice date and bank deposit (e.g., 5, 7, 10).
    - amount_tolerance_pct: Allowed amount variance percentage for fee/rounding diffs (e.g., 5.0).
    - strict_vendor_matching: If True, requires exact vendor matching between records.
    - weight_amount: Hungarian cost weight for amount difference percentage (0-100).
    - weight_date: Hungarian cost weight for date difference percentage (0-100).
    - weight_vendor: Hungarian cost weight for vendor match percentage (0-100).
    - rejection_threshold: Cutoff score penalty above which candidate matches are rejected (e.g., 0.40).
    - allow_split: If True, enables N:1 and 1:N subset-sum split settlement matching.
    - max_invoices_per_settlement: Max invoice batch size for subset-sum split settlements (e.g., 5).
    - split_tolerance_pct: Allowed tolerance percentage for subset-sum batch matching (e.g., 20.0).
    """
    err = require_agentic_mode()
    if err:
        return err

    raw = _load_raw_params()
    changes = []

    if date_tolerance_days is not None:
        raw["Settlement Date Window (days)"] = int(date_tolerance_days)
        changes.append(f"Date Window: {date_tolerance_days} days")
    if amount_tolerance_pct is not None:
        raw["Transaction Amount Tolerance (%)"] = float(amount_tolerance_pct)
        changes.append(f"Amount Variance: {amount_tolerance_pct}%")
    if strict_vendor_matching is not None:
        raw["Strict Vendor Matching"] = bool(strict_vendor_matching)
        changes.append(f"Strict Vendor Matching: {strict_vendor_matching}")
    if weight_amount is not None:
        raw["Importance of Amount Accuracy (%)"] = int(weight_amount)
        changes.append(f"Amount Weight: {weight_amount}%")
    if weight_date is not None:
        raw["Importance of Date Accuracy (%)"] = int(weight_date)
        changes.append(f"Date Weight: {weight_date}%")
    if weight_vendor is not None:
        raw["Importance of Vendor Match (%)"] = int(weight_vendor)
        changes.append(f"Vendor Weight: {weight_vendor}%")
    if rejection_threshold is not None:
        raw["Match Confidence Cutoff (score)"] = float(rejection_threshold)
        changes.append(f"Max Allowed Cost: {rejection_threshold}")
    if allow_split is not None:
        raw["Allow Split Settlements"] = bool(allow_split)
        changes.append(f"Split Settlement: {allow_split}")
    if max_invoices_per_settlement is not None:
        raw["Maximum Invoices per Settlement"] = int(max_invoices_per_settlement)
        changes.append(f"Max Invoices/Batch: {max_invoices_per_settlement}")
    if split_tolerance_pct is not None:
        raw["Split Amount Tolerance (%)"] = float(split_tolerance_pct)
        changes.append(f"Split Tolerance: {split_tolerance_pct}%")

    if not changes:
        return {
            "error": "No matching parameters were provided to update. Specify parameters such as date_tolerance_days or amount_tolerance_pct."
        }

    _save_raw_params(raw)
    updated = _params_to_frontend_dict(raw)

    return {
        "success": True,
        "action": "update_params",
        "target": updated,
        "params": updated,
        "message": f"Matching parameters updated successfully: {', '.join(changes)}. Sliders on frontend updated."
    }

@mcp.tool()
def run_reconciliation(config_overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Execute the Hungarian algorithm matching engine to perform 3-way financial reconciliation.
    Optionally accepts parameter overrides such as amount_tolerance_pct, date_tolerance_days, and split_tolerance_pct.
    Generates new matched triplets results and exceptions datasets in-process.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    try:
        project_root = Path(__file__).resolve().parent.parent
        rec_dir = project_root / "reconciliation"
        std_dir = project_root / "standardisation" / "data" / "standardized"

        if str(rec_dir) not in sys.path:
            sys.path.insert(0, str(rec_dir))

        import config as _cfg
        import run_reconciliation as _rr
        import hungarian_matcher as _hm

        # Build config from params.json with optional overrides
        raw_params = _load_raw_params()
        if config_overrides:
            if "amount_tolerance_pct" in config_overrides:
                raw_params["Transaction Amount Tolerance (%)"] = config_overrides["amount_tolerance_pct"]
            if "date_tolerance_days" in config_overrides:
                raw_params["Settlement Date Window (days)"] = config_overrides["date_tolerance_days"]
            if "strict_vendor_matching" in config_overrides:
                raw_params["Strict Vendor Matching"] = config_overrides["strict_vendor_matching"]
            if "split_tolerance_pct" in config_overrides:
                raw_params["Split Amount Tolerance (%)"] = config_overrides["split_tolerance_pct"]
            if "rejection_threshold" in config_overrides:
                raw_params["Match Confidence Cutoff (score)"] = config_overrides["rejection_threshold"]
            if "allow_split" in config_overrides:
                raw_params["Allow Split Settlements"] = config_overrides["allow_split"]

        cfg = _cfg.ReconciliationConfig(params_dict=raw_params)

        # Load standardized records
        invoices = _rr.load_records(std_dir, "invoice_standardized.csv", "invoice")
        razorpay = _rr.load_records(std_dir, "razorpay_standardized.csv", "razorpay")
        bank = _rr.load_records(std_dir, "bank_standardized.csv", "bank")

        # Locate mapping file
        map_path = project_root / "synthetic data" / "data" / "order_invoice_map.csv"
        if not map_path.exists():
            map_path = rec_dir / "data" / "order_invoice_map.csv"

        matcher = _hm.HungarianMatcher(cfg, map_file_path=map_path if map_path.exists() else None)
        result = matcher.match(invoices, razorpay, bank)

        # Save output datasets to reconciliation/data and reconciliation/
        # First create backup snapshots in reconciliation/backup for existing datasets
        RECONCILIATION_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        for existing_src in [rec_dir / "data" / "reconciliation_exceptions.csv", rec_dir / "data" / "reconciliation_results.csv"]:
            if existing_src.exists() and existing_src.stat().st_size > 0:
                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                b_file = RECONCILIATION_BACKUP_DIR / f"{existing_src.stem}_backup_{ts}.csv"
                if not b_file.exists():
                    shutil.copy2(existing_src, b_file)

        # Save output datasets strictly to reconciliation/data
        RECONCILIATION_DIR.mkdir(parents=True, exist_ok=True)
        triplets_df = pd.DataFrame(result.get("triplets", []))
        exceptions_df = pd.DataFrame(result.get("exceptions", []))

        if not triplets_df.empty and "invoice_ids" in triplets_df.columns:
            triplets_df["invoice_ids"] = triplets_df["invoice_ids"].apply(
                lambda x: ", ".join(x) if isinstance(x, (list, tuple, set)) else str(x)
            )
        if not triplets_df.empty and "razorpay" in triplets_df.columns:
            triplets_df["razorpay_id"] = triplets_df["razorpay"].apply(
                lambda x: x["entity_id"] if isinstance(x, dict) else None
            )
            triplets_df["amount"] = triplets_df["razorpay"].apply(
                lambda x: float(x.get("credit") or x.get("amount") or 0.0) if isinstance(x, dict) else None
            )
            triplets_df["vendor"] = triplets_df["razorpay"].apply(
                lambda x: x.get("vendor") if isinstance(x, dict) else None
            )
            triplets_df["date"] = triplets_df["razorpay"].apply(
                lambda x: x.get("date") if isinstance(x, dict) else None
            )
            triplets_df["settlement_utr"] = triplets_df["razorpay"].apply(
                lambda x: x.get("settlement_utr") if isinstance(x, dict) else None
            )
        if not triplets_df.empty and "bank" in triplets_df.columns:
            triplets_df["bank_ref"] = triplets_df["bank"].apply(
                lambda x: x["ref_no"] if isinstance(x, dict) else None
            )

        drop_cols = [c for c in ["razorpay", "bank"] if c in triplets_df.columns]
        if drop_cols:
            triplets_df.drop(columns=drop_cols, inplace=True)

        triplets_df.to_csv(RECONCILIATION_DIR / "reconciliation_results.csv", index=False)
        exceptions_df.to_csv(RECONCILIATION_DIR / "reconciliation_exceptions.csv", index=False)

        match_rate = result.get("match_rate", 0.0)
        matched_count = result.get("matched_count", 0)
        total_invoices = result.get("total_invoices", len(invoices))
        exceptions_count = len(result.get("exceptions", []))

        return {
            "success": True,
            "action": "reconcile",
            "match_rate": round(match_rate, 2),
            "matched_count": matched_count,
            "total_invoices": total_invoices,
            "exceptions_count": exceptions_count,
            "output": f"Reconciliation completed successfully. Match Rate: {match_rate:.2f}% ({matched_count}/{total_invoices} invoices matched, {exceptions_count} exceptions identified)."
        }

    except Exception as e:
        return {
            "success": False,
            "action": "reconcile",
            "error": f"Reconciliation in-process execution failed: {str(e)}"
        }

@mcp.tool()
def change_currency_and_date(
    base_currency: Optional[str] = None,
    date_format: Optional[str] = None
) -> Dict[str, Any]:
    """
    Update base accounting currency (e.g. 'USD', 'EUR', 'INR') and/or standard date format (e.g. 'YYYY-MM-DD', 'DD/MM/YYYY')
    across all financial files using cached in-memory LLM data. This is an instant (<0.2s), LLM-free deterministic operation.
    
    Parameters:
    - base_currency: Optional base accounting currency code (e.g. 'USD', 'EUR', 'INR', 'GBP', 'AED', 'SGD').
    - date_format: Optional date format (e.g. 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY').
    
    Creates automatic timestamped backups under standardisation/data/backup prior to overwriting datasets.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    if base_currency is None and date_format is None:
        return {
            "error": "No currency or date format changes requested. Please provide base_currency (e.g., 'USD', 'INR') and/or date_format (e.g., 'DD/MM/YYYY')."
        }

    try:
        import shutil
        
        project_root = Path(__file__).resolve().parent.parent
        std_dir = project_root / "standardisation" / "data" / "standardized"
        backup_dir = project_root / "standardisation" / "data" / "backup"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backups = []
        if std_dir.exists():
            for fname in ["invoice_standardized.csv", "razorpay_standardized.csv", "bank_standardized.csv"]:
                src = std_dir / fname
                if src.exists():
                    backup_file = backup_dir / f"{src.stem}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
                    shutil.copy2(src, backup_file)
                    backups.append(str(backup_file))

        # Get global standardizer
        curr = base_currency.strip().upper() if base_currency else None
        standardizer = get_standardizer(base_currency=curr or "INR")

        # If LLM data is not cached, populate from disk or run process_llm
        if not standardizer._llm_data:
            try:
                standardizer.load_or_process_llm()
            except Exception as e:
                return {"error": f"LLM standardisation data not found. Please run full standardisation first: {str(e)}"}

        # Apply deterministic normalisation (<0.2s without invoking LLM)
        standardizer.apply_deterministic(base_currency=curr, date_format=date_format)

        # Synchronize reconciliation results & exceptions to the new base currency
        try:
            from reconciliation.run_reconciliation import run_reconciliation_pipeline
            run_reconciliation_pipeline(project_root=project_root)
        except Exception as rec_err:
            logger.warning(f"Auto-reconciliation after currency change failed: {rec_err}")

        # Reload standardized CSVs to get current state
        invoices = load_df("invoice")
        razorpay = load_df("razorpay")
        bank = load_df("bank")

        active_currency = standardizer.base_currency

        return {
            "success": True,
            "action": "standardize",
            "target": active_currency,
            "base_currency": active_currency,
            "date_format": date_format,
            "files_standardized": {
                "invoice": len(invoices),
                "razorpay": len(razorpay),
                "bank": len(bank)
            },
            "backups_created": backups,
            "message": f"Deterministic normalisation applied successfully (Base Currency: {active_currency}{f', Date Format: {date_format}' if date_format else ''}). Reconciliation datasets synchronized."
        }
    except Exception as e:
        return {
            "success": False,
            "action": "standardize",
            "error": f"Failed to apply deterministic normalisation: {str(e)}"
        }

@mcp.tool()
def revert_last_action(backup_file: Optional[str] = None) -> Dict[str, Any]:
    """
    Restore a standardized CSV file from a specified backup snapshot under standardisation/data/backup.
    Overwrites current standardized data with the selected historical snapshot to undo previous edits.
    Re-run reconciliation after reverting to ensure results remain in sync.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    import shutil

    # If no specific backup file provided or requested 'latest', find the most recent backup
    backup_path: Optional[Path] = None
    if not backup_file or str(backup_file).strip().lower() in ["latest", "last", "most_recent", ""]:
        candidates = []
        if BACKUP_DIR.exists():
            candidates.extend(BACKUP_DIR.glob("*_backup_*.csv"))
        if RECONCILIATION_BACKUP_DIR.exists():
            candidates.extend(RECONCILIATION_BACKUP_DIR.glob("*_backup_*.csv"))
        if STANDARDIZED_DIR.exists():
            candidates.extend(STANDARDIZED_DIR.glob("*_backup_*.csv"))
        if not candidates:
            return {"error": "No backup files available to revert to."}
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        backup_path = candidates[0]
    else:
        raw_target = str(backup_file).strip().strip("'\"")
        p = Path(raw_target)
        if p.is_absolute() and p.exists():
            backup_path = p
        elif (BACKUP_DIR / raw_target).exists():
            backup_path = BACKUP_DIR / raw_target
        elif (RECONCILIATION_BACKUP_DIR / raw_target).exists():
            backup_path = RECONCILIATION_BACKUP_DIR / raw_target
        elif (STANDARDIZED_DIR / raw_target).exists():
            backup_path = STANDARDIZED_DIR / raw_target
        elif (BASE_DIR / raw_target).exists():
            backup_path = BASE_DIR / raw_target
        elif (RECONCILIATION_DIR / raw_target).exists():
            backup_path = RECONCILIATION_DIR / raw_target
        else:
            clean_name = Path(raw_target).name
            matches = list(BACKUP_DIR.glob(f"*{clean_name}*")) if BACKUP_DIR.exists() else []
            if not matches and RECONCILIATION_BACKUP_DIR.exists():
                matches = list(RECONCILIATION_BACKUP_DIR.glob(f"*{clean_name}*"))
            if not matches and STANDARDIZED_DIR.exists():
                matches = list(STANDARDIZED_DIR.glob(f"*{clean_name}*"))
            if matches:
                backup_path = matches[0]
            else:
                return {"error": f"Backup file not found: {backup_file}. Use list_backups to view available backup snapshots."}

    stem = backup_path.stem
    if "_backup_" not in stem:
        return {"error": f"Invalid backup file name format: {backup_path.name}. Expected filename containing '_backup_'"}
    
    parts = stem.rsplit('_backup_', 1)
    prefix = parts[0]
    
    if prefix in ["reconciliation_exceptions", "reconciliation_results"]:
        target_destinations = [RECONCILIATION_DIR / f"{prefix}.csv"]
        original_path = target_destinations[0]
    else:
        original_name = f"{prefix}.csv" if not prefix.endswith(".csv") else prefix
        target_destinations = [STANDARDIZED_DIR / original_name]
        original_path = target_destinations[0]

    try:
        for dest in target_destinations:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup_path, dest)
        row_count = None
        try:
            restored_df = pd.read_csv(original_path)
            row_count = len(restored_df)
        except Exception:
            pass

        return {
            "success": True,
            "action": "revert",
            "restored_file": str(original_path),
            "from_backup": str(backup_path),
            "rows_restored": row_count,
            "message": f"Successfully reverted {original_path.name} from backup snapshot {backup_path.name}."
        }
    except Exception as copy_err:
        return {"error": f"Failed to restore backup file: {str(copy_err)}"}

@mcp.tool()
def list_backups() -> Dict[str, Any]:
    """
    List all available historical backup snapshots across standardisation/data/backup and reconciliation/backup
    with creation timestamps, file sizes, and source types.
    Use this to identify which backup file path to pass into revert_last_action.
    Provides complete audit trail information of saved states.
    """
    backups = []
    seen_paths = set()

    # Search reconciliation/backup for reconciliation backups
    if RECONCILIATION_BACKUP_DIR.exists():
        for file in RECONCILIATION_BACKUP_DIR.glob("*_backup_*.csv"):
            resolved = str(file.resolve())
            if resolved in seen_paths:
                continue
            seen_paths.add(resolved)
            stat = file.stat()
            source_type = "reconciliation_exceptions" if "exceptions" in file.name.lower() else "reconciliation_results"
            try:
                rel_path = str(file.relative_to(BASE_DIR)).replace("\\", "/")
            except Exception:
                rel_path = str(file)
            backups.append({
                "filename": file.name,
                "path": str(file),
                "relative_path": rel_path,
                "source": source_type,
                "created": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "size_kb": round(stat.st_size / 1024, 2),
                "_mtime": stat.st_mtime
            })

    # Search standardisation/data/backup first
    if BACKUP_DIR.exists():
        for file in BACKUP_DIR.glob("*_backup_*.csv"):
            resolved = str(file.resolve())
            if resolved in seen_paths:
                continue
            seen_paths.add(resolved)
            stat = file.stat()
            source_type = "invoice" if "invoice" in file.name.lower() else ("razorpay" if "razorpay" in file.name.lower() else ("bank" if "bank" in file.name.lower() else "standardized"))
            try:
                rel_path = str(file.relative_to(BASE_DIR)).replace("\\", "/")
            except Exception:
                rel_path = str(file)
            backups.append({
                "filename": file.name,
                "path": str(file),
                "relative_path": rel_path,
                "source": source_type,
                "created": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "size_kb": round(stat.st_size / 1024, 2),
                "_mtime": stat.st_mtime
            })

    # Also search STANDARDIZED_DIR for any legacy backups
    if STANDARDIZED_DIR.exists():
        for file in STANDARDIZED_DIR.glob("*_backup_*.csv"):
            resolved = str(file.resolve())
            if resolved in seen_paths:
                continue
            seen_paths.add(resolved)
            stat = file.stat()
            source_type = "invoice" if "invoice" in file.name.lower() else ("razorpay" if "razorpay" in file.name.lower() else ("bank" if "bank" in file.name.lower() else "standardized"))
            try:
                rel_path = str(file.relative_to(BASE_DIR)).replace("\\", "/")
            except Exception:
                rel_path = str(file)
            backups.append({
                "filename": file.name,
                "path": str(file),
                "relative_path": rel_path,
                "source": source_type,
                "created": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "size_kb": round(stat.st_size / 1024, 2),
                "_mtime": stat.st_mtime
            })

    # Sort descending by creation timestamp (most recent first)
    backups.sort(key=lambda x: x["_mtime"], reverse=True)
    for b in backups:
        del b["_mtime"]

    return {
        "backups": backups,
        "count": len(backups),
        "backup_directory": str(RECONCILIATION_BACKUP_DIR),
        "standardization_backup_directory": str(BACKUP_DIR),
        "latest_backup": backups[0] if backups else None
    }

# -------------------------------------------------------------------
# Advanced Analytics & Reporting MCP Tools
# -------------------------------------------------------------------

@mcp.tool()
def get_summary_stats() -> Dict[str, Any]:
    """
    Compute aggregate reconciliation KPIs, status distribution, and complete financial flow realisation analytics.
    Leverages pre-computed reconciliation outputs and dynamically tracks live user exception resolutions.
    Returns:
    - Executive Overview KPIs: Total Invoiced (Gross Target), Total Settled & Credited, Discrepancy Variance, Resolved records.
    - Status Distribution Donut Analytics: Record Coverage Rate %, Matched Triplets, Unallocated Cash records, Missing Cash Exceptions, and Resolved count.
    - Invoice Match Rate Gauge: Matched Invoices Rate %, Matched Invoices count, Missing Invoices count, Total Invoices.
    - Financial Flow & Settlement Realisation (Waterfall Flow):
      1. Gross Pay (Billed volume / Target)
      2. Net Income In-Hand (Operating profit credited to bank from customer invoices)
      3. Government Tax (Sales tax / GST on invoices for statutory remittance)
      4. Razorpay Deductions (MDR Transaction Fee + Gateway GST)
      5. Missing Cash (Billed invoices not yet captured/settled by gateway)
      6. Unallocated Cash (Extra payments received without matching invoices)
      - Complete balanced realization equation string.
    Use this whenever the user asks for reconciliation results, overview, metrics, charts, or financial analysis.
    """
    # 1. Use the already computed baseline values from reconciliation summary
    try:
        from run_reconciliation import get_reconciliation_results_summary
    except ImportError:
        try:
            from reconciliation.run_reconciliation import get_reconciliation_results_summary
        except ImportError:
            sys.path.insert(0, str(BASE_DIR / "reconciliation"))
            from run_reconciliation import get_reconciliation_results_summary

    summary = get_reconciliation_results_summary(project_root=BASE_DIR)

    total_inv = float(summary.get("totalInvoiceAmount", 0.0))
    total_inv_tax = float(summary.get("totalInvoiceTax", 0.0))
    total_settled = float(summary.get("totalSettledAmount", 0.0))
    total_bank = float(summary.get("totalBankCredit", 0.0))
    total_fee_amt = float(summary.get("totalFeeAmount", 0.0))
    discrepancy_amt = float(summary.get("discrepancyAmount", 0.0))
    total_triplets = int(summary.get("matchedCount", 0))

    # 2. Live exception and resolution tracking (dynamically reflects user actions/resolutions)
    parsed_exc_df = _get_parsed_exceptions_df()
    unallocated_df = parsed_exc_df[parsed_exc_df["status_type"] == "unallocated_cash"] if not parsed_exc_df.empty else pd.DataFrame()
    exceptions_df = parsed_exc_df[parsed_exc_df["status_type"] == "exception"] if not parsed_exc_df.empty else pd.DataFrame()
    resolved_df = parsed_exc_df[parsed_exc_df["status_type"] == "resolved"] if not parsed_exc_df.empty else pd.DataFrame()

    unallocated_count = len(unallocated_df)
    unallocated_amt = float(unallocated_df[unallocated_df["type"].str.lower() == "razorpay"]["amount"].sum()) if not unallocated_df.empty else (
        float(unallocated_df["amount"].sum()) / 2.0 if not unallocated_df.empty else 0.0
    )
    audit_exceptions_count = len(exceptions_df)
    total_uncollected_amt = float(exceptions_df[exceptions_df["type"].str.lower() == "invoice"]["amount"].sum()) if not exceptions_df.empty else float(summary.get("totalUncollectedAmount", 0.0))
    resolved_count = len(resolved_df)
    total_resolved_amount = float(resolved_df["amount"].sum()) if not resolved_df.empty else 0.0

    # 3. Dynamic audit universe and coverage
    total_audit_universe = total_triplets + unallocated_count + audit_exceptions_count + resolved_count
    record_coverage_rate = round((total_triplets / total_audit_universe) * 100, 2) if total_audit_universe > 0 else 100.0

    # 4. Matched Invoices Count & Gauge
    triplets = summary.get("triplets", [])
    matched_inv_ids = set()
    for t in triplets:
        for inv_id in t.get("invoice_ids", []):
            if inv_id:
                matched_inv_ids.add(inv_id)
        if not t.get("invoice_ids") and t.get("invoice_id"):
            for inv_id in str(t.get("invoice_id")).split(","):
                inv_clean = inv_id.strip()
                if inv_clean:
                    matched_inv_ids.add(inv_clean)

    inv_df = load_df("invoice")
    total_invoices_count = len(inv_df) if not inv_df.empty else (len(matched_inv_ids) + audit_exceptions_count)
    matched_invoices_count = len(matched_inv_ids)
    invoice_match_rate = round((matched_invoices_count / total_invoices_count) * 100, 2) if total_invoices_count > 0 else 0.0
    missing_invoices_count = max(0, total_invoices_count - matched_invoices_count)

    # 5. Financial Flow Realisation (Net In-Hand derived strictly from matched customer invoices)
    net_in_hand = max(0.0, total_inv - (total_inv_tax + total_fee_amt + total_uncollected_amt))
    safe_gross = total_inv if total_inv > 0 else 1.0

    # Razorpay fee breakdown if present
    rp_df = load_df("razorpay")
    total_mdr_fee = float(rp_df["fee"].fillna(0).sum()) / 100.0 if not rp_df.empty and "fee" in rp_df.columns else round(total_fee_amt * 0.8475, 2)
    total_gateway_tax = float(rp_df["tax"].fillna(0).sum()) / 100.0 if not rp_df.empty and "tax" in rp_df.columns else round(total_fee_amt - total_mdr_fee, 2)

    return {
        "status": "success",
        # ── 1. Top Executive KPIs ──
        "executive_kpis": {
            "total_invoiced_amount": round(total_inv, 2),
            "total_settled_and_credited": round(total_settled, 2),
            "discrepancy_variance": round(discrepancy_amt, 2),
            "resolved_records_count": resolved_count,
            "total_resolved_amount": round(total_resolved_amount, 2),
        },
        # ── 2. Invoice Match Rate Gauge ──
        "invoice_match_rate_gauge": {
            "matched_invoices_rate_pct": invoice_match_rate,
            "matched_invoices_count": matched_invoices_count,
            "missing_cash_invoices_count": missing_invoices_count,
            "total_invoices_count": total_invoices_count,
            "description": f"Executive reconciliation realization: {matched_invoices_count}/{total_invoices_count} customer invoices ({invoice_match_rate}%) verified against gateway payouts."
        },
        # ── 3. Reconciliation Status Distribution (Donut Chart) ──
        "status_distribution_donut": {
            "record_coverage_rate_pct": record_coverage_rate,
            "matched_triplets_count": total_triplets,
            "matched_triplets_pct": round((total_triplets / (total_audit_universe or 1)) * 100, 1),
            "unallocated_cash_count": unallocated_count,
            "unallocated_cash_pct": round((unallocated_count / (total_audit_universe or 1)) * 100, 1),
            "unallocated_cash_amount": round(unallocated_amt, 2),
            "missing_cash_exceptions_count": audit_exceptions_count,
            "missing_cash_exceptions_pct": round((audit_exceptions_count / (total_audit_universe or 1)) * 100, 1),
            "missing_cash_amount": round(total_uncollected_amt, 2),
            "resolved_records_count": resolved_count,
            "resolved_records_pct": round((resolved_count / (total_audit_universe or 1)) * 100, 1),
            "total_audit_universe_records": total_audit_universe,
            "description": f"Distribution across {total_audit_universe} records: {total_triplets} Matched ({round((total_triplets / (total_audit_universe or 1)) * 100, 1)}%), {unallocated_count} Unallocated ({round((unallocated_count / (total_audit_universe or 1)) * 100, 1)}%), {audit_exceptions_count} Exceptions ({round((audit_exceptions_count / (total_audit_universe or 1)) * 100, 1)}%)."
        },
        # ── 4. Financial Flow & Settlement Realisation (Waterfall Flow) ──
        "financial_flow_realisation": {
            "gross_pay_billed": {
                "label": "Gross Pay (Billed)",
                "amount": round(total_inv, 2),
                "percent_of_gross": 100.0,
                "description": "Total gross revenue billed to customers (Benchmark Target)"
            },
            "net_income_in_hand": {
                "label": "Net Income (In-Hand)",
                "amount": round(net_in_hand, 2),
                "percent_of_gross": round((net_in_hand / safe_gross) * 100, 1),
                "description": "Net operating profit credited to bank from customer invoices"
            },
            "government_tax": {
                "label": "Government Tax (Invoice Tax)",
                "amount": round(total_inv_tax, 2),
                "percent_of_gross": round((total_inv_tax / safe_gross) * 100, 1),
                "description": "Sales tax / GST on customer invoices collected for statutory remittance"
            },
            "razorpay_deductions": {
                "label": "Razorpay Deductions (Fees & Gateway Tax)",
                "amount": round(total_fee_amt, 2),
                "percent_of_gross": round((total_fee_amt / safe_gross) * 100, 1),
                "processing_fee": round(total_mdr_fee, 2),
                "gateway_tax": round(total_gateway_tax, 2),
                "description": "Total payment gateway deductions (MDR Transaction Fee + GST on fee)"
            },
            "missing_cash_exceptions": {
                "label": "Missing Cash (Exceptions / Uncollected)",
                "amount": round(total_uncollected_amt, 2),
                "percent_of_gross": round((total_uncollected_amt / safe_gross) * 100, 1),
                "description": "Billed invoices not yet captured or settled by payment gateway"
            },
            "unallocated_cash": {
                "label": "Unallocated Cash (Extra Gateway Receipts)",
                "amount": round(unallocated_amt, 2),
                "percent_of_gross": round((unallocated_amt / safe_gross) * 100, 1),
                "description": "Extra payments received in Razorpay/Bank without matching invoices"
            },
            "balance_flow_equation": f"Gross Billed (₹{total_inv:,.2f}) = Net In-Hand (₹{net_in_hand:,.2f}) + Govt Tax (₹{total_inv_tax:,.2f}) + Razorpay Deductions (₹{total_fee_amt:,.2f}) + Missing Cash (₹{total_uncollected_amt:,.2f})"
        },
        # ── 5. Backwards Compatibility Flat Fields ──
        "total_invoice_amount": round(total_inv, 2),
        "total_invoice_tax": round(total_inv_tax, 2),
        "total_settled_amount": round(total_settled, 2),
        "total_bank_credit": round(total_bank, 2),
        "discrepancy": round(discrepancy_amt, 2),
        "discrepancy_variance": round(discrepancy_amt, 2),
        "match_rate": invoice_match_rate,
        "invoice_match_rate": invoice_match_rate,
        "record_coverage_rate": record_coverage_rate,
        "total_invoices": total_invoices_count,
        "matched_invoices": matched_invoices_count,
        "unmatched_invoices": missing_invoices_count,
        "total_triplets": total_triplets,
        "unallocated_count": unallocated_count,
        "unallocated_amount": round(unallocated_amt, 2),
        "audit_exceptions_count": audit_exceptions_count,
        "missing_cash_amount": round(total_uncollected_amt, 2),
        "resolved_count": resolved_count,
        "total_resolved_amount": round(total_resolved_amount, 2),
        "total_fee_amount": round(total_fee_amt, 2),
        "net_income_in_hand": round(net_in_hand, 2),
        "total_razorpay_settlements": len(rp_df) if not rp_df.empty else 0,
        "total_bank_deposits": len(load_df("bank")) if not load_df("bank").empty else 0
    }

@mcp.tool()
def aggregate_exceptions_by_vendor(
    type: Optional[str] = None,
    status_type: Optional[str] = None,
    sort_by: str = "count"
) -> Dict[str, Any]:
    """
    Group unreconciled exceptions or unallocated cash by vendor with record counts and total financial exposure.
    Accepts optional source type filter ('invoice', 'razorpay', 'bank'), status_type ('exception', 'unallocated_cash', 'all'), and sort order ('count' or 'amount').
    Use this to identify top problematic vendors causing reconciliation gaps.
    """
    df = _get_parsed_exceptions_df()
    if df.empty:
        return {"error": "No exceptions found. Run reconciliation first."}

    if status_type:
        st_clean = str(status_type).strip().lower()
        if st_clean in ["exception", "exceptions", "missing_cash", "high_risk"]:
            df = df[df["status_type"] == "exception"]
        elif st_clean in ["unallocated_cash", "unallocated", "extra_cash", "medium_risk"]:
            df = df[df["status_type"] == "unallocated_cash"]
        elif st_clean not in ["all", "*"]:
            df = df[df["status_type"] == st_clean]

    if type and type.lower() not in ["all", "*"]:
        df = df[df["type"].str.lower() == type.lower()]
        if df.empty:
            return {"vendors": [], "total_vendors": 0, "total_exception_amount": 0.0, "message": f"No records for type '{type}'."}

    grouped = []
    for vendor, group in df.groupby("vendor"):
        vendor_name = vendor if vendor else "unknown"
        tot_amt = float(group["amount"].sum())
        grouped.append({
            "vendor": vendor_name,
            "exception_count": int(len(group)),
            "total_amount": round(tot_amt, 2),
            "types": list(group["type"].unique()),
            "source_ids": [str(s) for s in group["source_id"].unique() if s]
        })

    if sort_by.lower() == "amount":
        grouped.sort(key=lambda x: x["total_amount"], reverse=True)
    else:
        grouped.sort(key=lambda x: (x["exception_count"], x["total_amount"]), reverse=True)

    total_amt = sum(v["total_amount"] for v in grouped)
    return {
        "filter_type": type,
        "status_type": status_type,
        "sort_by": sort_by,
        "total_vendors": len(grouped),
        "total_exception_amount": round(total_amt, 2),
        "vendors": grouped
    }

@mcp.tool()
def get_total_gateway_fees(date_from: Optional[str] = None, date_to: Optional[str] = None) -> Dict[str, Any]:
    """
    Calculate total payment gateway processing fees and taxes charged on Razorpay transactions.
    Supports optional date range filtering by settlement date (YYYY-MM-DD format).
    Returns transaction count, total fee deduction, total tax, and combined gateway deductions.
    """
    df = load_df("razorpay")
    if df.empty:
        return {"error": "No razorpay data found."}

    date_col = "settled_at_standardized" if "settled_at_standardized" in df.columns else (
        "date_standardized" if "date_standardized" in df.columns else "date"
    )
    if date_from and date_col in df.columns:
        df = df[df[date_col].astype(str) >= date_from]
    if date_to and date_col in df.columns:
        df = df[df[date_col].astype(str) <= date_to]

    if df.empty:
        return {"total_transactions": 0, "total_fee": 0.0, "total_tax": 0.0, "total_gateway_fees": 0.0, "message": "No transactions found in date range."}

    total_fee = 0.0
    total_tax = 0.0

    if "fee" in df.columns and "tax" in df.columns:
        total_fee = float(df["fee"].fillna(0).sum()) / 100.0
        total_tax = float(df["tax"].fillna(0).sum()) / 100.0
    elif "amount_converted" in df.columns and "credit_converted" in df.columns:
        gross = df["amount_converted"].fillna(0).sum()
        net = df["credit_converted"].fillna(0).sum()
        total_fee = float(gross - net)

    total_gateway_fees = total_fee + total_tax
    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_transactions": len(df),
        "total_fee": round(total_fee, 2),
        "total_tax": round(total_tax, 2),
        "total_gateway_fees": round(total_gateway_fees, 2)
    }

@mcp.tool()
def get_matched_triplets(
    type: Optional[str] = None,
    vendor: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: Optional[int] = 50
) -> Dict[str, Any]:
    """
    Retrieve successfully matched 3-way reconciliation records linking Invoice, Razorpay, and Bank data.
    Filters matched triplets by vendor name or date range with enriched amounts and transaction references.
    Use this to audit reconciled line items and confirm settlement accuracy.
    """
    results_file = RECONCILIATION_DIR / "reconciliation_results.csv"
    if not results_file.exists():
        return {"error": "No reconciliation results found. Run reconciliation first."}

    df = pd.read_csv(results_file)
    if df.empty:
        return {"matched_triplets": [], "count": 0}

    inv_df = load_df("invoice")
    if not inv_df.empty:
        inv_map = {}
        for _, row in inv_df.iterrows():
            inv_map[str(row.get("invoice_id"))] = {
                "vendor": row.get("vendor_standardized", row.get("vendor", "")),
                "date": str(row.get("date_standardized", row.get("date", ""))),
                "amount": float(row.get("amount_converted", 0.0))
            }

        vendors = []
        dates = []
        amounts = []
        for inv_val in df["invoice_ids"]:
            first_inv = str(inv_val).split(",")[0].strip()
            info = inv_map.get(first_inv, {})
            vendors.append(info.get("vendor", ""))
            dates.append(info.get("date", ""))
            amounts.append(info.get("amount", 0.0))

        df["vendor"] = vendors
        df["date"] = dates
        df["amount"] = amounts

    if vendor and "vendor" in df.columns:
        df = df[df["vendor"].astype(str).str.lower().str.contains(vendor.lower(), na=False)]
    if date_from and "date" in df.columns:
        df = df[df["date"].astype(str) >= date_from]
    if date_to and "date" in df.columns:
        df = df[df["date"].astype(str) <= date_to]

    records = df.head(limit or 50).to_dict(orient="records")
    return {"matched_triplets": records, "count": len(records), "total_matched": len(df)}

@mcp.tool()
def export_to_csv(
    data_type: str,
    filters: Optional[dict] = None,
    output_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Export filtered reconciliation data, exceptions, or standardized datasets into a downloadable CSV file.
    Accepts target data_type ('exceptions', 'results', 'invoice', 'razorpay', 'bank') and optional filter criteria.
    Saves the file to workspace/uploads/ (or custom path) and returns the file path and row count.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    if isinstance(filters, str):
        try:
            filters = json.loads(filters)
        except Exception:
            filters = {}
    filters = filters or {}

    dt_lower = data_type.lower().strip()
    if dt_lower in ["exceptions", "exception"]:
        df = _get_parsed_exceptions_df()
        st = filters.get("status_type", "exception") if isinstance(filters, dict) else "exception"
        if st and st.lower() not in ["all", "*"]:
            if st.lower() in ["exception", "exceptions", "missing_cash", "high_risk"]:
                df = df[df["status_type"] == "exception"]
            elif st.lower() in ["unallocated_cash", "unallocated", "extra_cash", "medium_risk"]:
                df = df[df["status_type"] == "unallocated_cash"]
            else:
                df = df[df["status_type"] == st.lower()]
    elif dt_lower in ["unallocated", "unallocated_cash"]:
        df = _get_parsed_exceptions_df()
        df = df[df["status_type"] == "unallocated_cash"]
    elif dt_lower in ["results", "triplets", "matched"]:
        results_file = RECONCILIATION_DIR / "reconciliation_results.csv"
        df = pd.read_csv(results_file) if results_file.exists() else pd.DataFrame()
    elif dt_lower in ["invoice", "razorpay", "bank"]:
        df = load_df(dt_lower)
    else:
        return {"error": f"Unknown data_type: {data_type}. Must be exceptions, unallocated_cash, results, invoice, razorpay, or bank."}

    if df.empty:
        return {"error": f"No data found for data_type: {data_type}"}

    for k, v in filters.items():
        if k == "status_type":
            continue
        if k in df.columns and v is not None:
            if isinstance(v, (int, float)):
                df = df[df[k] == v]
            else:
                df = df[df[k].astype(str).str.lower().str.contains(str(v).lower(), na=False)]

    if not output_path:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        uploads_dir = BASE_DIR / "chat-bot" / "workspace" / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        out_file = uploads_dir / f"{dt_lower}_export_{ts}.csv"
    else:
        out_file = Path(output_path)
        out_file.parent.mkdir(parents=True, exist_ok=True)

    df.to_csv(out_file, index=False)
    return {
        "success": True,
        "file_path": str(out_file),
        "rows_exported": len(df),
        "data_type": data_type
    }

@mcp.tool()
def search_transactions(search_term: str) -> Dict[str, Any]:
    """
    Execute a unified search across all 3 standardized datasets (Invoice, Razorpay, Bank).
    Matches search query against invoice IDs, payment IDs, bank UTRs, order numbers, vendors, and descriptions.
    Returns matched records grouped by source along with total match count.
    """
    term = str(search_term).lower().strip()
    if not term:
        return {"error": "search_term cannot be empty."}

    results = {
        "invoice": [],
        "razorpay": [],
        "bank": [],
        "total_matches": 0
    }

    inv_df = load_df("invoice")
    if not inv_df.empty:
        cols_to_search = [c for c in ["invoice_id", "order_id", "vendor_standardized", "vendor", "description"] if c in inv_df.columns]
        mask = pd.Series(False, index=inv_df.index)
        for col in cols_to_search:
            mask |= inv_df[col].astype(str).str.lower().str.contains(term, na=False)
        matched_inv = inv_df[mask].head(20).to_dict(orient="records")
        results["invoice"] = matched_inv

    rp_df = load_df("razorpay")
    if not rp_df.empty:
        cols_to_search = [c for c in ["entity_id", "order_id", "settlement_utr", "vendor_standardized", "description"] if c in rp_df.columns]
        mask = pd.Series(False, index=rp_df.index)
        for col in cols_to_search:
            mask |= rp_df[col].astype(str).str.lower().str.contains(term, na=False)
        matched_rp = rp_df[mask].head(20).to_dict(orient="records")
        results["razorpay"] = matched_rp

    bank_df = load_df("bank")
    if not bank_df.empty:
        cols_to_search = [c for c in ["ref_no", "cheque_number", "vendor_standardized", "description"] if c in bank_df.columns]
        mask = pd.Series(False, index=bank_df.index)
        for col in cols_to_search:
            mask |= bank_df[col].astype(str).str.lower().str.contains(term, na=False)
        matched_bank = bank_df[mask].head(20).to_dict(orient="records")
        results["bank"] = matched_bank

    results["total_matches"] = len(results["invoice"]) + len(results["razorpay"]) + len(results["bank"])
    return results

@mcp.tool()
def get_top_exceptions(limit: Optional[int] = 5, status_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Retrieve the top N highest-value reconciliation exceptions ranked by amount.
    Supports optional status_type filter ('exception' for Missing Cash, 'unallocated_cash' for Extra Cash, or 'all').
    Returns transaction details, affected vendors, missing amounts, and failure causes.
    Use this to prioritize investigation on the largest financial discrepancies first.
    """
    df = _get_parsed_exceptions_df()
    if df.empty:
        return {"error": "No exceptions found. Run reconciliation first."}

    if status_type:
        st_clean = str(status_type).strip().lower()
        if st_clean in ["exception", "exceptions", "missing_cash", "high_risk"]:
            df = df[df["status_type"] == "exception"]
        elif st_clean in ["unallocated_cash", "unallocated", "extra_cash", "medium_risk"]:
            df = df[df["status_type"] == "unallocated_cash"]
        elif st_clean not in ["all", "*"]:
            df = df[df["status_type"] == st_clean]

    top_df = df.sort_values(by="amount", ascending=False).head(limit or 5)
    records = top_df.to_dict(orient="records")
    return {
        "status_type": status_type,
        "top_exceptions": records,
        "count": len(records),
        "total_exceptions": len(df)
    }

@mcp.tool()
def mark_exceptions_resolved(
    exception_ids: List[str],
    resolution_note: str,
    skip_agentic_check: bool = False
) -> Dict[str, Any]:
    """
    Mark specific exception records as 'Resolved' in the reconciliation exceptions registry.
    Creates an automatic backup file, records resolution timestamps, and appends accountant explanation notes.
    Use this after verifying offline settlements or manual payments with external parties.
    """
    # ---- AGENTIC CHECK ----
    if not skip_agentic_check:
        err = require_agentic_mode()
        if err:
            return err

    exceptions_file = RECONCILIATION_DIR / "reconciliation_exceptions.csv"
    if not exceptions_file.exists():
        alt_file = BASE_DIR / "reconciliation" / "reconciliation_exceptions.csv"
        if alt_file.exists():
            exceptions_file = alt_file
        else:
            return {"error": "No exceptions file found."}

    df = pd.read_csv(exceptions_file)
    if df.empty:
        return {"error": "Exceptions file is empty."}

    RECONCILIATION_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_file = RECONCILIATION_BACKUP_DIR / f"reconciliation_exceptions_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(backup_file, index=False)

    # Convert all string columns to object/str to avoid pandas float64 assignment errors
    for col in ["status", "resolution_note", "resolved_at", "type", "reason"]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(object)

    if isinstance(exception_ids, str):
        exception_ids = [exception_ids]

    clean_ids = [str(x).strip().lower() for x in exception_ids if str(x).strip()]
    updated_count = 0
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for idx, row in df.iterrows():
        rec_str = str(row.get("record", ""))
        row_id_str = (
            str(row.get("id", "")) + " " +
            str(row.get("source_id", "")) + " " +
            str(row.get("invoice_id", "")) + " " +
            str(row.get("entity_id", "")) + " " +
            str(row.get("ref_no", "")) + " " +
            f"exc-{1001 + idx} exc_{1001 + idx} exc-{idx} exc_{idx}"
        )
        combined_text = (rec_str + " " + row_id_str).lower()
        
        matches = any(eid in combined_text for eid in clean_ids)
        if matches:
            df.at[idx, "status"] = "Resolved"
            existing_note = str(df.at[idx, "resolution_note"]) if pd.notna(df.at[idx, "resolution_note"]) and str(df.at[idx, "resolution_note"]).lower() != "nan" else ""
            new_note = f"{existing_note}; {resolution_note}".strip("; ") if existing_note else resolution_note
            df.at[idx, "resolution_note"] = new_note
            df.at[idx, "resolved_at"] = now_str
            updated_count += 1

    df.to_csv(exceptions_file, index=False)

    # Compute updated counts per status_type
    parsed_df = _get_parsed_exceptions_df()
    exc_count = int(len(parsed_df[parsed_df["status_type"] == "exception"])) if not parsed_df.empty else 0
    unalloc_count = int(len(parsed_df[parsed_df["status_type"] == "unallocated_cash"])) if not parsed_df.empty else 0
    resolved_count = int(len(parsed_df[parsed_df["status_type"] == "resolved"])) if not parsed_df.empty else 0
    total_count = int(len(parsed_df)) if not parsed_df.empty else 0

    stats = {
        "exceptions": exc_count,
        "unallocated_cash": unalloc_count,
        "resolved": resolved_count,
        "total": total_count,
    }

    return {
        "success": True,
        "resolved_count": updated_count,
        "backup_file": str(backup_file),
        "exception_ids": exception_ids,
        "resolution_note": resolution_note,
        "stats": stats,
        "message": f"Successfully marked {updated_count} record(s) as Resolved."
    }

@mcp.tool()
def resolve_exceptions_bulk(
    exception_ids: List[str],
    mode: str = "direct",
    resolution_note: Optional[str] = None,
    skip_agentic_check: bool = False
) -> Dict[str, Any]:
    """
    Resolve one or multiple reconciliation exceptions (Missing Cash or Unallocated Cash) via 3 workflows:
    - mode="memo": Drafts professional dispute or invoice allocation memos for user review with requires_confirmation=True.
    - mode="direct": Direct resolution with accountant notes.
    - mode="manual": One-click manual resolution with default audit trail note.
    """
    # ---- AGENTIC CHECK ----
    if not skip_agentic_check:
        err = require_agentic_mode()
        if err:
            return err

    if isinstance(exception_ids, str):
        exception_ids = [exception_ids]

    if not exception_ids:
        return {"error": "exception_ids cannot be empty."}

    mode_clean = str(mode).lower().strip()

    if mode_clean == "memo":
        # Check whether records are predominantly unallocated cash or missing cash
        parsed_df = _get_parsed_exceptions_df()
        is_unalloc = False
        if not parsed_df.empty:
            clean_ids = [str(x).strip().lower() for x in exception_ids if str(x).strip()]
            mask = pd.Series(False, index=parsed_df.index)
            for col in ["source_id", "exception_id"]:
                if col in parsed_df.columns:
                    mask |= parsed_df[col].astype(str).str.lower().isin(clean_ids)
            if mask.sum() == 0 and "raw_record" in parsed_df.columns:
                for eid in clean_ids:
                    mask |= parsed_df["raw_record"].astype(str).str.lower().str.contains(eid, na=False)
            matched_subset = parsed_df[mask]
            if not matched_subset.empty:
                unalloc_rows = matched_subset[matched_subset["status_type"] == "unallocated_cash"]
                if len(unalloc_rows) >= len(matched_subset) / 2:
                    is_unalloc = True

        if is_unalloc:
            memo_res = draft_unallocated_cash_memo(record_ids=exception_ids)
        else:
            memo_res = draft_dispute_memo(exception_ids=exception_ids)

        if "error" in memo_res:
            return memo_res

        return {
            "success": True,
            "mode": "memo",
            "requires_confirmation": True,
            "exception_ids": exception_ids,
            "memo_type": "unallocated_cash" if is_unalloc else "dispute",
            "memo_text": memo_res.get("full_memo_text", ""),
            "memos": memo_res.get("memos", []),
            "message": "Dispute/Allocation memorandum generated. Please review and confirm resolution."
        }

    elif mode_clean == "manual":
        note = resolution_note or "Resolved manually by user"
        return mark_exceptions_resolved(exception_ids=exception_ids, resolution_note=note, skip_agentic_check=skip_agentic_check)

    elif mode_clean == "direct":
        note = resolution_note or "Directly resolved by user"
        return mark_exceptions_resolved(exception_ids=exception_ids, resolution_note=note, skip_agentic_check=skip_agentic_check)

    else:
        return {"error": f"Invalid mode '{mode}'. Must be 'memo', 'direct', or 'manual'."}

# -------------------------------------------------------------------
# Email Generation Tool for Vendor / Counterparty Resolution
# (Supports both Missing Cash Exceptions and Unallocated Cash Records)
# -------------------------------------------------------------------
@mcp.tool()
def generate_email_from_exception(
    exception_ids: List[str],
    recipient_email: str,
    sender_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate a professional email draft (subject + body) in a conversational tone to send to a vendor, counterparty, or customer regarding one or more reconciliation exceptions or unallocated cash entries.
    
    Supports both:
    1. Exceptions / Missing Cash (Invoice Discrepancies, Missing Gateway Settlements, Missing Bank Deposits)
    2. Unallocated Cash / Extra Cash (Payments received in Razorpay/Bank without corresponding invoices)
    
    Parameters:
    - exception_ids: List of exception source IDs, invoice numbers, payment IDs (e.g. ['pay_123'], ['INV-1001']), or bank references.
    - recipient_email: Recipient's email address (e.g. 'finance@vendor.com').
    - sender_name: Optional sender name (e.g. 'PennyWise Finance Team').
    
    Returns structured email draft with subject, body, to, exception_ids, category, and summary stats.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    if not exception_ids:
        return {"error": "exception_ids cannot be empty."}
    if not recipient_email or "@" not in recipient_email:
        return {"error": "A valid recipient_email is required."}

    if isinstance(exception_ids, str):
        exception_ids = [exception_ids]

    df = _get_parsed_exceptions_df()
    id_col = _detect_id_column(df) or "source_id" if not df.empty else "source_id"
    clean_ids = [str(x).strip().lower() for x in exception_ids if str(x).strip()]

    matched_records = []
    if not df.empty:
        mask = pd.Series(False, index=df.index)
        for col in [id_col, "source_id", "exception_id"]:
            if col in df.columns:
                mask |= df[col].astype(str).str.lower().isin(clean_ids)
        if mask.sum() == 0 and "raw_record" in df.columns:
            for eid in clean_ids:
                mask |= df["raw_record"].astype(str).str.lower().str.contains(eid, na=False)
        matched_records = df[mask].to_dict(orient="records")

    sender_signoff = sender_name or "PennyWise Finance & Reconciliation Team"

    # Group records by vendor so each distinct vendor gets its own distinct email draft
    vendor_groups: Dict[str, List[Dict[str, Any]]] = {}
    if matched_records:
        for r in matched_records:
            v = str(r.get("vendor", "")).strip()
            v_name = v.title() if v and v.lower() != "nan" else "Vendor"
            if v_name not in vendor_groups:
                vendor_groups[v_name] = []
            vendor_groups[v_name].append(r)
    else:
        # Fallback if no specific rows were found in dataframe
        vendor_groups["Vendor"] = [{"source_id": eid, "amount": 0.0} for eid in exception_ids]

    emails_list = []
    total_amount_all = 0.0

    for vendor_name, records in vendor_groups.items():
        v_total = sum(float(r.get("amount", 0.0) or 0.0) for r in records)
        total_amount_all += v_total
        
        v_ids = []
        for r in records:
            eid = str(r.get(id_col) or r.get("source_id") or r.get("exception_id") or "").strip()
            if eid and eid not in v_ids:
                v_ids.append(eid)
        if not v_ids:
            v_ids = exception_ids

        v_dates = [str(r.get("date", "")).strip() for r in records if str(r.get("date", "")).strip() and str(r.get("date", "")).strip().lower() != "nan"]
        v_reasons = [str(r.get("reason", "")).strip() for r in records if str(r.get("reason", "")).strip() and str(r.get("reason", "")).strip().lower() != "nan"]
        
        v_id_str = ", ".join(v_ids)
        v_amount_str = f"₹{v_total:,.2f}" if v_total > 0 else "the referenced amount"
        v_dates_str = ", ".join(dict.fromkeys(v_dates)) if v_dates else "Recent"
        v_primary_reason = v_reasons[0] if v_reasons else "No matching settlement or deposit found"

        is_unalloc = any(
            str(r.get("status_type", "")).lower() == "unallocated_cash" or
            "unallocated" in str(r.get("reason", "")).lower() or
            "no matching invoice" in str(r.get("reason", "")).lower() or
            str(r.get("type", "")).lower() in ["razorpay", "bank"]
            for r in records
        )

        display_vendor = vendor_name if vendor_name != "Vendor" else "Team"

        if is_unalloc:
            v_subject = f"Clarification on Unallocated Payment – Ref: {v_id_str}"
            v_body = f"""Hi {display_vendor},

I hope this email finds you well.

I'm reaching out from our finance and reconciliation team regarding an unallocated payment record we received:

• Reference ID(s): {v_id_str}
• Counterparty / Vendor: {vendor_name}
• Amount: {v_amount_str}
• Date: {v_dates_str}
• Details: {v_primary_reason}

We currently have this payment recorded in our payment gateway/bank statement without a matching billing invoice in our system. Could you please help us with the relevant tax invoice or remittance advice so we can allocate and credit this payment accurately to your account?

Thank you for your assistance. Please let us know if you need any additional information from our side.

Warm regards,
{sender_signoff}"""
        else:
            v_subject = f"Reconciliation Inquiry – Ref: {v_id_str}"
            v_body = f"""Hi {display_vendor},

I hope you're having a good week.

I'm writing from the finance and accounting team regarding the following transaction in our 3-way reconciliation audit:

• Reference / Invoice ID(s): {v_id_str}
• Vendor / Counterparty: {vendor_name}
• Amount: {v_amount_str}
• Transaction Date: {v_dates_str}
• Issue Identified: {v_primary_reason}

During our audit, we identified that the corresponding settlement or bank deposit has not been reflected for this invoice. Could you please verify the payment status on your end or share the settlement reference/UTR number so we can match and close this in our books?

We appreciate your prompt support in resolving this discrepancy. Please feel free to reply directly to this email with any updates or questions.

Warm regards,
{sender_signoff}"""

        emails_list.append({
            "to": recipient_email.strip(),
            "subject": v_subject.strip(),
            "body": v_body.strip(),
            "vendor": vendor_name,
            "exception_ids": v_ids,
            "total_amount": round(v_total, 2),
            "exception_count": len(v_ids),
            "category": "unallocated_cash" if is_unalloc else "exception",
        })

    first_email = emails_list[0] if emails_list else {}

    return {
        "success": True,
        "email_count": len(emails_list),
        "emails": emails_list,
        "subject": first_email.get("subject", ""),
        "body": first_email.get("body", ""),
        "to": recipient_email.strip(),
        "exception_ids": exception_ids,
        "vendor": first_email.get("vendor", ""),
        "total_amount": round(total_amount_all, 2),
        "exception_count": len(exception_ids),
        "category": first_email.get("category", "exception"),
        "formatted_email": "\n\n---\n\n".join(
            f"📧 To: {e['to']}\nSubject: {e['subject']}\nVendor: {e['vendor']}\n\n{e['body']}"
            for e in emails_list
        )
    }

# -------------------------------------------------------------------
# Run the server
# -------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run(transport="stdio")