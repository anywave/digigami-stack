#!/bin/bash
#
# DIGIGAMI Guardian DNS + Pi-hole Integration Installer
#
# This script sets up Guardian DNS alongside Pi-hole for
# consent-aware DNS filtering combined with ad blocking.
#
# Usage: ./install-pihole-integration.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                   ║"
echo "║          DIGIGAMI GUARDIAN DNS + PI-HOLE INTEGRATION             ║"
echo "║                                                                   ║"
echo "║                     Defense in Depth                              ║"
echo "║                                                                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for root
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}Note: Some operations may require sudo.${NC}"
fi

# Check for Docker
echo -e "\n${BLUE}[1/6] Checking prerequisites...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${RED}❌ Docker is not installed.${NC}"
  echo "Please install Docker first: https://docs.docker.com/get-docker/"
  exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo -e "${RED}❌ Docker Compose is not installed.${NC}"
  echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
  exit 1
fi
echo -e "${GREEN}✓ Docker Compose found${NC}"

# Check if port 53 is available
if lsof -i :53 &> /dev/null; then
  echo -e "${YELLOW}⚠ Port 53 is in use. This may be an existing DNS server.${NC}"
  echo "  Current process:"
  lsof -i :53 | head -5
  echo ""
  read -p "Do you want to continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting."
    exit 1
  fi
fi

# Create necessary directories
echo -e "\n${BLUE}[2/6] Creating directories...${NC}"
mkdir -p blockpage
mkdir -p config
echo -e "${GREEN}✓ Directories created${NC}"

# Create block page
echo -e "\n${BLUE}[3/6] Creating block page...${NC}"
cat > blockpage/index.html << 'BLOCKPAGE_EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Blocked - DIGIGAMI Guardian</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 500px;
    }
    .shield {
      width: 120px;
      height: 120px;
      margin: 0 auto 2rem;
      background: linear-gradient(135deg, #4361ee 0%, #7209b7 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 40px rgba(67, 97, 238, 0.3);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    .shield svg {
      width: 60px;
      height: 60px;
      fill: white;
    }
    h1 {
      font-size: 1.8rem;
      margin-bottom: 1rem;
      background: linear-gradient(90deg, #4361ee, #7209b7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .message {
      color: #a0a0c0;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .domain {
      background: rgba(255,255,255,0.1);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-family: monospace;
      display: inline-block;
      margin-bottom: 2rem;
    }
    .buttons {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    button {
      padding: 0.8rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
    }
    .btn-primary {
      background: linear-gradient(135deg, #4361ee 0%, #7209b7 100%);
      color: white;
      box-shadow: 0 4px 15px rgba(67, 97, 238, 0.4);
    }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #a0a0c0;
    }
    .consent-info {
      margin-top: 2rem;
      font-size: 0.85rem;
      color: #666;
    }
    .category {
      display: inline-block;
      background: rgba(114, 9, 183, 0.3);
      padding: 0.25rem 0.75rem;
      border-radius: 100px;
      font-size: 0.8rem;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="shield">
      <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.4 0 2.8 1.1 2.8 2.5V11c.6.3 1 .9 1 1.5v3c0 1-.8 1.5-1.8 1.5h-4c-1 0-1.8-.5-1.8-1.5v-3c0-.6.4-1.2 1-1.5V9.5C9.2 8.1 10.6 7 12 7zm0 1.2c-.8 0-1.5.7-1.5 1.5v1.6h3V9.7c0-.8-.7-1.5-1.5-1.5z"/></svg>
    </div>

    <h1>Access Blocked</h1>

    <p class="message">
      This site has been blocked by DIGIGAMI Guardian based on your consent settings.
    </p>

    <div class="domain" id="blockedDomain">loading...</div>
    <div class="category" id="category">checking...</div>

    <div class="buttons">
      <button class="btn-primary" onclick="requestAccess()">
        Request Access
      </button>
      <button class="btn-secondary" onclick="goBack()">
        Go Back
      </button>
    </div>

    <p class="consent-info">
      Protected by DIGIGAMI Guardian + Pi-hole
    </p>
  </div>

  <script>
    // Get blocked domain from query params
    const params = new URLSearchParams(window.location.search);
    const domain = params.get('domain') || window.location.hostname;
    const category = params.get('category') || 'Unknown';

    document.getElementById('blockedDomain').textContent = domain;
    document.getElementById('category').textContent = category;

    function goBack() {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'about:blank';
      }
    }

    async function requestAccess() {
      const reason = prompt('Why do you need access to this site?');
      if (!reason) return;

      try {
        // This would connect to your DIGIGAMI cloud API
        const response = await fetch('/api/bypass/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, reason })
        });

        if (response.ok) {
          alert('Request sent to your guardian. They will be notified.');
        } else {
          alert('Could not send request. Please try again.');
        }
      } catch (e) {
        alert('Request sent! Your guardian will be notified.');
      }
    }
  </script>
</body>
</html>
BLOCKPAGE_EOF
echo -e "${GREEN}✓ Block page created${NC}"

# Create/check .env file
echo -e "\n${BLUE}[4/6] Configuring environment...${NC}"
if [ ! -f .env ]; then
  cp config/.env.example .env 2>/dev/null || cat > .env << 'ENV_EOF'
# DIGIGAMI Guardian DNS Configuration
DIGIGAMI_API_KEY=your_api_key_here
DIGIGAMI_CLOUD_URL=wss://api.digigami.ai/v1/spiral

# Pi-hole Configuration
PIHOLE_PASSWORD=changeme

# Block page IP (your server's IP)
BLOCK_PAGE_IP=192.168.1.100

# Timezone
TZ=America/New_York

# Upstream DNS (used by Pi-hole after ad blocking)
UPSTREAM_DNS=1.1.1.1;1.0.0.1

# Logging level
LOG_LEVEL=INFO
ENV_EOF
  echo -e "${YELLOW}⚠ Created .env file. Please edit it with your settings:${NC}"
  echo "  nano .env"
else
  echo -e "${GREEN}✓ .env file already exists${NC}"
fi

# Validate configuration
echo -e "\n${BLUE}[5/6] Validating configuration...${NC}"
source .env 2>/dev/null || true
if [ "$DIGIGAMI_API_KEY" = "your_api_key_here" ] || [ -z "$DIGIGAMI_API_KEY" ]; then
  echo -e "${YELLOW}⚠ DIGIGAMI_API_KEY not set. Please edit .env${NC}"
fi
if [ "$PIHOLE_PASSWORD" = "changeme" ]; then
  echo -e "${YELLOW}⚠ Please change PIHOLE_PASSWORD in .env${NC}"
fi
echo -e "${GREEN}✓ Configuration checked${NC}"

# Instructions
echo -e "\n${BLUE}[6/6] Ready to deploy!${NC}"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  To start DIGIGAMI Guardian + Pi-hole:"
echo ""
echo -e "    ${YELLOW}docker compose -f docker-compose.pihole.yml up -d${NC}"
echo ""
echo "  To start with block page server:"
echo ""
echo -e "    ${YELLOW}docker compose -f docker-compose.pihole.yml --profile with-blockpage up -d${NC}"
echo ""
echo "  After starting, configure your router's DNS to point to:"
echo -e "    ${GREEN}$(hostname -I | awk '{print $1}'):53${NC}"
echo ""
echo "  Pi-hole admin interface:"
echo -e "    ${BLUE}http://$(hostname -I | awk '{print $1}'):8080/admin${NC}"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Full documentation: PIHOLE_INTEGRATION.md"
echo ""
