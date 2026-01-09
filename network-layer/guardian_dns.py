"""
DIGIGAMI Network Guardian
DNS-Level Consent Enforcement Layer

This service runs on a home router, Pi-hole, or as a NextDNS-style cloud DNS resolver.
It intercepts DNS queries and enforces consent rules BEFORE sites can load.
"""

import asyncio
import aiohttp
import json
import hashlib
import logging
from dataclasses import dataclass
from typing import Optional, Dict, List, Set
from datetime import datetime, timedelta
import sqlite3
from pathlib import Path

# DNS libraries
try:
    import dnslib
    from dnslib import DNSRecord, RR, QTYPE, A
    from dnslib.server import DNSServer, BaseResolver
except ImportError:
    print("Install dnslib: pip install dnslib")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("digigami-network")

# ============ CONFIGURATION ============
@dataclass
class Config:
    # DNS settings
    dns_port: int = 53
    upstream_dns: str = "8.8.8.8"
    upstream_port: int = 53
    
    # Cloud sync
    cloud_api: str = "https://api.digigami.ai/v1"
    sync_interval: int = 30  # seconds
    
    # Block page
    block_page_ip: str = "192.168.1.1"  # Router IP serving block page
    
    # Local database
    db_path: str = "/var/lib/digigami/guardian.db"
    
    # Network identification
    network_id: str = ""  # Set during registration

config = Config()

# ============ CATEGORY DEFINITIONS ============
DOMAIN_CATEGORIES = {
    # Gambling
    "casino.com": "gambling",
    "pokerstars.com": "gambling",
    "draftkings.com": "gambling",
    "fanduel.com": "gambling",
    "bet365.com": "gambling",
    "bovada.lv": "gambling",
    "888casino.com": "gambling",
    "williamhill.com": "gambling",
    
    # Alcohol
    "wine.com": "alcohol",
    "totalwine.com": "alcohol",
    "drizly.com": "alcohol",
    "reservebar.com": "alcohol",
    "minibar.com": "alcohol",
    
    # Social Media (for time tracking)
    "tiktok.com": "social_media",
    "instagram.com": "social_media",
    "twitter.com": "social_media",
    "x.com": "social_media",
    "facebook.com": "social_media",
    "snapchat.com": "social_media",
    "reddit.com": "social_media",
    
    # Streaming (for time tracking)
    "youtube.com": "streaming",
    "netflix.com": "streaming",
    "twitch.tv": "streaming",
}

CATEGORY_PATTERNS = {
    "gambling": ["casino", "poker", "slots", "betting", "wager", "jackpot", "sportsbook"],
    "alcohol": ["wine", "liquor", "spirits", "brewery", "distillery", "beer"],
    "adult": ["xxx", "porn", "adult", "nsfw"],
    "cannabis": ["dispensary", "cannabis", "marijuana", "weed"],
}

CATEGORY_AGE_REQUIREMENTS = {
    "gambling": 21,
    "alcohol": 21,
    "tobacco": 21,
    "cannabis": 21,
    "adult": 18,
    "firearms": 18,
    "dating": 18,
    "social_media": 13,
}

