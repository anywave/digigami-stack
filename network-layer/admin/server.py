"""
DIGIGAMI Guardian Admin Dashboard
Web interface for managing consent settings, viewing logs, and approving bypass requests.
Includes NextDNS analytics integration and network health monitoring.
"""

import asyncio
import json
import sqlite3
import os
import aiohttp
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
import hashlib
import secrets
import platform
import psutil

from aiohttp import web
import aiohttp_cors

# Try to import NextDNS client
try:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from nextdns_client import NextDNSClient, NextDNSConfig
    NEXTDNS_AVAILABLE = True
except ImportError:
    NEXTDNS_AVAILABLE = False

# Configuration
@dataclass
class AdminConfig:
    db_path: str = os.environ.get("DIGIGAMI_DB_PATH", "/var/lib/digigami/guardian.db")
    admin_port: int = int(os.environ.get("ADMIN_PORT", "8082"))
    admin_secret: str = os.environ.get("ADMIN_SECRET", "")
    static_path: str = os.path.join(os.path.dirname(__file__), "static")
    session_timeout: int = 3600  # 1 hour

    # NextDNS settings
    nextdns_enabled: bool = os.environ.get("NEXTDNS_ENABLED", "false").lower() == "true"
    nextdns_api_key: str = os.environ.get("NEXTDNS_API_KEY", "")
    nextdns_profile_id: str = os.environ.get("NEXTDNS_PROFILE_ID", "")

config = AdminConfig()

# NextDNS client (initialized lazily)
_nextdns_client: Optional[NextDNSClient] = None

async def get_nextdns_client() -> Optional[NextDNSClient]:
    """Get or create NextDNS client"""
    global _nextdns_client

    if not NEXTDNS_AVAILABLE or not config.nextdns_enabled:
        return None

    if not config.nextdns_api_key or not config.nextdns_profile_id:
        return None

    if _nextdns_client is None:
        nextdns_config = NextDNSConfig(
            api_key=config.nextdns_api_key,
            profile_id=config.nextdns_profile_id
        )
        _nextdns_client = NextDNSClient(nextdns_config)

    return _nextdns_client

# Session management
sessions: Dict[str, dict] = {}

def generate_session_token() -> str:
    return secrets.token_urlsafe(32)

def validate_session(request) -> Optional[dict]:
    """Validate session from cookie or header"""
    token = request.cookies.get("digigami_session") or request.headers.get("X-Session-Token")
    if token and token in sessions:
        session = sessions[token]
        if datetime.utcnow().timestamp() < session["expires"]:
            return session
        else:
            del sessions[token]
    return None

def require_auth(handler):
    """Decorator to require authentication"""
    async def wrapper(request):
        session = validate_session(request)
        if not session:
            return web.json_response({"error": "Unauthorized"}, status=401)
        request["session"] = session
        return await handler(request)
    return wrapper

