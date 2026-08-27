import os
import sys
import shutil
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

import json
import asyncio
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

# ── Path setup so we can import reconciliation / standardisation modules ──────
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

for p in [str(PROJECT_ROOT), str(PROJECT_ROOT / "mcp_server"), str(PROJECT_ROOT / "standardisation"), str(PROJECT_ROOT / "reconciliation"), str(PROJECT_ROOT / "chat-bot")]:
    if p not in sys.path:
        sys.path.insert(0, p)

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)s  %(levelname)s  %(message)s",
)
logger = logging.getLogger("reconciliation-api")

# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="PennyWise – Your Khata Agent API",
    description="3-way transaction reconciliation with LLM standardisation, Hungarian matching, and Agentic Controller.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic request models ────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"
    agentic_mode: Optional[bool] = None

class ClearChatRequest(BaseModel):
    session_id: Optional[str] = "default"

class StandardizeRequest(BaseModel):
    invoice_path: str
    razorpay_path: str
    bank_path: str
    base_currency: str = "INR"

class ReconcileRequest(BaseModel):
    date_tolerance_days: int = 7
    amount_tolerance_pct: float = 5.0
    strict_vendor_matching: bool = False
    weight_amount: float = 70.0
    weight_date: float = 30.0
    weight_vendor: float = 0.0
    rejection_threshold: float = 0.40
    allow_split: bool = True
    max_invoices_per_settlement: int = 5
    split_tolerance_pct: float = 20.0

# ── Helpers ────────────────────────────────────────────────────────────────────
def _safe_val(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float):
        import math
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(v, pd.Timestamp):
        return v.isoformat()
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    return v

def _df_to_preview(df: pd.DataFrame, max_rows: Optional[int] = None) -> Dict[str, Any]:
    columns = [str(c) for c in df.columns]
    target_df = df if max_rows is None else df.head(max_rows)
    records = []
    for _, row in target_df.iterrows():
        records.append({str(k): _safe_val(v) for k, v in row.items()})
    return {"columns": columns, "preview": records, "total_rows": int(len(df))}

def _parse_csv(file_path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(file_path, encoding="utf-8")
    except UnicodeDecodeError:
        return pd.read_csv(file_path, encoding="latin-1")

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/", tags=["General"])
async def root():
    return {"service": "Reconciliation Platform API v2", "status": "online",
            "timestamp": datetime.utcnow().isoformat() + "Z"}

@app.get("/api/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "service": "reconciliation-backend", "version": "2.0.0",
            "timestamp": datetime.utcnow().isoformat() + "Z"}

@app.post("/api/upload", tags=["Upload"])
async def upload_files(
    invoice: UploadFile = File(...),
    razorpay: UploadFile = File(...),
    bank: UploadFile = File(...),
):
    files_map = {"invoice": invoice, "razorpay": razorpay, "bank": bank}
    result: Dict[str, Any] = {}
    for key, upload in files_map.items():
        if not upload.filename or not upload.filename.lower().endswith(".csv"):
            raise HTTPException(status_code=400,
                detail=f"'{key}' must be a .csv file (got: {upload.filename!r})")
        dest = UPLOADS_DIR / f"{key}_{Path(upload.filename).name}"
        try:
            with open(dest, "wb") as buf:
                shutil.copyfileobj(upload.file, buf)
        finally:
            await upload.close()
        df = _parse_csv(dest)
        preview = _df_to_preview(df)
        preview["filename"] = upload.filename
        preview["saved_path"] = str(dest)
        result[key] = preview

    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": "3 files uploaded.",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "files": result,
    })