# ============ USER PROFILE CACHE ============
class ProfileCache:
    """Cache user profiles identified by MAC address or device fingerprint"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.profiles: Dict[str, dict] = {}
        self.last_sync: Optional[datetime] = None
        self._init_db()
    
    def _init_db(self):
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS profiles (
                device_id TEXT PRIMARY KEY,
                user_did TEXT,
                profile_json TEXT,
                restrictions_json TEXT,
                updated_at TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS block_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT,
                domain TEXT,
                category TEXT,
                reason TEXT,
                timestamp TIMESTAMP
            )
        """)
        # Active bypasses table (shared with admin dashboard)
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
    
    def get_profile(self, device_id: str) -> Optional[dict]:
        """Get profile for a device (by MAC or IP)"""
        if device_id in self.profiles:
            return self.profiles[device_id]
        
        # Check database
        conn = sqlite3.connect(self.db_path)
        cursor = conn.execute(
            "SELECT profile_json, restrictions_json FROM profiles WHERE device_id = ?",
            (device_id,)
        )
        row = cursor.fetchone()
        conn.close()
        
        if row:
            profile = {
                "profile": json.loads(row[0]) if row[0] else None,
                "restrictions": json.loads(row[1]) if row[1] else None,
            }
            self.profiles[device_id] = profile
            return profile
        
        return None
    
    def set_profile(self, device_id: str, profile: dict, restrictions: dict):
        """Update profile for a device"""
        self.profiles[device_id] = {
            "profile": profile,
            "restrictions": restrictions,
        }
        
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            INSERT OR REPLACE INTO profiles (device_id, user_did, profile_json, restrictions_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            device_id,
            profile.get("did"),
            json.dumps(profile),
            json.dumps(restrictions),
            datetime.utcnow().isoformat()
        ))
        conn.commit()
        conn.close()
    
    def log_block(self, device_id: str, domain: str, category: str, reason: str):
        """Log a block event"""
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            INSERT INTO block_log (device_id, domain, category, reason, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (device_id, domain, category, reason, datetime.utcnow().isoformat()))
        conn.commit()
        conn.close()

profile_cache = ProfileCache(config.db_path)

# ============ DOMAIN CATEGORIZER ============
def categorize_domain(domain: str) -> Optional[str]:
    """Determine the category of a domain"""
    domain = domain.lower().strip(".")
    
    # Remove www prefix
    if domain.startswith("www."):
        domain = domain[4:]
    
    # Direct lookup
    if domain in DOMAIN_CATEGORIES:
        return DOMAIN_CATEGORIES[domain]
    
    # Check parent domains
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        parent = ".".join(parts[i:])
        if parent in DOMAIN_CATEGORIES:
            return DOMAIN_CATEGORIES[parent]
    
    # Pattern matching
    for category, patterns in CATEGORY_PATTERNS.items():
        for pattern in patterns:
            if pattern in domain:
                return category
    
    return None

# ============ CONSENT CHECKER ============
def check_active_bypass(device_id: str, domain: str) -> bool:
    """Check if there's an active bypass for this device and domain"""
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row

    # Check for exact domain match or wildcard bypass
    cursor = conn.execute("""
        SELECT id FROM active_bypasses
        WHERE device_id = ?
        AND (domain = ? OR domain = '*')
        AND expires_at > datetime('now')
        LIMIT 1
    """, (device_id, domain.lower().strip(".")))

    has_bypass = cursor.fetchone() is not None
    conn.close()
    return has_bypass

def check_consent(device_id: str, domain: str, category: str) -> dict:
    """
    Check if a device has consent to access a domain.
    Returns: {allowed: bool, reason: str, ...}
    """
    # First check for active bypass (from admin dashboard)
    if check_active_bypass(device_id, domain):
        return {
            "allowed": True,
            "reason": "active_bypass",
            "note": "Temporary bypass granted by guardian"
        }

    profile_data = profile_cache.get_profile(device_id)

    if not profile_data or not profile_data.get("restrictions"):
        # No profile - use network defaults
        return {
            "allowed": True,
            "reason": "no_profile",
            "note": "Device not registered with DIGIGAMI"
        }
    
    restrictions = profile_data["restrictions"]
    profile = profile_data["profile"]
    
    # Check age requirements
    user_age = restrictions.get("age", 18)
    required_age = CATEGORY_AGE_REQUIREMENTS.get(category, 0)
    
    if user_age < required_age:
        return {
            "allowed": False,
            "reason": "age_restricted",
            "category": category,
            "user_age": user_age,
            "required_age": required_age,
        }
    
    # Check explicit block list
    blocked_categories = restrictions.get("blocked_categories", [])
    if category in blocked_categories:
        return {
            "allowed": False,
            "reason": "category_blocked",
            "category": category,
        }
    
    # Check time-based restrictions
    time_limits = restrictions.get("time_limits", {})
    if category in time_limits:
        # Would need to track time - simplified here
        pass
    
    # Check guardian overrides
    if restrictions.get("emergency_freeze"):
        return {
            "allowed": False,
            "reason": "emergency_freeze",
            "message": restrictions.get("freeze_reason", "Guardian freeze active"),
        }
    
    return {
        "allowed": True,
        "reason": "passed_checks",
    }

