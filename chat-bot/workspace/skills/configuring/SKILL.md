---
name: configuring
description: "Change base currency, date formatting, and adjust matching parameters."
---

# Skill: Configuring

## Overview
This module governs how you change platform settings, including currency, date formats, and matching parameters.

## Changing Base Currency & Date Formatting
Use `change_currency_and_date(base_currency=optional_currency, date_format=optional_format)`.

- **Base Currency Changes**: When the user asks to change the base currency (e.g. "change base currency to USD/EUR/INR/CNY"), ALWAYS call `change_currency_and_date(base_currency="USD")`. This instantly recalculates all `amount_converted` fields using in-memory cached LLM data without re-triggering slow LLM calls.
- **Date Format Changes**: When the user asks to reformat or convert dates across datasets (e.g. "change date format to DD/MM/YYYY", "convert dates to DD-MM-YYYY", "standardize dates to DD/MM/YYYY"), **ALWAYS call `change_currency_and_date(date_format="DD/MM/YYYY")`**.
- **CRITICAL**: **NEVER use `bulk_update_csv` or row-by-row `update_csv_record` to reformat dates**. `change_currency_and_date` automatically and deterministically reformats ALL date columns (`date`, `issue_date`, `due_date`, `transaction_date`, `value_date`, `date_standardized`, `settled_at_standardized`) across `invoice`, `razorpay`, and `bank` datasets in one single fast operation (<0.1s).
- **Combined Changes**: You can change both at once, e.g. `change_currency_and_date(base_currency="USD", date_format="DD/MM/YYYY")`.
- **Impact**: Re-applies conversions and date normalisation across `invoice_standardized.csv`, `razorpay_standardized.csv`, and `bank_standardized.csv`.

## Adjusting Matching Parameters (Decoupled from Running Reconciliation)
Use `configure_matching_parameters(...)` to change any matching thresholds and tolerances without immediately re-running reconciliation matching. This updates `params.json` and updates the UI sliders in real-time:
- `date_tolerance_days`: Date window in days between invoice & deposit (e.g., 5, 7, 10).
- `amount_tolerance_pct`: Amount variance percentage for fee/rounding differences (e.g., 5.0, 10.0).
- `strict_vendor_matching`: Boolean (`True` / `False`) for exact vendor match requirement.
- `weight_amount`: Hungarian cost weight for amount (0-100).
- `weight_date`: Hungarian cost weight for date (0-100).
- `weight_vendor`: Hungarian cost weight for vendor (0-100).
- `rejection_threshold`: Maximum allowed cost cutoff score (e.g., 0.40).
- `allow_split`: Boolean (`True` / `False`) for split settlement (N:1 & 1:N subset-sum).
- `max_invoices_per_settlement`: Max invoices per batch (e.g., 5).
- `split_tolerance_pct`: Split tolerance percentage (e.g., 20.0).

**Rules:**
1. When the user asks to change or adjust any matching parameters (e.g., "change date window to 5 days", "set amount variance to 10%", "turn on strict vendor matching"), **call `configure_matching_parameters(...)`**.
2. Confirm the parameter was updated, state the new value, and let the user know the UI slider has moved to reflect the change.
3. If the user explicitly asks to run, execute, or re-run reconciliation matching after changing parameters, then call `run_reconciliation()`.

## Executing Reconciliation
Use `run_reconciliation()` to execute the 3-way Hungarian matching engine when the user asks to run reconciliation or recalculate matches.

## Analyzing Match Rates
- If match rate is **< 90%**: Suggest increasing `amount_tolerance_pct` to 10% and `split_tolerance_pct` to 20%.
- If match rate is **100%**: Explain the exceptions are **Unallocated Cash** or **Low Severity Bank items**, not matching failures.
