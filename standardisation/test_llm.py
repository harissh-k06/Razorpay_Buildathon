import unittest
from unittest.mock import patch
from llm_client import LLMStandardizer

class TestLLMStandardizer(unittest.TestCase):
    def setUp(self):
        self.standardizer = LLMStandardizer(
            api_key="mock-key",
            cache_enabled=True,
            max_batch_tokens=15000,
            max_retries=3,
            base_delay=0.1
        )

    def test_cache_mechanism(self):
        self.standardizer._set_cache("Amazon Web Services", "vendor", "amazon")
        self.assertEqual(self.standardizer._get_cached("amazon web services", "vendor"), "amazon")
        self.assertEqual(self.standardizer._get_cached("AMAZON WEB SERVICES", "vendor"), "amazon")
        self.assertIsNone(self.standardizer._get_cached("Google Cloud", "vendor"))

    def test_strip_thinking_and_extract_json(self):
        raw_1 = "<think>Processing vendors...</think>[\"amazon\", \"google\", \"microsoft\"]"
        extracted_1 = self.standardizer._strip_thinking_and_extract_json(raw_1)
        self.assertEqual(extracted_1, "[\"amazon\", \"google\", \"microsoft\"]")

        raw_2 = "```json\n[\"2026-04-15\", \"2026-04-16\"]\n```"
        extracted_2 = self.standardizer._strip_thinking_and_extract_json(raw_2)
        self.assertEqual(extracted_2, "[\"2026-04-15\", \"2026-04-16\"]")

    def test_safe_parse_json_array_unterminated(self):
        # Unterminated string recovery test
        broken_json = '["stripe usage-based", "amazon web services usage-based", "zoho one-time'
        recovered = self.standardizer._safe_parse_json_array(broken_json, expected_len=3)
        self.assertIsNotNone(recovered)
        self.assertIn("stripe usage-based", recovered)

    @patch.object(LLMStandardizer, "_call_with_retry")
    def test_standardize_vendors_batch(self, mock_call):
        mock_call.return_value = '["amazon", "google"]'
        results = self.standardizer.standardize_vendors_batch(["Amzn", "Google Cloud", "Amzn"])
        self.assertEqual(results, ["amazon", "google", "amazon"])
        self.assertEqual(mock_call.call_count, 1)

if __name__ == "__main__":
    unittest.main()