@app.post("/api/standardize", tags=["Standardize"])
async def standardize_files(req: StandardizeRequest):
    start = time.time()
    paths = {"invoice": Path(req.invoice_path),
             "razorpay": Path(req.razorpay_path),
             "bank": Path(req.bank_path)}
    for key, p in paths.items():
        if not p.exists():
            raise HTTPException(status_code=400, detail=f"File not found for '{key}': {p}")

    # Copy to standardisation/data/raw/
    raw_dir = PROJECT_ROOT / "standardisation" / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    name_map = {"invoice": "invoices.csv", "razorpay": "razorpay_settlements.csv", "bank": "bank.csv"}
    for key, src in paths.items():
        shutil.copy2(src, raw_dir / name_map[key])

    # Run standardizer.py in subprocess using the project venv python (dependency isolation)
    try:
        import subprocess
        venv_py_win = PROJECT_ROOT / "venv" / "Scripts" / "python.exe"
        venv_py_unix = PROJECT_ROOT / "venv" / "bin" / "python"
        py_exec = str(venv_py_win) if venv_py_win.exists() else (
            str(venv_py_unix) if venv_py_unix.exists() else sys.executable
        )

        base_curr = (req.base_currency or "INR").upper()
        std_script = PROJECT_ROOT / "standardisation" / "standardizer.py"

        res = subprocess.run(
            [py_exec, str(std_script), base_curr],
            capture_output=True,
            text=True,
            timeout=180,
            cwd=str(PROJECT_ROOT)
        )
        if res.returncode != 0:
            logger.error(f"Standardization subprocess failed: {res.stderr}")
            raise RuntimeError(res.stderr.strip() or res.stdout.strip() or f"Process exited with code {res.returncode}")

    except Exception as e:
        logger.exception("Standardization failed")
        raise HTTPException(status_code=500, detail=f"Standardization failed: {e}")

    duration = round(time.time() - start, 2)

    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    file_keys = {"invoice": "invoice_standardized.csv",
                 "razorpay": "razorpay_standardized.csv",
                 "bank": "bank_standardized.csv"}
    standardized_files: Dict[str, Any] = {}
    for key, fname in file_keys.items():
        p = std_dir / fname
        if p.exists():
            df = _parse_csv(p)
            preview = _df_to_preview(df)
            preview["saved_path"] = str(p)
            standardized_files[key] = preview
        else:
            standardized_files[key] = None

    return JSONResponse(status_code=200, content={
        "status": "success",
        "duration_seconds": duration,
        "message": f"Standardization completed in {duration}s",
        "standardized_files": standardized_files,
    })

