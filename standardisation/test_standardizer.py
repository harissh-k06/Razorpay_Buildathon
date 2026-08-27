import unittest
from unittest.mock import MagicMock, patch
from qwen_client import QwenStandardizer

class TestQwenStandardizer(unittest.TestCase):
    """
    Test suite for verifying Qwen3.8-27B OpenAI-compatible client via OrcaRouter.
    """
    
    def setUp(self):
        self.standardizer = QwenStandardizer(
            api_key="orcarouter",
            base_url="https://api.orcarouter.ai/v1",
            model="qwen/qwen3.8-27b-free"
        )

    def test_configuration(self):
        """Verify model, base_url, and client configurations."""
        self.assertEqual(self.standardizer.model, "qwen/qwen3.8-27b-free")
        self.assertEqual(self.standardizer.base_url, "https://api.orcarouter.ai/v1")
        self.assertEqual(self.standardizer.api_key, "orcarouter")

    def test_strip_thinking_tags(self):
        """Verify fallback thinking tag stripping."""
        raw_1 = "<think>\nReasoning text here...\n</think>amazon"
        self.assertEqual(self.standardizer._strip_thinking(raw_1), "amazon")

        raw_2 = "2026-04-15"
        self.assertEqual(self.standardizer._strip_thinking(raw_2), "2026-04-15")

        raw_3 = "<think>Partial reason\nUSD"
        self.assertEqual(self.standardizer._strip_thinking(raw_3), "USD")

    @patch.object(QwenStandardizer, "_call_llm")
    def test_standardize_methods(self, mock_call_llm):
        """Verify that standardization methods invoke _call_llm properly."""
        mock_call_llm.return_value = "amazon"
        result = self.standardizer.standardize_vendor("Amzn Web Srvcs")
        self.assertEqual(result, "amazon")
        mock_call_llm.assert_called()

if __name__ == "__main__":
    unittest.main()