# Database helpers
def get_db():
    """Get database connection"""
    db_path = config.db_path
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def init_admin_db():
    """Initialize admin-specific tables"""
    conn = get_db()

    # Bypass requests table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bypass_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TIMESTAMP,
            reviewed_by TEXT,
            duration_minutes INTEGER,
            notes TEXT
        )
    """)

    # Admin users table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'viewer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP
        )
    """)

    # Audit log
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user TEXT,
            action TEXT NOT NULL,
            target TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Temporary bypasses
    conn.execute("""
        CREATE TABLE IF NOT EXISTS active_bypasses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            granted_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()

def log_audit(admin_user: str, action: str, target: str = None, details: str = None):
    """Log admin action"""
    conn = get_db()
    conn.execute(
        "INSERT INTO audit_log (admin_user, action, target, details) VALUES (?, ?, ?, ?)",
        (admin_user, action, target, details)
    )
    conn.commit()
    conn.close()

# API Routes

async def api_login(request):
    """Admin login"""
    try:
        data = await request.json()
        username = data.get("username", "").strip()
        password = data.get("password", "")

        # Simple password check (use proper hashing in production)
        if config.admin_secret and password == config.admin_secret:
            token = generate_session_token()
            sessions[token] = {
                "username": username or "admin",
                "role": "admin",
                "expires": datetime.utcnow().timestamp() + config.session_timeout
            }

            log_audit(username, "login", None, "Successful login")

            response = web.json_response({"success": True, "username": username})
            response.set_cookie("digigami_session", token, max_age=config.session_timeout, httponly=True)
            return response

        return web.json_response({"error": "Invalid credentials"}, status=401)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

async def api_logout(request):
    """Admin logout"""
    token = request.cookies.get("digigami_session")
    if token and token in sessions:
        del sessions[token]
    response = web.json_response({"success": True})
    response.del_cookie("digigami_session")
    return response

@require_auth
async def api_dashboard_stats(request):
    """Get dashboard statistics"""
    conn = get_db()

    # Today's stats
    today = datetime.utcnow().date().isoformat()

    stats = {}

    # Total blocks today
    cursor = conn.execute(
        "SELECT COUNT(*) as count FROM block_log WHERE DATE(timestamp) = ?",
        (today,)
    )
    stats["blocks_today"] = cursor.fetchone()["count"]

    # Blocks by category
    cursor = conn.execute("""
        SELECT category, COUNT(*) as count
        FROM block_log
        WHERE DATE(timestamp) = ?
        GROUP BY category
        ORDER BY count DESC
    """, (today,))
    stats["blocks_by_category"] = [dict(row) for row in cursor.fetchall()]

    # Active devices
    cursor = conn.execute(
        "SELECT COUNT(DISTINCT device_id) as count FROM block_log WHERE DATE(timestamp) = ?"
        , (today,)
    )
    stats["active_devices"] = cursor.fetchone()["count"]

    # Pending bypass requests
    cursor = conn.execute(
        "SELECT COUNT(*) as count FROM bypass_requests WHERE status = 'pending'"
    )
    stats["pending_requests"] = cursor.fetchone()["count"]

    # Registered profiles
    cursor = conn.execute("SELECT COUNT(*) as count FROM profiles")
    stats["total_profiles"] = cursor.fetchone()["count"]

    # Recent blocks (last 10)
    cursor = conn.execute("""
        SELECT device_id, domain, category, reason, timestamp
        FROM block_log
        ORDER BY timestamp DESC
        LIMIT 10
    """)
    stats["recent_blocks"] = [dict(row) for row in cursor.fetchall()]

    conn.close()
    return web.json_response(stats)

@require_auth
async def api_devices(request):
    """List all registered devices/profiles"""
    conn = get_db()
    cursor = conn.execute("""
        SELECT device_id, user_did, profile_json, restrictions_json, updated_at
        FROM profiles
        ORDER BY updated_at DESC
    """)

    devices = []
    for row in cursor.fetchall():
        device = {
            "device_id": row["device_id"],
            "user_did": row["user_did"],
            "profile": json.loads(row["profile_json"]) if row["profile_json"] else {},
            "restrictions": json.loads(row["restrictions_json"]) if row["restrictions_json"] else {},
            "updated_at": row["updated_at"]
        }
        devices.append(device)

    conn.close()
    return web.json_response({"devices": devices})

@require_auth
async def api_device_detail(request):
    """Get device details and recent activity"""
    device_id = request.match_info["device_id"]
    conn = get_db()

    # Get profile
    cursor = conn.execute(
        "SELECT * FROM profiles WHERE device_id = ?",
        (device_id,)
    )
    row = cursor.fetchone()

    if not row:
        conn.close()
        return web.json_response({"error": "Device not found"}, status=404)

    device = {
        "device_id": row["device_id"],
        "user_did": row["user_did"],
        "profile": json.loads(row["profile_json"]) if row["profile_json"] else {},
        "restrictions": json.loads(row["restrictions_json"]) if row["restrictions_json"] else {},
        "updated_at": row["updated_at"]
    }

    # Get recent blocks
    cursor = conn.execute("""
        SELECT domain, category, reason, timestamp
        FROM block_log
        WHERE device_id = ?
        ORDER BY timestamp DESC
        LIMIT 50
    """, (device_id,))
    device["recent_blocks"] = [dict(r) for r in cursor.fetchall()]

    # Get active bypasses
    cursor = conn.execute("""
        SELECT domain, expires_at, granted_by
        FROM active_bypasses
        WHERE device_id = ? AND expires_at > datetime('now')
    """, (device_id,))
    device["active_bypasses"] = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return web.json_response(device)

@require_auth
async def api_update_device(request):
    """Update device restrictions"""
    device_id = request.match_info["device_id"]
    session = request["session"]

    try:
        data = await request.json()
        restrictions = data.get("restrictions", {})

        conn = get_db()
        conn.execute("""
            UPDATE profiles
            SET restrictions_json = ?, updated_at = ?
            WHERE device_id = ?
        """, (json.dumps(restrictions), datetime.utcnow().isoformat(), device_id))
        conn.commit()
        conn.close()

        log_audit(session["username"], "update_restrictions", device_id, json.dumps(restrictions))

        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@require_auth
async def api_block_log(request):
    """Get block log with pagination and filters"""
    page = int(request.query.get("page", 1))
    limit = min(int(request.query.get("limit", 50)), 200)
    device_id = request.query.get("device_id")
    category = request.query.get("category")
    date_from = request.query.get("from")
    date_to = request.query.get("to")

    offset = (page - 1) * limit

    conn = get_db()

    # Build query
    where_clauses = []
    params = []

    if device_id:
        where_clauses.append("device_id = ?")
        params.append(device_id)
    if category:
        where_clauses.append("category = ?")
        params.append(category)
    if date_from:
        where_clauses.append("timestamp >= ?")
        params.append(date_from)
    if date_to:
        where_clauses.append("timestamp <= ?")
        params.append(date_to)

    where = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Get total count
    cursor = conn.execute(f"SELECT COUNT(*) as count FROM block_log WHERE {where}", params)
    total = cursor.fetchone()["count"]

    # Get results
    cursor = conn.execute(f"""
        SELECT id, device_id, domain, category, reason, timestamp
        FROM block_log
        WHERE {where}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])

    logs = [dict(row) for row in cursor.fetchall()]

    conn.close()
    return web.json_response({
        "logs": logs,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    })

