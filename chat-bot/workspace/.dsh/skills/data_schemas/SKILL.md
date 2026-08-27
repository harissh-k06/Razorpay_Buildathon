---
name: data_schemas
description: "Detailed structure of standardized CSV files and matching rules."
---

# Skill: Data Schemas

## Overview
This file defines the exact structure of the standardized CSVs loaded into the system. Understanding these schemas is critical for the bot to query, explain, and update data correctly.

## Standardized Data Columns

### 1. Invoices (`invoice_standardized.csv`)
- **Primary ID**: `invoice_id` (e.g., `INV-001`)
- **Order ID**: `order_id` (e.g., `order_IGthkBFOlisrab`)
- **Critical Amount Field**: `amount_converted` (The Net Invoice amount in Base Currency)
- **Vendor**: `vendor_standardized` (e.g., `stripe`)
- **Date**: `date_standardized` (YYYY-MM-DD)
- **Source Type**: `source_type` (Always `invoice`)

*Note: The `credit_converted`, `debit_converted`, and `balance_converted` columns are all `0.0` for invoices and should be ignored.*

### 2. Razorpay Settlements (`razorpay_standardized.csv`)
- **Primary ID**: `entity_id` (e.g., `pay_a7OQTxrtTQEMwk`)
- **Order ID**: `order_id` (e.g., `order_tPW89wthxJ5Bhn`)
- **Settlement UTR (for Bank linking)**: `settlement_utr` (e.g., `17876794715a5pis`)
- **Gross Amount (with Fees)**: `amount_converted` (In Base Currency)
- **CRITICAL NET AMOUNT**: `credit_converted` (The actual deposited amount after Razorpay fees, in Base Currency)
- **Vendor**: `vendor_standardized` (e.g., `amazon`)
- **Settlement Date**: `settled_at_standardized` (YYYY-MM-DD)
- **Source Type**: `source_type` (Always `razorpay`)

### 3. Bank Deposits (`bank_standardized.csv`)
- **Primary ID**: `ref_no` (This is the Bank UTR, e.g., `1787679471sqwhbe`)
- **Credit Amount**: `credit_converted` (The deposited cash in Base Currency)
- **Vendor**: `vendor_standardized` (Always `razorpay` for these settlements)
- **Date**: `date_standardized` (YYYY-MM-DD)
- **Source Type**: `source_type` (Always `bank`)

## Critical Matching Rules

### How to Link the 3-Way Triplet:
1. **Razorpay to Bank**: Link via `settlement_utr` (Razorpay) == `ref_no` (Bank).
2. **Razorpay to Invoice**: Link via `order_id` OR by matching `vendor_standardized` + `credit_converted`.
3. **1:N Split**: One `order_id` has multiple Razorpay records. The SUM of their `credit_converted` must equal `amount_converted` (Invoice) within the allowed split tolerance (typically 20% to account for fees).
4. **N:1 Group**: Multiple Razorpay records share the exact same `settlement_utr`. 

### ⚠️ CRITICAL WARNING (Do Not Ignore)
**NEVER use `amount_converted` for Razorpay matching.**
- `amount_converted` on Razorpay is the **GROSS** amount (includes gateway fees).
- `credit_converted` is the **NET** amount (actual cash deposited into the bank).
- Because invoices are Net amounts, **you MUST use `credit_converted`** when calculating 1:N splits or matching against invoices. Failure to do so will incorrectly classify valid splits as exceptions.

## Data Status
- All `credit`, `debit`, and `balance` fields for Razorpay have been correctly converted from Paise to Rupees in the `*_converted` columns.
- All amounts are in the **Base Currency** (`INR` by default).
