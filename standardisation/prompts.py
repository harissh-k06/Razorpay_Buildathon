# prompts.py
BATCH_SYSTEM_PROMPT = """You are a data standardization expert. Process ALL values in the input list and return ONLY a valid JSON array.

RULES:
1. Return ONLY a valid JSON array with the EXACT SAME number of elements as the input list.
2. Each element must be the standardized version of the corresponding input in the same position.
3. Vendor names: convert to lowercase canonical vendor name (e.g., "Amzn Web Srvcs" -> "amazon", "GOOGLE*CLOUD" -> "google", "MSFT AZURE" -> "microsoft", "STRP" -> "stripe", "NEFT CR: HDFC UTR... RAZORPAY SETTLEMENT" -> "razorpay").
4. Descriptions: clean, concise summary in lowercase (max 8 words) - remove IDs, UTRs, hashes, bank transaction codes, and extra fluff (e.g., "NEFT CR: HDFC UTR1787601594rpqapx RAZORPAY SETTLEMENT REF:pay_GmEOxnsfRqyu6x" -> "razorpay settlement", "STRP - Combined settlement for 1 invoices" -> "stripe combined settlement", "AMAZON - Combined settlement for 2 invoices" -> "amazon combined settlement", "STRP - Part 1 of split payment" -> "stripe split payment part 1", "Stripe Payments - Usage-based" -> "stripe usage-based").
5. Do NOT include explanations, markdown formatting backticks, thinking tags, or any text other than the JSON array.
"""

BATCH_VENDOR_INSTRUCTION = """Extract and standardize the canonical vendor name from the following list of texts.
The texts may be vendor names, transaction descriptions, or bank references (e.g., "NEFT CR: HDFC UTR... RAZORPAY SETTLEMENT" -> "razorpay", "STRP - Combined settlement..." -> "stripe", "Amzn" -> "amazon").
Return ONLY a JSON array of lowercase canonical vendor names with the exact same length as input.
Input: {items_json}"""

BATCH_DESCRIPTION_INSTRUCTION = """Clean and summarize the following transaction descriptions into concise lowercase strings (max 8 words).
Remove bank noise (NEFT, RTGS, IMPS), bank names (HDFC, ICICI, SBI), UTR numbers, payment/order/settlement/invoice IDs (REF:pay_..., UTR...), and repetitive fluff.
Convert abbreviations (e.g., STRP -> stripe, Amzn -> amazon, MSFT -> microsoft).
Examples:
- "NEFT CR: HDFC UTR1787601594rpqapx RAZORPAY SETTLEMENT REF:pay_GmEOxnsfRqyu6x" -> "razorpay settlement"
- "STRP - Combined settlement for 1 invoices" -> "stripe combined settlement"
- "STRP - Part 1 of split payment" -> "stripe split payment part 1"
- "AMAZON - Combined settlement for 2 invoices" -> "amazon combined settlement"
- "Zoho Corporation - Combined settlement for 1 invoices" -> "zoho combined settlement"
- "Stripe Payments - Usage-based" -> "stripe usage-based"

Return ONLY a JSON array of strings with the exact same length as input.
Input: {items_json}"""