@require_auth
async def api_bypass_requests(request):
    """Get pending bypass requests"""
    status = request.query.get("status", "pending")

    conn = get_db()
    cursor = conn.execute("""
        SELECT * FROM bypass_requests
        WHERE status = ?
        ORDER BY requested_at DESC
    """, (status,))

    requests_list = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return web.json_response({"requests": requests_list})

@require_auth
async def api_submit_bypass_request(request):
    """Submit a new bypass request (from user)"""
    try:
        data = await request.json()
        device_id = data.get("device_id")
        domain = data.get("domain")
        reason = data.get("reason", "")

        if not device_id or not domain:
            return web.json_response({"error": "Missing required fields"}, status=400)

        conn = get_db()
        cursor = conn.execute("""
            INSERT INTO bypass_requests (device_id, domain, reason)
            VALUES (?, ?, ?)
        """, (device_id, domain, reason))
        request_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return web.json_response({"success": True, "request_id": request_id})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@require_auth
async def api_review_bypass(request):
    """Approve or deny a bypass request"""
    request_id = request.match_info["request_id"]
    session = request["session"]

    try:
        data = await request.json()
        action = data.get("action")  # "approve" or "deny"
        duration = data.get("duration", 60)  # minutes
        notes = data.get("notes", "")

        if action not in ["approve", "deny"]:
            return web.json_response({"error": "Invalid action"}, status=400)

        conn = get_db()

        # Get the request
        cursor = conn.execute("SELECT * FROM bypass_requests WHERE id = ?", (request_id,))
        bypass_req = cursor.fetchone()

        if not bypass_req:
            conn.close()
            return web.json_response({"error": "Request not found"}, status=404)

        # Update request status
        status = "approved" if action == "approve" else "denied"
        conn.execute("""
            UPDATE bypass_requests
            SET status = ?, reviewed_at = ?, reviewed_by = ?, duration_minutes = ?, notes = ?
            WHERE id = ?
        """, (status, datetime.utcnow().isoformat(), session["username"], duration, notes, request_id))

        # If approved, create active bypass
        if action == "approve":
            expires_at = datetime.utcnow() + timedelta(minutes=duration)
            conn.execute("""
                INSERT INTO active_bypasses (device_id, domain, expires_at, granted_by)
                VALUES (?, ?, ?, ?)
            """, (bypass_req["device_id"], bypass_req["domain"], expires_at.isoformat(), session["username"]))

        conn.commit()
        conn.close()

        log_audit(session["username"], f"bypass_{action}", f"request:{request_id}",
                  f"domain={bypass_req['domain']}, duration={duration}min")

        return web.json_response({"success": True, "status": status})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@require_auth
