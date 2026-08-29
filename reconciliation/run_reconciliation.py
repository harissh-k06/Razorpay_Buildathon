import sys
import os
import pandas as pd
from pathlib import Path
from typing import Dict, Any, List, Optional

# Ensure package imports work
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from config import ReconciliationConfig
from hungarian_matcher import HungarianMatcher

def load_records(data_dir: Path, file_name: str, record_type: str) -> List[Dict[str, Any]]:
    """Load standardized CSV and convert to list of dicts with correct fields."""
    file_path = data_dir / file_name
    if not file_path.exists():
        return []

    df = pd.read_csv(file_path)
    records = []
    # Explicit mapping of date column for each source type
    if record_type == 'invoice':
        date_col = 'date_standardized' if 'date_standardized' in df.columns else ('issue_date_standardized' if 'issue_date_standardized' in df.columns else 'date')
    elif record_type == 'razorpay':
        date_col = 'settled_at_standardized' if 'settled_at_standardized' in df.columns else ('date_standardized' if 'date_standardized' in df.columns else 'date')
    elif record_type == 'bank':
        date_col = 'transaction_date_standardized' if 'transaction_date_standardized' in df.columns else ('date_standardized' if 'date_standardized' in df.columns else 'date')
    else:
        date_col = 'date_standardized' if 'date_standardized' in df.columns else 'date'

    for _, row in df.iterrows():
        date_val = row.get(date_col)
        if pd.notna(date_val):
            try:
                date_val = pd.to_datetime(date_val, format='%Y-%m-%d')
            except Exception:
                try:
                    date_val = pd.to_datetime(date_val)
                except Exception:
                    date_val = None

        rec = {
            'date': date_val,
            'vendor': row.get('vendor_standardized', 'unknown'),
            'amount': float(row.get('amount_converted', row.get('amount', 0.0)) or 0.0),
        }
        # Add specific ID field based on source
        if record_type == 'invoice':
            rec['invoice_id'] = str(row.get('invoice_id', ''))
            rec['tax'] = float(row.get('tax_converted', row.get('tax', 0.0)) or 0.0)
            rec['subtotal'] = float(row.get('subtotal_converted', row.get('subtotal', 0.0)) or 0.0)
        elif record_type == 'razorpay':
            rec['entity_id'] = str(row.get('entity_id', ''))
            rec['order_id'] = row.get('order_id')
            rec['settlement_utr'] = row.get('settlement_utr')
            # Use credit_converted (net settlement amount) instead of gross amount_converted
            if 'credit_converted' in row and pd.notna(row['credit_converted']):
                rec['amount'] = float(row['credit_converted'])
            elif 'credit_cleaned' in row and pd.notna(row['credit_cleaned']):
                rec['amount'] = float(row['credit_cleaned'])
            rec['credit'] = rec['amount']
            rec['gross_amount'] = float(row.get('amount_converted', rec['amount']))
        elif record_type == 'bank':
            rec['ref_no'] = str(row.get('ref_no', ''))
        records.append(rec)
    return records

def serialize_triplet(t: dict, idx: int) -> dict:
    rzp = t.get("razorpay") or {}
    bnk = t.get("bank") or {}
    inv_ids = t.get("invoice_ids", [])
    match_type = t.get("match_type") or ("N:1 Group" if len(inv_ids) > 1 else "1:1 Exact")
    return {
        "id": f"TRIPLET-{1001 + idx}",
        "invoice_id": ", ".join(str(i) for i in inv_ids),
        "invoice_ids": [str(i) for i in inv_ids],
        "razorpay_id": str(rzp.get("entity_id", "")),
        "settlement_utr": str(rzp.get("settlement_utr", "")),
        "bank_ref_no": str(bnk.get("ref_no", "")) if bnk else "",
        "amount": float(rzp.get("amount") or 0.0),
        "vendor": str(rzp.get("vendor", "")),
        "date": str(rzp.get("date", "")) if rzp.get("date") else "",
        "status": "Matched",
        "match_type": match_type,
    }

