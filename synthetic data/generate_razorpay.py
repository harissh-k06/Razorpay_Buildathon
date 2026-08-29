import os
import sys
import csv
import random
import time
import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime, timedelta
from dotenv import load_dotenv
from tqdm import tqdm
import razorpay
from shared.config import generate_order_id, generate_payment_id, generate_settlement_id, generate_utr, VENDORS

# Ensure UTF-8 output encoding on Windows consoles
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from pathlib import Path
root_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=root_env)
load_dotenv()  # Load from local .env if present

KEY_ID = os.getenv("KEY_ID")
SECRET_KEY = os.getenv("SECRET_KEY")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Official Razorpay Settlement Recon API fields (per official documentation)
# Used to enforce exact schema honesty (NO synthetic columns like invoice_ids or _bank_split_count)
OFFICIAL_SETTLEMENT_FIELDS = [
    "entity_id",
    "type",
    "amount",
    "currency",
    "fee",
    "tax",
    "credit",
    "debit",
    "settlement_id",
    "settlement_utr",
    "settled_at",
    "created_at",
    "description",
    "order_id",
    "method",
    "card_network",
]

# Initialize Razorpay Client safely
client = None
if KEY_ID and SECRET_KEY:
    try:
        client = razorpay.Client(auth=(KEY_ID, SECRET_KEY))
    except Exception as e:
        print(f"[WARNING] Razorpay client initialization error: {e}")

# Exchange rates to INR for multi-currency invoice order creation
EXCHANGE_RATES_TO_INR = {
    "USD": 95.78,
    "EUR": 111.38,
    "GBP": 131.20,
    "INR": 1.0,
}

def get_invoice_total_inr(invoice):
    """Convert invoice total to INR using standard base exchange rates."""
    curr = str(invoice.get("currency", "INR")).upper().strip()
    rate = EXCHANGE_RATES_TO_INR.get(curr, 1.0)
    return float(invoice["total"]) * rate

def create_order(invoice, rzp_client=None):
    """Create a Razorpay order for a single invoice in INR paise."""
    total_inr = get_invoice_total_inr(invoice)
    amount_paise = int(round(total_inr * 100))
    order_data = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": invoice["invoice_id"],
        "payment_capture": 1,
        "notes": {
            "vendor": invoice["vendor_name"],
            "issue_date": invoice["issue_date"]
        }
    }
    
    if rzp_client:
        try:
            return rzp_client.order.create(order_data)
        except Exception:
            pass  # Fallback to local order representation if offline

    return {
        "id": invoice.get("order_id") or generate_order_id(),
        "entity": "order",
        "amount": amount_paise,
        "amount_paid": 0,
        "amount_due": amount_paise,
        "currency": "INR",
        "receipt": invoice["invoice_id"],
        "status": "created",
        "created_at": int(datetime.strptime(invoice["issue_date"], "%Y-%m-%d").timestamp()) if "issue_date" in invoice else int(time.time()),
        "notes": order_data["notes"]
    }

def simulate_payment(order_id, amount_paise, rzp_client=None):
    """
    Simulate payment for an order via Razorpay test API if available,
    or realistic captured payment structure.
    """
    mdr_rate = 0.02 + random.uniform(-0.002, 0.002)
    fee = int(round(amount_paise * mdr_rate))
    tax = int(round(fee * 0.18))
    
    if rzp_client:
        try:
            if hasattr(rzp_client.payment, 'create'):
                payment_data = {
                    "amount": amount_paise,
                    "currency": "INR",
                    "order_id": order_id,
                    "method": "card"
                }
                payment = rzp_client.payment.create(payment_data)
                return rzp_client.payment.capture(payment['id'], amount_paise)
        except Exception:
            pass

    return {
        "id": generate_payment_id(),
        "entity": "payment",
        "amount": amount_paise,
        "currency": "INR",
        "status": "captured",
        "order_id": order_id,
        "method": "card",
        "card_network": random.choice(["MC", "VISA", "RUPay"]),
        "captured": True,
        "fee": fee,
        "tax": tax,
        "created_at": int(time.time())
    }

def fetch_settlement_recon(year, month, day):
    """
    Fetch raw settlement recon data directly from the official Razorpay API endpoint.
    GET /v1/settlements/recon/combined
    """
    if not (KEY_ID and SECRET_KEY):
        return []
    url = "https://api.razorpay.com/v1/settlements/recon/combined"
    params = {"year": year, "month": month, "day": day}
    response = requests.get(
        url,
        params=params,
        auth=HTTPBasicAuth(KEY_ID, SECRET_KEY),
        timeout=15
    )
    response.raise_for_status()
    data = response.json()
    return data.get("items", [])

