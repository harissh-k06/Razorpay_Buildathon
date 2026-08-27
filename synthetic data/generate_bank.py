import os
import sys
import csv
import random
from datetime import datetime, timedelta
from tqdm import tqdm

# Ensure UTF-8 output encoding on Windows consoles
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def generate_bank_statements_from_settlement(razorpay_record):
    """Generate bank statement(s) for a single settlement record."""
    try:
        net_amount_paise = float(razorpay_record.get("credit", 0))
    except (ValueError, TypeError):
        net_amount_paise = 0.0
        
    net_amount_inr = net_amount_paise / 100.0
    utr = razorpay_record.get("settlement_utr", "")
    
    try:
        settled_at_val = int(razorpay_record.get("settled_at", 0))
        settled_at = datetime.fromtimestamp(settled_at_val)
    except Exception:
        settled_at = datetime.now()

    if not utr or net_amount_inr <= 0:
        return []

    entity_id = razorpay_record.get("entity_id", "")
    ref_desc = f" REF:{entity_id}" if entity_id else ""
    stmt = {
        "transaction_date": settled_at.strftime("%Y-%m-%d"),
        "value_date": (settled_at + timedelta(days=random.randint(0, 2))).strftime("%Y-%m-%d"),
        "description": f"NEFT CR: HDFC UTR{utr} RAZORPAY SETTLEMENT{ref_desc}",
        "ref_no": utr,
        "credit": round(net_amount_inr, 2),
        "debit": "",
        "balance": 0.0  # calculated in next step
    }
    return [stmt]

def generate_bank_statements(razorpay_records):
    """Generate bank statements for all Razorpay settlements with progress bars."""
    all_statements = []
    
    # Progress Bar 1: Creating bank entries
    for record in tqdm(razorpay_records, desc="Creating bank entries", unit="entry"):
        try:
            stmts = generate_bank_statements_from_settlement(record)
            all_statements.extend(stmts)
        except Exception as e:
            print(f"\n[ERROR] Error processing settlement record: {e}")

    # Sort by date
    all_statements.sort(key=lambda x: x.get("transaction_date", ""))
    
    # Progress Bar 2: Computing balances
    balance = 100000.00
    for stmt in tqdm(all_statements, desc="Computing balances", unit="entry"):
        try:
            balance += float(stmt.get("credit", 0.0))
            stmt["balance"] = round(balance, 2)
        except Exception:
            stmt["balance"] = round(balance, 2)

    return all_statements

def save_bank_statements(statements):
    """Save bank statements to bank.csv with progress bar."""
    if not statements:
        print("[WARNING] No bank statements to save.")
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    filename = os.path.join(DATA_DIR, "bank.csv")

    fieldnames = ["transaction_date", "value_date", "description", "ref_no", "credit", "debit", "balance"]
    
    # Progress Bar 3: Saving to CSV
    try:
        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for stmt in tqdm(statements, desc="Saving to CSV", unit="row"):
                writer.writerow({k: stmt.get(k, "") for k in fieldnames})

        print(f"\n[SUCCESS] Generated {len(statements)} bank statements -> {filename}")
    except Exception as e:
        print(f"\n[ERROR] Failed to save bank statements: {e}")

if __name__ == "__main__":
    razorpay_file = os.path.join(DATA_DIR, "razorpay_settlements.csv")
    if not os.path.exists(razorpay_file):
        print(f"[ERROR] {razorpay_file} not found. Please run generate_razorpay.py first.")
        sys.exit(1)

    razorpay_records = []
    try:
        with open(razorpay_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                razorpay_records.append(row)
    except Exception as e:
        print(f"[ERROR] Error reading {razorpay_file}: {e}")
        sys.exit(1)

    statements = generate_bank_statements(razorpay_records)
    save_bank_statements(statements)