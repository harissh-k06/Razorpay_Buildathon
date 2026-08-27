"""
Deterministic subset‑sum matcher for N:1 splits.
"""
import numpy as np
from itertools import combinations

def find_subset_sum(target, items, tolerance, max_items):
    """
    Find a subset of items that sums to `target` within `tolerance * target`.

    Parameters:
        target (float): The sum to match.
        items (list of (id, amount)): Available items.
        tolerance (float): Allowed relative deviation (e.g. 0.02 for 2%).
        max_items (int): Maximum number of items allowed in a subset.

    Returns:
        list: IDs of chosen items, or None if no subset is found.
    """
    # Sort by amount for pruning
    items = sorted(items, key=lambda x: x[1])
    n = len(items)
    best_combo = None
    best_diff = float('inf')

    def dfs(start, current_sum, combo):
        nonlocal best_combo, best_diff
        if len(combo) > max_items:
            return
        # If within tolerance, update best
        if abs(current_sum - target) <= tolerance * target:
            diff = abs(current_sum - target)
            if diff < best_diff:
                best_diff = diff
                best_combo = combo.copy()
            # Keep searching for a better (closer) match
        if current_sum > target * (1 + tolerance):
            return
        for i in range(start, n):
            combo.append(items[i][0])
            dfs(i + 1, current_sum + items[i][1], combo)
            combo.pop()

    dfs(0, 0.0, [])
    return best_combo


def match_bucket(invoices, settlements, tolerance, max_invoices, date_window_days, vendor_must_match):
    """
    Match a group of invoices to a group of settlements using subset‑sum.

    Parameters:
        invoices (list of dict): each with 'id', 'amount', 'date', 'vendor'.
        settlements (list of dict): each with 'id', 'amount', 'date', 'vendor'.
        tolerance (float): allowed deviation.
        max_invoices (int): max invoices per settlement.
        date_window_days (int): allowed date difference (days).
        vendor_must_match (bool): if True, only invoices with same vendor are considered.

    Returns:
        (matches, unmatched_invoices):
            matches: list of (settlement_id, [invoice_ids])
            unmatched_invoices: list of invoice dicts not used.
    """
    matches = []
    used_invoice_ids = set()

    # Process settlements in descending amount (largest first)
    for sett in sorted(settlements, key=lambda x: -x.get('amount', 0)):
        sett_id = sett.get('entity_id') or sett.get('id')
        sett_date = sett.get('date')
        # Candidate invoices: not used, vendor match, within date window
        candidates = []
        for inv in invoices:
            inv_id = inv.get('invoice_id') or inv.get('id')
            if not inv_id or inv_id in used_invoice_ids:
                continue
            if vendor_must_match and inv.get('vendor') != sett.get('vendor'):
                continue
            # Date window check
            inv_date = inv.get('date')
            if inv_date is not None and sett_date is not None:
                if abs((inv_date - sett_date).days) > date_window_days:
                    continue
            candidates.append((inv_id, inv.get('amount', 0.0)))

        if not candidates:
            matches.append((sett_id, []))
            continue

        matched_ids = find_subset_sum(
            target=sett.get('amount', 0.0),
            items=candidates,
            tolerance=tolerance,
            max_items=max_invoices
        )

        if matched_ids:
            matches.append((sett_id, matched_ids))
            for inv_id in matched_ids:
                used_invoice_ids.add(inv_id)
        else:
            matches.append((sett_id, []))

    # Remaining invoices not matched to any settlement
    unmatched_invoices = [inv for inv in invoices if (inv.get('invoice_id') or inv.get('id')) not in used_invoice_ids]
    return matches, unmatched_invoices
    