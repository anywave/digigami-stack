# DIGIGAMI Network Guardian

DNS-level consent enforcement for home networks, Pi-hole installations, and cloud DNS resolvers.

## Overview

The Network Guardian intercepts DNS queries at the network level, enforcing DIGIGAMI consent rules **before** sites can even begin to load. This provides:

- **Deep Protection**: Blocks at the network layer, works on all devices
- **Zero Trust**: Sites can't bypass browser extensions
- **Family Coverage**: Single point of control for all household devices
- **Real-time Sync**: Pulls restrictions from DIGIGAMI cloud in real-time

## Deployment Options

### Option 1: Docker (Recommended)

```bash
# Clone the repository
cd network-layer

# Copy and configure environment
cp config/.env.example .env
# Edit .env with your settings

# Create network token file
mkdir -p config
echo "your-network-token" > config/network_token

# Start the service
docker-compose up -d

# View logs
docker-compose logs -f guardian-dns
```

### Option 2: Raspberry Pi / Pi-hole

```bash
# Install Python 3.11+
sudo apt update && sudo apt install python3 python3-pip

# Install dependencies
pip3 install -r requirements.txt

# Configure
sudo mkdir -p /etc/digigami
echo "your-network-token" | sudo tee /etc/digigami/network_token

# Run as service (see systemd section)
sudo python3 guardian_dns.py
```

### Option 3: Router Integration

For advanced users with custom router firmware (OpenWrt, DD-WRT):

1. Install Python 3 on router
2. Copy `guardian_dns.py` and requirements
3. Configure as the primary DNS server
4. Point router's DHCP to use this DNS

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DIGIGAMI_DNS_PORT` | 53 | DNS server port |
| `DIGIGAMI_UPSTREAM_DNS` | 8.8.8.8 | Upstream DNS for non-blocked queries |
| `DIGIGAMI_CLOUD_API` | https://api.digigami.ai/v1 | Cloud sync endpoint |
| `DIGIGAMI_SYNC_INTERVAL` | 30 | Seconds between cloud syncs |
| `DIGIGAMI_BLOCK_PAGE_IP` | 192.168.1.1 | IP serving the block page |

### Network Token

The network token authenticates your network with DIGIGAMI cloud. Obtain one from:
1. Log in to https://digigami.ai/dashboard
2. Go to Settings → Networks
3. Click "Register Network"
4. Copy the token to `/etc/digigami/network_token`

## How It Works

1. **DNS Query Received**: Device requests `gambling-site.com`
2. **Category Detection**: Guardian identifies domain category
3. **Profile Lookup**: Checks device's profile and restrictions
4. **Consent Check**: Age requirements, blocked categories, time limits
5. **Decision**:
   - **Allowed**: Forward to upstream DNS, return real IP
   - **Blocked**: Return block page IP, log event, notify guardians

## Device Identification

Devices are identified by:
- **IP Address**: Default method
- **MAC Address**: More reliable (requires ARP access)
- **Device Fingerprint**: Future enhancement

Devices are associated with DIGIGAMI profiles through the cloud dashboard.

## Block Page

When a domain is blocked, users see a friendly block page explaining:
- What was blocked and why
- The category and reason
- Options to go back or view dashboard

## Systemd Service

To run as a systemd service on Linux:

```ini
# /etc/systemd/system/digigami-guardian.service
[Unit]
Description=DIGIGAMI Network Guardian DNS
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/digigami/network-layer
ExecStart=/usr/bin/python3 guardian_dns.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable digigami-guardian
sudo systemctl start digigami-guardian
```

## Troubleshooting

### Port 53 Already in Use

```bash
# Check what's using port 53
sudo lsof -i :53

# On Ubuntu with systemd-resolved
sudo systemctl stop systemd-resolved
sudo systemctl disable systemd-resolved
```

### DNS Not Resolving

```bash
# Test DNS resolution
dig @localhost example.com

# Check Guardian logs
docker-compose logs guardian-dns
```

### Devices Not Being Blocked

1. Verify device is using Guardian as DNS
2. Check that device is registered in DIGIGAMI dashboard
3. Ensure restrictions are configured for the profile

## Security Considerations

- Run on trusted network only
- Secure the network token
- Use HTTPS for cloud sync
- Consider DNS-over-TLS for upstream

## License

Part of the DIGIGAMI consent infrastructure.