# ============ DNS RESOLVER ============
class DigigamiResolver(BaseResolver):
    """
    Custom DNS resolver that enforces DIGIGAMI consent rules.
    """
    
    def __init__(self, upstream: str, upstream_port: int):
        self.upstream = upstream
        self.upstream_port = upstream_port
    
    def resolve(self, request, handler):
        """Handle DNS query"""
        qname = str(request.q.qname).rstrip(".")
        qtype = QTYPE[request.q.qtype]
        client_ip = handler.client_address[0]
        
        logger.debug(f"DNS Query: {qname} ({qtype}) from {client_ip}")
        
        # Only filter A records
        if qtype != "A":
            return self._forward_query(request)
        
        # Categorize the domain
        category = categorize_domain(qname)
        
        if category:
            # Check consent for this device
            device_id = client_ip  # In production, use MAC address
            consent_result = check_consent(device_id, qname, category)
            
            if not consent_result["allowed"]:
                logger.info(f"BLOCKED: {qname} ({category}) for {client_ip} - {consent_result['reason']}")
                
                # Log the block
                profile_cache.log_block(
                    device_id, qname, category, consent_result["reason"]
                )
                
                # Send push notification (async)
                asyncio.create_task(
                    send_block_notification(device_id, qname, consent_result)
                )
                
                # Return block page IP
                return self._block_response(request, qname)
        
        # Forward to upstream DNS
        return self._forward_query(request)
    
    def _forward_query(self, request) -> DNSRecord:
        """Forward query to upstream DNS"""
        try:
            response = request.send(self.upstream, self.upstream_port, timeout=5)
            return DNSRecord.parse(response)
        except Exception as e:
            logger.error(f"Upstream DNS error: {e}")
            return request.reply()
    
    def _block_response(self, request, qname: str) -> DNSRecord:
        """Return a response pointing to the block page"""
        reply = request.reply()
        reply.add_answer(
            RR(qname, QTYPE.A, rdata=A(config.block_page_ip), ttl=60)
        )
        return reply

