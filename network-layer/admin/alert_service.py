"""
DIGIGAMI Guardian Alert Service
Handles notifications for blocked content, bypass requests, and system events.
Supports email (SMTP) and webhook notifications.
"""

import asyncio
import aiohttp
import smtplib
import json
import sqlite3
import os
import logging
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any
from enum import Enum
from pathlib import Path

logger = logging.getLogger("digigami-alerts")


class AlertType(str, Enum):
    """Types of alerts that can be sent"""
    BLOCK_EVENT = "block_event"           # Content was blocked
    BYPASS_REQUESTED = "bypass_requested"  # User requested a bypass
    BYPASS_APPROVED = "bypass_approved"    # Bypass was approved
    BYPASS_DENIED = "bypass_denied"        # Bypass was denied
    BYPASS_EXPIRED = "bypass_expired"      # Active bypass expired
    EMERGENCY_FREEZE = "emergency_freeze"  # Emergency freeze activated
    FREEZE_LIFTED = "freeze_lifted"        # Emergency freeze lifted
    DAILY_SUMMARY = "daily_summary"        # Daily activity summary
    HIGH_BLOCK_RATE = "high_block_rate"    # Unusually high block rate detected


class AlertChannel(str, Enum):
    """Notification channels"""
    EMAIL = "email"
    WEBHOOK = "webhook"
    PUSH = "push"  # Future: mobile push notifications


@dataclass
class AlertConfig:
    """Configuration for alert service"""
    # Email settings
    smtp_host: str = os.environ.get("SMTP_HOST", "")
    smtp_port: int = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user: str = os.environ.get("SMTP_USER", "")
    smtp_password: str = os.environ.get("SMTP_PASSWORD", "")
    smtp_from_email: str = os.environ.get("SMTP_FROM_EMAIL", "guardian@digigami.ai")
    smtp_use_tls: bool = os.environ.get("SMTP_USE_TLS", "true").lower() == "true"

    # Default webhook
    default_webhook_url: str = os.environ.get("ALERT_WEBHOOK_URL", "")

    # Rate limiting
    rate_limit_window: int = 300  # 5 minutes
    rate_limit_max_alerts: int = 10  # Max alerts per window per device

    # Alert thresholds
    high_block_rate_threshold: int = 50  # Blocks per hour to trigger high rate alert


@dataclass
class Alert:
    """An alert to be sent"""
    alert_type: AlertType
    device_id: str
    title: str
    message: str
    details: Dict[str, Any]
    priority: str = "normal"  # low, normal, high, urgent
    timestamp: str = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow().isoformat()


