---
name: reverting_changes
description: "Revert previously made changes using backup files."
---

# Skill: Reverting Changes

## Overview
This module governs how you undo changes made to CSV files, configuration, or base currency. **You MUST be extremely explicit before reverting anything.**

## How to Revert
1. **Check available backups**: Call `list_backups` to see what `.bak` files exist, along with timestamps and descriptions.
2. **Identify the target**: Determine which backup corresponds to the user's request.
3. **Summarize**: Tell the user exactly what will be restored and which file will be overwritten.
4. **Confirm**: Ask for explicit confirmation before executing.
5. **Execute**: Call `revert_last_action` (or a specific `restore_backup` tool if available).
6. **Re-run**: Trigger `run_reconciliation` to ensure the data is correct after the revert.

## Rules
- NEVER revert to a backup without showing the user the list of available options.
- Always log the revert in `action_log.md`.
- If the user asks to "undo the last change", look at the most recent entry in `action_log.md`.
