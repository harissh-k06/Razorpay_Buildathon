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

for p in [str(BASE_DIR), str(PROJECT_ROOT), str(PROJECT_ROOT / "mcp_server"), str(PROJECT_ROOT / "standardisation"), str(PROJECT_ROOT / "reconciliation"), str(PROJECT_ROOT / "chat-bot")]:
    if p not in sys.path:
        sys.path.insert(0, p)

# ── Load env for OAuth config ───────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(dotenv_path=PROJECT_ROOT / ".env", override=True)

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
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth & Email Routers ───────────────────────────────────────────────────────
try:
    try:
        from auth import auth_router
    except ImportError:
        from api.auth import auth_router
    app.include_router(auth_router)
    logger.info("Auth router registered")
except Exception as _auth_err:
    logger.warning(f"Auth router not loaded: {_auth_err}")

try:
    try:
        from email_api import email_router
    except ImportError:
        from api.email_api import email_router
    app.include_router(email_router)
    logger.info("Email router registered")
except Exception as _email_err:
    logger.warning(f"Email router not loaded: {_email_err}")

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"
    agentic_mode: Optional[bool] = None
    history: Optional[List[Dict[str, Any]]] = None

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

class ReconcileParamsPayload(BaseModel):
    date_tolerance_days: Optional[int] = None
    amount_tolerance_pct: Optional[float] = None
    strict_vendor_matching: Optional[bool] = None
    weight_amount: Optional[int] = None
    weight_date: Optional[int] = None
    weight_vendor: Optional[int] = None
    rejection_threshold: Optional[float] = None
    allow_split: Optional[bool] = None
    max_invoices_per_settlement: Optional[int] = None
    split_tolerance_pct: Optional[float] = None

class UpdateRowRequest(BaseModel):
    source: str
    rowId: Optional[Any] = None
    rowIndex: Optional[int] = None
    updatedData: Dict[str, Any]

class ResolveExceptionsRequest(BaseModel):
    exception_ids: List[str]
    mode: str = "manual"  # "memo" | "direct" | "manual"
    resolution_note: Optional[str] = None

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
@app.api_route("/", methods=["GET", "HEAD"], tags=["General"])
async def root():
    return {"service": "Reconciliation Platform API v2", "status": "online",
            "timestamp": datetime.utcnow().isoformat() + "Z"}

@app.api_route("/api/health", methods=["GET", "HEAD"], tags=["Health"])
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

@app.post("/api/load-sample", tags=["Upload"])
async def load_sample_files():
    """Load bundled synthetic benchmark CSV files (200 Invoices, Razorpay settlements, Bank deposits) for instant 1-click testing."""
    synth_dir = PROJECT_ROOT / "synthetic data" / "data"
    files_to_copy = {
        "invoice": synth_dir / "invoices.csv",
        "razorpay": synth_dir / "razorpay_settlements.csv",
        "bank": synth_dir / "bank.csv",
    }
    
    result: Dict[str, Any] = {}
    for key, src_path in files_to_copy.items():
        if not src_path.exists():
            raise HTTPException(status_code=404, detail=f"Bundled sample benchmark file not found: {src_path.name}")
        dest = UPLOADS_DIR / f"{key}_{src_path.name}"
        shutil.copy2(src_path, dest)
        df = _parse_csv(dest)
        preview = _df_to_preview(df)
        preview["filename"] = src_path.name
        preview["saved_path"] = str(dest)
        result[key] = preview

    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": "Sample benchmark dataset loaded successfully (200 invoices).",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "files": result,
    })