class AlertService:
    """Service for managing and sending alerts"""

    def __init__(self, db_path: str, config: AlertConfig = None):
        self.db_path = db_path
        self.config = config or AlertConfig()
        self._rate_limit_cache: Dict[str, List[datetime]] = {}
        self._init_db()

    def _init_db(self):
        """Initialize alert-related database tables"""
        conn = sqlite3.connect(self.db_path)

        # Alert settings per device/profile
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT,
                profile_id TEXT,
                alert_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                config_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(device_id, alert_type, channel)
            )
        """)

        # Email recipients
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_recipients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT,
                profile_id TEXT,
                email TEXT NOT NULL,
                name TEXT,
                is_primary INTEGER DEFAULT 0,
                verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(device_id, email)
            )
        """)

        # Webhook configurations
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_webhooks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                secret TEXT,
                headers_json TEXT,
                enabled INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Alert history
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT,
                alert_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                recipient TEXT,
                title TEXT,
                message TEXT,
                details_json TEXT,
                status TEXT DEFAULT 'sent',
                error_message TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Global alert preferences
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_global_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
        conn.close()

    def _get_db(self):
        """Get database connection"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _check_rate_limit(self, device_id: str) -> bool:
        """Check if we're within rate limits for this device"""
        now = datetime.utcnow()
        window_start = now - timedelta(seconds=self.config.rate_limit_window)

        if device_id not in self._rate_limit_cache:
            self._rate_limit_cache[device_id] = []

        # Clean old entries
        self._rate_limit_cache[device_id] = [
            ts for ts in self._rate_limit_cache[device_id]
            if ts > window_start
        ]

        # Check limit
        if len(self._rate_limit_cache[device_id]) >= self.config.rate_limit_max_alerts:
            return False

        self._rate_limit_cache[device_id].append(now)
        return True

    def _log_alert(self, alert: Alert, channel: str, recipient: str,
                   status: str = "sent", error: str = None):
        """Log alert to history"""
        conn = self._get_db()
        conn.execute("""
            INSERT INTO alert_history
            (device_id, alert_type, channel, recipient, title, message, details_json, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            alert.device_id,
            alert.alert_type.value,
            channel,
            recipient,
            alert.title,
            alert.message,
            json.dumps(alert.details),
            status,
            error
        ))
        conn.commit()
        conn.close()

    async def send_alert(self, alert: Alert) -> Dict[str, Any]:
        """Send an alert through all configured channels"""
        results = {
            "alert_type": alert.alert_type.value,
            "device_id": alert.device_id,
            "channels": []
        }

        # Check rate limit
        if not self._check_rate_limit(alert.device_id):
            logger.warning(f"Rate limit exceeded for device {alert.device_id}")
            results["rate_limited"] = True
            return results

        # Get settings for this device and alert type
        settings = self._get_alert_settings(alert.device_id, alert.alert_type)

        # Send to each enabled channel
        for setting in settings:
            channel = setting["channel"]

            try:
                if channel == AlertChannel.EMAIL.value:
                    result = await self._send_email_alert(alert, setting)
                elif channel == AlertChannel.WEBHOOK.value:
                    result = await self._send_webhook_alert(alert, setting)
                else:
                    result = {"success": False, "error": f"Unknown channel: {channel}"}

                results["channels"].append({
                    "channel": channel,
                    **result
                })
            except Exception as e:
                logger.error(f"Failed to send {channel} alert: {e}")
                results["channels"].append({
                    "channel": channel,
                    "success": False,
                    "error": str(e)
                })

        return results

    def _get_alert_settings(self, device_id: str, alert_type: AlertType) -> List[Dict]:
        """Get enabled alert settings for a device and alert type"""
        conn = self._get_db()

        # Get device-specific settings
        cursor = conn.execute("""
            SELECT * FROM alert_settings
            WHERE (device_id = ? OR device_id IS NULL)
            AND alert_type = ?
            AND enabled = 1
            ORDER BY device_id DESC
        """, (device_id, alert_type.value))

        settings = [dict(row) for row in cursor.fetchall()]
        conn.close()

        # If no specific settings, check for global defaults
        if not settings:
            settings = self._get_default_settings(alert_type)

        return settings

    def _get_default_settings(self, alert_type: AlertType) -> List[Dict]:
        """Get default alert settings based on alert type"""
        defaults = []

        # High priority alerts get email by default
        high_priority_types = [
            AlertType.EMERGENCY_FREEZE,
            AlertType.HIGH_BLOCK_RATE,
            AlertType.BYPASS_REQUESTED
        ]

        if alert_type in high_priority_types:
            if self.config.smtp_host:
                defaults.append({
                    "channel": AlertChannel.EMAIL.value,
                    "config_json": None
                })

        # Webhook for all if configured
        if self.config.default_webhook_url:
            defaults.append({
                "channel": AlertChannel.WEBHOOK.value,
                "config_json": json.dumps({"url": self.config.default_webhook_url})
            })

        return defaults

    async def _send_email_alert(self, alert: Alert, setting: Dict) -> Dict:
        """Send an email alert"""
        if not self.config.smtp_host:
            return {"success": False, "error": "SMTP not configured"}

        # Get recipients
        recipients = self._get_email_recipients(alert.device_id)

        if not recipients:
            return {"success": False, "error": "No email recipients configured"}

        # Build email
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[DIGIGAMI Guardian] {alert.title}"
        msg["From"] = self.config.smtp_from_email
        msg["To"] = ", ".join(recipients)

        # Plain text version
        text_content = f"""
{alert.title}

{alert.message}

Details:
{self._format_details_text(alert.details)}

---
DIGIGAMI Guardian
Timestamp: {alert.timestamp}
Device: {alert.device_id}
        """

        # HTML version
        html_content = self._build_email_html(alert)

        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        try:
            # Send email
            if self.config.smtp_use_tls:
                server = smtplib.SMTP(self.config.smtp_host, self.config.smtp_port)
                server.starttls()
            else:
                server = smtplib.SMTP(self.config.smtp_host, self.config.smtp_port)

            if self.config.smtp_user and self.config.smtp_password:
                server.login(self.config.smtp_user, self.config.smtp_password)

            server.sendmail(self.config.smtp_from_email, recipients, msg.as_string())
            server.quit()

            for recipient in recipients:
                self._log_alert(alert, AlertChannel.EMAIL.value, recipient, "sent")

            return {"success": True, "recipients": recipients}
        except Exception as e:
            error_msg = str(e)
            for recipient in recipients:
                self._log_alert(alert, AlertChannel.EMAIL.value, recipient, "failed", error_msg)
            return {"success": False, "error": error_msg}

    def _get_email_recipients(self, device_id: str) -> List[str]:
        """Get email recipients for a device"""
        conn = self._get_db()
        cursor = conn.execute("""
            SELECT email FROM alert_recipients
            WHERE (device_id = ? OR device_id IS NULL)
            AND verified = 1
            ORDER BY is_primary DESC
        """, (device_id,))

        recipients = [row["email"] for row in cursor.fetchall()]
        conn.close()

        return recipients

    def _build_email_html(self, alert: Alert) -> str:
        """Build HTML email content"""
        priority_colors = {
            "low": "#6b7280",
            "normal": "#3b82f6",
            "high": "#f59e0b",
            "urgent": "#ef4444"
        }

        color = priority_colors.get(alert.priority, "#3b82f6")

        return f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #12121a; border-radius: 12px; overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #5ed5d5, #9b6dd6); padding: 30px; text-align: center;">
                            <span style="font-size: 48px;">🛡️</span>
                            <h1 style="color: #0a0a0f; margin: 10px 0 0; font-size: 24px;">DIGIGAMI Guardian</h1>
                        </td>
                    </tr>

                    <!-- Priority Bar -->
                    <tr>
                        <td style="background-color: {color}; padding: 8px; text-align: center;">
                            <span style="color: white; font-size: 12px; text-transform: uppercase; font-weight: bold;">
                                {alert.priority.upper()} PRIORITY
                            </span>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="color: #5ed5d5; margin: 0 0 15px; font-size: 20px;">{alert.title}</h2>
                            <p style="color: #ffffff; line-height: 1.6; margin: 0 0 20px;">{alert.message}</p>

                            <!-- Details Box -->
                            <table width="100%" style="background-color: #1a1a2f; border-radius: 8px; margin-bottom: 20px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="color: #9b6dd6; margin: 0 0 10px; font-size: 14px;">DETAILS</h3>
                                        {self._format_details_html(alert.details)}
                                    </td>
                                </tr>
                            </table>

                            <!-- Meta Info -->
                            <table width="100%" style="border-top: 1px solid #1a1a2f; padding-top: 15px;">
                                <tr>
                                    <td style="color: #6b7280; font-size: 12px;">
                                        <strong>Device:</strong> {alert.device_id}<br>
                                        <strong>Time:</strong> {alert.timestamp}<br>
                                        <strong>Type:</strong> {alert.alert_type.value}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #0a0a0f; padding: 20px; text-align: center;">
                            <p style="color: #6b7280; font-size: 12px; margin: 0;">
                                This alert was sent by DIGIGAMI Guardian<br>
                                <a href="https://digigami.ai/dashboard" style="color: #5ed5d5;">Manage Alert Settings</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """

    def _format_details_text(self, details: Dict) -> str:
        """Format details as plain text"""
        lines = []
        for key, value in details.items():
            formatted_key = key.replace("_", " ").title()
            lines.append(f"  {formatted_key}: {value}")
        return "\n".join(lines)

    def _format_details_html(self, details: Dict) -> str:
        """Format details as HTML table rows"""
        rows = []
        for key, value in details.items():
            formatted_key = key.replace("_", " ").title()
            rows.append(f"""
                <tr>
                    <td style="color: #9b6dd6; padding: 5px 10px 5px 0; font-size: 13px;">{formatted_key}</td>
                    <td style="color: #ffffff; padding: 5px 0; font-size: 13px;">{value}</td>
                </tr>
            """)
        return f"<table>{''.join(rows)}</table>"

    async def _send_webhook_alert(self, alert: Alert, setting: Dict) -> Dict:
        """Send a webhook alert"""
        # Get webhook config
        config_data = {}
        if setting.get("config_json"):
            config_data = json.loads(setting["config_json"])

        webhook_url = config_data.get("url") or self.config.default_webhook_url

        if not webhook_url:
            return {"success": False, "error": "No webhook URL configured"}

        # Build payload
        payload = {
            "alert_type": alert.alert_type.value,
            "device_id": alert.device_id,
            "title": alert.title,
            "message": alert.message,
            "details": alert.details,
            "priority": alert.priority,
            "timestamp": alert.timestamp,
            "source": "digigami_guardian"
        }

        # Build headers
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "DIGIGAMI-Guardian/1.0"
        }

        if config_data.get("secret"):
            import hashlib
            import hmac
            signature = hmac.new(
                config_data["secret"].encode(),
                json.dumps(payload).encode(),
                hashlib.sha256
            ).hexdigest()
            headers["X-Guardian-Signature"] = signature

        if config_data.get("headers"):
            headers.update(config_data["headers"])

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    webhook_url,
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status < 300:
                        self._log_alert(alert, AlertChannel.WEBHOOK.value, webhook_url, "sent")
                        return {"success": True, "status": response.status}
                    else:
                        error = f"HTTP {response.status}"
                        self._log_alert(alert, AlertChannel.WEBHOOK.value, webhook_url, "failed", error)
                        return {"success": False, "error": error}
        except Exception as e:
            error_msg = str(e)
            self._log_alert(alert, AlertChannel.WEBHOOK.value, webhook_url, "failed", error_msg)
            return {"success": False, "error": error_msg}

    # ============ CONVENIENCE METHODS ============

    async def send_block_alert(self, device_id: str, domain: str, category: str, reason: str):
        """Send alert for blocked content"""
        alert = Alert(
            alert_type=AlertType.BLOCK_EVENT,
            device_id=device_id,
            title=f"Content Blocked: {category.title()}",
            message=f"Access to {domain} was blocked on device {device_id}.",
            details={
                "domain": domain,
                "category": category,
                "reason": reason,
                "action": "blocked"
            },
            priority="normal"
        )
        return await self.send_alert(alert)

    async def send_bypass_request_alert(self, device_id: str, domain: str, reason: str, request_id: int):
        """Send alert for new bypass request"""
        alert = Alert(
            alert_type=AlertType.BYPASS_REQUESTED,
            device_id=device_id,
            title="New Bypass Request",
            message=f"A bypass request has been submitted for {domain}.",
            details={
                "domain": domain,
                "reason": reason,
                "request_id": request_id,
                "action_required": "Review and approve or deny"
            },
            priority="high"
        )
        return await self.send_alert(alert)

    async def send_bypass_decision_alert(self, device_id: str, domain: str,
                                          approved: bool, duration: int = None, notes: str = None):
        """Send alert for bypass request decision"""
        alert_type = AlertType.BYPASS_APPROVED if approved else AlertType.BYPASS_DENIED

        if approved:
            title = "Bypass Request Approved"
            message = f"Temporary access to {domain} has been granted for {duration} minutes."
        else:
            title = "Bypass Request Denied"
            message = f"The request to access {domain} was denied."

        alert = Alert(
            alert_type=alert_type,
            device_id=device_id,
            title=title,
            message=message,
            details={
                "domain": domain,
                "approved": approved,
                "duration_minutes": duration,
                "notes": notes or ""
            },
            priority="normal"
        )
        return await self.send_alert(alert)

    async def send_emergency_freeze_alert(self, device_id: str, reason: str, activated_by: str):
        """Send alert for emergency freeze"""
        alert = Alert(
            alert_type=AlertType.EMERGENCY_FREEZE,
            device_id=device_id,
            title="Emergency Freeze Activated",
            message=f"All internet access has been frozen for device {device_id}.",
            details={
                "reason": reason,
                "activated_by": activated_by,
                "status": "All content blocked"
            },
            priority="urgent"
        )
        return await self.send_alert(alert)

    async def send_freeze_lifted_alert(self, device_id: str, lifted_by: str):
        """Send alert when freeze is lifted"""
        alert = Alert(
            alert_type=AlertType.FREEZE_LIFTED,
            device_id=device_id,
            title="Emergency Freeze Lifted",
            message=f"Normal internet access has been restored for device {device_id}.",
            details={
                "lifted_by": lifted_by,
                "status": "Normal filtering resumed"
            },
            priority="normal"
        )
        return await self.send_alert(alert)

    async def send_high_block_rate_alert(self, device_id: str, block_count: int, period: str):
        """Send alert for unusually high block rate"""
        alert = Alert(
            alert_type=AlertType.HIGH_BLOCK_RATE,
            device_id=device_id,
            title="High Block Rate Detected",
            message=f"Device {device_id} has triggered {block_count} blocks in the past {period}.",
            details={
                "block_count": block_count,
                "period": period,
                "recommendation": "Review device activity"
            },
            priority="high"
        )
        return await self.send_alert(alert)

    # ============ SETTINGS MANAGEMENT ============

    def add_email_recipient(self, device_id: str, email: str, name: str = None, is_primary: bool = False):
        """Add an email recipient for a device"""
        conn = self._get_db()
        conn.execute("""
            INSERT OR REPLACE INTO alert_recipients
            (device_id, email, name, is_primary, verified)
            VALUES (?, ?, ?, ?, 1)
        """, (device_id, email, name, 1 if is_primary else 0))
        conn.commit()
        conn.close()

    def remove_email_recipient(self, device_id: str, email: str):
        """Remove an email recipient"""
        conn = self._get_db()
        conn.execute(
            "DELETE FROM alert_recipients WHERE device_id = ? AND email = ?",
            (device_id, email)
        )
        conn.commit()
        conn.close()

    def get_email_recipients_for_device(self, device_id: str) -> List[Dict]:
        """Get all email recipients for a device"""
        conn = self._get_db()
        cursor = conn.execute("""
            SELECT * FROM alert_recipients
            WHERE device_id = ? OR device_id IS NULL
            ORDER BY is_primary DESC, created_at ASC
        """, (device_id,))
        recipients = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return recipients

    def add_webhook(self, device_id: str, name: str, url: str, secret: str = None) -> int:
        """Add a webhook configuration"""
        conn = self._get_db()
        cursor = conn.execute("""
            INSERT INTO alert_webhooks (device_id, name, url, secret)
            VALUES (?, ?, ?, ?)
        """, (device_id, name, url, secret))
        webhook_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return webhook_id

    def remove_webhook(self, webhook_id: int):
        """Remove a webhook configuration"""
        conn = self._get_db()
        conn.execute("DELETE FROM alert_webhooks WHERE id = ?", (webhook_id,))
        conn.commit()
        conn.close()

    def get_webhooks_for_device(self, device_id: str) -> List[Dict]:
        """Get all webhooks for a device"""
        conn = self._get_db()
        cursor = conn.execute("""
            SELECT id, device_id, name, url, enabled, created_at
            FROM alert_webhooks
            WHERE device_id = ? OR device_id IS NULL
            ORDER BY created_at ASC
        """, (device_id,))
        webhooks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return webhooks

    def update_alert_setting(self, device_id: str, alert_type: AlertType,
                            channel: AlertChannel, enabled: bool, config: Dict = None):
        """Update alert settings for a device"""
        conn = self._get_db()
        conn.execute("""
            INSERT OR REPLACE INTO alert_settings
            (device_id, alert_type, channel, enabled, config_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            device_id,
            alert_type.value,
            channel.value,
            1 if enabled else 0,
            json.dumps(config) if config else None,
            datetime.utcnow().isoformat()
        ))
        conn.commit()
        conn.close()

    def get_alert_settings_for_device(self, device_id: str) -> List[Dict]:
        """Get all alert settings for a device"""
        conn = self._get_db()
        cursor = conn.execute("""
            SELECT * FROM alert_settings
            WHERE device_id = ? OR device_id IS NULL
            ORDER BY alert_type, channel
        """, (device_id,))
        settings = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return settings

    def get_alert_history(self, device_id: str = None, limit: int = 50,
                         alert_type: AlertType = None) -> List[Dict]:
        """Get alert history"""
        conn = self._get_db()

        query = "SELECT * FROM alert_history WHERE 1=1"
        params = []

        if device_id:
            query += " AND device_id = ?"
            params.append(device_id)

        if alert_type:
            query += " AND alert_type = ?"
            params.append(alert_type.value)

        query += " ORDER BY sent_at DESC LIMIT ?"
        params.append(limit)

        cursor = conn.execute(query, params)
        history = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return history


# Global alert service instance (initialized lazily)
_alert_service: Optional[AlertService] = None


def get_alert_service(db_path: str = None) -> AlertService:
    """Get or create the alert service instance"""
    global _alert_service

    if _alert_service is None:
        if db_path is None:
            db_path = os.environ.get("DIGIGAMI_DB_PATH", "/var/lib/digigami/guardian.db")
        _alert_service = AlertService(db_path)

    return _alert_service