async def api_grant_bypass(request):
    """Directly grant a bypass (without request)"""
    session = request["session"]

    try:
        data = await request.json()
        device_id = data.get("device_id")
        domain = data.get("domain")
        duration = data.get("duration", 60)  # minutes

        if not device_id or not domain:
            return web.json_response({"error": "Missing required fields"}, status=400)

        expires_at = datetime.utcnow() + timedelta(minutes=duration)

        conn = get_db()
        conn.execute("""
            INSERT INTO active_bypasses (device_id, domain, expires_at, granted_by)
            VALUES (?, ?, ?, ?)
        """, (device_id, domain, expires_at.isoformat(), session["username"]))
        conn.commit()
        conn.close()

        log_audit(session["username"], "grant_bypass", device_id, f"domain={domain}, duration={duration}min")

        return web.json_response({"success": True, "expires_at": expires_at.isoformat()})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@require_auth
async def api_revoke_bypass(request):
    """Revoke an active bypass"""
    bypass_id = request.match_info["bypass_id"]
    session = request["session"]

    conn = get_db()
    conn.execute("DELETE FROM active_bypasses WHERE id = ?", (bypass_id,))
    conn.commit()
    conn.close()

    log_audit(session["username"], "revoke_bypass", f"bypass:{bypass_id}")

    return web.json_response({"success": True})

@require_auth
async def api_active_bypasses(request):
    """Get all active bypasses"""
    conn = get_db()
    cursor = conn.execute("""
        SELECT * FROM active_bypasses
        WHERE expires_at > datetime('now')
        ORDER BY expires_at ASC
    """)

    bypasses = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return web.json_response({"bypasses": bypasses})

@require_auth
async def api_audit_log(request):
    """Get audit log"""
    page = int(request.query.get("page", 1))
    limit = min(int(request.query.get("limit", 50)), 200)
    offset = (page - 1) * limit

    conn = get_db()

    cursor = conn.execute("SELECT COUNT(*) as count FROM audit_log")
    total = cursor.fetchone()["count"]

    cursor = conn.execute("""
        SELECT * FROM audit_log
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    """, (limit, offset))

    logs = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return web.json_response({
        "logs": logs,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    })

@require_auth
async def api_emergency_freeze(request):
    """Activate emergency freeze for a device"""
    device_id = request.match_info["device_id"]
    session = request["session"]

    try:
        data = await request.json()
        reason = data.get("reason", "Guardian emergency freeze")

        conn = get_db()

        # Get current restrictions
        cursor = conn.execute(
            "SELECT restrictions_json FROM profiles WHERE device_id = ?",
            (device_id,)
        )
        row = cursor.fetchone()

        if not row:
            conn.close()
            return web.json_response({"error": "Device not found"}, status=404)

        restrictions = json.loads(row["restrictions_json"]) if row["restrictions_json"] else {}
        restrictions["emergency_freeze"] = True
        restrictions["freeze_reason"] = reason
        restrictions["freeze_activated"] = datetime.utcnow().isoformat()

        conn.execute("""
            UPDATE profiles
            SET restrictions_json = ?, updated_at = ?
            WHERE device_id = ?
        """, (json.dumps(restrictions), datetime.utcnow().isoformat(), device_id))
        conn.commit()
        conn.close()

        log_audit(session["username"], "emergency_freeze", device_id, reason)

        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@require_auth