@app.post("/api/reconcile", tags=["Reconcile"])
async def reconcile(req: ReconcileRequest):
    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    for key, fname in [("invoice", "invoice_standardized.csv"),
                        ("razorpay", "razorpay_standardized.csv"),
                        ("bank", "bank_standardized.csv")]:
        if not (std_dir / fname).exists():
            raise HTTPException(status_code=400,
                detail=f"Standardized file missing for '{key}'. Run /api/standardize first.")

    import json as _json, importlib

    # Build config parameters dictionary directly from request
    params_dict = {
        "Transaction Amount Tolerance (%)": req.amount_tolerance_pct,
        "Settlement Date Window (days)": req.date_tolerance_days,
        "Strict Vendor Matching": req.strict_vendor_matching,
        "Importance of Amount Accuracy (%)": req.weight_amount,
        "Importance of Date Accuracy (%)": req.weight_date,
        "Importance of Vendor Match (%)": req.weight_vendor,
        "Match Confidence Cutoff (score)": req.rejection_threshold,
        "Allow Split Settlements": req.allow_split,
        "Maximum Invoices per Settlement": req.max_invoices_per_settlement,
        "Split Amount Tolerance (%)": req.split_tolerance_pct,
    }

    try:
        import config as _cfg; importlib.reload(_cfg)
        config = _cfg.ReconciliationConfig(params_dict=params_dict)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Config error: {e}")

    try:
        import run_reconciliation as _rr; importlib.reload(_rr)
        load_records = _rr.load_records
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reconciliation import error: {e}")

    invoices = load_records(std_dir, "invoice_standardized.csv", "invoice")
    razorpay = load_records(std_dir, "razorpay_standardized.csv", "razorpay")
    bank     = load_records(std_dir, "bank_standardized.csv", "bank")

    map_path = PROJECT_ROOT / "synthetic data" / "data" / "order_invoice_map.csv"
    if not map_path.exists():
        map_path = PROJECT_ROOT / "reconciliation" / "data" / "order_invoice_map.csv"

    try:
        import hungarian_matcher as _hm; importlib.reload(_hm)
        matcher = _hm.HungarianMatcher(config, map_file_path=map_path if map_path.exists() else None)
        raw = matcher.match(invoices, razorpay, bank)
    except Exception as e:
        logger.exception("HungarianMatcher failed")
        raise HTTPException(status_code=500, detail=f"Matching failed: {e}")

    def _ser_triplet(t: dict, idx: int) -> dict:
        rzp = t.get("razorpay") or {}
        bnk = t.get("bank") or {}
        inv_ids = t.get("invoice_ids", [])
        match_type = t.get("match_type") or ("N:1 Group" if len(inv_ids) > 1 else "1:1 Exact")
        return {
            "id": f"TRIPLET-{1001 + idx}",
            "invoice_id": ", ".join(str(i) for i in inv_ids),
            "invoice_ids": [str(i) for i in inv_ids],
            "razorpay_id": str(rzp.get("entity_id", "")),
            "settlement_utr": str(rzp.get("settlement_utr", "")),
            "bank_ref_no": str(bnk.get("ref_no", "")) if bnk else "",
            "amount": float(rzp.get("amount") or 0),
            "vendor": str(rzp.get("vendor", "")),
            "date": str(rzp.get("date", "")) if rzp.get("date") else "",
            "status": "Matched",
            "match_type": match_type,
        }

    def _ser_exception(e: dict, idx: int) -> dict:
        rec = e.get("record") or {}
        exc_type = str(e.get("type", "")).capitalize()
        reason = str(e.get("reason", ""))
        source_id = (str(rec.get("invoice_id", "")) or str(rec.get("entity_id", "")) or str(rec.get("ref_no", "")))
        
        # Determine if Unallocated Cash (Medium Risk / Extra Cash) vs Exception (High Risk / Missing Cash)
        is_unallocated = (
            (exc_type.lower() == "razorpay" and "no matching invoice" in reason.lower()) or
            (exc_type.lower() == "bank" and ("no matching invoice" in reason.lower() or "unallocated" in reason.lower()))
        )
        severity = "Medium" if is_unallocated else "High"
        
        return {
            "id": f"EXC-{1001 + idx}",
            "type": exc_type,
            "source_id": source_id,
            "vendor": str(rec.get("vendor", "")),
            "amount": float(rec.get("amount") or 0),
            "date": str(rec.get("date", "")) if rec.get("date") else "",
            "reason": reason,
            "severity": severity,
        }

    triplets   = [_ser_triplet(t, i) for i, t in enumerate(raw["triplets"])]
    exceptions = [_ser_exception(e, i) for i, e in enumerate(raw["exceptions"])]

    # Strictly Invoice Match Rate: (Matched Invoices / Total Invoices) * 100
    matched_invoice_count = int(raw.get("matched_count", len(invoices)))
    total_invoice_count = len(invoices)
    invoice_match_rate = round((matched_invoice_count / total_invoice_count) * 100, 2) if total_invoice_count > 0 else 0.0

    # Segregate Unallocated Cash (Medium Risk / Extra Cash) vs Audit Exceptions (High Risk / Missing Cash)
    unallocated_count = sum(1 for e in exceptions if e.get("severity") == "Medium")
    audit_exception_count = sum(1 for e in exceptions if e.get("severity") == "High")

    # Record coverage rate: Matched Triplets / (Matched Triplets + Total Exceptions)
    total_triplets = len(triplets)
    total_exceptions = len(exceptions)
    record_coverage_rate = round((total_triplets / (total_triplets + total_exceptions)) * 100, 2) if (total_triplets + total_exceptions) > 0 else 0.0

    total_invoice_amt = sum(float(inv.get("amount") or 0) for inv in invoices)
    unallocated_rzp_amt = sum(float(e.get("amount") or 0) for e in exceptions if e.get("severity") == "Medium" and e.get("type", "").lower() == "razorpay")
    total_settled_amt = sum(float(t["amount"]) for t in triplets) + unallocated_rzp_amt

    return JSONResponse(status_code=200, content={
        "matchRate": invoice_match_rate,
        "invoiceMatchRate": invoice_match_rate,
        "recordCoverageRate": record_coverage_rate,
        "record_coverage_rate": record_coverage_rate,
        "matchedCount": matched_invoice_count,
        "matchedInvoicesCount": matched_invoice_count,
        "unallocatedCount": unallocated_count,
        "auditExceptionCount": audit_exception_count,
        "matchedTripletsCount": total_triplets,
        "exceptionCount": total_exceptions,
        "totalCount": total_invoice_count,
        "triplets": triplets,
        "exceptions": exceptions,
        "totalInvoiceAmount": round(total_invoice_amt, 2),
        "totalSettledAmount": round(total_settled_amt, 2),
        "totalBankCredit": round(total_settled_amt, 2),
        "discrepancyAmount": round(abs(total_invoice_amt - total_settled_amt), 2),
    })

