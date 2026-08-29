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

---

## How to Explain Reconciliation Results & Analytics
When the user asks "Explain the results", "Give me an overview of reconciliation", or asks about charts and metrics:
1. Call `get_summary_stats` to retrieve the comprehensive executive KPIs, gauge, donut distribution, and financial flow realisation breakdown.
2. Structure your response into clear, professional executive sections:
   - 📊 **Executive Overview & KPIs**: Total Invoiced (Gross Target), Total Settled & Credited, Discrepancy Variance, and Resolved records.
   - ⏱️ **Invoice Match Rate Realization (Gauge)**: Matched Invoices Rate % (e.g. 96.0% — 192/200 customer invoices matched, 8 missing cash).
   - 🍩 **Reconciliation Status Distribution (Donut Chart)**: Record Coverage Rate % (e.g. 91.87% coverage across 246 total records: 226 Matched Triplets [91.9%], 12 Unallocated Cash [4.9%], 8 Missing Cash Exceptions [3.3%], 0 Resolved).
   - 💵 **Financial Flow & Settlement Realisation (Waterfall Flow)**:
     - **1. Gross Pay (Billed)**: Total customer billing benchmark volume.
     - **2. Net Income (In-Hand)**: Net operating profit credited to bank from customer invoices (e.g. ₹46,53,955.86 / 78.4%).
     - **3. Government Tax (Invoice Tax)**: Statutory GST/Sales tax collected on customer invoices for government remittance (e.g. ₹9,06,015.03 / 15.3%).
     - **4. Razorpay Deductions**: Total payment gateway MDR transaction processing fees and taxes (e.g. ₹1,33,997.56 / 2.3%).
     - **5. Missing Cash (Exceptions)**: Billed invoices not yet captured or settled by payment gateway (e.g. ₹2,45,464.02 / 4.1%).
     - **6. Unallocated Cash**: Extra funds received in Razorpay/Bank without matching invoices (e.g. ₹17,153.86 / 0.3%).
     - **Realization Equation**: `Gross Billed = Net In-Hand + Government Tax + Razorpay Deductions + Missing Cash`.
   - 🚨 **High-Risk Exceptions & Unallocated Cash Summary**: Top exposures, affected counterparties, and recommended next steps (dispute memos, allocation requests, or vendor emails).
