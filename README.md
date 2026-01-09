# DIGIGAMI Deployment Stack

## Complete Multi-Layer Consent Infrastructure

Three coordinated deployment layers for consent-aware browsing protection:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│                              ┌─────────────────────┐                            │
│                              │   DIGIGAMI CLOUD    │                            │
│                              │   Profile Sync      │                            │
│                              │   Consent State     │                            │
│                              │   Hedera Anchor     │                            │
│                              └──────────┬──────────┘                            │
│                                         │                                        │
│                    ┌────────────────────┼────────────────────┐                  │
│                    │                    │                    │                  │
│                    ▼                    ▼                    ▼                  │
│        ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐       │
│        │ BROWSER EXTENSION │ │  NETWORK LAYER    │ │ DIGIGAMI BROWSER  │       │
│        │                   │ │                   │ │                   │       │
│        │ • Chrome/Firefox  │ │ • Router DNS      │ │ • Gecko Fork      │       │
│        │ • Easy install    │ │ • Pi-hole         │ │ • Native consent  │       │
│        │ • User-disablable │ │ • All devices     │ │ • Cannot bypass   │       │
│        └───────────────────┘ └───────────────────┘ └───────────────────┘       │
│                                                                                  │
│                         DEFENSE IN DEPTH                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
digigami-stack/
├── ARCHITECTURE.md          # Full system architecture documentation
├── README.md                # This file
│
├── extension/               # Chrome/Firefox Extension
│   ├── manifest.json        # Extension manifest (MV3)
│   ├── background.js        # Service worker with consent logic
│   ├── popup.html/js        # Extension popup UI
│   ├── options.html/js      # Settings page
│   ├── content.js           # Content script for overlay injection
│   ├── block.html           # Content blocked page
│   ├── panic.html           # Emergency safe space
│   ├── overlay.html         # Inline blocking overlay
│   ├── core/                # Core modules
│   │   ├── spiral-sync.js   # SPIRAL protocol WebSocket sync
│   │   └── sync-manager.js  # State coordination
│   ├── modes/               # Specialized modes
│   │   ├── witness-mode.js  # Evidence capture with hash chain
│   │   ├── conscience-mode.js # Value-based guidance
│   │   └── conductor-mode.js  # Presentation coaching
│   └── icons/               # Extension icons
│
├── network-layer/           # Router/DNS Protection
│   ├── guardian_dns.py      # Python DNS server with consent checking
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Container build
│   ├── docker-compose.yml   # Full deployment
│   ├── docker-compose.pihole.yml  # Pi-hole integration
│   ├── PIHOLE_INTEGRATION.md      # Pi-hole setup guide
│   ├── install-pihole-integration.sh  # Quick install script
│   ├── blockpage/           # Block page server files
│   └── config/.env.example  # Environment template
│
├── browser/                 # DIGIGAMI Browser
│   ├── BROWSER_SPEC.md      # Full browser specification
│   └── gecko-patches/       # Gecko engine modifications (TODO)
│
└── demo/                    # Interactive Demos
    └── three-layer-demo.html # Interactive coordination demo
```

## Layer Comparison

| Feature | Extension | Network | Browser |
|---------|-----------|---------|---------|
| Installation | Easy (store) | Moderate (router) | Easy (download) |
| Coverage | Single browser | All devices | Single browser |
| Bypassable | Yes (disable) | Harder (switch network) | No |
| Best for | Adults self-regulating | Families, enterprise | Full sovereignty |

## Quick Start

### 1. Browser Extension (Development)

```bash
cd extension/

# Chrome
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the extension/ directory

# Firefox
# 1. Open about:debugging
# 2. Click "This Firefox"
# 3. Click "Load Temporary Add-on"
# 4. Select manifest.json
```

### 2. Network Layer (Development)

```bash
cd network-layer/

# Install dependencies
pip install dnslib aiohttp

