import json
from pathlib import Path

class ReconciliationConfig:
    """Loads accountant‑friendly parameters from params.json or a dictionary."""
    def __init__(self, config_path=None, params_dict=None):
        if params_dict is not None:
            params = params_dict
        else:
            if config_path is None:
                config_path = Path(__file__).resolve().parent / "params.json"
            with open(config_path, "r") as f:
                loaded = json.load(f)
                params = loaded.get("accountant_friendly", loaded)

        # Amount tolerance (as fraction, e.g. 5% → 0.05)
        self.amount_tolerance = float(params.get("Transaction Amount Tolerance (%)", 5.0)) / 100.0
        # Date window (days)
        self.date_window_days = int(params.get("Settlement Date Window (days)", 7))
        # Vendor matching strictness
        self.vendor_must_match = bool(params.get("Strict Vendor Matching", False))
        # Weights for Hungarian (must sum to 1.0)
        self.weight_amount = float(params.get("Importance of Amount Accuracy (%)", 70.0)) / 100.0
        self.weight_date = float(params.get("Importance of Date Accuracy (%)", 30.0)) / 100.0
        self.weight_vendor = float(params.get("Importance of Vendor Match (%)", 0.0)) / 100.0
        # Cutoff score: matches with cost above this are rejected (maximum allowed cost)
        self.rejection_threshold = float(params.get("Match Confidence Cutoff (score)", 0.40))
        # Split handling
        self.allow_split = bool(params.get("Allow Split Settlements", True))
        self.max_invoices_per_settlement = int(params.get("Maximum Invoices per Settlement", 5))
        self.split_tolerance = float(params.get("Split Amount Tolerance (%)", 20.0)) / 100.0

    def __repr__(self):
        return f"ReconciliationConfig({self.__dict__})"