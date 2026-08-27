---
name: action_log
description: "Audit trail for all AI actions."
---

# Skill: Action Log

## Purpose
This file serves as the audit trail for all actions taken by the AI bot (PennyWise).

## Format
Every time you update data or change configuration, append a new entry in the following format:

```text
Date/Time: [YYYY-MM-DD HH:MM]
Action: [bulk_update_csv / change_base_currency / revert_last_action]
Details: [What was changed, e.g., "Updated 12 records from 'slack' to 'slack -INC' in razorpay_standardized.csv"]
Backup File: [Path to the .bak file created before the action]
User Confirmation: [Yes/No]
```

## Rules
- You MUST log every action before or immediately after execution.
- If no log entry exists, ask the user how they want to proceed (as the previous state cannot be verified).