@app.post("/api/standardize", tags=["Standardize"])
async def standardize_files(req: StandardizeRequest):
    start = time.time()
    raw_dir = PROJECT_ROOT / "standardisation" / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    synth_dir = PROJECT_ROOT / "synthetic data" / "data"
    name_map = {"invoice": "invoices.csv", "razorpay": "razorpay_settlements.csv", "bank": "bank.csv"}

    req_paths = {
        "invoice": req.invoice_path,
        "razorpay": req.razorpay_path,
        "bank": req.bank_path
    }

    # For each required dataset, find and prepare the source file with seamless automatic fallback
    for key, name in name_map.items():
        src_candidate = None
        user_p = Path(req_paths.get(key, "") or "")
        
        # 1. Check user provided path
        if user_p.exists() and user_p.is_file():
            src_candidate = user_p
        # 2. Check standard uploads directory
        elif (UPLOADS_DIR / f"{key}_{name}").exists():
            src_candidate = UPLOADS_DIR / f"{key}_{name}"
        # 3. Check existing raw data directory
        elif (raw_dir / name).exists():
            src_candidate = raw_dir / name
        # 4. Check bundled synthetic benchmark data directory
        elif (synth_dir / name).exists():
            src_candidate = synth_dir / name

        if not src_candidate or not src_candidate.exists():
            raise HTTPException(status_code=400, detail=f"File not found for '{key}'. Please upload files or load sample data.")
        
        # Copy to raw directory for standardizer
        shutil.copy2(src_candidate, raw_dir / name)

    # Run standardizer in-process for high speed, memory preservation, and in-memory LLM cache reuse
    try:
        from standardisation.standardizer import DataStandardizer
        base_curr = (req.base_currency or "INR").upper()
        standardizer = DataStandardizer(base_currency=base_curr)
        standardizer.process_files()
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
        "base_currency": base_curr,
        "message": f"Standardization completed in {duration}s",
        "standardized_files": standardized_files,
    })

@app.post("/api/reconcile", tags=["Reconcile"])
async def reconcile(req: ReconcileRequest):
    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    missing = [fname for key, fname in [("invoice", "invoice_standardized.csv"),
                                        ("razorpay", "razorpay_standardized.csv"),
                                        ("bank", "bank_standardized.csv")] if not (std_dir / fname).exists()]
    if missing:
        # Auto-standardize if files are missing
        try:
            from standardisation.standardizer import DataStandardizer
            standardizer = DataStandardizer(base_currency="INR")
            standardizer.process_files()
        except Exception as auto_std_err:
            raise HTTPException(status_code=400,
                detail=f"Standardized files missing and auto-standardization failed: {auto_std_err}")

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
        import run_reconciliation as _rr
        importlib.reload(_rr)
        results = _rr.run_reconciliation_pipeline(params_dict=params_dict, project_root=PROJECT_ROOT)
        return JSONResponse(status_code=200, content=results)
    except Exception as e:
        logger.exception("Reconciliation failed")
        raise HTTPException(status_code=500, detail=f"Matching failed: {e}")

