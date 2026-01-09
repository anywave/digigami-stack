"""
DIGIGAMI NextDNS Partnership API Client
Integrates with NextDNS for enhanced DNS filtering, analytics, and blocklists.

NextDNS API Documentation: https://nextdns.github.io/api/
"""

import asyncio
import aiohttp
import json
import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Set
from datetime import datetime, timedelta
from enum import Enum

logger = logging.getLogger("digigami-nextdns")


class NextDNSFilterType(Enum):
    """NextDNS filter categories"""
    PRIVACY = "privacy"
    SECURITY = "security"
    PARENTAL = "parental"
    ADS_TRACKERS = "ads-trackers"
    NATIVE_TRACKING = "native-tracking"
    AFFILIATE = "affiliate"


@dataclass
class NextDNSConfig:
    """NextDNS API configuration"""
    api_key: str = ""
    profile_id: str = ""  # NextDNS configuration ID (e.g., "abc123")
    api_base: str = "https://api.nextdns.io"

    # Feature flags
    use_nextdns_blocklists: bool = True
    use_nextdns_analytics: bool = True
    sync_interval: int = 300  # 5 minutes

    # Caching
    blocklist_cache_ttl: int = 3600  # 1 hour

    # Partnership features
    partner_id: str = "digigami"
    enable_doh: bool = True  # DNS-over-HTTPS
    enable_dot: bool = True  # DNS-over-TLS


@dataclass
class NextDNSBlocklist:
    """NextDNS blocklist entry"""
    id: str
    name: str
    description: str
    entries: int
    enabled: bool = True


@dataclass
class NextDNSAnalytics:
    """NextDNS analytics data"""
    queries_total: int = 0
    queries_blocked: int = 0
    queries_allowed: int = 0
    top_blocked_domains: List[Dict] = field(default_factory=list)
    top_allowed_domains: List[Dict] = field(default_factory=list)
    device_breakdown: Dict[str, int] = field(default_factory=dict)


