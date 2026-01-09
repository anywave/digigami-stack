# DIGIGAMI Deployment Architecture
## Complete Multi-Layer Consent Infrastructure

### Executive Summary

DIGIGAMI operates as a **defense-in-depth consent layer** across three deployment tiers:
1. **Browser Extension** - Lightweight, user-installable, cross-browser
2. **Network Layer** - Router/DNS level protection for homes and enterprises  
3. **DIGIGAMI Browser** - Full sovereign browser (Firefox-fork positioning)

All three layers coordinate through a **unified consent state** synchronized via the SPIRAL protocol.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        DIGIGAMI CONSENT INFRASTRUCTURE                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              ┌─────────────────────┐                            │
│                              │   DIGIGAMI CLOUD    │                            │
│                              │   ═══════════════   │                            │
│                              │                     │                            │
│                              │  • Profile Sync     │                            │
│                              │  • Consent State    │                            │
│                              │  • Hedera Anchor    │                            │
│                              │  • Fragment Mesh    │                            │
│                              │                     │                            │
│                              └──────────┬──────────┘                            │
│                                         │                                        │
│                    ┌────────────────────┼────────────────────┐                  │
│                    │                    │                    │                  │
│                    ▼                    ▼                    ▼                  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │  BROWSER EXTENSION  │  │   NETWORK LAYER     │  │  DIGIGAMI BROWSER   │     │
│  │  ═════════════════  │  │   ═════════════     │  │  ════════════════   │     │
│  │                     │  │                     │  │                     │     │
│  │  Chrome / Firefox   │  │  Router DNS Proxy   │  │  Sovereign Browser  │     │
│  │  Edge / Safari      │  │  Pi-hole / NextDNS  │  │  (Firefox Fork)     │     │
│  │                     │  │  Enterprise Proxy   │  │                     │     │
│  │  ┌───────────────┐  │  │  ┌───────────────┐  │  │  ┌───────────────┐  │     │
│  │  │ Content Script│  │  │  │ DNS Resolver  │  │  │  │ Native ACSP   │  │     │
│  │  │ Popup UI      │  │  │  │ Block Lists   │  │  │  │ Built-in Twin │  │     │
│  │  │ Background SW │  │  │  │ Profile Sync  │  │  │  │ Biometric API │  │     │
│  │  │ WebSocket     │  │  │  │ Push Notify   │  │  │  │ Fragment Mesh │  │     │
│  │  └───────────────┘  │  │  └───────────────┘  │  │  └───────────────┘  │     │
│  │                     │  │                     │  │                     │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │
│           │                         │                         │                 │
│           │                         │                         │                 │
│           └─────────────────────────┼─────────────────────────┘                 │
│                                     │                                           │
│                                     ▼                                           │
│                    ┌─────────────────────────────────┐                          │
│                    │      UNIFIED CONSENT STATE      │                          │
│                    │      ═══════════════════════    │                          │
│                    │                                 │                          │
│                    │  • Same Digigami across all     │                          │
│                    │  • Consent follows the user     │                          │
│                    │  • State computed, not stored   │                          │
│                    │  • Biometric anchored           │                          │
│                    │                                 │                          │
│                    └─────────────────────────────────┘                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Coordination Protocol

### Scenario: Minor attempts age-restricted site

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Request Initiated                                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  User types: casino.com                                                          │
│                                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│  │  User    │ ──► │ Browser  │ ──► │  OS DNS  │ ──► │  Router  │               │
│  │  Input   │     │  (any)   │     │ Resolver │     │   DNS    │               │
│  └──────────┘     └──────────┘     └──────────┘     └──────────┘               │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  STEP 2: Network Layer Intercept (FIRST GATE)                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │           NETWORK GUARDIAN              │                                    │
│  │                                         │                                    │
│  │  DNS Query: casino.com                  │                                    │
│  │  ┌─────────────────────────────────┐   │                                    │
│  │  │ Check against block lists       │   │                                    │
│  │  │ • Global: gambling category     │   │                                    │
│  │  │ • Profile: user age = 16        │   │                                    │
│  │  │ • Policy: gambling requires 21  │   │                                    │
│  │  └─────────────────────────────────┘   │                                    │
│  │                                         │                                    │
│  │  RESULT: BLOCK at DNS level            │                                    │
│  │  Return: 0.0.0.0 (or redirect page)    │                                    │
│  │                                         │                                    │
│  │  ACTION: Push notification to devices  │                                    │
│  │                                         │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
│  Site NEVER loads. User sees GUARDIAN block page.                               │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  STEP 3: If Network Layer Bypassed (e.g., cellular)                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  User switches to phone cellular data (bypasses home router)                    │
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │         BROWSER EXTENSION               │                                    │
│  │                                         │                                    │
│  │  webRequest.onBeforeRequest triggered   │                                    │
│  │  ┌─────────────────────────────────┐   │                                    │
│  │  │ URL: https://casino.com         │   │                                    │
│  │  │ Check local consent state       │   │                                    │
│  │  │ • Profile: user age = 16        │   │                                    │
│  │  │ • Category: gambling            │   │                                    │
│  │  └─────────────────────────────────┘   │                                    │
│  │                                         │                                    │
│  │  RESULT: BLOCK at extension level      │                                    │
│  │  Inject Digigami overlay               │                                    │
│  │                                         │                                    │
│  │  ACTION: Sync event to cloud           │                                    │
│  │          Notify network layer          │                                    │
│  │                                         │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  STEP 4: If Extension Disabled/Uninstalled                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  User disables extension, tries again on home WiFi                              │
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │         NETWORK LAYER (again)           │                                    │
│  │                                         │                                    │
│  │  Still blocked at router level!         │                                    │
│  │                                         │                                    │
│  │  PLUS: Cloud detects extension removed  │                                    │
│  │        Sends alert to guardian          │                                    │
│  │                                         │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  STEP 5: If Using DIGIGAMI Browser                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Native integration - no bypass possible without exiting browser                │
│                                                                                  │
│  ┌─────────────────────────────────────────┐                                    │
│  │         DIGIGAMI BROWSER                │                                    │
│  │                                         │                                    │
│  │  Consent layer is PART OF the browser   │                                    │
│  │  ┌─────────────────────────────────┐   │                                    │
│  │  │ URL bar → Consent check         │   │                                    │
│  │  │ Navigation → Consent check      │   │                                    │
│  │  │ All requests → Consent check    │   │                                    │
│  │  └─────────────────────────────────┘   │                                    │
│  │                                         │                                    │
│  │  Cannot be disabled without closing    │                                    │
│  │  the browser entirely                  │                                    │
│  │                                         │                                    │
│  └─────────────────────────────────────────┘                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Recommendations by Use Case

