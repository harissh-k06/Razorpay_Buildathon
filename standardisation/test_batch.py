import unittest
from unittest.mock import MagicMock, patch
from gemini_client import GeminiStandardizer

class TestBatchGeminiStandardizer(unittest.TestCase):
    """
    Test suite for batch processing, caching, token estimation, and Gemini integration.
    """

    def setUp(self):
        self.standardizer = GeminiStandardizer(
            gemini_api_key="mock-key",
            cache_enabled=True,
            max_batch_tokens=15000,
            max_retries=3,
            base_delay=0.1
        )

    def test_cache_mechanism(self):
        """Verify cache storage, retrieval, and case-insensitivity."""
        self.standardizer._set_cache("Amazon Web Services", "vendor", "amazon")
        self.assertEqual(self.standardizer._get_cached("amazon web services", "vendor"), "amazon")
        self.assertEqual(self.standardizer._get_cached("AMAZON WEB SERVICES", "vendor"), "amazon")
        self.assertIsNone(self.standardizer._get_cached("Google Cloud", "vendor"))

    def test_token_estimation(self):
        """Verify conservative token estimation calculation."""
        text = "Amazon Web Services Inc."
        tokens = self.standardizer._estimate_tokens(text)
        self.assertGreater(tokens, 0)
        self.assertLess(tokens, 100)

    def test_batch_values_chunking(self):
        """Verify that large inputs are chunked into multiple sub-batches."""
        self.standardizer.max_batch_tokens = 250  # small limit for testing
        dummy_values = [f"Vendor_Name_Item_Number_{i}" for i in range(50)]
        batches = self.standardizer._batch_values(dummy_values, "vendor")
        self.assertGreater(len(batches), 1)
        total_items = sum(len(b) for b in batches)
        self.assertEqual(total_items, 50)

    def test_strip_thinking_and_extract_json(self):
        """Verify that thinking tags are stripped and JSON arrays are correctly extracted."""
        raw_1 = "<think>Processing vendors...</think>[\"amazon\", \"google\", \"microsoft\"]"
        extracted_1 = self.standardizer._strip_thinking_and_extract_json(raw_1)
        self.assertEqual(extracted_1, "[\"amazon\", \"google\", \"microsoft\"]")

        raw_2 = "```json\n[\"2026-04-15\", \"2026-04-16\"]\n```"
        extracted_2 = self.standardizer._strip_thinking_and_extract_json(raw_2)
        self.assertEqual(extracted_2, "[\"2026-04-15\", \"2026-04-16\"]")

    @patch.object(GeminiStandardizer, "_call_with_retry")
    def test_standardize_vendors_batch(self, mock_call):
        """Verify that uncached vendors trigger batch calls while cached vendors hit the cache."""
        mock_call.return_value = '["amazon", "google"]'
        
        # First call: 2 unique vendors
        results = self.standardizer.standardize_vendors_batch(["Amzn", "Google Cloud", "Amzn"])
        self.assertEqual(results, ["amazon", "google", "amazon"])
        self.assertEqual(mock_call.call_count, 1)

        # Second call with identical items: 0 API calls (100% cache hit)
        results_cached = self.standardizer.standardize_vendors_batch(["Amzn", "Google Cloud"])
        self.assertEqual(results_cached, ["amazon", "google"])
        self.assertEqual(mock_call.call_count, 1)

    @patch.object(GeminiStandardizer, "_call_with_retry")
    def test_standardize_descriptions_batch(self, mock_call):
        """Verify description summarization batch call."""
        mock_call.return_value = '["razorpay settlement", "stripe payment usage-based"]'
        raw_desc = [
            "NEFT CR: HDFC UTR1787585427i1k9xw RAZORPAY SETTLEMENT",
            "Stripe Payments - Stripe Payments - Usage-based"
        ]
        results = self.standardizer.standardize_descriptions_batch(raw_desc)
        self.assertEqual(results, ["razorpay settlement", "stripe payment usage-based"])
        self.assertEqual(mock_call.call_count, 1)

if __name__ == "__main__":
    unittest.main()
