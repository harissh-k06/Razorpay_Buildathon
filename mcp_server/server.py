import os
import sys
import time
import json
import re
import pandas as pd
from pathlib import Path
from io import StringIO
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from fastmcp import FastMCP
from dotenv import load_dotenv
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)
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
        for col in df.columns:
            col_str = str(col).lower().strip()
            if any(re.search(p, col_str, re.I) for p in patterns):
                return col
        return None

    date_col = find_col([r'transaction\s*date', r'txndate', r'value\s*date', r'date'])
    desc_col = find_col([r'remark', r'narration', r'description', r'particulars', r'transaction\s*details'])
    debit_col = find_col([r'withdrawal', r'debit', r'dr\b', r'paid\s*out', r'paid'])
    credit_col = find_col([r'deposit', r'credit', r'cr\b', r'received', r'paid\s*in'])
    balance_col = find_col([r'balance', r'closing\s*bal', r'closing\s*balance'])
    ref_col = find_col([r'cheque', r'ref\s*no', r'ref', r'utr', r'chq', r'transaction\s*id'])

    vendor_col = find_col([r'vendor_name', r'vendor', r'merchant'])
    amount_col = find_col([r'total', r'amount', r'subtotal', r'net_settlement'])
    currency_col = find_col([r'currency'])
    invoice_id_col = find_col([r'invoice_id', r'invoice'])
    order_id_col = find_col([r'order_id', r'order'])

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
    """Use DeepSeek to find the header row and column mapping."""
    if OpenAI is None:
        raise ImportError("OpenAI library not installed – cannot use LLM fallback.")
    client = OpenAI(
        api_key=os.environ.get("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com"
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
        model="deepseek-chat",
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
RECONCILIATION_DIR = BASE_DIR / "reconciliation" / "data"

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
        status_type, severity = _classify_exception_row(rec_type, raw_reason)

        parsed_rows.append({
            "type": rec_type,
            "source_id": str(source_id) if source_id else "",
            "exception_id": str(source_id) if source_id else "",
            "vendor": vendor,
            "amount": amount,
            "date": date_val,
            "reason": raw_reason,
            "status": row.get("status", "Open"),
            "status_type": status_type,
            "severity": severity,
            "resolution_note": row.get("resolution_note", ""),
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

@mcp.tool()
def bulk_update_csv(source: str, condition: dict, new_values: dict) -> Dict[str, Any]:
    """
    Update field values in bulk across standardized CSV files (invoice, razorpay, bank).
    Matches records using condition dictionary and updates them with new_values dictionary.
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
    backup_file = STANDARDIZED_DIR / f"{source}_standardized_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(backup_file, index=False)
    
    # Apply bulk update
    mask = pd.Series(True, index=df.index)
    for key, value in condition.items():
        if key in df.columns:
            mask &= df[key].astype(str).str.contains(str(value), case=False, na=False)
    
    if mask.sum() == 0:
        return {"error": "No records matched the condition. No changes made.", "backup_file": str(backup_file)}
    
    for key, value in new_values.items():
        if key in df.columns:
            df.loc[mask, key] = value
    
    # Save
    save_df(source, df)
    
    return {
        "success": True,
        "action": "review",
        "updated_count": int(mask.sum()),
        "backup_file": str(backup_file)
    }

@mcp.tool()
def update_csv_record(source: str, record_id: str, field_to_update: str, new_value: Any) -> Dict[str, Any]:
    """
    Update a specific field in a single transaction record by its unique ID.
    Locates the record in invoice_id, entity_id, or ref_no and modifies the target field.
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
    backup_file = STANDARDIZED_DIR / f"{source}_standardized_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(backup_file, index=False)
    
    # Determine ID column
    id_col = "invoice_id" if source == "invoice" else ("entity_id" if source == "razorpay" else "ref_no")
    
    # Find the record
    mask = df[id_col].astype(str) == str(record_id)
    if mask.sum() == 0:
        return {"error": f"Record {record_id} not found in {source}.", "backup_file": str(backup_file)}
    
    # Update
    if field_to_update in df.columns:
        df.loc[mask, field_to_update] = new_value
    else:
        return {"error": f"Field {field_to_update} not found.", "backup_file": str(backup_file)}
    
    # Save
    save_df(source, df)
    
    return {"success": True, "updated_count": 1, "backup_file": str(backup_file)}

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

        # Import standardizer
        try:
            from standardisation.standardizer import DataStandardizer
        except ImportError:
            from standardizer import DataStandardizer

        # Determine the base currency
        curr = (base_currency or "INR").strip().upper()

        # Create backup for all standardized files before running
        backups = []
        if std_dir.exists():
            for fname in ["invoice_standardized.csv", "razorpay_standardized.csv", "bank_standardized.csv"]:
                src = std_dir / fname
                if src.exists():
                    backup_file = std_dir / f"{src.stem}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
                    import shutil
                    shutil.copy2(src, backup_file)
                    backups.append(str(backup_file))

        # Instantiate and run the standardizer in-process
        standardizer = DataStandardizer(base_currency=curr)
        standardizer.process_files()

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

        # Build config
        params_dict = {}
        if config_overrides:
            if "amount_tolerance_pct" in config_overrides:
                params_dict["Transaction Amount Tolerance (%)"] = config_overrides["amount_tolerance_pct"]
            if "date_tolerance_days" in config_overrides:
                params_dict["Settlement Date Window (days)"] = config_overrides["date_tolerance_days"]
            if "strict_vendor_matching" in config_overrides:
                params_dict["Strict Vendor Matching"] = config_overrides["strict_vendor_matching"]
            if "split_tolerance_pct" in config_overrides:
                params_dict["Split Amount Tolerance (%)"] = config_overrides["split_tolerance_pct"]

        cfg = _cfg.ReconciliationConfig(params_dict=params_dict if params_dict else None)

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
        out_dirs = [rec_dir / "data", rec_dir]
        for out_dir in out_dirs:
            out_dir.mkdir(parents=True, exist_ok=True)
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
            if not triplets_df.empty and "bank" in triplets_df.columns:
                triplets_df["bank_ref"] = triplets_df["bank"].apply(
                    lambda x: x["ref_no"] if isinstance(x, dict) else None
                )

            drop_cols = [c for c in ["razorpay", "bank"] if c in triplets_df.columns]
            if drop_cols:
                triplets_df.drop(columns=drop_cols, inplace=True)

            triplets_df.to_csv(out_dir / "reconciliation_results.csv", index=False)
            exceptions_df.to_csv(out_dir / "reconciliation_exceptions.csv", index=False)

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
def change_base_currency(new_currency: str) -> Dict[str, Any]:
    """
    Change the base accounting currency and re-run standardization across all financial files.
    Converts invoice amounts and settlements to the requested currency code (e.g., USD, EUR, INR).
    Creates backups prior to converting and recalculating converted columns.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    import subprocess
    import sys
    
    project_root = Path(__file__).resolve().parent.parent
    curr = str(new_currency).strip().upper()
    std_script = project_root / "standardisation" / "standardizer.py"
    res = subprocess.run([sys.executable, str(std_script), curr], capture_output=True, text=True, timeout=180)
    if res.returncode != 0:
        return {"error": res.stderr.strip() or res.stdout.strip() or f"Standardization failed with code {res.returncode}"}
    return {
        "success": True,
        "action": "standardize",
        "target": curr,
        "new_currency": curr,
        "message": f"Standardized all files to new base currency {curr}."
    }

@mcp.tool()
def revert_last_action(backup_file: str) -> Dict[str, Any]:
    """
    Restore a standardized CSV file from a specified .bak backup file.
    Overwrites current standardized data with the selected historical snapshot to undo previous edits.
    Re-run reconciliation after reverting to ensure results remain in sync.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    backup_path = Path(backup_file)
    if not backup_path.exists():
        return {"error": f"Backup file not found: {backup_file}"}
    
    # Determine original file name (remove _backup_YYYYMMDD_HHMMSS)
    parts = backup_path.stem.rsplit('_backup_', 1)
    if len(parts) != 2:
        return {"error": "Invalid backup file name format."}
    
    original_name = parts[0] + ".csv"
    original_path = STANDARDIZED_DIR / original_name
    
    # Restore
    import shutil
    shutil.copy2(backup_path, original_path)
    
    return {"success": True, "restored_file": str(original_path), "from_backup": str(backup_path)}

@mcp.tool()
def list_backups() -> Dict[str, Any]:
    """
    List all available historical .bak backup files with creation timestamps and file sizes.
    Use this to identify which backup file path to pass into revert_last_action.
    Provides complete audit trail information of saved states.
    """
    backups = []
    for file in STANDARDIZED_DIR.glob("*_backup_*.csv"):
        stat = file.stat()
        backups.append({
            "filename": file.name,
            "path": str(file),
            "created": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            "size_kb": round(stat.st_size / 1024, 2)
        })
    
    return {"backups": backups, "count": len(backups)}

# -------------------------------------------------------------------
# Advanced Analytics & Reporting MCP Tools
# -------------------------------------------------------------------

@mcp.tool()
def get_summary_stats() -> Dict[str, Any]:
    """
    Compute aggregate reconciliation KPIs across all standardized datasets.
    Returns total invoice amounts, Razorpay settled credits, bank credits, discrepancy, and 3-way match rate percentage.
    Use this whenever the user asks for a high-level financial reconciliation overview or summary statistics.
    """
    inv_df = load_df("invoice")
    rp_df = load_df("razorpay")
    bank_df = load_df("bank")

    total_inv = float(inv_df["amount_converted"].sum()) if not inv_df.empty and "amount_converted" in inv_df.columns else 0.0
    total_settled = float(rp_df["credit_converted"].sum()) if not rp_df.empty and "credit_converted" in rp_df.columns else (
        float(rp_df["amount_converted"].sum()) if not rp_df.empty and "amount_converted" in rp_df.columns else 0.0
    )
    total_bank = float(bank_df["credit_converted"].sum()) if not bank_df.empty and "credit_converted" in bank_df.columns else 0.0

    results_file = RECONCILIATION_DIR / "reconciliation_results.csv"
    match_rate = 0.0
    matched_invoices_count = 0
    total_invoices_count = len(inv_df) if not inv_df.empty else 0

    if results_file.exists() and total_invoices_count > 0:
        res_df = pd.read_csv(results_file)
        if not res_df.empty and "invoice_ids" in res_df.columns:
            matched_inv_ids = set()
            for val in res_df["invoice_ids"].dropna():
                for item in str(val).split(","):
                    item_clean = item.strip()
                    if item_clean:
                        matched_inv_ids.add(item_clean)
            matched_invoices_count = len(matched_inv_ids)
            match_rate = round((matched_invoices_count / total_invoices_count) * 100, 2)

    return {
        "total_invoice_amount": round(total_inv, 2),
        "total_settled_amount": round(total_settled, 2),
        "total_bank_credit": round(total_bank, 2),
        "discrepancy": round(abs(total_inv - total_settled), 2),
        "match_rate": match_rate,
        "total_invoices": total_invoices_count,
        "matched_invoices": matched_invoices_count,
        "unmatched_invoices": max(0, total_invoices_count - matched_invoices_count),
        "total_razorpay_settlements": len(rp_df) if not rp_df.empty else 0,
        "total_bank_deposits": len(bank_df) if not bank_df.empty else 0
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
def mark_exceptions_resolved(exception_ids: List[str], resolution_note: str) -> Dict[str, Any]:
    """
    Mark specific exception records as 'Resolved' in the reconciliation exceptions registry.
    Creates an automatic backup file, records resolution timestamps, and appends accountant explanation notes.
    Use this after verifying offline settlements or manual payments with external parties.
    """
    # ---- AGENTIC CHECK ----
    err = require_agentic_mode()
    if err:
        return err

    exceptions_file = RECONCILIATION_DIR / "reconciliation_exceptions.csv"
    if not exceptions_file.exists():
        return {"error": "No exceptions file found."}

    df = pd.read_csv(exceptions_file)
    if df.empty:
        return {"error": "Exceptions file is empty."}

    backup_file = RECONCILIATION_DIR / f"reconciliation_exceptions_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(backup_file, index=False)

    if "status" not in df.columns:
        df["status"] = "Open"
    if "resolution_note" not in df.columns:
        df["resolution_note"] = ""
    if "resolved_at" not in df.columns:
        df["resolved_at"] = ""

    if isinstance(exception_ids, str):
        exception_ids = [exception_ids]

    updated_count = 0
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for idx, row in df.iterrows():
        rec_str = str(row.get("record", ""))
        matches = any(eid in rec_str for eid in exception_ids)
        if matches:
            df.at[idx, "status"] = "Resolved"
            existing_note = str(df.at[idx, "resolution_note"]) if pd.notna(df.at[idx, "resolution_note"]) else ""
            new_note = f"{existing_note}; {resolution_note}".strip("; ") if existing_note else resolution_note
            df.at[idx, "resolution_note"] = new_note
            df.at[idx, "resolved_at"] = now_str
            updated_count += 1

    df.to_csv(exceptions_file, index=False)
    return {
        "success": True,
        "resolved_count": updated_count,
        "backup_file": str(backup_file),
        "exception_ids": exception_ids,
        "resolution_note": resolution_note
    }



# -------------------------------------------------------------------
# Run the server
# -------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run(transport="stdio")