class NextDNSClient:
    """
    NextDNS API client for DIGIGAMI Guardian integration.

    Features:
    - Fetch and sync blocklists from NextDNS
    - Report DNS analytics to NextDNS
    - Manage NextDNS configurations via API
    - Support for DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT)
    """

    def __init__(self, config: NextDNSConfig):
        self.config = config
        self._session: Optional[aiohttp.ClientSession] = None
        self._blocklist_cache: Dict[str, Set[str]] = {}
        self._blocklist_last_update: Optional[datetime] = None
        self._analytics_buffer: List[Dict] = []

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session"""
        if self._session is None or self._session.closed:
            headers = {
                "X-Api-Key": self.config.api_key,
                "Content-Type": "application/json",
                "User-Agent": f"DIGIGAMI-Guardian/1.0 (Partner: {self.config.partner_id})"
            }
            self._session = aiohttp.ClientSession(headers=headers)
        return self._session

    async def close(self):
        """Close the client session"""
        if self._session and not self._session.closed:
            await self._session.close()

    # ============ PROFILE MANAGEMENT ============

    async def get_profile(self) -> Optional[Dict]:
        """Get NextDNS profile/configuration details"""
        if not self.config.profile_id:
            logger.warning("No NextDNS profile_id configured")
            return None

        try:
            session = await self._get_session()
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}"
            ) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logger.error(f"NextDNS profile fetch failed: {response.status}")
                    return None
        except Exception as e:
            logger.error(f"NextDNS API error: {e}")
            return None

    async def list_profiles(self) -> List[Dict]:
        """List all NextDNS profiles for the account"""
        try:
            session = await self._get_session()
            async with session.get(f"{self.config.api_base}/profiles") as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("data", [])
                else:
                    logger.error(f"NextDNS profiles list failed: {response.status}")
                    return []
        except Exception as e:
            logger.error(f"NextDNS API error: {e}")
            return []

    async def create_linked_profile(self, name: str, settings: Dict) -> Optional[str]:
        """
        Create a new NextDNS profile linked to DIGIGAMI user.
        Returns the profile ID if successful.
        """
        try:
            session = await self._get_session()
            payload = {
                "name": name,
                "settings": {
                    **settings,
                    "meta": {
                        "partner": self.config.partner_id,
                        "created_via": "digigami-guardian"
                    }
                }
            }

            async with session.post(
                f"{self.config.api_base}/profiles",
                json=payload
            ) as response:
                if response.status == 201:
                    data = await response.json()
                    return data.get("data", {}).get("id")
                else:
                    error = await response.text()
                    logger.error(f"NextDNS profile creation failed: {error}")
                    return None
        except Exception as e:
            logger.error(f"NextDNS API error: {e}")
            return None

    # ============ BLOCKLISTS ============

    async def get_available_blocklists(self) -> List[NextDNSBlocklist]:
        """Get list of available blocklists from NextDNS"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/security/blocklists"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return [
                        NextDNSBlocklist(
                            id=item["id"],
                            name=item["name"],
                            description=item.get("description", ""),
                            entries=item.get("entries", 0),
                            enabled=item.get("enabled", True)
                        )
                        for item in data.get("data", [])
                    ]
                else:
                    logger.error(f"NextDNS blocklists fetch failed: {response.status}")
                    return []
        except Exception as e:
            logger.error(f"NextDNS API error: {e}")
            return []

    async def sync_blocklists(self) -> Dict[str, Set[str]]:
        """
        Sync blocklist domains from NextDNS.
        Returns dict of category -> set of blocked domains.
        """
        # Check cache
        if (self._blocklist_last_update and
            datetime.utcnow() - self._blocklist_last_update <
            timedelta(seconds=self.config.blocklist_cache_ttl)):
            return self._blocklist_cache

        blocklists = {}

        try:
            session = await self._get_session()

            # Fetch privacy blocklist
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/privacy/blocklists"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    blocklists["privacy"] = set(
                        item["id"] for item in data.get("data", []) if item.get("active")
                    )

            # Fetch security blocklist
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/security"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    blocklists["security"] = set(data.get("threatIntelligenceFeeds", []))

            # Fetch parental control settings
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/parentalControl"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    parental_categories = data.get("categories", [])
                    blocklists["parental"] = set(parental_categories)

            # Fetch denylist (custom blocked domains)
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/denylist"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    blocklists["custom"] = set(
                        item["id"] for item in data.get("data", []) if item.get("active")
                    )

            self._blocklist_cache = blocklists
            self._blocklist_last_update = datetime.utcnow()
            logger.info(f"Synced NextDNS blocklists: {sum(len(v) for v in blocklists.values())} entries")

            return blocklists

        except Exception as e:
            logger.error(f"NextDNS blocklist sync error: {e}")
            return self._blocklist_cache  # Return cached data on error

    async def add_to_denylist(self, domain: str) -> bool:
        """Add a domain to the NextDNS denylist"""
        try:
            session = await self._get_session()
            async with session.post(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/denylist",
                json={"id": domain, "active": True}
            ) as response:
                return response.status in (200, 201)
        except Exception as e:
            logger.error(f"NextDNS denylist add error: {e}")
            return False

    async def remove_from_denylist(self, domain: str) -> bool:
        """Remove a domain from the NextDNS denylist"""
        try:
            session = await self._get_session()
            async with session.delete(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/denylist/{domain}"
            ) as response:
                return response.status in (200, 204)
        except Exception as e:
            logger.error(f"NextDNS denylist remove error: {e}")
            return False

    async def add_to_allowlist(self, domain: str) -> bool:
        """Add a domain to the NextDNS allowlist"""
        try:
            session = await self._get_session()
            async with session.post(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/allowlist",
                json={"id": domain, "active": True}
            ) as response:
                return response.status in (200, 201)
        except Exception as e:
            logger.error(f"NextDNS allowlist add error: {e}")
            return False

    # ============ ANALYTICS ============

    async def get_analytics(self, period: str = "24h") -> NextDNSAnalytics:
        """
        Get analytics from NextDNS.
        period: "1h", "24h", "7d", "30d"
        """
        analytics = NextDNSAnalytics()

        try:
            session = await self._get_session()

            # Get query stats
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/analytics/status",
                params={"from": f"-{period}"}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    stats = data.get("data", {})
                    analytics.queries_total = stats.get("allQueries", 0)
                    analytics.queries_blocked = stats.get("blockedQueries", 0)
                    analytics.queries_allowed = analytics.queries_total - analytics.queries_blocked

            # Get top blocked domains
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/analytics/domains",
                params={"from": f"-{period}", "status": "blocked", "limit": 20}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    analytics.top_blocked_domains = data.get("data", [])

            # Get top allowed domains
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/analytics/domains",
                params={"from": f"-{period}", "status": "allowed", "limit": 20}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    analytics.top_allowed_domains = data.get("data", [])

            # Get device breakdown
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/analytics/devices",
                params={"from": f"-{period}"}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    analytics.device_breakdown = {
                        item["name"]: item["queries"]
                        for item in data.get("data", [])
                    }

            return analytics

        except Exception as e:
            logger.error(f"NextDNS analytics fetch error: {e}")
            return analytics

    async def report_query(self, query_data: Dict):
        """
        Buffer a query event for reporting to NextDNS analytics.
        This batches queries to reduce API calls.
        """
        if not self.config.use_nextdns_analytics:
            return

        self._analytics_buffer.append({
            **query_data,
            "timestamp": datetime.utcnow().isoformat(),
            "source": self.config.partner_id
        })

        # Flush buffer if it gets too large
        if len(self._analytics_buffer) >= 100:
            await self.flush_analytics()

    async def flush_analytics(self):
        """Flush analytics buffer to NextDNS"""
        if not self._analytics_buffer:
            return

        try:
            session = await self._get_session()
            payload = {
                "profile_id": self.config.profile_id,
                "events": self._analytics_buffer,
                "partner": self.config.partner_id
            }

            async with session.post(
                f"{self.config.api_base}/analytics/batch",
                json=payload
            ) as response:
                if response.status in (200, 201):
                    logger.debug(f"Flushed {len(self._analytics_buffer)} analytics events")
                    self._analytics_buffer = []
                else:
                    logger.error(f"Analytics flush failed: {response.status}")
        except Exception as e:
            logger.error(f"Analytics flush error: {e}")

    # ============ DNS-OVER-HTTPS ============

    def get_doh_url(self) -> str:
        """Get the DNS-over-HTTPS URL for this profile"""
        return f"https://dns.nextdns.io/{self.config.profile_id}"

    def get_dot_hostname(self) -> str:
        """Get the DNS-over-TLS hostname for this profile"""
        return f"{self.config.profile_id}.dns.nextdns.io"

    async def resolve_doh(self, domain: str, record_type: str = "A") -> Optional[List[str]]:
        """
        Resolve a domain using NextDNS DoH.
        Useful for fallback or validation.
        """
        try:
            session = await self._get_session()

            # DoH wire format query
            async with session.get(
                self.get_doh_url(),
                params={"name": domain, "type": record_type},
                headers={"Accept": "application/dns-json"}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    answers = data.get("Answer", [])
                    return [
                        answer["data"]
                        for answer in answers
                        if answer.get("type") == (1 if record_type == "A" else 28)
                    ]
                return None
        except Exception as e:
            logger.error(f"DoH resolution error: {e}")
            return None

    # ============ PARENTAL CONTROLS ============

    async def get_parental_settings(self) -> Dict:
        """Get current parental control settings"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/parentalControl"
            ) as response:
                if response.status == 200:
                    return await response.json()
                return {}
        except Exception as e:
            logger.error(f"NextDNS parental settings error: {e}")
            return {}

    async def update_parental_settings(self, settings: Dict) -> bool:
        """Update parental control settings"""
        try:
            session = await self._get_session()
            async with session.patch(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/parentalControl",
                json=settings
            ) as response:
                return response.status == 200
        except Exception as e:
            logger.error(f"NextDNS parental update error: {e}")
            return False

    async def set_blocked_categories(self, categories: List[str]) -> bool:
        """Set blocked content categories for parental controls"""
        # Valid NextDNS parental categories
        valid_categories = {
            "porn", "gambling", "dating", "piracy", "social-networks",
            "video-streaming", "games", "online-gaming", "chat",
            "messaging", "drugs", "alcohol", "tobacco", "weapons"
        }

        filtered = [c for c in categories if c in valid_categories]
        return await self.update_parental_settings({"categories": filtered})

    # ============ SECURITY SETTINGS ============

    async def get_security_settings(self) -> Dict:
        """Get security settings from NextDNS"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/security"
            ) as response:
                if response.status == 200:
                    return await response.json()
                return {}
        except Exception as e:
            logger.error(f"NextDNS security settings error: {e}")
            return {}

    async def enable_threat_protection(self, threats: List[str] = None) -> bool:
        """Enable threat protection features"""
        if threats is None:
            threats = [
                "malware", "phishing", "cryptojacking",
                "newly-registered-domains", "dga", "parked-domains"
            ]

        settings = {
            "threatIntelligenceFeeds": True,
            **{threat: True for threat in threats}
        }

        try:
            session = await self._get_session()
            async with session.patch(
                f"{self.config.api_base}/profiles/{self.config.profile_id}/security",
                json=settings
            ) as response:
                return response.status == 200
        except Exception as e:
            logger.error(f"NextDNS threat protection error: {e}")
            return False