# Run (requires root for port 53)
sudo python guardian_dns.py
```

### 3. Demo

```bash
# Open the interactive demo
open demo/three-layer-demo.html
# or
python -m http.server 8000
# then visit http://localhost:8000/demo/three-layer-demo.html
```

## How They Coordinate

### Scenario: Minor (16) tries to access casino.com

**With Network Layer Active:**
```
User → Browser → DNS Query → GUARDIAN DNS → BLOCKED
                                    ↓
                            Block page served
                            Push notification sent
```
Site never loads. Most secure.

**Network Bypassed (cellular), Extension Active:**
```
User → Browser → webRequest API → Extension → BLOCKED
                                      ↓
                              Overlay injected
                              Cloud notified
```
Site blocked at browser level.

**Extension Disabled, Back on Home WiFi:**
```
User → Browser → DNS Query → GUARDIAN DNS → BLOCKED
                                    ↓
                            Still blocked!
                            Alert: Extension was disabled
```
Defense in depth catches bypass attempts.

**Using DIGIGAMI Browser:**
```
User → URL bar → Consent Layer → BLOCKED
                       ↓
                Native block UI
                Cannot be bypassed
```
Full sovereignty, deepest integration.

## State Synchronization

All layers share consent state via SPIRAL protocol:

```json
{
  "user_id": "did:hedera:0.0.123456",
  "consent_state": {
    "theta": 2,
    "phi": "GROUNDED",
    "harmonic": 1,
    "coherence": 0.78
  },
  "restrictions": {
    "age": 16,
    "blocked_categories": ["gambling", "alcohol"],
    "time_limits": { "social_media": 120 }
  }
}
```

## Firefox Refugee Opportunity

With Mozilla's recent controversial changes, DIGIGAMI Browser positions as the privacy-first alternative:

- **Firefox's direction**: Corporate priorities, user trust eroding
- **DIGIGAMI Browser**: User sovereignty, consent as native feature
- **Target audience**: Privacy advocates, families, self-regulators

Key messaging:
> "You chose Firefox because you believed in a user-first web. DIGIGAMI Browser continues that mission - with consent as a native feature."

## Development Roadmap

### Phase 1: Extension MVP ✅
- [x] Manifest v3 structure
- [x] Background service worker with webRequest interception
- [x] Popup UI with consent state display
- [x] Options/settings page
- [x] Content script overlays
- [x] Block page with bypass request flow
- [x] Panic/emergency safe space
- [x] SPIRAL protocol cloud sync
- [x] Category-based blocking
- [x] Age-based restrictions
- [x] Time limits enforcement
- [x] Coherence-based access

### Phase 1.5: Specialized Modes ✅
- [x] Witness Mode (evidence capture with SHA-256 hash chain)
- [x] Conscience Mode (value-based ethical guidance)
- [x] Conductor Mode (presentation coaching with speech recognition)

### Phase 2: Network Layer ✅
- [x] DNS server with consent checking
- [x] Docker deployment (Dockerfile + docker-compose)
- [x] Configuration templates
- [x] Pi-hole integration guide
- [ ] NextDNS partnership API
- [ ] Admin dashboard

### Phase 3: DIGIGAMI Browser (Future)
- [x] Specification document
- [ ] Gecko fork setup
- [ ] Core consent hooks
- [ ] Breathing Ring UI
- [ ] Native age verification API
- [ ] Biometric integration

## Privacy Guarantees

```
WHAT IS STORED:              WHAT IS NEVER STORED:
═══════════════              ════════════════════
✓ Consent state (computed)   ✗ Browsing history
✓ Age bracket (not date)     ✗ Exact birthdate
✓ Category blocks            ✗ Specific URLs visited
✓ Coherence level            ✗ Raw biometric data
```

## Contributing

See individual layer READMEs for contribution guidelines.

## License

- Extension: MIT
- Network Layer: MIT
- Browser: MPL 2.0 (matching Gecko)
- Documentation: CC BY 4.0