def serialize_exception(e: dict, idx: int) -> dict:
    rec = e.get("record") or {}
    exc_type = str(e.get("type", "")).capitalize()
    reason = str(e.get("reason", ""))
    source_id = (str(rec.get("invoice_id", "")) or str(rec.get("entity_id", "")) or str(rec.get("ref_no", "")) or str(e.get("source_id", "")))
    status = str(e.get("status", "Open")).strip()

    is_unallocated = (
        (exc_type.lower() == "razorpay" and "no matching invoice" in reason.lower()) or
        (exc_type.lower() == "bank" and ("no matching invoice" in reason.lower() or "unallocated" in reason.lower() or "settlement or invoice" in reason.lower()))
    )

    if status.lower() == "resolved":
        status_type = "resolved"
        severity = "Resolved"
    elif is_unallocated:
        status_type = "unallocated_cash"
        severity = "Medium"
    else:
        status_type = "exception"
        severity = "High"

    return {
        "id": f"EXC-{1001 + idx}",
        "type": exc_type,
        "source_id": source_id,
        "vendor": str(rec.get("vendor", "")),
        "amount": float(rec.get("amount") or 0.0),
        "date": str(rec.get("date", "")) if rec.get("date") else "",
        "reason": reason,
        "status": status,
        "status_type": status_type,
        "severity": severity,
        "resolution_note": str(e.get("resolution_note", "") or ""),
        "resolved_at": str(e.get("resolved_at", "") or ""),
    }

