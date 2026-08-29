---
name: resolving_editing
description: "Update CSV data, reassign records, and draft dispute memos."
---

# Skill: Resolving & Editing

## THE STRICT AGENTIC MODE TOGGLE RULE (MANDATORY):
- **Agentic Mode (Green / ON)**: All write/edit tools execute directly and automatically with zero-click execution.
- **Ask Mode (Yellow / OFF)**: Write/edit tools are strictly locked and cannot execute under any circumstance — text confirmation in chat does NOT grant permission.
- If the user asks for a modification while in Ask Mode, decline and inform them: *"This is an agentic action. Please turn Agentic Mode ON (green toggle next to the send button) to proceed."*
- **The field to be updated for vendor name changes is ALWAYS `vendor_standardized`** unless the user explicitly says otherwise.

## Overview
This module governs how you update data, re-map records, and draft dispute memos. You MUST adhere to the Agentic Mode toggle state.

## Common Actions

### 1. Bulk Updating Data (e.g., Fixing Vendor Names)
Use `bulk_update_csv(source, condition, new_values)` to change vendor names or fix typos across the standardized CSVs.

**Summary Presentation Rule (Old Value -> New Value):**
When presenting a summary to the user, ALWAYS clearly display the mapping:
`Update vendor_standardized: "Old Value" -> "New Value"`
NEVER just show `vendor_standardized = "old"` without showing the new target value.

**Source Selection Protocol (MANDATORY):**
- **ALWAYS search across ALL THREE sources** (`invoice`, `razorpay`, `bank`) for the vendor or condition.
- If the user specifies the sources (e.g., "in all 3 files", "in invoice and razorpay"), or if you have already presented the counts and the user confirms, **do NOT ask again**.
- If the user has not specified the source, present the counts once showing the exact Old -> New mapping:
  "I found this vendor in the following sources:
  - Invoice: X records (`vendor_standardized: "zoho" -> "zoho corp"`)
  - Razorpay: Y records (`vendor_standardized: "zoho" -> "zoho corp"`)
  - Bank: Z records (`vendor_standardized: "zoho" -> "zoho corp"`)
  Would you like me to execute this across all sources?"
- **If the user says 'I confirm', 'I confirm across all 3 files', or 'Go ahead', execute immediately across the confirmed/all sources.**

**Step-by-Step Process:**
1. **Find the affected records across all 3 sources**: Check `invoice`, `razorpay`, and `bank` to see where the vendor/record exists.
2. **Present Clear Summary Once**: Show the exact count and `vendor_standardized: "old" -> "new"`.
3. **Execute Immediately on Confirmation**: Call `bulk_update_csv` for each target source without any second round of questioning.
4. **Re-run Reconciliation**: Trigger `run_reconciliation` to compute the updated match rate.

Tool Call Example:
```json
{
  "tool_name": "bulk_update_csv",
  "arguments": {
    "source": "razorpay",
    "condition": {"vendor_standardized": "zoho"},
    "new_values": {"vendor_standardized": "zoho corp"}
  }
}
```

### 2. Reassigning Unallocated Cash (Medium Severity)
Use `update_csv_record` to map a specific Razorpay `entity_id` to an existing Invoice ID. 
1. **Check Invoice Existence**: Verify the target Invoice ID exists in `invoice_standardized.csv` (you can use `query_exceptions` or `get_standardized_data_preview`).
2. **Confirm**: Ask the user: "I am about to map Razorpay entity `pay_X` to Invoice `INV-Y`. Confirm?"
3. **Execute**: Call `update_csv_record` linking the specific `order_id` to the Invoice, OR directly map the `entity_id` to the invoice in the mapping file.
4. **Re-run Reconciliation**: Trigger `run_reconciliation` to see if it moves from Unallocated Cash to Matched.

### 3. Drafting Dispute Memos (Missing Cash)
**Memo vs Email**: If the user asks for a **memo** (formal internal/external document), use `draft_dispute_memo` or `draft_unallocated_cash_memo`. If the user asks for an **email** (to send to a recipient), use `generate_email_from_exception` (see Section 5). Do not mix the two.

Use `draft_dispute_memo(exception_ids, memo_type)` for missing cash exceptions (e.g. uncollected invoices, missing bank deposits).