# ── Chat Endpoint ─────────────────────────────────────────────────────────────
@app.post("/api/chat", tags=["Chat"])
async def chat_endpoint(request: ChatRequest):
    """Direct real-time SSE token streaming from chat_bot.py agentic loop."""
    session_id = request.session_id or "default"
    logger.info(f"[/api/chat] Received message for session '{session_id}': '{request.message}' (agentic_mode={request.agentic_mode})")

    # If frontend sent agentic_mode in payload, synchronize backend mode state immediately
    if request.agentic_mode is not None:
        try:
            from server import set_agentic_mode
            set_agentic_mode(request.agentic_mode)
        except Exception:
            try:
                from mcp_server.server import set_agentic_mode
                set_agentic_mode(request.agentic_mode)
            except Exception as set_err:
                logger.warning(f"Failed to sync agentic mode: {set_err}")

    async def event_generator():
        chunk_count = 0
        try:
            from chat_bot import stream_chat
            async for chunk in stream_chat(request.message, session_id=session_id, agentic_mode=request.agentic_mode):
                chunk_count += 1
                yield chunk
            logger.info(f"[/api/chat] Stream finished successfully for session '{session_id}' ({chunk_count} chunks yielded)")
        except Exception as e:
            logger.error(f"[/api/chat] Error for session '{session_id}': {e}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/chat/clear", tags=["Chat"])
async def clear_chat_endpoint(request: ClearChatRequest = ClearChatRequest()):
    """Clears the conversational memory history for a given session."""
    session_id = request.session_id or "default"
    try:
        from chat_bot import clear_session
        clear_session(session_id)
        logger.info(f"[/api/chat/clear] Session '{session_id}' cleared successfully")
        return {"success": True, "message": f"Chat history for session '{session_id}' cleared"}
    except Exception as e:
        logger.error(f"[/api/chat/clear] Error clearing session '{session_id}': {e}")
        return {"success": False, "error": str(e)}

class AgenticModeRequest(BaseModel):
    enabled: bool

@app.get("/api/agentic-mode", tags=["Agentic Mode"])
async def get_agentic_mode_endpoint():
    """Returns whether Agentic Mode (auto-execute write/action tools) is enabled."""
    try:
        from server import get_agentic_mode
        mode = get_agentic_mode()
    except ImportError:
        from mcp_server.server import get_agentic_mode
        mode = get_agentic_mode()
    return {"enabled": mode}

@app.post("/api/agentic-mode", tags=["Agentic Mode"])
async def set_agentic_mode_endpoint(request: AgenticModeRequest):
    """Toggles Agentic Mode (True = Auto-execute green, False = Ask Mode yellow)."""
    try:
        from server import set_agentic_mode
        set_agentic_mode(request.enabled)
    except ImportError:
        from mcp_server.server import set_agentic_mode
        set_agentic_mode(request.enabled)
    logger.info(f"[/api/agentic-mode] Agentic Mode updated to: {request.enabled}")
    return {"enabled": request.enabled}

@app.get("/api/data_status", tags=["Status"])
async def data_status():
    """Returns the latest file modification time of the standardized CSVs."""
    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    latest_mtime = 0.0
    for fname in ["invoice_standardized.csv", "razorpay_standardized.csv", "bank_standardized.csv"]:
        path = std_dir / fname
        if path.exists():
            latest_mtime = max(latest_mtime, os.path.getmtime(path))
    return JSONResponse(
        status_code=200,
        content={"last_modified": latest_mtime},
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/standardized_data", tags=["Standardize"])
async def get_standardized_data():
    """Returns previews of current standardized CSV files."""
    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    file_keys = {
        "invoice": "invoice_standardized.csv",
        "razorpay": "razorpay_standardized.csv",
        "bank": "bank_standardized.csv"
    }
    standardized_files: Dict[str, Any] = {}
    for key, fname in file_keys.items():
        p = std_dir / fname
        if p.exists():
            df = _parse_csv(p)
            preview = _df_to_preview(df)
            preview["saved_path"] = str(p)
            standardized_files[key] = preview
        else:
            standardized_files[key] = None

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "standardized_files": standardized_files,
        },
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
