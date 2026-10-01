"""
email_service.py — Async SMTP email sender for interview invitations.

Uses Python's built-in smtplib wrapped in asyncio.to_thread so it
doesn't block the FastAPI event loop. No extra dependencies required.
"""
import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import List, Optional, Any
from datetime import datetime, timedelta, timezone
import os

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from models import User, Tenant, Interview, InterviewQuestion, CodingQuestion, EmailLog, Membership
from config import settings
from logging_config import logger as log


def _send_smtp_email_sync(
    to: str,
    cc: List[str],
    bcc: List[str],
    subject: str,
    body: str,
    from_email: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_pass: str,
    from_header: Optional[str] = None,
    html_body: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> None:
    """
    Synchronous SMTP send — runs in a thread executor so it doesn't block asyncio.
    Raises on any failure so the caller can catch and log.
    """
    msg = MIMEMultipart("alternative")
    msg["From"]    = from_header or from_email
    msg["To"]      = to
    msg["Subject"] = subject

    if cc:
        msg["Cc"] = ", ".join(cc)

    if reply_to:
        msg["Reply-To"] = reply_to

    # All recipients for actual delivery (SMTP envelope)
    import re
    to_list = [e.strip() for e in re.split(r"[,;]+", to) if e.strip()]
    all_recipients = to_list + cc + bcc

    # Plain-text body
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # HTML body
    if html_body:
        msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30.0) as server:
        server.ehlo()
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, all_recipients, msg.as_string())

    log.info(f"Email sent to {to} (cc={cc}, bcc={len(bcc)} hidden) subject='{subject}'")


MAPPED_RECRUITERS = {
    "eswarmacherla91@gmail.com": "Nandeeswar",
    "eswarmacherla91": "Nandeeswar",
    "nandeesh": "Nandeeswar",
    "nandeeswar": "Nandeeswar",
    "admin@scaloz.com": "Scaloz Administrator",
    "sso-admin@scaloz.com": "SSO Admin"
}

def is_invalid_placeholder(val: Optional[str]) -> bool:
    if not val:
        return True
    val_lower = val.lower().strip()
    invalid_keywords = [
        "from jd", "from_jd", "unknown", "n/a", "na", "job", "position", "none", "null", "undefined", "title", "role"
    ]
    return val_lower in invalid_keywords or len(val_lower) < 2

def extract_job_title_from_jd(jd_text: Optional[str]) -> Optional[str]:
    if not jd_text:
        return None
    
    import re
    # Try looking for lines starting with Job Title, Position, Role, etc.
    patterns = [
        r"(?:job\s+title|position|role|title)\s*[:\-=]\s*([^\n\r]+)",
        r"([^\n\r]+)\s+(?:jd|job\s+description|specification)",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, jd_text, re.IGNORECASE)
        if match:
            extracted = match.group(1).strip()
            # Clean up trailing punctuation, brackets, etc.
            extracted = re.sub(r"^[-\s:|#*=]+", "", extracted).strip()
            if extracted and len(extracted) < 100 and not is_invalid_placeholder(extracted):
                return extracted
                
    # Fallback to the first non-empty line if it looks like a title
    lines = [line.strip() for line in jd_text.splitlines() if line.strip()]
    if lines:
        job_keywords = ["engineer", "developer", "manager", "analyst", "architect", "lead", "senior", "director", "specialist", "consultant", "designer", "administrator", "scientist", "programmer", "executive", "officer", "coordinator", "tester", "writer", "support"]
        for first_line in lines[:3]: # check first 3 lines
            first_line = re.sub(r"^[-\s:|#*=]+", "", first_line).strip()
            if len(first_line) > 3 and len(first_line) < 80 and not is_invalid_placeholder(first_line):
                line_lower = first_line.lower()
                exclude_words = ["college", "university", "institute", "school", "academy", "department", "foundation", "trust", "society", "association"]
                if any(ew in line_lower for ew in exclude_words):
                    continue
                if any(kw in line_lower for kw in job_keywords):
                    return first_line
            
    return None

def is_invalid_recruiter_name(name: Optional[str]) -> bool:
    if not name:
        return True
    name_lower = name.lower().strip()
    invalid_names = ["admin", "administrator", "system", "noreply", "no-reply", "null", "undefined", "user", "manager", "recruiter"]
    if name_lower in invalid_names:
        return True
    # Check if it looks like an email or database ID or username
    if "@" in name_lower or name_lower.isalnum() and any(c.isdigit() for c in name_lower):
        return True
    return False

def format_clean_name(name_or_email: str) -> str:
    if "@" in name_or_email:
        name_or_email = name_or_email.split("@")[0]
    cleaned = "".join([c for c in name_or_email if c.isalpha() or c.isspace() or c == "_"])
    cleaned = cleaned.replace("_", " ").strip()
    return " ".join([w.capitalize() for w in cleaned.split()])