@app.get("/api/reconcile-params", tags=["Reconcile"])
@app.get("/api/reconcile_params", tags=["Reconcile"])
async def get_reconcile_params_endpoint():
    """Retrieve current matching parameters and tolerance thresholds."""
    try:
        try:
            from server import _load_raw_params, _params_to_frontend_dict
        except ImportError:
            from mcp_server.server import _load_raw_params, _params_to_frontend_dict
        raw = _load_raw_params()
        return JSONResponse(
            content={
                "status": "success",
                "params": _params_to_frontend_dict(raw),
                "raw": raw
            },
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    except Exception as e:
        logger.error(f"Failed to fetch matching params: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})

@app.post("/api/reconcile-params", tags=["Reconcile"])
@app.post("/api/reconcile_params", tags=["Reconcile"])
async def update_reconcile_params_endpoint(payload: ReconcileParamsPayload):
    """Update matching parameters and save to reconciliation/params.json without executing matching."""
    try:
        try:
            from server import configure_matching_parameters
        except ImportError:
            from mcp_server.server import configure_matching_parameters

        res = configure_matching_parameters(
            date_tolerance_days=payload.date_tolerance_days,
            amount_tolerance_pct=payload.amount_tolerance_pct,
            strict_vendor_matching=payload.strict_vendor_matching,
            weight_amount=payload.weight_amount,
            weight_date=payload.weight_date,
            weight_vendor=payload.weight_vendor,
            rejection_threshold=payload.rejection_threshold,
            allow_split=payload.allow_split,
            max_invoices_per_settlement=payload.max_invoices_per_settlement,
            split_tolerance_pct=payload.split_tolerance_pct,
            skip_agentic_check=True,
        )
        return JSONResponse(content=res)
    except Exception as e:
        logger.error(f"Failed to update matching params: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})

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
            import chat_bot
            async for chunk in chat_bot.stream_chat(
                request.message,
                session_id=session_id,
                agentic_mode=request.agentic_mode,
                history=request.history
            ):
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
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
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
@app.get("/api/data-status", tags=["Status"])
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

@app.post("/api/update-row", tags=["Standardize"])
@app.post("/api/update_row", tags=["Standardize"])
async def update_row(req: UpdateRowRequest):
    """Updates a single row in the specified standardized CSV file."""
    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    src_clean = req.source.lower().strip().replace("_standardized", "").replace(".csv", "")

    file_map = {
        "invoice": "invoice_standardized.csv",
        "invoices": "invoice_standardized.csv",
        "razorpay": "razorpay_standardized.csv",
        "settlement": "razorpay_standardized.csv",
        "settlements": "razorpay_standardized.csv",
        "bank": "bank_standardized.csv",
    }

    filename = file_map.get(src_clean, f"{src_clean}_standardized.csv")
    csv_path = std_dir / filename
    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Standardized file for '{req.source}' not found at {csv_path}"
        )

    try:
        df = _parse_csv(csv_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read CSV: {e}")

    target_idx = None

    # 1. Try matching by unique ID column
    if req.rowId is not None and str(req.rowId).strip() != "":
        row_id_str = str(req.rowId).strip()
        possible_id_cols = [
            "invoice_id", "entity_id", "razorpay_id", "settlement_id",
            "ref_no", "bank_ref_no", "utr", "id"
        ]
        for col in possible_id_cols:
            if col in df.columns:
                matches = df.index[df[col].astype(str).str.strip() == row_id_str].tolist()
                if matches:
                    target_idx = matches[0]
                    break

    # 2. Fallback to rowIndex
    if target_idx is None and req.rowIndex is not None:
        if 0 <= req.rowIndex < len(df):
            target_idx = req.rowIndex

    # 3. Fallback: if rowId is numeric and within index bounds
    if target_idx is None and req.rowId is not None:
        try:
            num_idx = int(str(req.rowId))
            if 0 <= num_idx < len(df):
                target_idx = num_idx
        except ValueError:
            pass

    if target_idx is None:
        raise HTTPException(
            status_code=404,
            detail=f"Could not locate row with rowId='{req.rowId}' or rowIndex='{req.rowIndex}' in {filename}"
        )

    # 4. Update the fields
    for k, val in req.updatedData.items():
        if k in df.columns:
            # Parse numbers/floats if column is numeric
            df.at[target_idx, k] = val

    # 5. Save back to CSV
    try:
        df.to_csv(csv_path, index=False, encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save CSV: {e}")

    preview = _df_to_preview(df)
    preview["saved_path"] = str(csv_path)

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": f"Row {target_idx + 1} updated successfully in {filename}.",
            "source": src_clean,
            "preview": preview,
        },
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/standardized-data", tags=["Standardize"])
@app.get("/api/standardized_data", tags=["Standardize"])
async def get_standardized_data(source: Optional[str] = None):
    """Returns previews of current standardized CSV files, optionally filtered by source."""
    std_dir = PROJECT_ROOT / "standardisation" / "data" / "standardized"
    file_keys = {
        "invoice": "invoice_standardized.csv",
        "razorpay": "razorpay_standardized.csv",
        "bank": "bank_standardized.csv"
    }

    if source:
        src_clean = source.lower().strip().replace("_standardized", "").replace(".csv", "")
        if src_clean in ["invoices"]:
            src_clean = "invoice"
        elif src_clean in ["settlement", "settlements"]:
            src_clean = "razorpay"
        if src_clean in file_keys:
            file_keys = {src_clean: file_keys[src_clean]}

    detected_base = "INR"
    standardized_files: Dict[str, Any] = {}
    for key, fname in file_keys.items():
        p = std_dir / fname
        if p.exists():
            df = _parse_csv(p)
            if "base_currency" in df.columns and not df.empty:
                b_val = str(df["base_currency"].iloc[0]).strip().upper()
                if b_val and b_val != "NAN":
                    detected_base = b_val
            preview = _df_to_preview(df)
            preview["saved_path"] = str(p)
            standardized_files[key] = preview
        else:
            standardized_files[key] = None

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "base_currency": detected_base,
            "standardized_files": standardized_files,
        },
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.post("/api/resolve-exceptions", tags=["Reconcile"])
async def resolve_exceptions_endpoint(req: ResolveExceptionsRequest):
    """
    Resolve one or multiple reconciliation exceptions (Missing Cash or Unallocated Cash).
    Supports 3 workflows:
    - 'memo': Drafts dispute/unallocated memo for review (requires confirmation).
    - 'direct': Direct mark with custom resolution note.
    - 'manual': One-click mark with default audit note.
    """
    try:
        try:
            from server import resolve_exceptions_bulk, _get_parsed_exceptions_df
        except ImportError:
            from mcp_server.server import resolve_exceptions_bulk, _get_parsed_exceptions_df

        result = resolve_exceptions_bulk(
            exception_ids=req.exception_ids,
            mode=req.mode,
            resolution_note=req.resolution_note,
            skip_agentic_check=True
        )

        if isinstance(result, dict) and "error" in result:
            return JSONResponse(status_code=400, content={"status": "error", "error": result["error"]})

        # Load updated parsed exceptions from disk to return serialized exception list
        parsed_df = _get_parsed_exceptions_df()
        serialized_exceptions = []
        if not parsed_df.empty:
            for idx, row in parsed_df.iterrows():
                serialized_exceptions.append({
                    "id": str(row.get("source_id") or f"EXC-{1001 + idx}"),
                    "type": str(row.get("type", "")).capitalize(),
                    "source_id": str(row.get("source_id", "")),
                    "vendor": str(row.get("vendor", "")),
                    "amount": float(row.get("amount", 0.0)),
                    "date": str(row.get("date", "")),
                    "reason": str(row.get("reason", "")),
                    "status": str(row.get("status", "Open")),
                    "status_type": str(row.get("status_type", "exception")),
                    "severity": str(row.get("severity", "High")),
                    "resolution_note": str(row.get("resolution_note", "")),
                    "resolved_at": str(row.get("resolved_at", "")),
                })

        unallocated_count = sum(1 for e in serialized_exceptions if e.get("status_type") == "unallocated_cash")
        audit_exception_count = sum(1 for e in serialized_exceptions if e.get("status_type") == "exception")
        resolved_count = sum(1 for e in serialized_exceptions if e.get("status_type") == "resolved")

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "success": True,
                "mode": req.mode,
                "result": result,
                "exceptions": serialized_exceptions,
                "unallocatedCount": unallocated_count,
                "auditExceptionCount": audit_exception_count,
                "resolvedCount": resolved_count,
                "totalCount": len(serialized_exceptions),
                "memo_text": result.get("memo_text") if isinstance(result, dict) else None,
                "requires_confirmation": result.get("requires_confirmation", False) if isinstance(result, dict) else False,
            },
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    except Exception as e:
        logger.exception("Failed to resolve exceptions")
        raise HTTPException(status_code=500, detail=f"Failed to resolve exceptions: {e}")

@app.get("/api/reconciliation-results", tags=["Reconcile"])
@app.get("/api/reconciliation_results", tags=["Reconcile"])
async def get_reconciliation_results():
    """Retrieve current reconciliation triplets and updated exceptions from disk."""
    try:
        from reconciliation.run_reconciliation import get_reconciliation_results_summary
        # Fetches live reconciliation results dynamically synchronized to the current base currency
        data = get_reconciliation_results_summary(project_root=PROJECT_ROOT)
        return JSONResponse(
            content=data,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    except Exception as e:
        logger.error(f"Error fetching reconciliation results: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"status": "error", "error": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