async def api_lift_freeze(request):
    """Lift emergency freeze for a device"""
    device_id = request.match_info["device_id"]
    session = request["session"]

    conn = get_db()

    cursor = conn.execute(
        "SELECT restrictions_json FROM profiles WHERE device_id = ?",
        (device_id,)
    )
    row = cursor.fetchone()

    if not row:
        conn.close()
        return web.json_response({"error": "Device not found"}, status=404)

    restrictions = json.loads(row["restrictions_json"]) if row["restrictions_json"] else {}
    restrictions.pop("emergency_freeze", None)
    restrictions.pop("freeze_reason", None)
    restrictions.pop("freeze_activated", None)

    conn.execute("""
        UPDATE profiles
        SET restrictions_json = ?, updated_at = ?
        WHERE device_id = ?
    """, (json.dumps(restrictions), datetime.utcnow().isoformat(), device_id))
    conn.commit()
    conn.close()

    log_audit(session["username"], "lift_freeze", device_id)

    return web.json_response({"success": True})

@require_auth
async def api_categories(request):
    """Get category statistics"""
    conn = get_db()

    cursor = conn.execute("""
        SELECT category, COUNT(*) as total_blocks,
               COUNT(DISTINCT device_id) as unique_devices,
               MAX(timestamp) as last_block
        FROM block_log
        GROUP BY category
        ORDER BY total_blocks DESC
    """)

    categories = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return web.json_response({"categories": categories})


# ============ NEXTDNS ANALYTICS API ============

@require_auth
async def api_nextdns_status(request):
    """Get NextDNS integration status and profile info"""
    status = {
        "available": NEXTDNS_AVAILABLE,
        "enabled": config.nextdns_enabled,
        "configured": bool(config.nextdns_api_key and config.nextdns_profile_id),
        "profile_id": config.nextdns_profile_id if config.nextdns_enabled else None,
        "profile": None
    }

    if status["configured"]:
        try:
            client = await get_nextdns_client()
            if client:
                profile = await client.get_profile()
                if profile:
                    status["profile"] = {
                        "id": profile.get("id"),
                        "name": profile.get("name"),
                        "fingerprint": profile.get("fingerprint")
                    }
                    status["connected"] = True
                else:
                    status["connected"] = False
        except Exception as e:
            status["error"] = str(e)
            status["connected"] = False

    return web.json_response(status)