- **Single Exception Resolution Directive**: When the user asks to draft a dispute memo for an invoice exception (e.g. "Draft memo for INV-025"), call `draft_dispute_memo(exception_ids=["INV-025"])`.
- When filtering for a batch, call `query_exceptions(status_type='exception', ...)` first to get the IDs.

### 4. Drafting Unallocated Cash Memos (Extra Cash)
Use `draft_unallocated_cash_memo(record_ids, vendor, source_type)` when the user asks to draft a memo, notice, or invoice request for **Unallocated Cash** (e.g. payment gateway settlements or bank deposits received without a matching billing invoice).

- **Unallocated Memo Directive**: When the user says "Draft memo for unallocated cash", "Draft memo for payment pay_123", or "Draft memo for unallocated cash from Slack", call `draft_unallocated_cash_memo`.
- Parameters:
  - `record_ids`: Optional list of payment IDs (e.g. `["pay_123"]`) or UTRs.
  - `vendor`: Optional vendor name (e.g. `"slack"`).
  - `source_type`: Optional source (`"razorpay"`, `"bank"`, or `"all"`).

Tool Call Example:
```json
{
  "tool_name": "draft_unallocated_cash_memo",
  "arguments": {
    "vendor": "slack"
  }
}
```

### 5. Generating & Sending Email for Exceptions (Human-to-Human)

When the user wants to send a **professional email** (not a formal memo) to a vendor or counterparty about an exception or unallocated cash, use the **`generate_email_from_exception`** tool.

- **Tool**: `generate_email_from_exception(exception_ids, recipient_email, sender_name=None)`
- **Purpose**: Produces a ready-to-send email (subject + body) in a conversational, human-to-human tone. It internally fetches exception/unallocated details and formats them as a conversational email.
- **When to use**:
  - The user explicitly says: *“Send an email for exception INV-034 to finance@vendor.com”* or *“Email the vendor about payment pay_123”*.
  - The user selects **“Send Email”** from the PennyWise pop-up dialog (the frontend passes the recipient email and exception context).
- **Flow**:
  1. Call the tool with the exception ID(s) and the recipient email.
  2. The tool returns a JSON with `subject`, `body`, and `to`.
  3. Display the email draft in the chat (in a clear, formatted block) along with a JSON code block for frontend rendering.
  4. The user can review, edit (via the chat’s Edit functionality), and then click **Send Email**.
  5. The frontend will handle sending via `/api/email/send` and, on success, automatically call `mark_exceptions_resolved` to resolve the exception.
- **Important**: The email body is written in a warm, professional tone (e.g., *“Hi [Vendor Team], I’m [Your Name], Financial Controller… Could you please provide the corresponding invoice?”*). Do **not** output a formal memorandum for email requests; use the email-specific draft.

**Tool Call Example**:
```json
{
  "tool_name": "generate_email_from_exception",
  "arguments": {
    "exception_ids": ["INV-034"],
    "recipient_email": "finance@vendor.com",
    "sender_name": "Harissh Krishna"
  }
}
```

**Response Handling**:
- After the email draft is generated, confirm to the user: *"Here is the email draft for [recipient]. You can review, edit, or click Send Email in the card below to dispatch it."*
- After the email is sent and resolved via the UI, the frontend will automatically mark the exception as resolved.
- If the user asks to draft an email for multiple exceptions, pass all IDs to the tool – it will aggregate them into a single email draft.
- **Note**: This tool is read-only (it reads exception data and formats output, but does not modify data directly). It does not require Agentic Mode to be ON. The subsequent sending and resolution actions are handled directly by the frontend.

### Memo Template & Presentation Rules
**CRITICAL OUTPUT RULE:** When `draft_dispute_memo` or `draft_unallocated_cash_memo` returns memo content, you **MUST** output the complete, verbatim memorandum text directly in your response inside a block or formatted text. **DO NOT summarize, compress, or replace the memo with short bullet points.** The user needs the full, professional, human-readable letter to copy and send immediately.

**Email Draft Presentation**: When `generate_email_from_exception` returns an email draft, display it with a clear subject line and body, and include the JSON code block. The user should be able to copy or edit it in the UI card. Do not wrap it in a memo header; it should look like a standard conversational email.

