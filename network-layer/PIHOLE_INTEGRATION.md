# Pi-hole Integration Guide

## DIGIGAMI Guardian DNS + Pi-hole: Defense in Depth

This guide explains how to run DIGIGAMI Guardian DNS alongside Pi-hole for the ultimate consent-aware, ad-blocking, privacy-respecting network protection.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                         YOUR HOME NETWORK                                   │
│                                                                              │
│    ┌──────────────┐                                                          │
│    │   Device     │ ─── DNS Query ──→ ┌────────────────────────┐            │
│    │  (Phone/PC)  │                   │   DIGIGAMI GUARDIAN    │            │
│    └──────────────┘                   │   Port 5353            │            │
│                                       │   • Consent checking   │            │
│                                       │   • Age verification   │            │
│                                       │   • Category blocking  │            │
│                                       └──────────┬─────────────┘            │
│                                                  │                          │
│                                                  │ Forward allowed queries  │
│                                                  ▼                          │
│                                       ┌────────────────────────┐            │
│                                       │      PI-HOLE           │            │
│                                       │      Port 53           │            │
│                                       │   • Ad blocking        │            │
│                                       │   • Tracker blocking   │            │
│                                       │   • Malware blocking   │            │
│                                       └──────────┬─────────────┘            │
│                                                  │                          │
│                                                  │ Forward to upstream      │
│                                                  ▼                          │
│                                       ┌────────────────────────┐            │
│                                       │   UPSTREAM DNS         │            │
│                                       │   (Cloudflare/Quad9)   │            │
│                                       └────────────────────────┘            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Why Combine Them?

| Feature | Guardian DNS | Pi-hole | Combined |
|---------|-------------|---------|----------|
| Ad blocking | ❌ | ✅ | ✅ |
| Tracker blocking | ❌ | ✅ | ✅ |
| Consent-aware blocking | ✅ | ❌ | ✅ |
| Age-based restrictions | ✅ | ❌ | ✅ |
| Coherence checking | ✅ | ❌ | ✅ |
| Guardian approval | ✅ | ❌ | ✅ |
| SPIRAL protocol sync | ✅ | ❌ | ✅ |
| Blocklist management | ❌ | ✅ | ✅ |
| Statistics dashboard | ❌ | ✅ | ✅ |

**Together**: Your family gets consent-aware protection AND ad blocking with full statistics.

## Prerequisites

- Raspberry Pi (3B+ or later) or any Linux server
- Pi-hole already installed and running
- Docker (recommended) or Python 3.8+
- Your DIGIGAMI Cloud API key

## Installation Methods

### Method 1: Docker Compose (Recommended)

This method runs Guardian DNS in a container that forwards to your existing Pi-hole.

**1. Create the integration docker-compose file:**

```yaml
# docker-compose.pihole.yml
version: '3.8'

services:
  guardian-dns:
    build: .
    container_name: digigami-guardian
    restart: unless-stopped
    ports:
      - "5353:53/udp"
      - "5353:53/tcp"
    environment:
      - DIGIGAMI_CLOUD_URL=wss://api.digigami.ai/v1/spiral
      - DIGIGAMI_API_KEY=${DIGIGAMI_API_KEY}
      - UPSTREAM_DNS=pihole  # Forward to Pi-hole container
      - UPSTREAM_PORT=53
      - BLOCK_PAGE_IP=192.168.1.100  # Your server IP
      - LOG_LEVEL=INFO
    networks:
      - pihole_network
    depends_on:
      - pihole

  pihole:
    image: pihole/pihole:latest
    container_name: pihole
    restart: unless-stopped
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "80:80/tcp"
    environment:
      - TZ=America/New_York
      - WEBPASSWORD=${PIHOLE_PASSWORD}
      - PIHOLE_DNS_=1.1.1.1;1.0.0.1
    volumes:
      - ./pihole/etc-pihole:/etc/pihole
      - ./pihole/etc-dnsmasq.d:/etc/dnsmasq.d
    networks:
      - pihole_network

networks:
  pihole_network:
    driver: bridge
```

**2. Create your .env file:**

```bash
# .env
DIGIGAMI_API_KEY=your_api_key_here
PIHOLE_PASSWORD=your_secure_password
```

**3. Start the stack:**

```bash
docker compose -f docker-compose.pihole.yml up -d
```

**4. Configure your router:**

Point your router's DHCP to use `your-server-ip:5353` as the DNS server.

### Method 2: Existing Pi-hole Installation

If you already have Pi-hole running (not in Docker), you can add Guardian DNS alongside it.

**1. Install Guardian DNS:**

```bash
# Clone the repository
git clone https://github.com/digigami/digigami-stack.git
cd digigami-stack/network-layer

# Install dependencies
pip install -r requirements.txt

# Copy and edit config
cp config/.env.example config/.env
nano config/.env
```

**2. Configure Guardian DNS to forward to Pi-hole:**

```bash
# config/.env
UPSTREAM_DNS=127.0.0.1
UPSTREAM_PORT=53  # Pi-hole's port
LISTEN_PORT=5353  # Guardian listens on different port
DIGIGAMI_API_KEY=your_api_key_here
```

**3. Reconfigure Pi-hole to listen on 127.0.0.1 only:**

Edit `/etc/pihole/setupVars.conf`:
```
PIHOLE_INTERFACE=lo
```

Then restart Pi-hole:
```bash
pihole restartdns
```

**4. Run Guardian DNS:**

```bash
# Run directly
sudo python guardian_dns.py

# Or create a systemd service (see below)
```