# ============ DIGIGAMI <-> NEXTDNS CATEGORY MAPPING ============

DIGIGAMI_TO_NEXTDNS_CATEGORIES = {
    # DIGIGAMI category -> NextDNS category
    "gambling": "gambling",
    "alcohol": "alcohol",
    "tobacco": "tobacco",
    "adult": "porn",
    "cannabis": "drugs",
    "social_media": "social-networks",
    "streaming": "video-streaming",
    "gaming": "online-gaming",
    "dating": "dating",
    "firearms": "weapons",
}

NEXTDNS_TO_DIGIGAMI_CATEGORIES = {v: k for k, v in DIGIGAMI_TO_NEXTDNS_CATEGORIES.items()}


def map_digigami_to_nextdns(digigami_category: str) -> Optional[str]:
    """Map DIGIGAMI category to NextDNS category"""
    return DIGIGAMI_TO_NEXTDNS_CATEGORIES.get(digigami_category)


def map_nextdns_to_digigami(nextdns_category: str) -> Optional[str]:
    """Map NextDNS category to DIGIGAMI category"""
    return NEXTDNS_TO_DIGIGAMI_CATEGORIES.get(nextdns_category)


# ============ INTEGRATION HELPER ============

class NextDNSIntegration:
    """
    High-level integration between DIGIGAMI Guardian and NextDNS.
    Manages syncing, analytics reporting, and profile management.
    """

    def __init__(self, client: NextDNSClient):
        self.client = client
        self._sync_task: Optional[asyncio.Task] = None
        self._analytics_task: Optional[asyncio.Task] = None

    async def start(self):
        """Start background sync and analytics tasks"""
        if self.client.config.use_nextdns_blocklists:
            self._sync_task = asyncio.create_task(self._sync_loop())

        if self.client.config.use_nextdns_analytics:
            self._analytics_task = asyncio.create_task(self._analytics_loop())

        logger.info("NextDNS integration started")

    async def stop(self):
        """Stop background tasks and cleanup"""
        if self._sync_task:
            self._sync_task.cancel()
        if self._analytics_task:
            self._analytics_task.cancel()

        await self.client.flush_analytics()
        await self.client.close()
        logger.info("NextDNS integration stopped")

    async def _sync_loop(self):
        """Periodic blocklist sync"""
        while True:
            try:
                await self.client.sync_blocklists()
            except Exception as e:
                logger.error(f"NextDNS sync error: {e}")

            await asyncio.sleep(self.client.config.sync_interval)

    async def _analytics_loop(self):
        """Periodic analytics flush"""
        while True:
            await asyncio.sleep(60)  # Flush every minute
            try:
                await self.client.flush_analytics()
            except Exception as e:
                logger.error(f"NextDNS analytics error: {e}")

    async def check_domain(self, domain: str) -> Dict:
        """
        Check if a domain should be blocked based on NextDNS settings.
        Returns: {"blocked": bool, "reason": str, "category": str}
        """
        blocklists = await self.client.sync_blocklists()

        # Check custom denylist first
        if domain in blocklists.get("custom", set()):
            return {
                "blocked": True,
                "reason": "custom_denylist",
                "category": "custom"
            }

        # Check parental control categories (domain pattern matching)
        parental_categories = blocklists.get("parental", set())
        for category in parental_categories:
            # Pattern-based category detection would go here
            pass

        return {
            "blocked": False,
            "reason": "allowed",
            "category": None
        }

    async def sync_digigami_restrictions(self, restrictions: Dict) -> bool:
        """
        Sync DIGIGAMI user restrictions to NextDNS profile.
        Maps DIGIGAMI categories to NextDNS parental control categories.
        """
        blocked_categories = restrictions.get("blocked_categories", [])

        # Map to NextDNS categories
        nextdns_categories = [
            mapped
            for cat in blocked_categories
            if (mapped := map_digigami_to_nextdns(cat))
        ]

        return await self.client.set_blocked_categories(nextdns_categories)

    async def report_block_event(self, device_id: str, domain: str,
                                  category: str, reason: str):
        """Report a block event to NextDNS analytics"""
        await self.client.report_query({
            "domain": domain,
            "device": device_id,
            "status": "blocked",
            "category": map_digigami_to_nextdns(category) or category,
            "reason": reason,
            "source": "digigami-guardian"
        })

    async def report_allow_event(self, device_id: str, domain: str):
        """Report an allowed query to NextDNS analytics"""
        await self.client.report_query({
            "domain": domain,
            "device": device_id,
            "status": "allowed",
            "source": "digigami-guardian"
        })
