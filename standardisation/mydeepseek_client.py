import os
import re
import json
import time
import random
import threading
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

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

class DeepSeekStandardizer:
    """
    High-throughput batch standardizer using DeepSeek via OpenAI-compatible API.
    - Smart in-memory caching (thread-safe)
    - Token estimation and item-bounded chunking (30 items/batch to prevent truncation & timeout)
    - Parallel batch execution
    - Exponential backoff with jitter on rate limits / connection errors
    - Pure LLM standardization for:
        - Vendor canonicalization
        - Description summarization
    """

    def __init__(
        self,
        model: str = "deepseek-v4-flash",
        cache_enabled: bool = True,
        max_batch_tokens: int = 150000,
        max_items_per_batch: int = 25,          # 25 items per batch for sub-second parallel completion
        max_retries: int = 5,
        base_delay: float = 1.0,
        api_key: Optional[str] = None,
        base_url: str = "https://api.deepseek.com/v1",
        max_parallel_batches: int = 20          # Max concurrent workers (DeepSeek supports up to 2500 concurrent connections)
    ):
        self.model = model
        self.cache_enabled = cache_enabled
        self.max_batch_tokens = max_batch_tokens
        self.max_items_per_batch = max_items_per_batch
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_parallel_batches = max_parallel_batches

        self.api_key = (
            api_key
            or os.getenv("DEEPSEEK_API_KEY")
        )
        if not self.api_key:
            raise ValueError(
                "DEEPSEEK_API_KEY not found in environment variables. "
                "Please set it in your .env file."
            )

        self.base_url = base_url

        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key
        )
        self.cache: Dict[str, Any] = {}
        self._lock = threading.Lock()

    # ---------- Cache methods ----------
    def _get_cache_key(self, value: Any, task_type: str) -> str:
        val_str = str(value).lower().strip() if value is not None else ""
        return f"{task_type}:{val_str}"

    def _get_cached(self, value: Any, task_type: str) -> Optional[Any]:
        if not self.cache_enabled:
            return None
        with self._lock:
            return self.cache.get(self._get_cache_key(value, task_type))

    def _set_cache(self, value: Any, task_type: str, result: Any):
        if self.cache_enabled and result is not None:
            with self._lock:
                self.cache[self._get_cache_key(value, task_type)] = result

    # ---------- Token estimation and batching ----------
    def _estimate_tokens(self, text: str) -> int:
        if not text:
            return 2
        asian_chars = sum(1 for c in text if ord(c) > 127)
        english_chars = len(text) - asian_chars
        tokens = (english_chars / 3.5) + (asian_chars / 1.5)
        return int(tokens) + 10

    def _batch_values(self, values: List[str], task_type: str) -> List[List[str]]:
        """Split values into token-safe and item-bounded batches."""
        batches: List[List[str]] = []
        current_batch: List[str] = []
        current_tokens = 200

        for val in values:
            val_tokens = self._estimate_tokens(str(val))
            if (current_tokens + val_tokens > self.max_batch_tokens or len(current_batch) >= self.max_items_per_batch) and current_batch:
                batches.append(current_batch)
                current_batch = [val]
                current_tokens = 200 + val_tokens
            else:
                current_batch.append(val)
                current_tokens += val_tokens

        if current_batch:
            batches.append(current_batch)

        return batches

    # ---------- Response parsing helpers ----------
    def _strip_thinking_and_extract_json(self, text: str) -> str:
        if not text:
            return "[]"
        cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"</?think>", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        json_match = re.search(r"\[.*\]", cleaned, flags=re.DOTALL)
        return json_match.group(0) if json_match else cleaned

    def _safe_parse_json_array(self, text: str, expected_len: int) -> Optional[List[str]]:
        if not text:
            return None
        # Attempt direct parse
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(x).strip().lower() for x in parsed]
        except Exception:
            pass

        # Repair heuristics for truncated output
        cleaned = text.strip()
        if cleaned.startswith("["):
            if cleaned.count('"') % 2 != 0:
                repaired = cleaned + '"]'
                try:
                    parsed = json.loads(repaired)
                    if isinstance(parsed, list):
                        return [str(x).strip().lower() for x in parsed]
                except Exception:
                    pass
            if not cleaned.endswith("]"):
                repaired = cleaned + "]"
                try:
                    parsed = json.loads(repaired)
                    if isinstance(parsed, list):
                        return [str(x).strip().lower() for x in parsed]
                except Exception:
                    pass

        # Fallback: regex extract quoted strings
        try:
            matches = re.findall(r'"((?:[^"\\]|\\.)*)"', text)
            if matches and (abs(len(matches) - expected_len) <= 2 or len(matches) >= expected_len):
                return [m.strip().lower() for m in matches[:expected_len]]
        except Exception:
            pass
        return None

    # ---------- API call with retry ----------
    def _call_with_retry(self, prompt: str, max_tokens: int) -> str:
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
                    timeout=60.0,
                )
                content = response.choices[0].message.content or ""
                return self._strip_thinking_and_extract_json(content)
            except Exception as e:
                err_str = str(e).lower()
                if "403" in err_str and "insufficient" in err_str:
                    print(f"[Error] Insufficient credits: {e}")
                    raise
                elif any(x in err_str for x in ["429", "rate", "timeout", "503", "connection", "connect", "abort", "reset"]):
                    jitter = random.uniform(0.8, 1.2)
                    wait_time = min(delay * (2 ** retry_count) * jitter, 30.0)
                    print(f"[Retry] {e}. Waiting {wait_time:.1f}s (retry {retry_count+1}/{self.max_retries})...")
                    time.sleep(wait_time)
                    retry_count += 1
                else:
                    print(f"[API Error] {e}")
                    raise
        raise RuntimeError(f"Max retries ({self.max_retries}) exceeded.")

    # ---------- Batch processing with parallel execution ----------
    def _process_single_batch(self, batch: List[str], task_type: str, instruction_template: str) -> List[tuple]:
        """
        Process a single batch through LLM and return (raw_item, standardized_result) pairs.
        """
        items_json = json.dumps(batch, ensure_ascii=False)
        prompt = instruction_template.format(items_json=items_json)
        max_tokens = min(max(len(batch) * 60, 300), 2000)

        try:
            raw_json = self._call_with_retry(prompt, max_tokens=max_tokens)
            parsed = self._safe_parse_json_array(raw_json, len(batch))
            if parsed is not None and len(parsed) == len(batch):
                return list(zip(batch, parsed))
            elif parsed is not None and len(parsed) > 0:
                results = []
                for i, raw_item in enumerate(batch):
                    res_val = parsed[i] if i < len(parsed) and parsed[i].strip() else raw_item
                    results.append((raw_item, res_val))
                return results
            else:
                return [(raw_item, raw_item) for raw_item in batch]
        except Exception as e:
            print(f"[Warning] Batch {task_type} failed: {e}")
            return [(raw_item, raw_item) for raw_item in batch]

    def _batch_call(self, values: List[str], task_type: str, instruction_template: str) -> List[Any]:
        if not values:
            return []

        # Identify uncached unique values
        uncached_unique: List[str] = []
        for val in values:
            if self._get_cached(val, task_type) is None and val not in uncached_unique:
                uncached_unique.append(val)

        if uncached_unique:
            batches = self._batch_values(uncached_unique, task_type)
            print(f"   [Batch] {len(batches)} batches for {len(uncached_unique)} uncached {task_type}s (max {self.max_items_per_batch}/batch)")

            # Process batches in parallel
            with ThreadPoolExecutor(max_workers=min(len(batches), self.max_parallel_batches)) as executor:
                future_to_batch = {
                    executor.submit(self._process_single_batch, batch, task_type, instruction_template): batch
                    for batch in batches
                }

                for future in as_completed(future_to_batch):
                    batch_results = future.result()
                    for raw_item, res_item in batch_results:
                        self._set_cache(raw_item, task_type, res_item)

        # Assemble final results in original order
        return [
            self._get_cached(val, task_type) if self._get_cached(val, task_type) is not None else val
            for val in values
        ]

    # ---------- Public methods ----------
    def standardize_vendors_batch(self, vendors: List[str]) -> List[str]:
        raw_strings = [str(v) if v is not None else "" for v in vendors]
        return self._batch_call(raw_strings, "vendor", BATCH_VENDOR_INSTRUCTION)

    def standardize_descriptions_batch(self, descriptions: List[str]) -> List[str]:
        raw_strings = [str(d) if d is not None else "" for d in descriptions]
        return self._batch_call(raw_strings, "description", BATCH_DESCRIPTION_INSTRUCTION)