@require_auth
async def api_nextdns_analytics(request):
    """Get NextDNS analytics data"""
    period = request.query.get("period", "24h")

    if not config.nextdns_enabled:
        return web.json_response({"error": "NextDNS not enabled"}, status=400)

    try:
        client = await get_nextdns_client()
        if not client:
            return web.json_response({"error": "NextDNS client not available"}, status=500)

        analytics = await client.get_analytics(period)

        return web.json_response({
            "period": period,
            "queries_total": analytics.queries_total,
            "queries_blocked": analytics.queries_blocked,
            "queries_allowed": analytics.queries_allowed,
            "block_rate": round(
                (analytics.queries_blocked / analytics.queries_total * 100)
                if analytics.queries_total > 0 else 0, 1
            ),
            "top_blocked_domains": analytics.top_blocked_domains[:10],
            "top_allowed_domains": analytics.top_allowed_domains[:10],
            "device_breakdown": analytics.device_breakdown
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def api_nextdns_blocklists(request):
    """Get NextDNS blocklists status"""
    if not config.nextdns_enabled:
        return web.json_response({"error": "NextDNS not enabled"}, status=400)

    try:
        client = await get_nextdns_client()
        if not client:
            return web.json_response({"error": "NextDNS client not available"}, status=500)

        blocklists = await client.get_available_blocklists()

        return web.json_response({
            "blocklists": [
                {
                    "id": bl.id,
                    "name": bl.name,
                    "description": bl.description,
                    "entries": bl.entries,
                    "enabled": bl.enabled
                }
                for bl in blocklists
            ]
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def api_nextdns_parental(request):
    """Get NextDNS parental control settings"""
    if not config.nextdns_enabled:
        return web.json_response({"error": "NextDNS not enabled"}, status=400)

    try:
        client = await get_nextdns_client()
        if not client:
            return web.json_response({"error": "NextDNS client not available"}, status=500)

        settings = await client.get_parental_settings()
        return web.json_response(settings)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def api_nextdns_security(request):
    """Get NextDNS security settings"""
    if not config.nextdns_enabled:
        return web.json_response({"error": "NextDNS not enabled"}, status=400)

    try:
        client = await get_nextdns_client()
        if not client:
            return web.json_response({"error": "NextDNS client not available"}, status=500)

        settings = await client.get_security_settings()
        return web.json_response(settings)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def api_nextdns_add_denylist(request):
    """Add domain to NextDNS denylist"""
    if not config.nextdns_enabled:
        return web.json_response({"error": "NextDNS not enabled"}, status=400)

    try:
        data = await request.json()
        domain = data.get("domain", "").strip().lower()

        if not domain:
            return web.json_response({"error": "Domain required"}, status=400)

        client = await get_nextdns_client()
        if not client:
            return web.json_response({"error": "NextDNS client not available"}, status=500)

        success = await client.add_to_denylist(domain)

        if success:
            session = request["session"]
            log_audit(session["username"], "nextdns_denylist_add", domain)
            return web.json_response({"success": True, "domain": domain})
        else:
            return web.json_response({"error": "Failed to add domain"}, status=500)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def api_nextdns_remove_denylist(request):
    """Remove domain from NextDNS denylist"""
    domain = request.match_info["domain"]

    if not config.nextdns_enabled:
        return web.json_response({"error": "NextDNS not enabled"}, status=400)

    try:
        client = await get_nextdns_client()
        if not client:
            return web.json_response({"error": "NextDNS client not available"}, status=500)

        success = await client.remove_from_denylist(domain)

        if success:
            session = request["session"]
            log_audit(session["username"], "nextdns_denylist_remove", domain)
            return web.json_response({"success": True})
        else:
            return web.json_response({"error": "Failed to remove domain"}, status=500)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ============ NETWORK STATUS API ============

@require_auth
async def api_network_status(request):
    """Get network and system health status"""
    status = {
        "timestamp": datetime.utcnow().isoformat(),
        "system": {
            "platform": platform.system(),
            "hostname": platform.node(),
            "python_version": platform.python_version()
        },
        "guardian": {
            "db_path": config.db_path,
            "db_exists": Path(config.db_path).exists()
        },
        "nextdns": {
            "available": NEXTDNS_AVAILABLE,
            "enabled": config.nextdns_enabled,
            "connected": False
        }
    }

    # Get system resources if psutil available
    try:
        status["system"]["cpu_percent"] = psutil.cpu_percent(interval=0.1)
        status["system"]["memory_percent"] = psutil.virtual_memory().percent
        status["system"]["disk_percent"] = psutil.disk_usage("/").percent
    except Exception:
        pass

    # Check NextDNS connection
    if config.nextdns_enabled:
        try:
            client = await get_nextdns_client()
            if client:
                profile = await client.get_profile()
                status["nextdns"]["connected"] = profile is not None
                if profile:
                    status["nextdns"]["profile_name"] = profile.get("name")
        except Exception as e:
            status["nextdns"]["error"] = str(e)

    # Get database stats
    try:
        conn = get_db()

        # Total blocks
        cursor = conn.execute("SELECT COUNT(*) as count FROM block_log")
        status["guardian"]["total_blocks"] = cursor.fetchone()["count"]

        # Total profiles
        cursor = conn.execute("SELECT COUNT(*) as count FROM profiles")
        status["guardian"]["total_profiles"] = cursor.fetchone()["count"]

        # Active bypasses
        cursor = conn.execute(
            "SELECT COUNT(*) as count FROM active_bypasses WHERE expires_at > datetime('now')"
        )
        status["guardian"]["active_bypasses"] = cursor.fetchone()["count"]

        conn.close()
    except Exception as e:
        status["guardian"]["db_error"] = str(e)

    return web.json_response(status)


@require_auth
async def api_timeline(request):
    """Get block activity timeline (hourly breakdown)"""
    hours = int(request.query.get("hours", 24))
    hours = min(hours, 168)  # Max 7 days

    conn = get_db()

    # Get hourly block counts
    cursor = conn.execute("""
        SELECT
            strftime('%Y-%m-%d %H:00', timestamp) as hour,
            COUNT(*) as count,
            COUNT(DISTINCT device_id) as devices
        FROM block_log
        WHERE timestamp >= datetime('now', ? || ' hours')
        GROUP BY hour
        ORDER BY hour ASC
    """, (f"-{hours}",))

    timeline = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return web.json_response({"timeline": timeline, "hours": hours})


@require_auth
async def api_top_blocked(request):
    """Get top blocked domains"""
    limit = min(int(request.query.get("limit", 20)), 100)
    period = request.query.get("period", "24h")

    # Parse period
    if period == "1h":
        time_filter = "-1 hours"
    elif period == "7d":
        time_filter = "-7 days"
    elif period == "30d":
        time_filter = "-30 days"
    else:
        time_filter = "-24 hours"

    conn = get_db()

    cursor = conn.execute("""
        SELECT
            domain,
            category,
            COUNT(*) as count,
            COUNT(DISTINCT device_id) as devices,
            MAX(timestamp) as last_blocked
        FROM block_log
        WHERE timestamp >= datetime('now', ?)
        GROUP BY domain
        ORDER BY count DESC
        LIMIT ?
    """, (time_filter, limit))

    domains = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return web.json_response({"domains": domains, "period": period})


# Serve static files
async def serve_index(request):
    """Serve the main dashboard page"""
    return web.FileResponse(os.path.join(config.static_path, "index.html"))

# Application setup
def create_app():
    app = web.Application()

    # CORS setup
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*"
        )
    })

    # API routes
    api_routes = [
        ("POST", "/api/login", api_login),
        ("POST", "/api/logout", api_logout),
        ("GET", "/api/dashboard", api_dashboard_stats),
        ("GET", "/api/devices", api_devices),
        ("GET", "/api/devices/{device_id}", api_device_detail),
        ("PUT", "/api/devices/{device_id}", api_update_device),
        ("GET", "/api/logs", api_block_log),
        ("GET", "/api/bypass-requests", api_bypass_requests),
        ("POST", "/api/bypass-requests", api_submit_bypass_request),
        ("POST", "/api/bypass-requests/{request_id}/review", api_review_bypass),
        ("POST", "/api/bypasses", api_grant_bypass),
        ("DELETE", "/api/bypasses/{bypass_id}", api_revoke_bypass),
        ("GET", "/api/bypasses/active", api_active_bypasses),
        ("GET", "/api/audit", api_audit_log),
        ("POST", "/api/devices/{device_id}/freeze", api_emergency_freeze),
        ("POST", "/api/devices/{device_id}/unfreeze", api_lift_freeze),
        ("GET", "/api/categories", api_categories),
        # NextDNS integration routes
        ("GET", "/api/nextdns/status", api_nextdns_status),
        ("GET", "/api/nextdns/analytics", api_nextdns_analytics),
        ("GET", "/api/nextdns/blocklists", api_nextdns_blocklists),
        ("GET", "/api/nextdns/parental", api_nextdns_parental),
        ("GET", "/api/nextdns/security", api_nextdns_security),
        ("POST", "/api/nextdns/denylist", api_nextdns_add_denylist),
        ("DELETE", "/api/nextdns/denylist/{domain}", api_nextdns_remove_denylist),
        # Network status routes
        ("GET", "/api/network/status", api_network_status),
        ("GET", "/api/timeline", api_timeline),
        ("GET", "/api/top-blocked", api_top_blocked),
    ]

    for method, path, handler in api_routes:
        route = app.router.add_route(method, path, handler)
        cors.add(route)

    # Static files
    app.router.add_static("/static", config.static_path)
    app.router.add_get("/", serve_index)
    app.router.add_get("/{path:.*}", serve_index)  # SPA fallback

    return app

def main():
    """Start the admin dashboard server"""
    print(f"""
╔══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║           DIGIGAMI GUARDIAN ADMIN DASHBOARD                      ║
║                                                                   ║
╚══════════════════════════════════════════════════════════════════╝
    """)

    # Initialize database
    init_admin_db()

    # Create app
    app = create_app()

    print(f"Starting admin dashboard on port {config.admin_port}")
    print(f"Database: {config.db_path}")
    print(f"Static files: {config.static_path}")

    if not config.admin_secret:
        print("\n⚠️  WARNING: ADMIN_SECRET not set. Using default authentication.")
        print("   Set ADMIN_SECRET environment variable for production.\n")

    web.run_app(app, host="0.0.0.0", port=config.admin_port)

if __name__ == "__main__":
    main()
