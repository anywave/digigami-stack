/**
 * DIGIGAMI Guardian - SPIRAL Protocol State Synchronization
 * Unified consent state across all layers (extension, network, browser)
 */

class SPIRALSync {
  constructor() {
    this.websocket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.heartbeatInterval = null;
    this.stateListeners = [];

    // Current consent state (SPIRAL model)
    this.state = {
      userId: null,
      consentState: {
        theta: 1,           // WITNESS sector (1-5)
        phi: 'GROUNDED',    // Stability state
        harmonic: 1,        // Depth level
        coherence: 1.0      // Current coherence (0-1)
      },
      restrictions: {
        ageVerified: false,
        age: null,
        blockedCategories: [],
        timeLimits: {}
      },
      guardianOverrides: {
        enabled: false,
        guardianDid: null
      },
      lastSync: null,
      signature: null
    };

    // Cloud API configuration
    this.cloudEndpoint = 'wss://api.digigami.ai/v1/spiral';
    this.apiEndpoint = 'https://api.digigami.ai/v1';
  }

  /**
   * Initialize SPIRAL sync
   */
  async initialize() {
    // Load cached state from storage
    await this.loadCachedState();

    // Establish WebSocket connection
    this.connect();

    // Listen for state change events
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.digiProfile) {
        this.handleLocalStateChange(changes.digiProfile.newValue);
      }
    });

    console.log('[SPIRAL] Initialized');
    return true;
  }

  /**
   * Connect to DIGIGAMI cloud via WebSocket
   */
  connect() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      // Get auth token first
      chrome.storage.sync.get(['digiAuthToken'], (result) => {
        if (!result.digiAuthToken) {
          console.log('[SPIRAL] No auth token, skipping connection');
          this.scheduleReconnect();
          return;
        }

        this.websocket = new WebSocket(
          `${this.cloudEndpoint}?token=${result.digiAuthToken}`
        );

        this.websocket.onopen = () => this.handleOpen();
        this.websocket.onmessage = (event) => this.handleMessage(event);
        this.websocket.onclose = (event) => this.handleClose(event);
        this.websocket.onerror = (error) => this.handleError(error);
      });
    } catch (error) {
      console.error('[SPIRAL] Connection error:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open
   */
  handleOpen() {
    console.log('[SPIRAL] Connected to cloud');
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;

    // Start heartbeat
    this.startHeartbeat();

    // Request full state sync
    this.requestFullSync();

    // Dispatch connection event
    this.dispatchEvent('connected');
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'STATE_UPDATE':
          this.handleStateUpdate(message.payload);
          break;

        case 'RESTRICTION_CHANGE':
          this.handleRestrictionChange(message.payload);
          break;

        case 'GUARDIAN_ACTION':
          this.handleGuardianAction(message.payload);
          break;

        case 'COHERENCE_UPDATE':
          this.handleCoherenceUpdate(message.payload);
          break;

        case 'PONG':
          // Heartbeat response
          break;

        case 'ERROR':
          console.error('[SPIRAL] Server error:', message.payload);
          break;

        default:
          console.log('[SPIRAL] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[SPIRAL] Message parse error:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  handleClose(event) {
    console.log('[SPIRAL] Connection closed:', event.code);
    this.isConnected = false;
    this.stopHeartbeat();

    if (event.code !== 1000) {
      // Abnormal close, attempt reconnect
      this.scheduleReconnect();
    }

    this.dispatchEvent('disconnected');
  }

  /**
   * Handle WebSocket error
   */
  handleError(error) {
    console.error('[SPIRAL] WebSocket error:', error);
    this.dispatchEvent('error', { error });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[SPIRAL] Max reconnection attempts reached');
      this.dispatchEvent('maxReconnectReached');
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    console.log(`[SPIRAL] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.send({ type: 'PING', timestamp: Date.now() });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send message via WebSocket
   */
  send(message) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Request full state sync from cloud
   */
  requestFullSync() {
    this.send({
      type: 'REQUEST_FULL_SYNC',
      timestamp: Date.now()
    });
  }

  /**
   * Handle full state update from cloud
   */
  handleStateUpdate(payload) {
    console.log('[SPIRAL] State update received');

    // Validate signature (simplified - real implementation uses Hedera)
    if (payload.signature) {
      // In production: verify against Hedera ledger
      console.log('[SPIRAL] Signature present, assumed valid');
    }

    // Update local state
    this.state = {
      userId: payload.user_id,
      consentState: {
        theta: payload.consent_state?.theta || 1,
        phi: payload.consent_state?.phi || 'GROUNDED',
        harmonic: payload.consent_state?.harmonic || 1,
        coherence: payload.consent_state?.coherence || 1.0
      },
      restrictions: {
        ageVerified: payload.restrictions?.age_verified || false,
        age: payload.restrictions?.age,
        blockedCategories: payload.restrictions?.blocked_categories || [],
        timeLimits: payload.restrictions?.time_limits || {}
      },
      guardianOverrides: {
        enabled: payload.guardian_overrides?.enabled || false,
        guardianDid: payload.guardian_overrides?.guardian_did
      },
      lastSync: new Date().toISOString(),
      signature: payload.signature
    };

    // Cache to storage
    this.cacheState();

    // Notify listeners
    this.dispatchEvent('stateUpdated', this.state);
  }

  /**
   * Handle restriction change from guardian
   */
  handleRestrictionChange(payload) {
    console.log('[SPIRAL] Restriction change:', payload);

    if (payload.blockedCategories) {
      this.state.restrictions.blockedCategories = payload.blockedCategories;
    }

    if (payload.timeLimits) {
      this.state.restrictions.timeLimits = {
        ...this.state.restrictions.timeLimits,
        ...payload.timeLimits
      };
    }

    this.state.lastSync = new Date().toISOString();
    this.cacheState();

    // Notify listeners
    this.dispatchEvent('restrictionsChanged', this.state.restrictions);

    // Show notification to user if appropriate
    if (payload.notifyUser) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'DIGIGAMI Guardian',
        message: payload.message || 'Your restrictions have been updated.',
        priority: 1
      });
    }
  }

  /**
   * Handle guardian action (bypass approval, etc.)
   */
  handleGuardianAction(payload) {
    console.log('[SPIRAL] Guardian action:', payload.action);

    switch (payload.action) {
      case 'BYPASS_APPROVED':
        this.handleBypassApproved(payload);
        break;

      case 'BYPASS_DENIED':
        this.handleBypassDenied(payload);
        break;

      case 'EMERGENCY_LOCK':
        this.handleEmergencyLock(payload);
        break;

      case 'TIME_EXTENSION':
        this.handleTimeExtension(payload);
        break;
    }
  }

  /**
   * Handle bypass approval from guardian
   */
  handleBypassApproved(payload) {
    const { domain, duration, bypassToken } = payload;

    // Store temporary bypass
    chrome.storage.local.get(['tempBypasses'], (result) => {
      const bypasses = result.tempBypasses || {};
      bypasses[domain] = {
        token: bypassToken,
        expiresAt: Date.now() + (duration * 60000),
        approvedBy: payload.guardianId
      };

      chrome.storage.local.set({ tempBypasses: bypasses });
    });

    // Notify user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Access Approved',
      message: `${domain} has been temporarily approved for ${duration} minutes.`,
      priority: 2
    });

    this.dispatchEvent('bypassApproved', payload);
  }

  /**
   * Handle bypass denial from guardian
   */
  handleBypassDenied(payload) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Access Denied',
      message: payload.reason || 'Your access request was not approved.',
      priority: 1
    });

    this.dispatchEvent('bypassDenied', payload);
  }

  /**
   * Handle emergency lock from guardian
   */
  handleEmergencyLock(payload) {
    console.log('[SPIRAL] Emergency lock activated');

    // Store emergency lock state
    chrome.storage.local.set({
      emergencyLock: {
        active: true,
        activatedAt: Date.now(),
        activatedBy: payload.guardianId,
        reason: payload.reason
      }
    });

    // Close all non-essential tabs
    if (payload.closeTabs) {
      chrome.tabs.query({}, (tabs) => {
        const safeDomains = ['digigami.ai', 'google.com', 'bing.com'];
        tabs.forEach(tab => {
          try {
            const url = new URL(tab.url);
            if (!safeDomains.some(d => url.hostname.includes(d))) {
              chrome.tabs.remove(tab.id);
            }
          } catch (e) {
            // Invalid URL, close it
            chrome.tabs.remove(tab.id);
          }
        });
      });
    }

    this.dispatchEvent('emergencyLock', payload);
  }

  /**
   * Handle time extension from guardian
   */
  handleTimeExtension(payload) {
    const { category, additionalMinutes } = payload;

    // Update time limits
    const currentLimit = this.state.restrictions.timeLimits[category] || 0;
    this.state.restrictions.timeLimits[category] = currentLimit + additionalMinutes;

    this.cacheState();

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Time Extended',
      message: `You have ${additionalMinutes} more minutes for ${category}.`,
      priority: 1
    });

    this.dispatchEvent('timeExtended', payload);
  }

  /**
   * Handle coherence update from biometric or behavioral analysis
   */
  handleCoherenceUpdate(payload) {
    const previousCoherence = this.state.consentState.coherence;
    this.state.consentState.coherence = payload.coherence;

    // Check if coherence dropped below threshold
    if (payload.coherence < 0.4 && previousCoherence >= 0.4) {
      console.log('[SPIRAL] Low coherence detected, restricting access');
      this.dispatchEvent('lowCoherence', {
        current: payload.coherence,
        previous: previousCoherence
      });
    }

    this.cacheState();
    this.dispatchEvent('coherenceUpdated', { coherence: payload.coherence });
  }

  /**
   * Push local state change to cloud
   */
  pushStateChange(changeType, data) {
    this.send({
      type: 'STATE_CHANGE',
      changeType,
      payload: data,
      timestamp: Date.now()
    });
  }

  /**
   * Report access attempt to cloud
   */
  reportAccessAttempt(domain, category, decision) {
    this.send({
      type: 'ACCESS_ATTEMPT',
      payload: {
        domain,
        category,
        decision, // 'allowed', 'blocked', 'bypassed'
        timestamp: Date.now()
      }
    });
  }

  /**
   * Request bypass approval from guardian
   */
  requestBypass(domain, reason, duration) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();

      // Set up listener for response
      const handler = (event) => {
        if (event.detail.requestId === requestId) {
          window.removeEventListener('spiral-bypass-response', handler);
          resolve(event.detail);
        }
      };
      window.addEventListener('spiral-bypass-response', handler);

      // Timeout after 5 minutes
      setTimeout(() => {
        window.removeEventListener('spiral-bypass-response', handler);
        reject(new Error('Bypass request timed out'));
      }, 300000);

      // Send request
      this.send({
        type: 'BYPASS_REQUEST',
        payload: {
          requestId,
          domain,
          reason,
          duration,
          timestamp: Date.now()
        }
      });
    });
  }

  /**
   * Handle local state changes
   */
  handleLocalStateChange(newProfile) {
    // Sync relevant changes to cloud
    if (newProfile.age !== this.state.restrictions.age) {
      this.pushStateChange('AGE_UPDATE', { age: newProfile.age });
    }

    // Update local state
    this.state.restrictions.age = newProfile.age;
    this.state.restrictions.ageVerified = newProfile.ageVerified || false;
  }

  /**
   * Cache state to local storage
   */
  cacheState() {
    chrome.storage.local.set({
      spiralState: this.state,
      spiralCachedAt: Date.now()
    });
  }

  /**
   * Load cached state from storage
   */
  async loadCachedState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['spiralState', 'spiralCachedAt'], (result) => {
        if (result.spiralState) {
          this.state = result.spiralState;
          console.log('[SPIRAL] Loaded cached state from', result.spiralCachedAt);
        }
        resolve();
      });
    });
  }

  /**
   * Get current consent state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Check if access is allowed for a category
   */
  isAccessAllowed(category) {
    // Check blocked categories
    if (this.state.restrictions.blockedCategories.includes(category)) {
      return {
        allowed: false,
        reason: 'category_blocked',
        category
      };
    }

    // Check coherence threshold
    if (this.state.consentState.coherence < 0.4) {
      return {
        allowed: false,
        reason: 'low_coherence',
        coherence: this.state.consentState.coherence
      };
    }

    // Check time limits
    const timeLimit = this.state.restrictions.timeLimits[category];
    if (timeLimit !== undefined) {
      // Time limit check would need usage tracking
      // For now, assume allowed if limit > 0
      if (timeLimit <= 0) {
        return {
          allowed: false,
          reason: 'time_limit_exceeded',
          category
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Register state change listener
   */
  onStateChange(callback) {
    this.stateListeners.push(callback);
  }

  /**
   * Dispatch event to listeners
   */
  dispatchEvent(eventType, data = {}) {
    // Notify registered listeners
    this.stateListeners.forEach(listener => {
      try {
        listener({ type: eventType, data });
      } catch (e) {
        console.error('[SPIRAL] Listener error:', e);
      }
    });

    // Also dispatch as custom event for cross-script communication
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`spiral-${eventType}`, {
        detail: data
      }));
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    this.stopHeartbeat();

    if (this.websocket) {
      this.websocket.close(1000, 'Manual disconnect');
      this.websocket = null;
    }

    this.isConnected = false;
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastSync: this.state.lastSync
    };
  }
}

// Export singleton
if (typeof window !== 'undefined') {
  window.SPIRALSync = new SPIRALSync();
}

// For service worker context
if (typeof self !== 'undefined' && self.ServiceWorkerGlobalScope) {
  self.SPIRALSync = new SPIRALSync();
}
