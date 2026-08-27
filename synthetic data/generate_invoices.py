import os
import sys
import csv
import random
from datetime import datetime, timedelta
from tqdm import tqdm
from shared.config import VENDORS, CURRENCIES, generate_order_id

# Ensure UTF-8 output encoding on Windows consoles
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Fixed seed for reproducibility
random.seed(42)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def generate_invoice(index):
    """Generate a single internal invoice"""
    vendor = random.choice(VENDORS)
    currency = random.choice(CURRENCIES)
    
    # Base amount between $10 and $500 (in USD equivalent)
    base_amount_usd = round(random.uniform(10, 500), 2)
    
    # Convert to target currency (simplified)
    if currency == "USD":
        subtotal = base_amount_usd
    elif currency == "EUR":
        subtotal = round(base_amount_usd * 0.857, 2)
    elif currency == "GBP":
        subtotal = round(base_amount_usd * 0.733, 2)
    else:  # INR
        subtotal = round(base_amount_usd * 95.77, 2)
    
    tax = round(subtotal * 0.18, 2)  # 18% GST
    total = round(subtotal + tax, 2)
    
    # Dates
    issue_date = datetime(2025, 1, 1) + timedelta(days=random.randint(0, 608))
    due_date = issue_date + timedelta(days=random.randint(15, 30))
    
    return {
        "invoice_id": f"INV-{index+1:03d}",
        "order_id": generate_order_id(),
        "issue_date": issue_date.strftime("%Y-%m-%d"),
        "due_date": due_date.strftime("%Y-%m-%d"),
        "vendor_name": vendor["name"],
        "description": f"{vendor['name']} - {random.choice(['Subscription', 'One-time Payment', 'Usage-based', 'Annual Renewal'])}",
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "currency": currency,
    }

def generate_invoices(count=200):
    """Generate all invoices with a progress bar"""
    invoices = []
    with tqdm(total=count, desc="Creating invoices", unit="invoice") as pbar:
        for i in range(count):
            try:
                invoices.append(generate_invoice(i))
            except Exception as e:
                print(f"\n[ERROR] Error generating invoice #{i+1}: {e}")
            pbar.update(1)
    return invoices

def save_invoices(invoices, filename=None):
    """Save invoices to CSV inside data directory"""
    if not invoices:
        print("[WARNING] No invoices to save.")
        return
    if filename is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        filename = os.path.join(DATA_DIR, "invoices.csv")
    else:
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        
    try:
        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=invoices[0].keys())
            writer.writeheader()
            writer.writerows(invoices)
        print(f"[SUCCESS] Generated {len(invoices)} invoices -> {filename}")
    except Exception as e:
        print(f"[ERROR] Failed to save invoices to {filename}: {e}")

if __name__ == "__main__":
    invoices = generate_invoices(200)
    save_invoices(invoices)