**5. Update router DNS:**

Point all devices to your server's IP on port 5353.

### Method 3: Pi-hole as Upstream (Chain Configuration)

For maximum flexibility, you can chain them:

```
Devices → Guardian DNS (53) → Pi-hole (5353) → Upstream
```

**Pi-hole configuration:**

```bash
# Change Pi-hole to listen on 5353
sudo nano /etc/pihole/setupVars.conf
# Add: PIHOLE_DNS_PORT=5353

# Restart
pihole restartdns
```

**Guardian DNS configuration:**

```bash
# config/.env
UPSTREAM_DNS=127.0.0.1
UPSTREAM_PORT=5353
LISTEN_PORT=53
```

## Systemd Service

Create `/etc/systemd/system/digigami-guardian.service`:

```ini
[Unit]
Description=DIGIGAMI Guardian DNS Server
After=network.target pihole-FTL.service
Wants=pihole-FTL.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/digigami-stack/network-layer
ExecStart=/usr/bin/python3 guardian_dns.py
Restart=always
RestartSec=5
Environment="PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable digigami-guardian
sudo systemctl start digigami-guardian
```

## Verification

### Test the chain:

```bash
# Test Guardian DNS
dig @localhost -p 5353 example.com

# Test a blocked category (gambling)
dig @localhost -p 5353 casino.com
# Should return your block page IP

# Test Pi-hole ad blocking
dig @localhost -p 53 ads.google.com
# Should return 0.0.0.0
```

### Check logs:

```bash
# Guardian DNS logs
journalctl -u digigami-guardian -f

# Docker logs
docker logs -f digigami-guardian

# Pi-hole logs
pihole -t
```

## Block Page Configuration

When Guardian DNS blocks a domain, it returns a block page IP. Set up the block page server:

**Using the included block page:**

```bash
# Serve the extension's block page
cd /opt/digigami-stack/extension
python -m http.server 80

# Or use nginx
sudo apt install nginx
sudo cp block.html /var/www/html/index.html
```

**Custom block page with consent request:**

The block page should include a button to request guardian approval:

```html
<button onclick="requestBypass()">
  Request Access from Guardian
</button>

<script>
async function requestBypass() {
  const domain = new URLSearchParams(location.search).get('domain');
  const response = await fetch('https://api.digigami.ai/v1/bypass/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, reason: 'User request' })
  });
  // Handle response...
}
</script>
```

## Router Configuration

### Common Routers

**Netgear:**
1. Login to router (routerlogin.net)
2. Internet → DNS Address → Use These DNS Servers
3. Primary: Your server IP
4. Secondary: Leave blank (forces all traffic through Guardian)

**TP-Link:**
1. Login to router (tplinkwifi.net)
2. Advanced → Network → DHCP Server
3. Primary DNS: Your server IP

**UniFi:**
1. Settings → Networks → [Network] → DHCP Name Server
2. Manual → Enter your server IP

**pfSense/OPNsense:**
1. Services → DHCP Server
2. DNS Servers: Your server IP

## Troubleshooting

### DNS not resolving

```bash
# Check Guardian DNS is running
systemctl status digigami-guardian

# Check ports
netstat -tulpn | grep -E '53|5353'

# Test direct connection
dig @your-server-ip -p 5353 google.com
```

### Pi-hole not receiving queries

```bash
# Check Pi-hole is running
systemctl status pihole-FTL

# Verify Guardian forwards correctly
dig @127.0.0.1 -p 5353 google.com +trace
```

### Block page not showing

```bash
# Check web server is running
curl http://your-block-page-ip/

# Verify BLOCK_PAGE_IP in config
grep BLOCK_PAGE config/.env
```

## Advanced: Split DNS

For families with different consent profiles, you can run multiple Guardian DNS instances:

```yaml
services:
  guardian-kids:
    image: digigami/guardian-dns
    ports:
      - "5353:53/udp"
    environment:
      - PROFILE_ID=kids_profile
      - UPSTREAM_DNS=pihole

  guardian-teens:
    image: digigami/guardian-dns
    ports:
      - "5354:53/udp"
    environment:
      - PROFILE_ID=teens_profile
      - UPSTREAM_DNS=pihole

  guardian-adults:
    image: digigami/guardian-dns
    ports:
      - "5355:53/udp"
    environment:
      - PROFILE_ID=adults_profile
      - UPSTREAM_DNS=pihole
```

Then assign different DNS servers to different VLANs or device groups.

## Monitoring Dashboard

Guardian DNS exposes Prometheus metrics at `/metrics`:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'guardian-dns'
    static_configs:
      - targets: ['guardian-dns:9090']
```

Key metrics:
- `guardian_dns_queries_total` - Total queries
- `guardian_dns_blocked_total` - Blocked queries by category
- `guardian_dns_consent_checks_total` - Consent verifications
- `guardian_dns_bypass_requests_total` - Guardian bypass requests

## Security Considerations

1. **Never expose port 53 to the internet** - Only serve your local network
2. **Use HTTPS for the block page** - Prevents certificate warnings
3. **Rotate API keys regularly** - Keep your DIGIGAMI API key secure
4. **Monitor for bypass attempts** - Check logs for unusual patterns
5. **Keep both systems updated** - Security patches matter

## Support

- Pi-hole documentation: https://docs.pi-hole.net/
- DIGIGAMI Guardian: https://docs.digigami.ai/guardian-dns
- Community forum: https://community.digigami.ai/

---

*"Defense in depth: Because one layer is never enough."*
