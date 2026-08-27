import sys
import pandas as pd
from pathlib import Path

# Ensure package imports work
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from config import ReconciliationConfig
from hungarian_matcher import HungarianMatcher

def load_records(data_dir, file_name, record_type):
    """Load standardized CSV and convert to list of dicts with correct fields."""
    df = pd.read_csv(data_dir / file_name)
    records = []
    for _, row in df.iterrows():
        # Determine date column
        date_col = None
        for col in ['settled_at_standardized', 'transaction_date_standardized',
                    'issue_date_standardized', 'date_standardized']:
            if col in df.columns:
                date_col = col
                break
        if date_col is None:
            date_col = 'date'  # fallback

        date_val = row.get(date_col)
        if pd.notna(date_val):
            try:
                date_val = pd.to_datetime(date_val)
            except Exception:
                date_val = None

        rec = {
            'date': date_val,
            'vendor': row.get('vendor_standardized', 'unknown'),
            'amount': row.get('amount_converted', 0.0),
        }
        # Add specific ID field based on source
        if record_type == 'invoice':
            rec['invoice_id'] = row['invoice_id']
        elif record_type == 'razorpay':
            rec['entity_id'] = row['entity_id']
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
            rec['ref_no'] = row['ref_no']
        records.append(rec)
    return records

def main():
    # Load config
    config = ReconciliationConfig()

    # Locate standardized data
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    data_dir = project_root / "standardisation" / "data" / "standardized"
    if not data_dir.exists():
        data_dir = script_dir.parent / "standardisation" / "data" / "standardized"
    if not data_dir.exists():
        print("[ERROR] Standardized data directory not found.")
        sys.exit(1)

    # Load data
    invoices = load_records(data_dir, "invoice_standardized.csv", "invoice")
    razorpay = load_records(data_dir, "razorpay_standardized.csv", "razorpay")
    bank = load_records(data_dir, "bank_standardized.csv", "bank")

    # Locate mapping file
    map_path = project_root / "synthetic data" / "data" / "order_invoice_map.csv"
    if not map_path.exists():
        map_path = script_dir.parent / "synthetic data" / "data" / "order_invoice_map.csv"

    # Instantiate matcher with config and mapping
    matcher = HungarianMatcher(config, map_file_path=map_path)
    result = matcher.match(invoices, razorpay, bank)

    # Print results
    print("=" * 50)
    print("RECONCILIATION RESULTS")
    print("=" * 50)
    print(f"Match Rate: {result['match_rate']:.2f}%")
    print(f"Matched:    {result['matched_count']} / {result['total_invoices']} invoices")
    print(f"Exceptions: {len(result['exceptions'])} records")

    # Save outputs into reconciliation/data directory
    out_dir = script_dir / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    triplets_df = pd.DataFrame(result['triplets'])
    exceptions_df = pd.DataFrame(result['exceptions'])

    # Flatten triplets for easier viewing
    if not triplets_df.empty and 'invoice_ids' in triplets_df.columns:
        triplets_df['invoice_ids'] = triplets_df['invoice_ids'].apply(lambda x: ', '.join(x) if isinstance(x, (list, tuple, set)) else str(x))
    if not triplets_df.empty and 'razorpay' in triplets_df.columns:
        triplets_df['razorpay_id'] = triplets_df['razorpay'].apply(lambda x: x['entity_id'] if isinstance(x, dict) else None)
    if not triplets_df.empty and 'bank' in triplets_df.columns:
        triplets_df['bank_ref'] = triplets_df['bank'].apply(lambda x: x['ref_no'] if isinstance(x, dict) else None)

    drop_cols = [c for c in ['razorpay', 'bank'] if c in triplets_df.columns]
    if drop_cols:
        triplets_df.drop(columns=drop_cols, inplace=True)

    results_file = out_dir / "reconciliation_results.csv"
    exceptions_file = out_dir / "reconciliation_exceptions.csv"

    triplets_df.to_csv(results_file, index=False)
    exceptions_df.to_csv(exceptions_file, index=False)

    print(f"\nResults saved to: {results_file}")
    print(f"Exceptions saved to: {exceptions_file}")

if __name__ == "__main__":
    main()