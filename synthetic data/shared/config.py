import random

# Fixed random seed for reproducibility
random.seed(42)

# Real-world vendor names (with abbreviations for mismatches)
VENDORS = [
    {"name": "Amazon Web Services", "abbr": "Amzn", "short": "AMAZON"},
    {"name": "Google Cloud Platform", "abbr": "GCP", "short": "GOOGLE"},
    {"name": "Microsoft Azure", "abbr": "MSFT", "short": "MICROSOFT"},
    {"name": "Stripe Payments", "abbr": "STRP", "short": "STRIPE"},
    {"name": "Shopify Inc", "abbr": "SHOP", "short": "SHOPIFY"},
    {"name": "Salesforce.com", "abbr": "SFDC", "short": "SALESFORCE"},
    {"name": "Zoho Corporation", "abbr": "ZOHO", "short": "ZOHO"},
    {"name": "Freshworks Inc", "abbr": "FRESH", "short": "FRESHWORKS"},
    {"name": "Twilio Inc", "abbr": "TWL", "short": "TWILIO"},
    {"name": "DigitalOcean", "abbr": "DO", "short": "DIGITALOCEAN"},
    {"name": "Cloudflare Inc", "abbr": "CF", "short": "CLOUDFLARE"},
    {"name": "Atlassian", "abbr": "ATL", "short": "ATLASSIAN"},
    {"name": "Slack Technologies", "abbr": "SLK", "short": "SLACK"},
    {"name": "Zoom Video Communications", "abbr": "ZM", "short": "ZOOM"},
    {"name": "Dropbox Inc", "abbr": "DBX", "short": "DROPBOX"},
    {"name": "Adobe Creative Cloud", "abbr": "ADBE", "short": "ADOBE"},
]

# Real-world currencies
CURRENCIES = ["USD", "EUR", "GBP", "INR"]

# Exchange rates (simplified, for reference)
EXCHANGE_RATES = {
    "USD": 1.0,
    "EUR": 0.857,
    "GBP": 0.733,
    "INR": 95.77
}

def generate_order_id():
    """Generate a Razorpay-style order ID"""
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    return "order_" + "".join(random.choices(chars, k=14))

def generate_payment_id():
    """Generate a Razorpay-style payment ID"""
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    return "pay_" + "".join(random.choices(chars, k=14))

def generate_settlement_id():
    """Generate a Razorpay-style settlement ID"""
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    return "setl_" + "".join(random.choices(chars, k=14))

def generate_utr():
    """Generate a realistic UTR (Unique Transaction Reference)"""
    # Real UTR format: timestamp + random string
    import time
    timestamp = str(int(time.time()))[-10:]
    chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    suffix = "".join(random.choices(chars, k=6))
    return timestamp + suffix