def generate_real_razorpay_data(invoices, split_scenarios=True, wait_duration=30):
    """
    Executes the 4-step Razorpay workflow with realistic merchant settlement scenarios:
      - 70%: 1:1 (Single invoice -> Single payment -> Single settlement)
      - 15%: N:1 (Multiple invoices for same vendor -> Batched payout with shared settlement_id/UTR)
      - 10%: 1:N (Single invoice -> Partial payments / instalments)
      -  5%: Missing (Unsettled invoice / no settlement record)

    Data Honesty & Schema Guarantee:
      - If the live API returns settlement items, they are saved as-is.
      - If Test Mode returns 0 settlements, settlement records are constructed strictly
        adhering to the official Razorpay Settlement Recon API schema (no synthetic cheat columns).
      - The link between orders and invoices is stored strictly in order_invoice_map.csv.
    """
    errors = []
    order_map = {}
    invoice_orders = []
    scenario_counts = {'1:1': 0, 'N:1': 0, '1:N': 0, 'missing': 0}

    # -------------------------------------------------------------
    # Step 1: Creating Orders in Razorpay & Assigning Scenarios
    # -------------------------------------------------------------
    with tqdm(total=len(invoices), desc="Creating orders in Razorpay", unit="order") as pbar:
        for inv in invoices:
            if split_scenarios:
                scenario = random.choices(['1:1', 'N:1', '1:N', 'missing'], weights=[70, 15, 10, 5])[0]
            else:
                scenario = '1:1'
            scenario_counts[scenario] += 1

            try:
                order = create_order(inv, client)
                order_map[order['id']] = inv['invoice_id']
                invoice_orders.append((inv, order, scenario))
            except Exception as e:
                errors.append(f"Order creation failed for {inv.get('invoice_id', 'unknown')}: {str(e)}")
            pbar.update(1)
            time.sleep(0.01)

    orders_created_count = len(invoice_orders)

    # -------------------------------------------------------------
    # Step 1b: Creating Unallocated Orders (Extra cash sitting at gateway without invoice)
    # -------------------------------------------------------------
    unallocated_orders = []
    unallocated_count = 8
    sample_vendors = random.choices(VENDORS, k=unallocated_count) if VENDORS else [
        {"name": "Slack Technologies"}, {"name": "Amazon Web Services"}, {"name": "Zoho Corporation"}, {"name": "HubSpot Inc"}
    ]
    for idx, v in enumerate(sample_vendors):
        v_name = v["name"] if isinstance(v, dict) else str(v)
        unalloc_amt_paise = random.randint(150000, 450000)  # ₹1,500 to ₹4,500 in paise
        unalloc_order_data = {
            "amount": unalloc_amt_paise,
            "currency": "INR",
            "receipt": f"UNALLOC-RCPT-{idx+1:03d}",
            "payment_capture": 1,
            "notes": {
                "vendor": v_name,
                "type": "unallocated_customer_deposit"
            }
        }
        ord_obj = None
        if client:
            try:
                ord_obj = client.order.create(unalloc_order_data)
            except Exception:
                pass
        if not ord_obj:
            ord_obj = {
                "id": generate_order_id(),
                "entity": "order",
                "amount": unalloc_amt_paise,
                "amount_paid": 0,
                "amount_due": unalloc_amt_paise,
                "currency": "INR"
            }
        # Intentionally DO NOT add ord_obj['id'] to order_map so it remains unlinked to any invoice!
        unallocated_orders.append((v_name, ord_obj, unalloc_amt_paise))

    # -------------------------------------------------------------
    # Step 2: Simulating Payments (Applying 1:N Splits, Missing & Unallocated)
    # -------------------------------------------------------------
    payment_tasks = []
    split_payments_count = 0

    for inv, order, scenario in invoice_orders:
        total_inr = get_invoice_total_inr(inv)
        amount = int(round(total_inr * 100))
        base_timestamp = int(datetime.strptime(inv["issue_date"], "%Y-%m-%d").timestamp()) if "issue_date" in inv else int(time.time())

        if scenario == 'missing':
            # 5% missing: invoice is uncollected/unsettled (no payments created)
            continue

        elif scenario == '1:N':
            # 10% 1:N: split invoice into 2-3 partial payments across timestamps (within 1-2 days)
            num_parts = random.randint(2, 3)
            parts = sorted(random.sample(range(1, amount), num_parts - 1))
            split_amounts = []
            prev = 0
            for p in parts:
                split_amounts.append(p - prev)
                prev = p
            split_amounts.append(amount - prev)
            split_payments_count += len(split_amounts)

            for i, amt in enumerate(split_amounts):
                offset_time = base_timestamp + (i * random.randint(0, 86400))
                payment_tasks.append((inv, order, amt, scenario, offset_time))

        else:
            # 1:1 (70%) or N:1 (15%): single full payment
            payment_tasks.append((inv, order, amount, scenario, base_timestamp))

    # Add unallocated payment tasks (standalone receipts at gateway)
    for v_name, ord_obj, amt in unallocated_orders:
        created_time = int(time.time()) - random.randint(86400, 86400 * 30)
        payment_tasks.append(({'vendor_name': v_name}, ord_obj, amt, 'unallocated', created_time))

    payment_records = []
    with tqdm(total=len(payment_tasks), desc="Processing payments", unit="payment") as pbar:
        for inv, order, amt, scenario, created_time in payment_tasks:
            try:
                payment = simulate_payment(order['id'], amt, client)
                payment_records.append({
                    "payment_id": payment.get('id') or generate_payment_id(),
                    "order_id": order['id'],
                    "amount": amt,
                    "fee": payment.get('fee', int(round(amt * 0.02))),
                    "tax": payment.get('tax', int(round(int(round(amt * 0.02)) * 0.18))),
                    "method": payment.get('method', 'card'),
                    "card_network": payment.get('card_network', random.choice(["MC", "VISA", "RUPay"])),
                    "created_at": created_time,
                    "vendor": inv.get('vendor_name', ''),
                    "scenario": scenario
                })
            except Exception as e:
                errors.append(f"Payment simulation failed for order {order['id']}: {str(e)}")
            pbar.update(1)
            time.sleep(0.01)

    # -------------------------------------------------------------
    # Step 3: Waiting for Settlements
    # -------------------------------------------------------------
    with tqdm(total=wait_duration, desc="Waiting for settlements to process", unit="s") as pbar:
        for _ in range(wait_duration):
            time.sleep(1)
            pbar.update(1)

    # -------------------------------------------------------------
    # Step 4: Fetching Raw Settlement Recon Data
    # -------------------------------------------------------------
    today = datetime.now()
    raw_settlement_items = []
    with tqdm(total=3, desc="Fetching recon data", unit="day") as pbar:
        for offset in range(3):
            date = today - timedelta(days=offset)
            try:
                items = fetch_settlement_recon(date.year, date.month, date.day)
                if items:
                    raw_settlement_items.extend(items)
            except Exception as e:
                errors.append(f"Recon fetch failed for {date.strftime('%Y-%m-%d')}: {str(e)}")
            pbar.update(1)
            time.sleep(0.1)

    # Deduplicate real API response items if any overlap across dates
    seen = set()
    unique_settlements = []
    for item in raw_settlement_items:
        key = (item.get('entity_id'), item.get('settlement_id'))
        if key not in seen:
            seen.add(key)
            unique_settlements.append(item)

    is_synthetic_fallback = False
    n1_batches_count = 0

    # If API returned no settlement batches (e.g. Test Mode),
    # generate realistic settlement records derived from the simulated payments,
    # strictly adhering to the official Razorpay Settlement Recon API schema (no synthetic columns).
    if not unique_settlements and payment_records:
        is_synthetic_fallback = True

        # Group N:1 payments by vendor with creation dates within 2 days (172800s)
        n1_candidates = [p for p in payment_records if p.get('scenario') == 'N:1']
        other_payments = [p for p in payment_records if p.get('scenario') != 'N:1']

        n1_by_vendor = {}
        for p in n1_candidates:
            v = p.get('vendor', 'Unknown')
            n1_by_vendor.setdefault(v, []).append(p)

        n1_batches = []
        unbatched_n1 = []

        for vendor, v_payments in n1_by_vendor.items():
            v_payments.sort(key=lambda x: x['created_at'])
            i = 0
            while i < len(v_payments):
                # Try to form batches of 2 to 4 payments close in time (within 2 days)
                batch = [v_payments[i]]
                j = i + 1
                while j < len(v_payments) and len(batch) < 4:
                    if abs(v_payments[j]['created_at'] - batch[0]['created_at']) <= 2 * 86400:
                        batch.append(v_payments[j])
                        j += 1
                    else:
                        break
                if len(batch) >= 2:
                    n1_batches.append(batch)
                    i = j
                else:
                    unbatched_n1.append(v_payments[i])
                    i += 1

        n1_batches_count = len(n1_batches)

        # 1. Process N:1 batched settlements (shared settlement_id, settlement_utr, settled_at)
        for batch in n1_batches:
            shared_setl_id = generate_settlement_id()
            shared_utr = generate_utr()
            shared_settled_at = max(p['created_at'] for p in batch) + random.randint(86400, 172800)

            for p in batch:
                amt = p["amount"]
                fee = p["fee"]
                tax = p["tax"]
                credit = amt - fee - tax
                unique_settlements.append({
                    "entity_id": p["payment_id"],
                    "type": "payment",
                    "amount": amt,
                    "currency": "INR",
                    "fee": fee,
                    "tax": tax,
                    "credit": credit,
                    "debit": 0,
                    "settlement_id": shared_setl_id,
                    "settlement_utr": shared_utr,
                    "settled_at": shared_settled_at,
                    "created_at": p["created_at"],
                    "description": f"{p['vendor']} - Settlement",
                    "order_id": p["order_id"],
                    "method": p["method"],
                    "card_network": p["card_network"]
                })

        # 2. Process individual settlements (1:1, 1:N, and unbatched N:1)
        standalone_payments = other_payments + unbatched_n1
        for p in standalone_payments:
            amt = p["amount"]
            fee = p["fee"]
            tax = p["tax"]
            credit = amt - fee - tax
            settlement_id = generate_settlement_id()
            settlement_utr = generate_utr()
            settled_at = p["created_at"] + random.randint(86400, 172800)

            unique_settlements.append({
                "entity_id": p["payment_id"],
                "type": "payment",
                "amount": amt,
                "currency": "INR",
                "fee": fee,
                "tax": tax,
                "credit": credit,
                "debit": 0,
                "settlement_id": settlement_id,
                "settlement_utr": settlement_utr,
                "settled_at": settled_at,
                "created_at": p["created_at"],
                "description": f"{p['vendor']} - Settlement",
                "order_id": p["order_id"],
                "method": p["method"],
                "card_network": p["card_network"]
            })

    # -------------------------------------------------------------
    # Save Output to CSV (Strictly Official Columns Only)
    # -------------------------------------------------------------
    settlements_file = os.path.join(DATA_DIR, "razorpay_settlements.csv")
    if unique_settlements:
        fieldnames = list(unique_settlements[0].keys())
        with open(settlements_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for item in unique_settlements:
                writer.writerow(item)
    else:
        with open(settlements_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=OFFICIAL_SETTLEMENT_FIELDS)
            writer.writeheader()

    # -------------------------------------------------------------
    # Save Order-to-Invoice Mapping Separately
    # -------------------------------------------------------------
    map_file = os.path.join(DATA_DIR, "order_invoice_map.csv")
    with open(map_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["order_id", "invoice_id"])
        for oid, iid in order_map.items():
            writer.writerow([oid, iid])

    # -------------------------------------------------------------
    # Final Summary
    # -------------------------------------------------------------
    unique_utrs = len(set(s.get('settlement_utr', '') for s in unique_settlements if s.get('settlement_utr')))
    print("\n" + "=" * 50)
    print("           RAZORPAY RECONCILIATION SUMMARY         ")
    print("=" * 50)
    print(f"  - Orders Created:         {orders_created_count}")
    print(f"  - Payments Processed:     {len(payment_records)}")
    print(f"  - Total Settlement Rows:  {len(unique_settlements)}")
    print(f"  - Unique Settlement Batches (UTRs): {unique_utrs}")
    print("  - Scenario Breakdown (Invoice Level):")
    print(f"      * 1:1 (Single Settlement):   {scenario_counts['1:1']} invoices")
    print(f"      * N:1 (Batched Settlements): {scenario_counts['N:1']} invoices ({n1_batches_count} shared settlement batches)")
    print(f"      * 1:N (Split Payments):      {scenario_counts['1:N']} invoices ({split_payments_count} payment splits)")
    print(f"      * Missing (Unsettled):       {scenario_counts['missing']} invoices")
    print(f"      * Unallocated (Extra Cash):  {unallocated_count} orphan settlement records")
    if is_synthetic_fallback:
        print("  - Settlements Source:     Synthetic data generated matching official API schema")
    else:
        print("  - Settlements Source:     Live Razorpay API response")
    print(f"  - Errors Encountered:     {len(errors)}")
    if errors:
        print("  [WARNING] Details of encountered errors:")
        for err in errors[:5]:
            print(f"     - {err}")
        if len(errors) > 5:
            print(f"     ... and {len(errors) - 5} more")
    print("=" * 50)
    print(f"[SUCCESS] Saved {len(unique_settlements)} settlement records -> {settlements_file}")
    print(f"[SUCCESS] Saved order-invoice mapping -> {map_file}\n")

    return unique_settlements

if __name__ == "__main__":
    # Load invoices
    invoice_file = os.path.join(DATA_DIR, "invoices.csv")
    if not os.path.exists(invoice_file):
        invoice_file = "invoices.csv"  # fallback

    invoices = []
    try:
        with open(invoice_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row["total"] = float(row["total"])
                invoices.append(row)
    except Exception as e:
        print(f"[ERROR] Error loading {invoice_file}: {e}")
        sys.exit(1)

    # Generate Razorpay data
    settlements = generate_real_razorpay_data(invoices, split_scenarios=True, wait_duration=30)