# ============ CLOUD SYNC ============
async def sync_with_cloud():
    """Sync profiles and rules from DIGIGAMI cloud"""
    try:
        async with aiohttp.ClientSession() as session:
            # Get network token from local config
            token = await get_network_token()
            if not token:
                logger.warning("No network token configured")
                return
            
            async with session.get(
                f"{config.cloud_api}/network/sync",
                headers={"Authorization": f"Bearer {token}"},
                params={"network_id": config.network_id}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    # Update profiles
                    for device in data.get("devices", []):
                        profile_cache.set_profile(
                            device["device_id"],
                            device["profile"],
                            device["restrictions"]
                        )
                    
                    # Update global block lists
                    global DOMAIN_CATEGORIES
                    if "domain_categories" in data:
                        DOMAIN_CATEGORIES.update(data["domain_categories"])
                    
                    logger.info(f"Synced {len(data.get('devices', []))} profiles from cloud")
                else:
                    logger.error(f"Cloud sync failed: {response.status}")
    except Exception as e:
        logger.error(f"Cloud sync error: {e}")

async def send_block_notification(device_id: str, domain: str, result: dict):
    """Send push notification about block event"""
    try:
        async with aiohttp.ClientSession() as session:
            token = await get_network_token()
            if not token:
                return
            
            await session.post(
                f"{config.cloud_api}/events/network-block",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "network_id": config.network_id,
                    "device_id": device_id,
                    "domain": domain,
                    "category": result.get("category"),
                    "reason": result.get("reason"),
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )
    except Exception as e:
        logger.error(f"Notification error: {e}")

async def get_network_token() -> Optional[str]:
    """Get network authentication token"""
    # In production, read from secure storage
    try:
        with open("/etc/digigami/network_token", "r") as f:
            return f.read().strip()
    except:
        return None

# ============ PERIODIC SYNC ============
async def sync_loop():
    """Periodically sync with cloud"""
    while True:
        await sync_with_cloud()
        await asyncio.sleep(config.sync_interval)

# ============ BLOCK PAGE SERVER ============
from aiohttp import web

async def block_page_handler(request):
    """Serve the block page when a domain is blocked"""
    domain = request.query.get("domain", "unknown")
    reason = request.query.get("reason", "blocked")
    category = request.query.get("category", "restricted")
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>DIGIGAMI Guardian</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #0a0a0f;
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
            }}
            .container {{
                text-align: center;
                max-width: 500px;
            }}
            .icon {{
                font-size: 5rem;
                margin-bottom: 1rem;
            }}
            h1 {{
                font-size: 1.8rem;
                color: #5ed5d5;
                margin-bottom: 0.5rem;
            }}
            .domain {{
                color: #f28d7d;
                font-family: monospace;
                background: rgba(242, 141, 125, 0.1);
                padding: 0.5rem 1rem;
                border-radius: 6px;
                margin: 1rem 0;
            }}
            .reason {{
                color: #888;
                margin-bottom: 2rem;
                line-height: 1.6;
            }}
            .card {{
                background: #12121a;
                border: 1px solid #1a1a2f;
                border-radius: 12px;
                padding: 1.5rem;
                margin-bottom: 1rem;
            }}
            .card h3 {{
                color: #9b6dd6;
                font-size: 0.9rem;
                margin-bottom: 0.5rem;
            }}
            .btn {{
                padding: 0.875rem 2rem;
                border-radius: 8px;
                border: none;
                font-size: 1rem;
                cursor: pointer;
                margin: 0.5rem;
            }}
            .btn-primary {{
                background: linear-gradient(135deg, #5ed5d5, #9b6dd6);
                color: #0a0a0f;
            }}
            .btn-secondary {{
                background: transparent;
                border: 2px solid #5ed5d5;
                color: #5ed5d5;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">🛡️</div>
            <h1>DIGIGAMI Guardian</h1>
            <div class="domain">{domain}</div>
            <p class="reason">
                This site has been blocked by your network's DIGIGAMI Guardian.<br>
                <strong>Category:</strong> {category} | <strong>Reason:</strong> {reason}
            </p>
            
            <div class="card">
                <h3>Why am I seeing this?</h3>
                <p style="color: #aaa; font-size: 0.9rem;">
                    Your Digigami is protecting you based on your profile settings.
                    This block was enforced at the network level.
                </p>
            </div>
            
            <button class="btn btn-primary" onclick="window.history.back()">
                ← Go Back
            </button>
            <button class="btn btn-secondary" onclick="location.href='https://digigami.ai/dashboard'">
                View Dashboard
            </button>
        </div>
    </body>
    </html>
    """
    return web.Response(text=html, content_type="text/html")

async def start_block_page_server():
    """Start the block page HTTP server"""
    app = web.Application()
    app.router.add_get("/", block_page_handler)
    app.router.add_get("/blocked", block_page_handler)
    
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 80)
    await site.start()
    logger.info("Block page server started on port 80")

# ============ MAIN ============
def main():
    """Start the DIGIGAMI Network Guardian"""
    logger.info("Starting DIGIGAMI Network Guardian")
    
    # Create DNS resolver
    resolver = DigigamiResolver(config.upstream_dns, config.upstream_port)
    
    # Start DNS server
    dns_server = DNSServer(resolver, port=config.dns_port, address="0.0.0.0")
    dns_server.start_thread()
    logger.info(f"DNS server started on port {config.dns_port}")
    
    # Start async services
    loop = asyncio.get_event_loop()
    
    # Start block page server
    loop.run_until_complete(start_block_page_server())
    
    # Start sync loop
    loop.create_task(sync_loop())
    
    # Keep running
    try:
        loop.run_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        dns_server.stop()

if __name__ == "__main__":
    main()
