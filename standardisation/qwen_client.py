import os
import re
import json
import time
import random
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from typing import List, Dict, Any, Optional

# Load .env file from root and standardisation folder
root_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=root_env)
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

from prompts import (
    BATCH_SYSTEM_PROMPT,
    BATCH_VENDOR_INSTRUCTION,
    BATCH_DESCRIPTION_INSTRUCTION,
)

class QwenStandardizer:
    """
    High-throughput batch standardizer using Qwen models via Logfare's OpenAI-compatible API.
    FEATURES:
    - Smart in-memory caching
    - Token estimation and safe chunking
    - Exponential backoff with jitter on 429 / rate limits
    - LLM USED ONLY FOR:
        - Vendor name canonicalization (including bank descriptions)
        - Description summarization
    - Everything else (dates, amounts, currencies) is deterministic
    """

    def __init__(
        self,
        model: str = "qwen-3.8-27b",           # Default model on Logfare
        cache_enabled: bool = True,
        max_batch_tokens: int = 15000,
        max_retries: int = 5,
        base_delay: float = 1.0,
        api_key: Optional[str] = None,
        base_url: str = "https://logfare.ai/v1"  # Logfare endpoint
    ):
        self.model = model
        self.cache_enabled = cache_enabled
        self.max_batch_tokens = max_batch_tokens
        self.max_retries = max_retries
        self.base_delay = base_delay
        # Use LOGFARE_API_KEY from environment, or fallback to API_KEY for backward compatibility
        self.api_key = api_key or os.getenv("LOGFARE_API_KEY") or os.getenv("API_KEY")
        self.base_url = base_url

        # Initialize OpenAI client with Logfare settings
        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key
        )
        self.cache: Dict[str, Any] = {}

    def _get_cache_key(self, value: Any, task_type: str) -> str:
        """Generate cache key: 'vendor:amazon web services'"""
        val_str = str(value).lower().strip() if value is not None else ""
        return f"{task_type}:{val_str}"

    def _get_cached(self, value: Any, task_type: str) -> Optional[Any]:
        if not self.cache_enabled:
            return None
        return self.cache.get(self._get_cache_key(value, task_type))

    def _set_cache(self, value: Any, task_type: str, result: Any):
        if self.cache_enabled:
            self.cache[self._get_cache_key(value, task_type)] = result

    def _estimate_tokens(self, text: str) -> int:
        """Conservative token estimate."""
        if not text:
            return 2
        asian_chars = sum(1 for c in text if ord(c) > 127)
        english_chars = len(text) - asian_chars
        tokens = (english_chars / 3.5) + (asian_chars / 1.5)
        return int(tokens) + 10

    def _batch_values(self, values: List[str], task_type: str) -> List[List[str]]:
        """Split values into token-safe batches."""
        batches: List[List[str]] = []
        current_batch: List[str] = []
        current_tokens = 200  # overhead
        max_items_per_batch = 25

        for val in values:
            val_tokens = self._estimate_tokens(str(val))
            if (current_tokens + val_tokens > self.max_batch_tokens or len(current_batch) >= max_items_per_batch) and current_batch:
                batches.append(current_batch)
                current_batch = [val]
                current_tokens = 200 + val_tokens
            else:
                current_batch.append(val)
                current_tokens += val_tokens

        if current_batch:
            batches.append(current_batch)
        return batches

    def _strip_thinking_and_extract_json(self, text: str) -> str:
        """Remove thinking tags, code fences, and extract JSON array."""
        if not text:
            return "[]"
        cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"</?think>", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        json_match = re.search(r"\[.*\]", cleaned, flags=re.DOTALL)
        return json_match.group(0) if json_match else cleaned

    def _safe_parse_json_array(self, text: str, expected_len: int) -> Optional[List[str]]:
        """Parse JSON array safely with repair heuristics for truncated/unterminated strings."""
        if not text:
            return None
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except Exception:
            pass

        cleaned = text.strip()
        if cleaned.startswith("["):
            if cleaned.count('"') % 2 != 0:
                repaired = cleaned + '"]'
                try:
                    parsed = json.loads(repaired)
                    if isinstance(parsed, list):
                        return [str(x) for x in parsed]
                except Exception:
                    pass
            if not cleaned.endswith("]"):
                repaired = cleaned + "]"
                try:
                    parsed = json.loads(repaired)
                    if isinstance(parsed, list):
                        return [str(x) for x in parsed]
                except Exception:
                    pass

        try:
            matches = re.findall(r'"((?:[^"\\]|\\.)*)"', text)
            if matches and (abs(len(matches) - expected_len) <= 2 or len(matches) >= expected_len):
                return matches[:expected_len]
        except Exception:
            pass

        return None

    def _call_with_retry(self, prompt: str, max_tokens: int) -> str:
        """Call API with exponential backoff on rate limits."""
        retry_count = 0
        delay = self.base_delay

        while retry_count < self.max_retries:
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": BATCH_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.1,
                    max_tokens=max_tokens,
                    # Logfare does not support extra_body; remove if not needed
                )
                content = response.choices[0].message.content or ""
                return self._strip_thinking_and_extract_json(content)
            except Exception as e:
                err_str = str(e).lower()
                if "403" in err_str and "insufficient" in err_str:
                    print(f"[Error] Insufficient credits: {e}")
                    raise
                elif any(x in err_str for x in ["429", "rate", "timeout", "503"]):
                    jitter = random.uniform(0.8, 1.2)
                    wait_time = min(delay * (2 ** retry_count) * jitter, 30.0)
                    print(f"[Rate Limit] Waiting {wait_time:.1f}s (retry {retry_count+1}/{self.max_retries})...")
                    time.sleep(wait_time)
                    retry_count += 1
                else:
                    print(f"[API Error] {e}")
                    raise
        raise RuntimeError(f"Max retries ({self.max_retries}) exceeded.")

    def _batch_call(self, values: List[str], task_type: str, instruction_template: str) -> List[Any]:
        """Main batched LLM call with caching."""
        if not values:
            return []

        # 1. Identify uncached unique values
        uncached_unique: List[str] = []
        for val in values:
            if self._get_cached(val, task_type) is None and val not in uncached_unique:
                uncached_unique.append(val)

        # 2. Process uncached items in batches
        if uncached_unique:
            batches = self._batch_values(uncached_unique, task_type)
            for batch_idx, batch in enumerate(batches):
                items_json = json.dumps(batch, ensure_ascii=False)
                prompt = instruction_template.format(items_json=items_json)
                max_tokens = min(max(len(batch) * 80, 500), 4000)

                try:
                    raw_json = self._call_with_retry(prompt, max_tokens=max_tokens)
                    parsed = self._safe_parse_json_array(raw_json, len(batch))
                    if parsed is not None and len(parsed) == len(batch):
                        for raw_item, res_item in zip(batch, parsed):
                            self._set_cache(raw_item, task_type, res_item)
                    elif parsed is not None and len(parsed) > 0:
                        for i, raw_item in enumerate(batch):
                            res_val = parsed[i] if i < len(parsed) else raw_item
                            self._set_cache(raw_item, task_type, res_val)
                    else:
                        # Fallback: use raw value
                        for raw_item in batch:
                            self._set_cache(raw_item, task_type, raw_item)
                except Exception as e:
                    print(f"[Warning] Batch {task_type} failed: {e}")
                    for raw_item in batch:
                        self._set_cache(raw_item, task_type, raw_item)

        # 3. Assemble results in original order
        return [self._get_cached(val, task_type) if self._get_cached(val, task_type) is not None else val for val in values]

    def standardize_vendors_batch(self, vendors: List[str]) -> List[str]:
        """
        Batch standardize vendor names or bank descriptions using LLM.
        NO hardcoded mappings used.
        """
        raw_strings = [str(v) if v is not None else "" for v in vendors]
        return self._batch_call(raw_strings, "vendor", BATCH_VENDOR_INSTRUCTION)

    def standardize_descriptions_batch(self, descriptions: List[str]) -> List[str]:
        """
        Summarize ALL descriptions in ONE batched API call using LLM.
        For bank descriptions: extract core meaning (e.g., 'razorpay settlement')
        For Razorpay descriptions: clean and summarize (e.g., 'stripe payment usage-based')
        """
        raw_strings = [str(d) if d is not None else "" for d in descriptions]
        return self._batch_call(raw_strings, "description", BATCH_DESCRIPTION_INSTRUCTION)