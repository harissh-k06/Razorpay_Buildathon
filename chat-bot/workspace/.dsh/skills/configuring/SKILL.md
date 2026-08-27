---
name: configuring
description: "Change base currency and adjust matching parameters."
---

# Skill: Configuring

## Overview
This module governs how you change platform settings, including currency and matching parameters.

## Changing Base Currency
Use `change_base_currency(new_currency)`.
- **Direct Execution Rule**: When the user says "change base currency to USD" (or any currency like EUR, INR, GBP), ALWAYS call `change_base_currency` with the new currency. This will re-run the standardization pipeline and update all `amount_converted` fields.
- **Impact**: Re-runs the entire standardization pipeline, converting all amounts in `invoice_standardized.csv`, `razorpay_standardized.csv`, and `bank_standardized.csv` to the new base currency.
- **Confirmation Directive**: If confirmation is needed, present the target currency once. When the user confirms ("I confirm", "Yes", "Go ahead"), execute `change_base_currency` immediately.

## Adjusting Matching Parameters
Use `run_reconciliation(config_overrides)` to change:
- `amount_tolerance_pct` (Default 5%)
- `date_tolerance_days` (Default 7)
- `rejection_threshold` (Default 0.4)
- `split_tolerance_pct` (Default 5% - **recommend 20%** for standard gateway fees)
- `max_invoices_per_settlement` (Default 5)

## Analyzing Match Rates
- If match rate is **< 90%**: Suggest increasing `amount_tolerance_pct` to 10% and `split_tolerance_pct` to 20%.
- If match rate is **100%**: Explain the exceptions are **Unallocated Cash** or **Low Severity Bank items**, not matching failures.