def resolve_professional_recruiter_name(user_obj: Optional[User]) -> Optional[str]:
    if not user_obj:
        return None
    email_lower = (user_obj.email or "").lower().strip()
    name_lower = (user_obj.full_name or "").lower().strip()
    
    for key, val in MAPPED_RECRUITERS.items():
        if key in (email_lower, name_lower):
            return val
            
    if user_obj.full_name and not is_invalid_recruiter_name(user_obj.full_name):
        return user_obj.full_name
        
    if user_obj.email:
        prefix = user_obj.email.split("@")[0]
        if not is_invalid_recruiter_name(prefix):
            return format_clean_name(prefix)
            
    return None


def is_uuid_str(val: Any) -> bool:
    if not val:
        return False
    try:
        from uuid import UUID
        UUID(str(val).strip())
        return True
    except ValueError:
        return False


def get_clean_company_name(tenant: Any) -> str:
    if not tenant:
        return "Our Company"
    # Check settings first
    company_name = (tenant.settings or {}).get("company_name")
    if company_name and not is_uuid_str(company_name):
        return company_name
    
    if getattr(tenant, "name", None):
        return format_clean_name(tenant.name)
    
    return "Our Company"


async def get_clean_company_name_async(db: Optional[AsyncSession], tenant: Any) -> str:
    if not tenant:
        return "Our Company"
        
    company_name = (tenant.settings or {}).get("company_name")
    if company_name and not is_uuid_str(company_name):
        return company_name
        
    # Try fetching from Scaloz master DB
    if db:
        try:
            from database import fetch_company_name_from_scaloz
            scaloz_name = await fetch_company_name_from_scaloz(tenant.name)
            if scaloz_name:
                settings_dict = dict(tenant.settings or {})
                settings_dict["company_name"] = scaloz_name
                tenant.settings = settings_dict
                db.add(tenant)
                await db.commit()
                return scaloz_name
        except Exception as e:
            log.error(f"Error fetching/syncing company name from Scaloz: {e}")
            
    if getattr(tenant, "name", None):
        return format_clean_name(tenant.name)
        
    return "Our Company"