```text
================================================================================
FINANCIAL RECONCILIATION DISPUTE & CLARIFICATION MEMORANDUM
================================================================================

MEMORANDUM
To:        [Vendor / Counterparty Name] (Accounts Receivable / Finance Department)
From:      Finance Reconciliation & Operations Team
Date:      [Current Date]
Subject:   Urgent: Transaction Dispute & Reconciliation Clarification — Ref: [ID(s)]

--------------------------------------------------------------------------------
1. TRANSACTION SUMMARY
--------------------------------------------------------------------------------
• Primary Reference / ID(s):  [INV-XXX / pay_XXX / UTR_XXX]
• Vendor / Counterparty:      [Vendor Name]
• Transaction Date(s):        [YYYY-MM-DD]
• Financial Exposure:         ₹[Amount] INR
• Reconciliation State:       Unreconciled Exception (Action Required)

--------------------------------------------------------------------------------
2. DETAILED DISPUTE REASON & BACKGROUND
--------------------------------------------------------------------------------
[Detailed, professional human-readable context explaining why the transaction could not be reconciled, e.g., missing settlement credit, unallocated cash, or ledger mismatch]

--------------------------------------------------------------------------------
3. REQUIRED ACTION & NEXT STEPS
--------------------------------------------------------------------------------
[Clear, numbered action steps requesting remittance advice, UTR, or billing invoices]

--------------------------------------------------------------------------------
4. SENDER CONTACT & CONFIDENTIALITY
--------------------------------------------------------------------------------
Please reply directly to this notice with the requested documentation or contact:
Finance Operations Team | Automated Reconciliation System
Direct Email: finance-reconciliation@internal.corp

================================================================================
```

### 6. Exporting Data to CSV
Use `export_to_csv(data_type, filters, output_path)` to generate custom CSV exports of exceptions, triplets, or standardized datasets.
- `data_type`: `'exceptions'`, `'results'`, `'invoice'`, `'razorpay'`, or `'bank'`
- `filters`: optional dictionary of column filters (e.g., `{"vendor": "slack"}`)
- `output_path`: optional destination path (defaults to `workspace/uploads/`)

Tool Call Example:
```json
{
  "tool_name": "export_to_csv",
  "arguments": {
    "data_type": "exceptions",
    "filters": {"vendor": "slack"}
  }
}
```

### 7. Marking Exceptions Resolved & Bulk Resolution
Use `mark_exceptions_resolved(exception_ids, resolution_note)` or `resolve_exceptions_bulk(exception_ids, mode, resolution_note)` to update exception records to "Resolved" with audit notes.

- `mode="memo"`: Automatically selects dispute memo (for missing cash) or unallocated cash allocation request letter (for extra cash), drafts the full letter, and presents it with `requires_confirmation=True`.
- `mode="direct"`: Direct resolution with custom accountant note.
- `mode="manual"`: One-click manual resolution with default audit trail note.

Tool Call Example (Bulk Resolve with Memo):
```json
{
  "tool_name": "resolve_exceptions_bulk",
  "arguments": {
    "exception_ids": ["INV-025", "INV-061"],
    "mode": "memo"
  }
}
```

Tool Call Example (Direct Resolve):
```json
{
  "tool_name": "mark_exceptions_resolved",
  "arguments": {
    "exception_ids": ["INV-025"],
    "resolution_note": "Payment verified manually via bank offline receipt."
  }
}
```

## Safety Rules for Updates
1. **Backup First**: Before running `bulk_update_csv`, `mark_exceptions_resolved`, or `change_base_currency`, ALWAYS create a `.bak` backup of the file (the backend handles this, but you must mention it).
2. **Confirm Before Editing**: If the action modifies records and confirmation is needed, present a clear summary once and ask for a simple Yes/No.
3. **The Green Light Directive**: If the user says 'I confirm', 'Go ahead', 'Yes', or 'I confirm across all 3 files' after you have presented the plan, it is the final green light. Execute immediately without asking for further clarification or re-confirmation.
4. **Audit Trail**: Log every action you take to `action_log.md` (Date, Action, Details, Backup File, User Confirmation).
