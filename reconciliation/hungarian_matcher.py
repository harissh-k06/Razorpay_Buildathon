import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from pathlib import Path
from datetime import datetime

try:
    from reconciliation.config import ReconciliationConfig
    from reconciliation.subset_sum_matcher import match_bucket
except (ImportError, ModuleNotFoundError):
    try:
        from .config import ReconciliationConfig
        from .subset_sum_matcher import match_bucket
    except (ImportError, ModuleNotFoundError):
        from config import ReconciliationConfig
        from subset_sum_matcher import match_bucket

class HungarianMatcher:
    def __init__(self, config: ReconciliationConfig, map_file_path=None):
        self.config = config
        self.LARGE_COST = 1e6

        # Load order → invoice mapping
        if map_file_path is None:
            map_file_path = (
                Path(__file__).resolve().parent.parent
                / "synthetic data" / "data" / "order_invoice_map.csv"
            )
        self.order_invoice_map = pd.read_csv(map_file_path)
        self.order_to_invoices = {}
        for _, row in self.order_invoice_map.iterrows():
            order_id = row['order_id']
            inv_id = row['invoice_id']
            self.order_to_invoices.setdefault(order_id, []).append(inv_id)

    def build_cost_matrix(self, source_records, target_records, is_razorpay_to_bank=False):
        """
        Build cost matrix for 1:1 matching using Hungarian.
        Used only for leftovers after subset‑sum matching.
        """
        n_src = len(source_records)
        n_tgt = len(target_records)
        if n_src == 0 or n_tgt == 0:
            return np.full((n_src, n_tgt), self.LARGE_COST)

        cost_matrix = np.full((n_src, n_tgt), self.LARGE_COST)

        for i, src in enumerate(source_records):
            for j, tgt in enumerate(target_records):
                # Vendor cost
                if not is_razorpay_to_bank:
                    if self.config.vendor_must_match and src.get('vendor') != tgt.get('vendor'):
                        continue
                    vendor_cost = 0.0 if src.get('vendor') == tgt.get('vendor') else 0.3
                else:
                    vendor_cost = 0.0  # Bank → Razorpay all same vendor

                # Amount cost (log ratio)
                src_amt = src.get('amount', 0)
                tgt_amt = tgt.get('amount', 0)
                if tgt_amt <= 0 or src_amt <= 0:
                    amount_cost = 0.5
                else:
                    ratio = src_amt / tgt_amt
                    amount_cost = min(abs(np.log(ratio)), 0.5)

                # Date cost (exponential decay)
                src_date = src.get('date')
                tgt_date = tgt.get('date')
                if src_date is not None and tgt_date is not None and pd.notna(src_date) and pd.notna(tgt_date):
                    diff_days = abs((src_date - tgt_date).days)
                    date_cost = min(1 - np.exp(-diff_days / 2.0), 0.5)
                else:
                    date_cost = 0.5

                cost = (self.config.weight_amount * amount_cost +
                        self.config.weight_date * date_cost +
                        self.config.weight_vendor * vendor_cost)

                cost_matrix[i, j] = cost

        return cost_matrix

    def match(self, invoices, razorpay_settlements, bank_deposits):
        """
        Perform full 3‑way reconciliation with:
          - order_id mapping (invoice → order)
          - subset‑sum for N:1 and 1:N splits
          - Hungarian for remaining 1:1 leftovers
          - UTR join for bank matching

        Returns dict with triplets, exceptions, match_rate.
        """
        # Build invoice lookup by invoice_id
        inv_by_id = {inv['invoice_id']: inv for inv in invoices}

        # Group Razorpay records by order_id
        raz_by_order = {}
        for raz in razorpay_settlements:
            order_id = raz.get('order_id')
            if order_id:
                raz_by_order.setdefault(order_id, []).append(raz)

        # Bank lookup by UTR
        bank_by_utr = {bank['ref_no']: bank for bank in bank_deposits if bank.get('ref_no')}

        matched_triplets = []
        used_invoice_ids = set()
        used_razorpay_ids = set()

        # -------------------------------------------------------------
        # Stage 1: Use mapping + subset‑sum for split handling
        # -------------------------------------------------------------
        for order_id, raz_list in raz_by_order.items():
            inv_ids = self.order_to_invoices.get(order_id, [])
            if not inv_ids:
                continue
            invs_for_order = [inv_by_id[inv_id] for inv_id in inv_ids if inv_id in inv_by_id]
            if not invs_for_order:
                continue

            # Case A: 1:N split (1 invoice -> multiple partial settlements under the same order)
            if len(invs_for_order) == 1 and len(raz_list) > 1:
                inv = invs_for_order[0]
                total_raz_amt = sum(r.get('credit', r.get('amount', 0)) for r in raz_list)
                if abs(total_raz_amt - inv.get('amount', 0)) <= self.config.split_tolerance * max(inv.get('amount', 0), 1e-5):
                    vendor_ok = (not self.config.vendor_must_match) or all(r.get('vendor') == inv.get('vendor') for r in raz_list)
                    date_ok = all(
                        (inv.get('date') is None or r.get('date') is None or abs((inv['date'] - r['date']).days) <= self.config.date_window_days)
                        for r in raz_list
                    )
                    if vendor_ok and date_ok:
                        for raz_rec in raz_list:
                            matched_triplets.append({
                                'invoice_ids': [inv['invoice_id']],
                                'razorpay': raz_rec,
                                'bank': None,
                                'match_type': '1:N Split'
                            })
                            used_razorpay_ids.add(raz_rec['entity_id'])
                        used_invoice_ids.add(inv['invoice_id'])
                        continue

            # Case B: 1:1 or N:1 subset‑sum matching on this order bucket
            matches, unmatched_invs = match_bucket(
                invoices=invs_for_order,
                settlements=raz_list,
                tolerance=self.config.split_tolerance,
                max_invoices=self.config.max_invoices_per_settlement,
                date_window_days=self.config.date_window_days,
                vendor_must_match=self.config.vendor_must_match
            )

            # Record matched settlements
            for sett_id, matched_inv_ids in matches:
                if matched_inv_ids:
                    # Find the actual Razorpay record
                    raz_record = next((r for r in raz_list if r['entity_id'] == sett_id), None)
                    if raz_record is None:
                        continue
                    # Store matched triplet (bank will be filled later)
                    match_type = 'N:1 Group' if len(matched_inv_ids) > 1 else '1:1 Exact'
                    matched_triplets.append({
                        'invoice_ids': matched_inv_ids,
                        'razorpay': raz_record,
                        'bank': None,
                        'match_type': match_type
                    })
                    for inv_id in matched_inv_ids:
                        used_invoice_ids.add(inv_id)
                    used_razorpay_ids.add(sett_id)

            # Unmatched invoices will be passed to Hungarian later
            # We'll collect them globally after all buckets processed.

        # -------------------------------------------------------------
        # Stage 2: Collect leftovers (invoices & Razorpay not used)
        # -------------------------------------------------------------
        leftover_invoices = [inv for inv in invoices if inv['invoice_id'] not in used_invoice_ids]
        leftover_razorpay = [raz for raz in razorpay_settlements if raz['entity_id'] not in used_razorpay_ids]

        # -------------------------------------------------------------
        # Stage 3: Hungarian for leftover 1:1 matches
        # -------------------------------------------------------------
        if leftover_invoices and leftover_razorpay:
            cost_matrix = self.build_cost_matrix(leftover_invoices, leftover_razorpay, is_razorpay_to_bank=False)
            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            for i, j in zip(row_ind, col_ind):
                if cost_matrix[i, j] <= self.config.rejection_threshold:
                    inv = leftover_invoices[i]
                    raz = leftover_razorpay[j]
                    used_invoice_ids.add(inv['invoice_id'])
                    used_razorpay_ids.add(raz['entity_id'])
                    is_exact = (inv.get('amount') == raz.get('amount') and inv.get('vendor') == raz.get('vendor'))
                    matched_triplets.append({
                        'invoice_ids': [inv['invoice_id']],
                        'razorpay': raz,
                        'bank': None,
                        'match_type': '1:1 Exact' if is_exact else '1:1 Fuzzy'
                    })

        # -------------------------------------------------------------
        # Stage 4: Link to bank deposits using UTR
        # -------------------------------------------------------------
        for triplet in matched_triplets:
            utr = triplet['razorpay'].get('settlement_utr')
            if utr in bank_by_utr:
                triplet['bank'] = bank_by_utr[utr]

        # Stage 5: Build exceptions list
        exceptions = []
        # Invoices not matched to any Razorpay settlement
        for inv in invoices:
            if inv['invoice_id'] not in used_invoice_ids:
                exceptions.append({
                    'type': 'invoice',
                    'record': inv,
                    'reason': 'No matching Razorpay settlement'
                })
        # Razorpay settlements matched to invoices but missing bank deposit (Gateway settled, but bank didn't receive it)
        seen_missing_bank_rzp = set()
        for triplet in matched_triplets:
            if triplet.get('bank') is None and triplet.get('razorpay'):
                rzp = triplet['razorpay']
                eid = rzp.get('entity_id')
                if eid and eid not in seen_missing_bank_rzp:
                    seen_missing_bank_rzp.add(eid)
                    exceptions.append({
                        'type': 'razorpay',
                        'record': rzp,
                        'reason': 'No matching Bank deposit'
                    })
        # Razorpay records not matched to any invoice (Extra cash sitting at gateway)
        for raz in razorpay_settlements:
            if raz['entity_id'] not in used_razorpay_ids:
                exceptions.append({
                    'type': 'razorpay',
                    'record': raz,
                    'reason': 'No matching invoice'
                })
        # Bank deposits not linked to any matched triplet
        matched_bank_utrs = {t['razorpay']['settlement_utr'] for t in matched_triplets if t.get('razorpay') and t.get('bank')}
        all_razorpay_utrs = {r.get('settlement_utr') for r in razorpay_settlements if r.get('settlement_utr')}
        
        for bank in bank_deposits:
            utr = bank.get('ref_no')
            if utr not in matched_bank_utrs:
                if utr in all_razorpay_utrs:
                    # Bank deposit corresponds to an unallocated Razorpay settlement
                    exceptions.append({
                        'type': 'bank',
                        'record': bank,
                        'reason': 'No matching invoice'
                    })
                else:
                    # Bank deposit with no gateway record at all
                    exceptions.append({
                        'type': 'bank',
                        'record': bank,
                        'reason': 'No matching Razorpay settlement'
                    })

        match_rate = len(used_invoice_ids) / len(invoices) * 100 if invoices else 0

        return {
            'triplets': matched_triplets,
            'exceptions': exceptions,
            'match_rate': match_rate,
            'total_invoices': len(invoices),
            'matched_count': len(used_invoice_ids),
            'triplets_count': len(matched_triplets)
        }