async def send_interview_email(
    to: str,
    subject: str,
    body: str,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
    db: Optional[AsyncSession] = None,
    user_id: Optional[Any] = None,
    tenant_id: Optional[Any] = None,
    user_name: Optional[str] = None,
    tenant_name: Optional[str] = None,
    interview_id: Optional[Any] = None,
) -> dict:
    """
    Async wrapper — sends a responsive, branded HTML email via configured SMTP,
    falling back to console logging and local HTML preview file if SMTP is unconfigured.

    Returns a dict: { "success": bool, "error": str | None }
    """
    cc  = cc  or []
    bcc = bcc or []

    smtp_host  = settings.SMTP_HOST
    smtp_port  = settings.SMTP_PORT
    smtp_user  = settings.SMTP_USER
    smtp_pass  = settings.SMTP_PASS
    from_email = settings.SMTP_FROM or smtp_user

    # 1. Resolve User, Tenant and Interview dynamically if DB is available
    resolved_user_name = user_name
    resolved_tenant_name = None
    
    interview = None
    tenant = None
    recruiter_user = None
    recruiter_membership = None

    if db:
        if interview_id:
            try:
                from uuid import UUID
                i_uuid = UUID(str(interview_id)) if not isinstance(interview_id, UUID) else interview_id
                res = await db.execute(select(Interview).where(Interview.id == i_uuid))
                interview = res.scalar_one_or_none()
                if interview:
                    if interview.tenant_id:
                        res_t = await db.execute(select(Tenant).where(Tenant.id == interview.tenant_id))
                        tenant = res_t.scalar_one_or_none()
                        if tenant:
                            resolved_tenant_name = await get_clean_company_name_async(db, tenant)
                    
                    if interview.recruiter_id:
                        res_u = await db.execute(select(User).where(User.id == interview.recruiter_id))
                        recruiter_user = res_u.scalar_one_or_none()
                        if recruiter_user:
                            resolved_user_name = recruiter_user.full_name or recruiter_user.email.split("@")[0]
                            
                            # Load membership to fetch recruiter's scaloz_role (job title)
                            if interview.tenant_id:
                                res_m = await db.execute(
                                    select(Membership)
                                    .where(
                                        and_(
                                            Membership.user_id == interview.recruiter_id,
                                            Membership.tenant_id == interview.tenant_id
                                        )
                                    )
                                )
                                recruiter_membership = res_m.scalar_one_or_none()
            except Exception as e:
                log.error(f"Error fetching interview/tenant/recruiter from db: {e}")

        if not resolved_user_name and user_id:
            try:
                from uuid import UUID
                u_uuid = UUID(str(user_id)) if not isinstance(user_id, UUID) else user_id
                res = await db.execute(select(User).where(User.id == u_uuid))
                recruiter_user = res.scalar_one_or_none()
                if recruiter_user:
                    resolved_user_name = recruiter_user.full_name or recruiter_user.email.split("@")[0]
            except Exception as e:
                log.error(f"Error fetching user for email display name: {e}")

        if tenant_id:
            try:
                from uuid import UUID
                t_uuid = UUID(str(tenant_id)) if not isinstance(tenant_id, UUID) else tenant_id
                res = await db.execute(select(Tenant).where(Tenant.id == t_uuid))
                tenant_res = res.scalar_one_or_none()
                if tenant_res:
                    tenant = tenant_res
                    resolved_tenant_name = await get_clean_company_name_async(db, tenant)
            except Exception as e:
                log.error(f"Error fetching tenant for email display name: {e}")

        if not tenant and tenant_name:
            try:
                res = await db.execute(select(Tenant).where(Tenant.name == tenant_name))
                tenant_res = res.scalar_one_or_none()
                if tenant_res:
                    tenant = tenant_res
                    resolved_tenant_name = await get_clean_company_name_async(db, tenant)
            except Exception as e:
                log.error(f"Error fetching tenant by name for email display: {e}")

    # Resolve a clean, professional recruiter display name
    recruiter_display_name = None
    if recruiter_user:
        recruiter_display_name = resolve_professional_recruiter_name(recruiter_user)
        
    if not recruiter_display_name and resolved_user_name:
        if not is_invalid_recruiter_name(resolved_user_name):
            recruiter_display_name = resolved_user_name
        else:
            cleaned_str = format_clean_name(resolved_user_name)
            if not is_invalid_recruiter_name(cleaned_str):
                recruiter_display_name = cleaned_str

    if not resolved_tenant_name or is_uuid_str(resolved_tenant_name):
        if tenant and tenant.name:
            resolved_tenant_name = format_clean_name(tenant.name)
        elif tenant_name:
            resolved_tenant_name = format_clean_name(tenant_name)
        else:
            resolved_tenant_name = "Our Company"
    elif resolved_tenant_name and resolved_tenant_name != "Our Company":
        cleaned = resolved_tenant_name.replace("-", " ").replace("_", " ")
        resolved_tenant_name = " ".join([w.capitalize() for w in cleaned.split()])

    # 2. Build Display Name
    display_name = None
    if recruiter_display_name and resolved_tenant_name:
        display_name = f"{recruiter_display_name} ({resolved_tenant_name})"
    elif resolved_tenant_name:
        display_name = f"{resolved_tenant_name} Recruitment"

    from_header = None
    if display_name:
        try:
            from_header = formataddr((display_name, from_email))
        except Exception as e:
            log.error(f"Error formatting from display address: {e}")

    # 3. Construct Responsive HTML Email Template (Enterprise UI)
    html_body = None
    if interview:
        try:
            candidate_name = interview.candidate_name or "Candidate"
            # Friendly greeting name
            candidate_display_name = candidate_name.split()[0] if candidate_name else "Candidate"
            
            # Resolve correct Job Title from JD or manual role with safe neutral fallbacks
            extracted_title = None
            if getattr(interview, "jd_text", None):
                extracted_title = extract_job_title_from_jd(interview.jd_text)
                
            job_role_clean = interview.job_role
            if not job_role_clean or is_invalid_placeholder(job_role_clean):
                job_role_clean = None
                
            final_job_title = extracted_title or job_role_clean or "Technical Assessment"
                
            company_name = resolved_tenant_name or "Our Company"
            
            # Clean subject line of any placeholder words
            for placeholder in ["From JD", "From_JD", "Unknown", "N/A", "na", "Job", "Position", "unknown"]:
                if placeholder in subject:
                    subject = subject.replace(placeholder, final_job_title)
            
            # Recruiter job title from Membership
            recruiter_role = "Technical Recruiter"
            if recruiter_membership and recruiter_membership.scaloz_role:
                recruiter_role = recruiter_membership.scaloz_role
            
            # Base URL
            base_url = settings.FRONTEND_ORIGIN or settings.AI_INTERVIEW_BASE_URL or "http://localhost:8080"
            
            # Interview Link
            short_code = getattr(interview, "short_code", None)
            if short_code:
                interview_link = f"{base_url}/i/{short_code}"
            else:
                interview_link = f"{base_url}/take-interview?token={interview.invite_token}"
                
            # Timezone selection & Dates conversion - Always use Asia/Kolkata (IST)
            timezone_str = "Asia/Kolkata"
            try:
                from zoneinfo import ZoneInfo
                ist_tz = ZoneInfo("Asia/Kolkata")
            except Exception:
                try:
                    from zoneinfo import ZoneInfo
                    ist_tz = ZoneInfo("Asia/Kolkata")
                except Exception:
                    ist_tz = timezone(timedelta(hours=5, minutes=30))

            created_at_dt = interview.created_at or datetime.now(timezone.utc)
            if created_at_dt.tzinfo is None:
                created_at_dt = created_at_dt.replace(tzinfo=timezone.utc)
            assigned_on_ist = created_at_dt.astimezone(ist_tz)
            assigned_on_date = f"{assigned_on_ist.day} {assigned_on_ist.strftime('%B %Y')}"

            # Format start & end times if explicitly set
            available_from = getattr(interview, "available_from", None)
            available_until = getattr(interview, "available_until", None)
            
            # Dummy variables for backward compatibility/f-string references (if any exist)
            schedule_str = ""
            timezone_display = ""
            expiration_date = ""
            start_display = ""
            end_display = ""
            access_window_html = ""
            access_note_html = ""
            
            if available_from and available_until:
                if available_from.tzinfo is None:
                    available_from = available_from.replace(tzinfo=timezone.utc)
                if available_until.tzinfo is None:
                    available_until = available_until.replace(tzinfo=timezone.utc)
                
                from_local = available_from.astimezone(ist_tz)
                until_local = available_until.astimezone(ist_tz)
                
                from_hour = from_local.strftime("%I:%M %p").lstrip("0")
                until_hour = until_local.strftime("%I:%M %p").lstrip("0")
                
                start_display = f"{from_local.day} {from_local.strftime('%B %Y')}, {from_hour} IST"
                end_display = f"{until_local.day} {until_local.strftime('%B %Y')}, {until_hour} IST"
                
                access_window_html = f"""<!-- Interview Access Window -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">📅</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Interview Access Window (IST):</strong><br/>
                          <span style="font-size: 13.5px; margin-left: 0px; color: #4b5563;">
                            <strong>Start:</strong> {start_display}<br/>
                            <strong>End:</strong> {end_display}
                          </span>
                        </td>
                      </tr>"""
                access_note_html = """<p style="margin: 0; font-size: 13px; color: #4b5563; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      <strong>Note:</strong> Candidates can access and start the interview only within the configured Interview Access Window (IST).
                    </p>"""
            elif available_until:
                if available_until.tzinfo is None:
                    available_until = available_until.replace(tzinfo=timezone.utc)
                until_local = available_until.astimezone(ist_tz)
                until_hour = until_local.strftime("%I:%M %p").lstrip("0")
                end_display = f"{until_local.day} {until_local.strftime('%B %Y')}, {until_hour} IST"
                
                access_window_html = f"""<!-- Interview Access Window -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">📅</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Interview Access Deadline (IST):</strong><br/>
                          <span style="font-size: 13.5px; margin-left: 0px; color: #4b5563;">
                            <strong>Complete by:</strong> {end_display}
                          </span>
                        </td>
                      </tr>"""
                access_note_html = """<p style="margin: 0; font-size: 13px; color: #4b5563; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      <strong>Note:</strong> Please complete and submit your interview before the deadline indicated above.
                    </p>"""
            else:
                # No access window configured: do not output start/end dates or 7-day default window
                start_display = ""
                end_display = ""
                access_window_html = ""
                access_note_html = ""
            
            # Duration
            duration = f"{interview.duration_minutes} minutes" if interview.duration_minutes else "30 minutes"
            
            # Branding & Support Defaults
            support_email = "support@xevyte.com"
            support_phone = None
            primary_color = "#1F6FEB"
            secondary_color = "#06B6D4"
            logo_html = ""
            privacy_url = f"{base_url}/privacy"
            terms_url = f"{base_url}/terms"
            website_url = base_url
            
            if tenant:
                t_settings = tenant.settings or {}
                company_name = await get_clean_company_name_async(db, tenant)
                support_email = t_settings.get("support_email") or support_email
                support_phone = t_settings.get("phone") or t_settings.get("support_phone")
                
                # Colors
                primary_color = t_settings.get("primary_brand_color") or t_settings.get("primary_color") or primary_color
                secondary_color = t_settings.get("secondary_brand_color") or t_settings.get("secondary_color") or secondary_color
                
                # Safe color format
                if primary_color and not str(primary_color).startswith("#") and not str(primary_color).startswith("rgb") and not str(primary_color).startswith("hsl"):
                    primary_color = f"#{primary_color}"
                if secondary_color and not str(secondary_color).startswith("#") and not str(secondary_color).startswith("rgb") and not str(secondary_color).startswith("hsl"):
                    secondary_color = f"#{secondary_color}"
                    
                # Logo
                logo_url = t_settings.get("logo") or t_settings.get("company_logo")
                if logo_url:
                    logo_html = f'<img src="{logo_url}" alt="{company_name} Logo" border="0" style="max-height: 48px; max-width: 200px; margin-bottom: 16px; display: block; border: 0; outline: none; text-decoration: none;" />'
                else:
                    initials = "".join([w[0] for w in company_name.split() if w])[:2].upper() or "AI"
                    logo_html = f"""
                    <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                      <tr>
                        <td align="center" width="44" height="44" bgcolor="#ffffff" style="background-color: #ffffff; border-radius: 8px; width: 44px; height: 44px; font-size: 18px; font-weight: 800; color: {primary_color}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          {initials}
                        </td>
                      </tr>
                    </table>
                    """
                
                # Links
                privacy_url = t_settings.get("privacy_url") or privacy_url
                terms_url = t_settings.get("terms_url") or terms_url
                website_url = t_settings.get("website_url") or website_url

            if not logo_html:
                initials = "".join([w[0] for w in company_name.split() if w])[:2].upper() or "AI"
                logo_html = f"""
                <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                  <tr>
                    <td align="center" width="44" height="44" bgcolor="#ffffff" style="background-color: #ffffff; border-radius: 8px; width: 44px; height: 44px; font-size: 18px; font-weight: 800; color: {primary_color}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      {initials}
                    </td>
                  </tr>
                </table>
                """

            # Query dynamic assessment details (tech, behavioral, coding counts)
            tech_count = 0
            behavioral_count = 0
            coding_count = 0
            
            try:
                # 1. Tech questions count
                tech_query = select(func.count(InterviewQuestion.id)).where(
                    and_(
                        InterviewQuestion.interview_id == interview.id,
                        InterviewQuestion.question_type == "technical",
                        InterviewQuestion.selected == True
                    )
                )
                tech_count = (await db.execute(tech_query)).scalar() or 0

                # 2. Behavioral questions count
                behavioral_query = select(func.count(InterviewQuestion.id)).where(
                    and_(
                        InterviewQuestion.interview_id == interview.id,
                        InterviewQuestion.question_type == "behavioral",
                        InterviewQuestion.selected == True
                    )
                )
                behavioral_count = (await db.execute(behavioral_query)).scalar() or 0

                # 3. Coding questions count
                coding_query = select(func.count(CodingQuestion.id)).where(
                    CodingQuestion.interview_id == interview.id
                )
                coding_count = (await db.execute(coding_query)).scalar() or 0
            except Exception as e:
                log.error(f"Error querying question counts for email template: {e}")
                
            # Formulate interview type
            rounds = []
            if tech_count > 0:
                rounds.append("Technical Evaluation")
            if coding_count > 0:
                rounds.append("Coding Assessment")
            if behavioral_count > 0:
                rounds.append("Behavioral Assessment")
            if not rounds:
                rounds.append("AI Multimodal Assessment")
                
            interview_type = " + ".join(rounds)
            
            # Support phone HTML
            support_phone_html = ""
            if support_phone:
                support_phone_html = f' &bull; <a href="tel:{support_phone}" style="color: {primary_color}; text-decoration: none;">{support_phone}</a>'
                
            # Extract the custom intro message
            custom_msg = body
            for marker in ["Interview Details:", "Interview Link:", "Please ensure that:", "Regards,", "We wish you all the best"]:
                if marker in custom_msg:
                    custom_msg = custom_msg.split(marker)[0]
            custom_msg = custom_msg.strip()
            
            for greeting_prefix in ["Dear " + candidate_name, "Hello " + candidate_name, "Dear Candidate", "Hello Candidate"]:
                if custom_msg.startswith(greeting_prefix):
                    custom_msg = custom_msg[len(greeting_prefix):].strip()
                    if custom_msg.startswith(","):
                        custom_msg = custom_msg[1:].strip()
                        
            if custom_msg:
                custom_msg_html_formatted = custom_msg.replace("\n", "<br />")
                recruiter_message_html = f'<div style="font-size: 14.5px; color: #4b5563; line-height: 1.6; margin-bottom: 24px; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">{custom_msg_html_formatted}</div>'
            else:
                recruiter_message_html = ""
                
            # Build features list HTML (2-column layout)
            feature_items = []
            if tech_count > 0:
                feature_items.append("🤖 AI Technical Evaluation")
            if behavioral_count > 0:
                feature_items.append("🧠 Behavioral Interview")
            if coding_count > 0:
                feature_items.append("💻 Coding Assessment")
            feature_items.extend([
                "🛡️ AI Proctoring",
                "💬 Communication Analysis",
                "📊 Instant Evaluation"
            ])

            features_rows_html = ""
            for i in range(0, len(feature_items), 2):
                features_rows_html += "<tr>"
                features_rows_html += f'<td width="50%" style="font-size: 13.5px; color: #4b5563; padding: 6px 0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">{feature_items[i]}</td>'
                if i+1 < len(feature_items):
                    features_rows_html += f'<td width="50%" style="font-size: 13.5px; color: #4b5563; padding: 6px 0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">{feature_items[i+1]}</td>'
                else:
                    features_rows_html += '<td width="50%" style="font-size: 13.5px; color: #4b5563; padding: 6px 0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;"></td>'
                features_rows_html += "</tr>"
                
            # Assigned By block details
            if recruiter_display_name:
                assigned_by_html = f"""
                <strong style="color: #1f2937;">Assigned By:</strong><br />
                <span style="font-weight: 600; color: #1f2937;">{recruiter_display_name}</span><br />
                <span style="font-size: 12.5px; color: #6b7280;">{company_name}</span>
                """
                footer_signature_html = f"""
                <p style="margin: 0 0 4px 0; font-size: 13px; color: #4b5563; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Best regards,</p>
                <p style="margin: 0 0 4px 0; font-size: 14px; color: #1f2937; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">{recruiter_display_name}</p>
                <p style="margin: 0 0 16px 0; font-size: 13px; color: #4b5563; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">{company_name} Recruitment Team</p>
                """
            else:
                assigned_by_html = f"""
                <strong style="color: #1f2937;">Assigned By:</strong><br />
                <span style="font-weight: 600; color: #1f2937;">{company_name} Recruitment Team</span>
                """
                footer_signature_html = f"""
                <p style="margin: 0 0 4px 0; font-size: 13px; color: #4b5563; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Best regards,</p>
                <p style="margin: 0 0 16px 0; font-size: 14px; color: #1f2937; font-weight: 700; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">{company_name} Recruitment Team</p>
                """

            # Generate the bulletproof, responsive HTML string
            html_body = f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>AI Interview Invitation</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style type="text/css">
    body, table, td, p, a, span, h1, h2, h3, h4, h5, h6, div, li, strong, center {{
      font-family: 'Segoe UI', Arial, sans-serif !important;
    }}
  </style>
  <![endif]-->
  <style type="text/css">
    :root {{
      color-scheme: light;
      supported-color-schemes: light;
    }}
    body {{
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background-color: #f4f6f8;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }}
    table {{
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }}
    img {{
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }}
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f4f6f8" style="background-color: #f4f6f8; padding: 40px 10px;">
    <tr>
      <td align="center">
        <!--[if (gte mso 9)|(IE)]>
        <table width="600" align="center" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
        <![endif]-->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- Branded Header with Bulletproof Fallback -->
          <tr>
            <td bgcolor="{primary_color}" style="background-color: {primary_color}; background-image: linear-gradient(135deg, {primary_color}, {secondary_color}); padding: 32px 40px; text-align: left; color: #ffffff;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    {logo_html}
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff !important; line-height: 1.2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">{company_name}</h1>
                    <div style="margin-top: 4px; font-size: 13px; font-weight: 700; color: #e0e7ff; text-transform: uppercase; letter-spacing: 1px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">AI Interview Platform</div>
                    <table border="0" cellpadding="0" cellspacing="0" style="margin-top: 12px;">
                      <tr>
                        <td bgcolor="{secondary_color}" style="background-color: {secondary_color}; border-radius: 12px; padding: 4px 12px; font-size: 11px; font-weight: 700; color: #ffffff !important; text-transform: uppercase; letter-spacing: 0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          AI Proctored Assessment
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Email Content Body -->
          <tr>
            <td style="padding: 40px;">
              
              <!-- Greeting & Invitation -->
              <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #111827; line-height: 1.4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Hello {candidate_display_name},</p>
              <p style="margin: 0 0 12px 0; font-size: 15px; color: #4b5563; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                You have been invited to participate in an AI-powered interview for the position of <strong>{final_job_title}</strong> at <strong>{company_name}</strong>.
              </p>
              <p style="margin: 0 0 24px 0; font-size: 15px; color: #4b5563; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                Please review the interview details below and start the assessment before the expiration date.
              </p>
              
              <!-- Recruiter message -->
              {recruiter_message_html}

              <!-- Interview Information Card -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f9fafb" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #374151; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Interview Details</h3>
                    
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <!-- Position -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">💼</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Position:</strong> {final_job_title}
                        </td>
                      </tr>
                      <!-- Company -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">🏢</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Company:</strong> {company_name}
                        </td>
                      </tr>
                      <!-- Interview Type -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">⚡</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Assessment Type:</strong> {interview_type}
                        </td>
                      </tr>
                      <!-- Duration -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">⏱️</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Duration:</strong> {duration}
                        </td>
                      </tr>
                      {access_window_html}
                      <!-- Assigned By -->
                      <tr>
                        <td width="30" valign="top" style="padding-bottom: 12px; font-size: 16px;">👤</td>
                        <td valign="top" style="padding-bottom: 12px; font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5;">
                          {assigned_by_html}
                        </td>
                      </tr>
                      <!-- Assigned On -->
                      <tr>
                        <td width="30" valign="top" style="font-size: 16px;">📝</td>
                        <td valign="top" style="font-size: 14px; color: #4b5563; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #1f2937;">Assigned On:</strong> {assigned_on_date}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Preparation Instructions Card -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f8fafc" style="background-color: #f8fafc; border-left: 4px solid {primary_color}; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; border-radius: 4px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      ℹ️ Important Preparation Instructions
                    </h3>
                    <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      <li style="margin-bottom: 8px;">Use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> for the best experience.</li>
                      <li style="margin-bottom: 8px;">Ensure a stable high-speed internet connection.</li>
                      <li style="margin-bottom: 8px;">Webcam and microphone must remain enabled throughout the interview.</li>
                      <li style="margin-bottom: 8px;">Complete the interview in a quiet, well-lit environment.</li>
                      <li style="margin-bottom: 8px;">Do not refresh or close the browser tab once the assessment starts.</li>
                      <li style="margin-bottom: 8px;">Do not switch tabs, exit full screen, or open other applications.</li>
                      <li style="margin-bottom: 8px;"><strong>AI Proctoring</strong> is enabled to monitor browser activity and camera feeds.</li>
                      <li style="margin-bottom: 0;">Have a valid government-issued photo ID ready for identity verification.</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Primary Call-to-Action Button (Bulletproof for Outlook, Mac & Web) -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 8px; margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{interview_link}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="16%" strokecolor="{primary_color}" fillcolor="{primary_color}">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:'Segoe UI', Arial, sans-serif;font-size:16px;font-weight:bold;">
                        Start AI Interview &rarr;
                      </center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto; border-collapse: separate;">
                      <tr>
                        <td align="center" bgcolor="{primary_color}" style="border-radius: 8px; background-color: {primary_color}; background-image: linear-gradient(135deg, {primary_color}, {secondary_color});">
                          <a href="{interview_link}" target="_blank" style="display: inline-block; padding: 16px 36px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 700; color: #ffffff !important; text-decoration: none; border-radius: 8px; -webkit-text-size-adjust: none; mso-hide: all; line-height: 1.2;">
                            Start AI Interview &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <!-- Additional Information Section -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid #e5e7eb; margin-bottom: 28px;">
                <tr>
                  <td style="padding-top: 20px;">
                    <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                      If the button above does not work, copy and paste this URL into your browser:
                    </p>
                    <p style="margin: 0 0 16px 0; font-size: 12.5px; color: {primary_color}; word-break: break-all; font-family: Consolas, Monaco, monospace; line-height: 1.4;">
                      <a href="{interview_link}" style="color: {primary_color}; text-decoration: underline;">{interview_link}</a>
                    </p>
                    {access_note_html}
                  </td>
                </tr>
              </table>

              <!-- AI Features Card -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f9fafb" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">Your Assessment Includes</h4>
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      {features_rows_html}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#fffbeb" style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 16px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td width="30" valign="top" style="font-size: 18px; line-height: 1;">🛡️</td>
                        <td valign="top" style="font-size: 13px; color: #b45309; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          <strong style="color: #92400e;">Security Notice:</strong> This interview is secured using AI Proctoring. Multiple face detection, browser/tab switching, camera interruption, and suspicious activities are automatically monitored.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td bgcolor="#f9fafb" style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 32px 40px; text-align: center; font-size: 12px; color: #6b7280; line-height: 1.6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              {footer_signature_html}
              
              <p style="margin: 16px 0 16px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af;">
                Powered by AI Interview Platform
              </p>
              
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                <tr>
                  <td align="center" style="font-size: 12px; color: #6b7280; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <a href="mailto:{support_email}" style="color: {primary_color}; text-decoration: none;">{support_email}</a>
                    {support_phone_html}
                  </td>
                </tr>
              </table>

              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-size: 12px; color: #9ca3af; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <a href="{privacy_url}" style="color: #6b7280; text-decoration: none; margin: 0 8px;">Privacy Policy</a> &bull; 
                    <a href="{terms_url}" style="color: #6b7280; text-decoration: none; margin: 0 8px;">Terms of Service</a> &bull; 
                    <a href="{website_url}" style="color: #6b7280; text-decoration: none; margin: 0 8px;">Website</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!--[if (gte mso 9)|(IE)]>
            </td>
          </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>"""
        except Exception as e:
            log.error(f"Error rendering HTML email template: {e}")

    # Write preview to file for easy testing / local display
    if html_body:
        try:
            preview_path = os.path.join(os.getcwd(), "email_preview.html")
            with open(preview_path, "w", encoding="utf-8") as f:
                f.write(html_body)
            log.info(f"[Email] Local HTML email preview written to: {preview_path}")
        except Exception as e:
            log.error(f"Failed to write local email preview file: {e}")

    email_log_status = "sent"
    email_log_error = None

    if not smtp_host or not smtp_user or not smtp_pass:
        msg = "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env"
        log.warning(f"⚠️ {msg} - Simulated send completed.")
        
        if db and interview_id and interview:
            try:
                recruiter_email = recruiter_user.email if recruiter_user else None
                log_entry = EmailLog(
                    interview_id=interview.id,
                    to_email=to,
                    cc=",".join(cc) if cc else None,
                    bcc=",".join(bcc) if bcc else None,
                    subject=subject,
                    sent_by=recruiter_email,
                    status="sent",
                    error_message="SMTP Simulated - Written to email_preview.html"
                )
                db.add(log_entry)
                await db.commit()
            except Exception as e:
                log.error(f"Failed to log email in db: {e}")
                
        return {"success": True, "error": None, "simulated": True}

    try:
        await asyncio.to_thread(
            _send_smtp_email_sync,
            to,
            cc,
            bcc,
            subject,
            body,
            from_email,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_pass,
            from_header,
            html_body,
            recruiter_user.email if recruiter_user else None,
        )
        
        # Log successful send to EmailLog
        if db and interview_id and interview:
            try:
                recruiter_email = recruiter_user.email if recruiter_user else None
                log_entry = EmailLog(
                    interview_id=interview.id,
                    to_email=to,
                    cc=",".join(cc) if cc else None,
                    bcc=",".join(bcc) if bcc else None,
                    subject=subject,
                    sent_by=recruiter_email,
                    status="sent",
                    error_message=None
                )
                db.add(log_entry)
                await db.commit()
            except Exception as e:
                log.error(f"Failed to log email in db: {e}")
                
        return {"success": True, "error": None}

    except smtplib.SMTPAuthenticationError as e:
        error_msg = "SMTP authentication failed. Check SMTP_USER and SMTP_PASS."
        log.error(f"SMTP auth error sending to {to}: {e}")
        if db and interview_id and interview:
            try:
                recruiter_email = recruiter_user.email if recruiter_user else None
                log_entry = EmailLog(
                    interview_id=interview.id,
                    to_email=to,
                    cc=",".join(cc) if cc else None,
                    bcc=",".join(bcc) if bcc else None,
                    subject=subject,
                    sent_by=recruiter_email,
                    status="failed",
                    error_message=error_msg
                )
                db.add(log_entry)
                await db.commit()
            except Exception as ex:
                log.error(f"Failed to log failed email in db: {ex}")
        return {"success": False, "error": error_msg}

    except smtplib.SMTPRecipientsRefused as e:
        error_msg = f"Recipient address rejected by mail server: {to}"
        log.error(f"SMTP recipient refused for {to}: {e}")
        if db and interview_id and interview:
            try:
                recruiter_email = recruiter_user.email if recruiter_user else None
                log_entry = EmailLog(
                    interview_id=interview.id,
                    to_email=to,
                    cc=",".join(cc) if cc else None,
                    bcc=",".join(bcc) if bcc else None,
                    subject=subject,
                    sent_by=recruiter_email,
                    status="failed",
                    error_message=error_msg
                )
                db.add(log_entry)
                await db.commit()
            except Exception as ex:
                log.error(f"Failed to log failed email in db: {ex}")
        return {"success": False, "error": error_msg}

    except smtplib.SMTPException as e:
        error_msg = f"SMTP error: {str(e)}"
        log.error(f"SMTP error sending to {to}: {e}")
        if db and interview_id and interview:
            try:
                recruiter_email = recruiter_user.email if recruiter_user else None
                log_entry = EmailLog(
                    interview_id=interview.id,
                    to_email=to,
                    cc=",".join(cc) if cc else None,
                    bcc=",".join(bcc) if bcc else None,
                    subject=subject,
                    sent_by=recruiter_email,
                    status="failed",
                    error_message=error_msg
                )
                db.add(log_entry)
                await db.commit()
            except Exception as ex:
                log.error(f"Failed to log failed email in db: {ex}")
        return {"success": False, "error": error_msg}

    except Exception as e:
        error_msg = f"Unexpected error sending email: {str(e)}"
        log.error(f"Unexpected email error to {to}: {e}")
        if db and interview_id and interview:
            try:
                recruiter_email = recruiter_user.email if recruiter_user else None
                log_entry = EmailLog(
                    interview_id=interview.id,
                    to_email=to,
                    cc=",".join(cc) if cc else None,
                    bcc=",".join(bcc) if bcc else None,
                    subject=subject,
                    sent_by=recruiter_email,
                    status="failed",
                    error_message=error_msg
                )
                db.add(log_entry)
                await db.commit()
            except Exception as ex:
                log.error(f"Failed to log failed email in db: {ex}")
        return {"success": False, "error": error_msg}