def run_reconciliation_pipeline(params_dict: Optional[dict] = None, project_root: Optional[Path] = None) -> Dict[str, Any]:
    """
    Executes the end-to-end reconciliation matching pipeline:
    - HungarianMatcher (1:1, 1:N, N:1)
    - Exception classification
    - Triplet persistence to CSV
    - Summary analytics and financial breakdown computation
    """
    if project_root is None:
        project_root = Path(__file__).resolve().parent.parent

    config = ReconciliationConfig(params_dict=params_dict)
    data_dir = project_root / "standardisation" / "data" / "standardized"

    invoices = load_records(data_dir, "invoice_standardized.csv", "invoice")
    razorpay = load_records(data_dir, "razorpay_standardized.csv", "razorpay")
    bank     = load_records(data_dir, "bank_standardized.csv", "bank")

    map_path = project_root / "synthetic data" / "data" / "order_invoice_map.csv"
    if not map_path.exists():
        map_path = project_root / "reconciliation" / "data" / "order_invoice_map.csv"

    matcher = HungarianMatcher(config, map_file_path=map_path if map_path.exists() else None)
    raw = matcher.match(invoices, razorpay, bank)

    # Save output datasets to disk for persistent inspection and MCP access
    rec_dirs = [project_root / "reconciliation", project_root / "reconciliation" / "data"]
    for rdir in rec_dirs:
        try:
            rdir.mkdir(parents=True, exist_ok=True)
            triplets_df = pd.DataFrame(raw.get("triplets", []))
            exceptions_df = pd.DataFrame(raw.get("exceptions", []))

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

            if "status" not in exceptions_df.columns and not exceptions_df.empty:
                exceptions_df["status"] = "Open"
            if "resolution_note" not in exceptions_df.columns and not exceptions_df.empty:
                exceptions_df["resolution_note"] = ""
            if "resolved_at" not in exceptions_df.columns and not exceptions_df.empty:
                exceptions_df["resolved_at"] = ""

            triplets_df.to_csv(rdir / "reconciliation_results.csv", index=False)
            exceptions_df.to_csv(rdir / "reconciliation_exceptions.csv", index=False)
        except Exception:
            pass

    triplets   = [serialize_triplet(t, i) for i, t in enumerate(raw["triplets"])]
    exceptions = [serialize_exception(e, i) for i, e in enumerate(raw["exceptions"])]

    matched_invoice_count = int(raw.get("matched_count", len(invoices)))
    total_invoice_count = len(invoices)
    invoice_match_rate = round((matched_invoice_count / total_invoice_count) * 100, 2) if total_invoice_count > 0 else 0.0

    unallocated_count = sum(1 for e in exceptions if e.get("status_type") == "unallocated_cash")
    audit_exception_count = sum(1 for e in exceptions if e.get("status_type") == "exception")
    resolved_count = sum(1 for e in exceptions if e.get("status_type") == "resolved")
    total_triplets = len(triplets)
    total_exceptions = len(exceptions)
    record_coverage_rate = round((total_triplets / (total_triplets + total_exceptions)) * 100, 2) if (total_triplets + total_exceptions) > 0 else 0.0

    # Financial Breakdown
    inv_file = data_dir / "invoice_standardized.csv"
    rzp_file = data_dir / "razorpay_standardized.csv"
    bnk_file = data_dir / "bank_standardized.csv"

    inv_df = pd.read_csv(inv_file) if inv_file.exists() else pd.DataFrame()
    rzp_df = pd.read_csv(rzp_file) if rzp_file.exists() else pd.DataFrame()
    bnk_df = pd.read_csv(bnk_file) if bnk_file.exists() else pd.DataFrame()

    total_invoice_amt = float(inv_df["amount_converted"].sum()) if not inv_df.empty and "amount_converted" in inv_df.columns else sum(float(inv.get("amount") or 0) for inv in invoices)
    total_invoice_subtotal = float(inv_df["subtotal_converted"].sum()) if not inv_df.empty and "subtotal_converted" in inv_df.columns else 0.0
    total_invoice_tax = float(inv_df["tax_converted"].sum()) if not inv_df.empty and "tax_converted" in inv_df.columns else max(0.0, total_invoice_amt - total_invoice_subtotal)

    total_gross_settlement = float(rzp_df["amount_converted"].sum()) if not rzp_df.empty and "amount_converted" in rzp_df.columns else sum(float(rp.get("gross_amount") or rp.get("amount") or 0) for rp in razorpay)
    total_settled_amt = float(rzp_df["credit_converted"].sum()) if not rzp_df.empty and "credit_converted" in rzp_df.columns else sum(float(rp.get("credit") or rp.get("amount") or 0) for rp in razorpay)
    total_bank_amt = float(bnk_df["credit_converted"].sum()) if not bnk_df.empty and "credit_converted" in bnk_df.columns else sum(float(bnk.get("credit") or bnk.get("amount") or 0) for bnk in bank)
    total_uncollected_amt = sum(float(e.get("amount") or 0.0) for e in exceptions if str(e.get("type", "")).lower() == "invoice" and str(e.get("status", "")).lower() != "resolved")

    return {
        "matchRate": invoice_match_rate,
        "invoiceMatchRate": invoice_match_rate,
        "recordCoverageRate": record_coverage_rate,
        "record_coverage_rate": record_coverage_rate,
        "matchedCount": matched_invoice_count,
        "matchedInvoicesCount": matched_invoice_count,
        "unallocatedCount": unallocated_count,
        "auditExceptionCount": audit_exception_count,
        "resolvedCount": resolved_count,
        "matchedTripletsCount": total_triplets,
        "exceptionCount": total_exceptions,
        "totalCount": total_invoice_count,
        "triplets": triplets,
        "exceptions": exceptions,
        "totalInvoiceAmount": round(total_invoice_amt, 2),
        "totalInvoiceSubtotal": round(total_invoice_subtotal, 2),
        "totalInvoiceTax": round(total_invoice_tax, 2),
        "totalSettledAmount": round(total_settled_amt, 2),
        "totalBankCredit": round(total_bank_amt, 2),
        "totalGrossSettlement": round(total_gross_settlement, 2),
        "totalFeeAmount": round(total_fee_amt, 2),
        "totalUncollectedAmount": round(total_uncollected_amt, 2),
        "discrepancyAmount": round(discrepancy_amt, 2),
    }

