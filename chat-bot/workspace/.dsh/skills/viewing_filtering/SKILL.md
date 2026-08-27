---
name: viewing_filtering
description: "Filter and search exceptions and unallocated cash by status_type, type, date, vendor, amount, or UTR."
---

# Skill: Viewing & Filtering

## Overview
This module governs how you view, search, and filter data from the Review and Results tabs. Use the `query_exceptions` and `get_unallocated_cash` MCP tools as your primary engine.

## Financial Categories
- **Exceptions (High Risk / Missing Cash)**: Money expected but not physically in bank.
  - Invoices with `No matching Razorpay settlement` (Billed, but gateway didn't capture/settle).
  - Razorpay with `No matching Bank deposit` (Gateway settled, but bank statement does not reflect).
  - Bank with `No matching Razorpay settlement` (Deposit exists without gateway record).
  - Fetch with: `query_exceptions(status_type='exception')`.
- **Unallocated Cash (Medium Risk / Extra Cash)**: Money physically present in Bank/Gateway, but no invoice exists.
  - Razorpay with `No matching invoice` (Extra funds at gateway).
  - Bank with `No matching invoice` or `No matching Razorpay settlement or invoice` (Extra funds in bank).
  - Fetch with: `query_exceptions(status_type='unallocated_cash')` or `get_unallocated_cash()`.

## How to Filter
The user can ask for specific records. You **MUST** translate their natural language into structured parameters. 

### Supported Filter Dimensions
| User Intent | Parameter | Example |
| :--- | :--- | :--- |
| By Category | `status_type` | "Show me **Exceptions**" -> `status_type='exception'`<br>"Show me **Unallocated Cash**" -> `status_type='unallocated_cash'` |
| By Type | `type` | "Show me **Invoice** exceptions" -> `type='invoice'` |
| By Date Range | `date_from`, `date_to` | "Show me records in **March**" -> `date_from='2025-03-01'`, `date_to='2025-03-31'` |
| By Vendor | `vendor` | "Show me **Twilio** exceptions" -> `vendor='twilio'` |
| By Amount | `amount_min`, `amount_max` | "Show me records above **₹10,000**" -> `amount_min=10000` |
| By Search | `search_term` | "Find UTR **1787679471...**" -> `search_term='1787679471'` |

## The Three Tabs
When viewing data, explain the distinction:
- **Matched Triplets**: 3-way matched records linking Invoice, Razorpay Settlement, and Bank Deposit.
- **Unallocated Cash (Medium Risk / Extra Cash)**: Payments deposited or settled that lack matching customer billing invoices.
- **Exceptions (High Risk / Missing Cash)**: Expected revenue or payouts missing from bank/gateway accounts.

## Advanced Analytics & Cross-Source Search Tools
- **High-Level Statistics**: `get_summary_stats()` -> Returns total invoice amount, settled amount, bank credit, discrepancy, and match rate.
- **Unallocated Cash Helper**: `get_unallocated_cash(type, vendor, date_from, date_to, ...)` -> Queries unallocated cash entries.
- **Vendor Aggregations**: `aggregate_exceptions_by_vendor(type, status_type, sort_by)` -> Groups exceptions or unallocated cash by vendor (`sort_by='count'` or `'amount'`).
- **Top Exceptions**: `get_top_exceptions(limit, status_type)` -> Returns the top N largest exceptions by amount.
- **Cross-Source Search**: `search_transactions(search_term)` -> Searches across all 3 standardized sources (Invoice, Razorpay, Bank).
- **Payment Gateway Fees**: `get_total_gateway_fees(date_from, date_to)` -> Calculates sum of fees and taxes deducted by Razorpay.
- **Matched Triplets**: `get_matched_triplets(type, vendor, date_from, date_to, limit)` -> Queries reconciled matched triplets.

## Tool Reference
- `query_exceptions(type, exception_type, status_type, date_from, date_to, vendor, amount_min, amount_max, search_term, limit)`
- `get_unallocated_cash(type, vendor, date_from, date_to, amount_min, amount_max, search_term, limit)`
- `get_summary_stats()`
- `aggregate_exceptions_by_vendor(type, status_type, sort_by)`
- `get_top_exceptions(limit, status_type)`
- `search_transactions(search_term)`
- `get_total_gateway_fees(date_from, date_to)`
- `get_matched_triplets(type, vendor, date_from, date_to, limit)`
- `get_standardized_data_preview(source, limit)`
