---
name: explaining
description: "Explain standardization rules, matching logic, and financial exceptions using plain business language."
---

# How to Explain Standardization

When the user asks "How was the data standardized?", "Explain how the data was standardized", or asks about the cleaning process, use the `explain_standardization` tool. Then provide a clean, high-level summary using the exact format below.

## STRICT BUSINESS LANGUAGE RULES (MANDATORY)

DO NOT mention internal technical details:
- DO NOT mention "MCP", "Parsers", or "canonical JSON".
- DO NOT mention "Paise", "divided by 100", or raw unit calculations.
- DO NOT mention "Hungarian Algorithm", "Subset-Sum", or "cost matrix".
- DO NOT mention internal column names like `credit_converted`, `amount_converted`, or raw code fields.
- DO NOT mention "UTRs", "N:1", or "1:N" technical terms.
- DO NOT mention gateway fees unless explaining why a deposited amount is slightly less than the invoice.

MUST mention in plain English:
- **Vendors**: Vendor names were cleaned up and normalized. Give 3 actual examples: "Amazon Web Services" changed to `amazon`, "Slack Technologies" changed to `slack`, and "Zoho Corporation" changed to `zoho`.
- **Dates**: All dates were converted into a clean, standardized `YYYY-MM-DD` format (e.g., 2025-09-08).
- **Currencies**: All invoice, settlement, and bank amounts were converted from their original currencies (USD, EUR, GBP, etc.) to the base currency (e.g., INR).
- **Gateway Fees**: Processing fees and taxes are tracked separately, so the "Net" amount received is slightly less than the invoice amount.
- **Matching**: The system links your invoices to the payments received (Razorpay settlements) and the money that actually hits your bank account.

## Required Summary Format

When the user asks "Explain how the data was standardized", respond with:

### Data Standardization Summary

- **Vendors:** Vendor names were cleaned up and normalized. For example, "Amazon Web Services" became `amazon`, "Slack Technologies" became `slack`, and "Zoho Corporation" became `zoho`.
- **Dates:** All dates were converted into a clean, standardized YYYY-MM-DD format (e.g., 2025-09-08).
- **Currencies:** All invoice, settlement, and bank amounts were converted from their original currencies (USD, EUR, GBP, etc.) to the base currency (e.g., INR).
- **Gateway Fees:** Processing fees and taxes are tracked separately, so the "Net" amount received is slightly less than the invoice amount.
- **Matching:** The system links your invoices to the payments received (Razorpay settlements) and the money that actually hits your bank account.

---

## How to Explain Specific Exceptions
When asked "Why is this an exception?", explain in simple business terms:
- **Unmatched Invoice**: Invoice billed, but no matching payment received yet (Credit risk).
- **Unallocated Cash**: Payment received, but no matching invoice found yet.
- **Bank Deposit without Settlement**: Money deposited in the bank without an associated gateway settlement record.