def get_reconciliation_results_summary(project_root: Optional[Path] = None) -> Dict[str, Any]:
    """
    Reads existing reconciliation outputs from disk and computes summary metrics.
    """
    if project_root is None:
        project_root = Path(__file__).resolve().parent.parent

    data_dir = project_root / "standardisation" / "data" / "standardized"
    rzp_file = data_dir / "razorpay_standardized.csv"
    bank_file = data_dir / "bank_standardized.csv"
    inv_file = data_dir / "invoice_standardized.csv"

    rzp_map = {}
    total_settled_amt = 0.0
    total_gross_settlement = 0.0
    if rzp_file.exists():
        try:
            rzp_df = pd.read_csv(rzp_file)
            c_col = "credit_converted" if "credit_converted" in rzp_df.columns else ("credit" if "credit" in rzp_df.columns else "amount")
            g_col = "amount_converted" if "amount_converted" in rzp_df.columns else "amount"
            total_settled_amt = float(pd.to_numeric(rzp_df[c_col], errors="coerce").fillna(0).sum())
            total_gross_settlement = float(pd.to_numeric(rzp_df[g_col], errors="coerce").fillna(0).sum())
            for _, r in rzp_df.iterrows():
                eid = str(r.get("entity_id", "")).strip()
                if eid:
                    amt = float(r.get("credit_converted", r.get("amount_converted", r.get("amount", 0.0))) or 0.0)
                    rzp_map[eid] = {
                        "amount": amt,
                        "vendor": str(r.get("vendor_standardized", r.get("vendor", ""))),
                        "date": str(r.get("date_standardized", r.get("settled_at_standardized", r.get("date", "")))),
                        "settlement_utr": str(r.get("settlement_utr", "")),
                    }
        except Exception:
            pass

    results_file = project_root / "reconciliation" / "reconciliation_results.csv"
    triplets = []
    if results_file.exists():
        tdf = pd.read_csv(results_file)
        if not tdf.empty:
            for idx, row in tdf.iterrows():
                inv_val = str(row.get("invoice_ids", row.get("invoice_id", "")))
                inv_list = [x.strip() for x in inv_val.split(",") if x.strip()]
                match_type = str(row.get("match_type", "1:1 Exact"))
                if not match_type or match_type == "nan":
                    match_type = "N:1 Group" if len(inv_list) > 1 else "1:1 Exact"
                rzp_id = str(row.get("razorpay_id", "")).strip()
                rzp_info = rzp_map.get(rzp_id, {})
                amt = float(row.get("amount", 0.0) or 0.0) or rzp_info.get("amount", 0.0)
                vendor = str(row.get("vendor", "")) or rzp_info.get("vendor", "")
                date_val = str(row.get("date", "")) or rzp_info.get("date", "")
                utr = str(row.get("settlement_utr", "")) or rzp_info.get("settlement_utr", "")
                triplets.append({
                    "id": f"TRIPLET-{1001 + idx}",
                    "invoice_id": inv_val,
                    "invoice_ids": inv_list,
                    "razorpay_id": rzp_id,
                    "settlement_utr": utr,
                    "bank_ref_no": str(row.get("bank_ref", row.get("bank_ref_no", ""))),
                    "amount": amt,
                    "vendor": vendor,
                    "date": date_val,
                    "status": "Matched",
                    "match_type": match_type,
                })

    try:
        from server import _get_parsed_exceptions_df
    except ImportError:
        from mcp_server.server import _get_parsed_exceptions_df

    parsed_df = _get_parsed_exceptions_df()
    serialized_exceptions = []
    if not parsed_df.empty:
        for idx, row in parsed_df.iterrows():
            serialized_exceptions.append({
                "id": str(row.get("source_id") or f"EXC-{1001 + idx}"),
                "type": str(row.get("type", "")).capitalize(),
                "source_id": str(row.get("source_id", "")),
                "vendor": str(row.get("vendor", "")),
                "amount": float(row.get("amount", 0.0) or 0.0),
                "date": str(row.get("date", "")),
                "reason": str(row.get("reason", "")),
                "status": str(row.get("status", "Open")),
                "status_type": str(row.get("status_type", "exception")),
                "severity": str(row.get("severity", "High")),
                "resolution_note": str(row.get("resolution_note", "")),
                "resolved_at": str(row.get("resolved_at", "")),
            })

    unallocated_count = sum(1 for e in serialized_exceptions if e.get("status_type") == "unallocated_cash")
    audit_exception_count = sum(1 for e in serialized_exceptions if e.get("status_type") == "exception")
    resolved_count = sum(1 for e in serialized_exceptions if e.get("status_type") == "resolved")
    total_triplets = len(triplets)
    total_exceptions = len(serialized_exceptions)

    total_resolved_amount = sum(e["amount"] for e in serialized_exceptions if e.get("status_type") == "resolved")
    record_coverage_rate = round((total_triplets / (total_triplets + total_exceptions)) * 100, 2) if (total_triplets + total_exceptions) > 0 else 100.0

    total_invoice_amt = 0.0
    total_invoice_subtotal = 0.0
    total_invoice_tax = 0.0
    if inv_file.exists():
        try:
            inv_df = pd.read_csv(inv_file)
            amt_col = "amount_converted" if "amount_converted" in inv_df.columns else "amount"
            total_invoice_amt = float(pd.to_numeric(inv_df[amt_col], errors="coerce").fillna(0).sum())
            if "subtotal_converted" in inv_df.columns:
                total_invoice_subtotal = float(pd.to_numeric(inv_df["subtotal_converted"], errors="coerce").fillna(0).sum())
            if "tax_converted" in inv_df.columns:
                total_invoice_tax = float(pd.to_numeric(inv_df["tax_converted"], errors="coerce").fillna(0).sum())
            else:
                total_invoice_tax = max(0.0, total_invoice_amt - total_invoice_subtotal)
        except Exception:
            total_invoice_amt = 0.0

    total_bank_amt = 0.0
    if bank_file.exists():
        try:
            bank_df = pd.read_csv(bank_file)
            b_col = "credit_converted" if "credit_converted" in bank_df.columns else ("credit" if "credit" in bank_df.columns else "amount")
            total_bank_amt = float(pd.to_numeric(bank_df[b_col], errors="coerce").fillna(0).sum())
        except Exception:
            total_bank_amt = total_settled_amt

    total_fee_amt = max(0.0, total_gross_settlement - total_settled_amt)
    discrepancy_amt = abs(total_invoice_amt - total_settled_amt)
    total_uncollected_amt = sum(float(e.get("amount") or 0.0) for e in serialized_exceptions if str(e.get("type", "")).lower() == "invoice" and str(e.get("status", "")).lower() != "resolved")

    return {
        "status": "success",
        "triplets": triplets,
        "exceptions": serialized_exceptions,
        "matchedCount": total_triplets,
        "totalCount": total_triplets + total_exceptions,
        "matchRate": record_coverage_rate,
        "invoiceMatchRate": record_coverage_rate,
        "recordCoverageRate": record_coverage_rate,
        "unallocatedCount": unallocated_count,
        "auditExceptionCount": audit_exception_count,
        "resolvedCount": resolved_count,
        "totalResolvedAmount": round(total_resolved_amount, 2),
        "totalInvoiceAmount": round(total_invoice_amt, 2),
        "totalInvoiceSubtotal": round(total_invoice_subtotal, 2),
        "totalInvoiceTax": round(total_invoice_tax, 2),
        "totalSettledAmount": round(total_settled_amt, 2),
        "totalBankCredit": round(total_bank_amt, 2),
        "totalGrossSettlement": round(total_gross_settlement, 2),
        "totalFeeAmount": round(total_fee_amt, 2),
        "totalUncollectedAmount": round(total_uncollected_amt, 2),
        "discrepancyAmount": round(discrepancy_amt, 2),
    }

def main():
    results = run_reconciliation_pipeline()
    print("=" * 50)
    print("RECONCILIATION RESULTS")
    print("=" * 50)
    print(f"Match Rate: {results['matchRate']:.2f}%")
    print(f"Matched:    {results['matchedCount']} / {results['totalCount']} invoices")
    print(f"Exceptions: {len(results['exceptions'])} records")
    print(f"Gross Invoiced:    ${results['totalInvoiceAmount']:.2f}")
    print(f"Invoice Tax:       ${results['totalInvoiceTax']:.2f}")
    print(f"Razorpay Gross:    ${results['totalGrossSettlement']:.2f}")
    print(f"Razorpay Fee/Tax:  ${results['totalFeeAmount']:.2f}")
    print(f"Bank Deposits:     ${results['totalBankCredit']:.2f}")

if __name__ == "__main__":
    main()