| Use Case | Primary Layer | Secondary Layer | Notes |
|----------|--------------|-----------------|-------|
| Adult self-regulation | Extension | - | User wants help, won't bypass |
| Family home (kids) | Network | Extension | Defense in depth |
| Enterprise office | Network + Device | Extension | IT-managed |
| Privacy-focused user | DIGIGAMI Browser | Network | Full stack |
| School/Library | Network | Device Agent | Locked down |
| Shared device (cafe) | Network | - | Can't install per-user |

---

## State Synchronization

All layers share consent state via SPIRAL protocol:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CONSENT STATE SYNC                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────────┐                              ┌───────────────┐               │
│  │   Extension   │ ◄──── WebSocket ────────────►│  DIGIGAMI     │               │
│  │               │                              │  Cloud        │               │
│  └───────────────┘                              └───────┬───────┘               │
│                                                         │                        │
│  ┌───────────────┐                                      │                        │
│  │   Network     │ ◄──── API Polling ──────────────────►│                        │
│  │   Layer       │       (every 30s)                    │                        │
│  └───────────────┘                                      │                        │
│                                                         │                        │
│  ┌───────────────┐                                      │                        │
│  │   DIGIGAMI    │ ◄──── Native Socket ────────────────►│                        │
│  │   Browser     │       (persistent)                   │                        │
│  └───────────────┘                                      │                        │
│                                                                                  │
│  SYNC PAYLOAD:                                                                   │
│  ═════════════                                                                   │
│  {                                                                               │
│    "user_id": "did:hedera:0.0.123456",                                          │
│    "consent_state": {                                                            │
│      "theta": 2,           // WITNESS sector                                     │
│      "phi": "GROUNDED",    // Stability state                                    │
│      "harmonic": 1,        // Depth level                                        │
│      "coherence": 0.78     // Current coherence                                  │
│    },                                                                            │
│    "restrictions": {                                                             │
│      "age_verified": false,                                                      │
│      "age": 16,                                                                  │
│      "blocked_categories": ["gambling", "alcohol", "adult"],                     │
│      "time_limits": { "social_media": 120 }                                      │
│    },                                                                            │
│    "guardian_overrides": {                                                       │
│      "enabled": true,                                                            │
│      "guardian_did": "did:hedera:0.0.789012"                                    │
│    },                                                                            │
│    "last_sync": "2025-01-09T04:30:00Z",                                         │
│    "signature": "0x..."   // Hedera-anchored                                    │
│  }                                                                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Privacy Guarantees

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PRIVACY BY DESIGN                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  WHAT IS STORED:                          WHAT IS NEVER STORED:                 │
│  ════════════════                         ══════════════════════                │
│                                                                                  │
│  ✓ Consent state (computed)               ✗ Browsing history                    │
│  ✓ Age bracket (not birthdate)            ✗ Exact birthdate                     │
│  ✓ Category blocks (not URLs)             ✗ Specific URLs visited               │
│  ✓ Coherence level (not biometrics)       ✗ Raw biometric data                  │
│  ✓ Guardian relationship (DID only)       ✗ Personal contact info               │
│                                                                                  │
│  ZERO-KNOWLEDGE AGE VERIFICATION:                                               │
│  ════════════════════════════════                                               │
│                                                                                  │
│  Site asks: "Is user 21+?"                                                      │
│  DIGIGAMI responds: "YES" or "NO"                                               │
│  Site NEVER learns: actual age, name, identity                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```
