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
