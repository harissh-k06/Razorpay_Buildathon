"""
Gmail email sending endpoint for PennyWise.
Uses the authenticated user's Google OAuth token to send emails via Gmail API.
"""
import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger("email_api")

email_router = APIRouter(prefix="/api/email", tags=["Email"])


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None


def _build_gmail_service(access_token: str):
    """Build an authenticated Gmail API service."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(token=access_token)
        service = build("gmail", "v1", credentials=creds)
        return service
    except Exception as e:
        logger.error(f"Failed to build Gmail service: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to build Gmail service: {e}")


def _create_mime_message(
    sender: str,
    to: str,
    subject: str,
    body: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
) -> dict:
    """Create a MIME email message encoded for Gmail API."""
    msg = MIMEMultipart("alternative")
    msg["From"]    = sender
    msg["To"]      = to
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = cc
    if bcc:
        msg["Bcc"] = bcc

    # Plain text body
    text_part = MIMEText(body, "plain", "utf-8")
    msg.attach(text_part)

    # HTML body (convert newlines to <br> for nicer rendering)
    html_body = body.replace("\n", "<br>")
    html_part = MIMEText(
        f"<html><body style='font-family:Arial,sans-serif;font-size:14px;line-height:1.6'>{html_body}</body></html>",
        "html",
        "utf-8",
    )
    msg.attach(html_part)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    return {"raw": raw}


@email_router.post("/send")
async def send_email(request: Request, payload: SendEmailRequest):
    """
    Send an email via Gmail API using the authenticated user's OAuth token.
    Reads session from cookie, uses stored access_token, and auto-refreshes if expired.
    """
    from auth import get_session_by_request, refresh_access_token, SESSION_COOKIE

    session = get_session_by_request(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated. Please login first.")

    session_id = request.cookies.get(SESSION_COOKIE, "")
    access_token = session.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="No access token found. Please re-login.")

    sender_email = session.get("email", "me")
    sender_name  = session.get("name", "")
    sender       = f"{sender_name} <{sender_email}>" if sender_name else sender_email

    message = _create_mime_message(
        sender=sender,
        to=payload.to,
        subject=payload.subject,
        body=payload.body,
        cc=payload.cc,
        bcc=payload.bcc,
    )

    try:
        service = _build_gmail_service(access_token)
        sent = service.users().messages().send(userId="me", body=message).execute()
    except Exception as e:
        # If token expired, auto-refresh and retry once
        new_token = refresh_access_token(session_id) if session_id else None
        if new_token:
            try:
                service = _build_gmail_service(new_token)
                sent = service.users().messages().send(userId="me", body=message).execute()
            except Exception as retry_err:
                logger.error(f"Failed to send email after token refresh: {retry_err}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Failed to send email: {str(retry_err)}")
        else:
            logger.error(f"Failed to send email and token could not be refreshed: {e}", exc_info=True)
            raise HTTPException(status_code=401, detail="OAuth token expired. Please log out and log in again.")

    logger.info(f"Email sent by {sender_email} to {payload.to} | id={sent.get('id')}")
    return JSONResponse({
        "success": True,
        "message": f"Email sent successfully to {payload.to}",
        "message_id": sent.get("id"),
        "sender": sender_email,
    })
