/**
 * DIGIGAMI Guardian - Sync Manager
 * Coordinates state between SPIRAL protocol, modes, and extension components
 */

class SyncManager {
  constructor() {
    this.spiral = null;
    this.modes = {
      witness: null,
      conscience: null,
      conductor: null
    };
    this.isInitialized = false;
    this.syncQueue = [];
    this.isSyncing = false;
  }

  /**
   * Initialize the sync manager
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    console.log('[SyncManager] Initializing...');

    // Initialize SPIRAL sync
    if (typeof SPIRALSync !== 'undefined') {
      this.spiral = window.SPIRALSync || self.SPIRALSync;
      await this.spiral.initialize();
    }

    // Register for SPIRAL events
    if (this.spiral) {
      this.spiral.onStateChange((event) => {
        this.handleSpiralEvent(event);
      });
    }

    // Initialize modes if available
    this.initializeModes();

    // Start periodic sync
    this.startPeriodicSync();

    this.isInitialized = true;
    console.log('[SyncManager] Initialized');
  }

  /**
   * Initialize available modes
   */
  initializeModes() {
    // Witness Mode
    if (typeof DigiWitness !== 'undefined') {
      this.modes.witness = window.DigiWitness;
      console.log('[SyncManager] Witness mode registered');
    }

    // Conscience Mode
    if (typeof DigiConscience !== 'undefined') {
      this.modes.conscience = window.DigiConscience;
      this.modes.conscience.initialize();
      console.log('[SyncManager] Conscience mode registered');
    }

    // Conductor Mode
    if (typeof DigiConductor !== 'undefined') {
      this.modes.conductor = window.DigiConductor;
      console.log('[SyncManager] Conductor mode registered');
    }
  }

  /**
   * Handle SPIRAL protocol events
   */
  handleSpiralEvent(event) {
    console.log('[SyncManager] SPIRAL event:', event.type);

    switch (event.type) {
      case 'stateUpdated':
        this.syncModeStates(event.data);
        break;

      case 'restrictionsChanged':
        this.applyRestrictions(event.data);
        break;

      case 'lowCoherence':
        this.handleLowCoherence(event.data);
        break;

      case 'emergencyLock':
        this.handleEmergencyLock(event.data);
        break;

      case 'bypassApproved':
        this.handleBypassApproved(event.data);
        break;
    }

    // Dispatch to extension components
    this.broadcastToExtension(event);
  }

  /**
   * Sync mode states with SPIRAL state
   */
  syncModeStates(spiralState) {
    // Update conscience mode with coherence state
    if (this.modes.conscience && spiralState.consentState) {
      const coherenceLevel = spiralState.consentState.coherence;

      if (coherenceLevel < 0.4) {
        // Low coherence - activate conscience prompts
        this.modes.conscience.activate();
      }
    }

    // Sync restrictions to storage for all components
    chrome.storage.sync.set({
      digiRestrictions: spiralState.restrictions,
      digiCoherence: spiralState.consentState?.coherence
    });
  }

  /**
   * Apply restriction changes
   */
  applyRestrictions(restrictions) {
    // Update storage
    chrome.storage.sync.set({
      digiRestrictions: restrictions
    });

    // Notify open tabs to re-check
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'RESTRICTIONS_UPDATED',
          restrictions
        }).catch(() => {
          // Tab might not have content script
        });
      });
    });
  }

  /**
   * Handle low coherence state
   */
  handleLowCoherence(data) {
    console.log('[SyncManager] Low coherence detected:', data.current);

    // Activate conscience mode for guidance
    if (this.modes.conscience) {
      this.modes.conscience.activate();
    }

    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'DIGIGAMI Guardian',
      message: 'Take a moment to center yourself. Some restrictions are in effect.',
      priority: 2
    });

    // Apply temporary restrictions
    chrome.storage.local.set({
      lowCoherenceMode: {
        active: true,
        since: Date.now(),
        level: data.current
      }
    });
  }

  /**
   * Handle emergency lock
   */
  handleEmergencyLock(data) {
    console.log('[SyncManager] Emergency lock activated');

    // Deactivate all active modes
    if (this.modes.witness && this.modes.witness.isActive) {
      this.modes.witness.deactivate();
    }
    if (this.modes.conductor && this.modes.conductor.isActive) {
      this.modes.conductor.stop();
    }

    // Show emergency screen on all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.update(tab.id, {
          url: chrome.runtime.getURL('panic.html')
        });
      });
    });
  }

  /**
   * Handle bypass approval
   */
  handleBypassApproved(data) {
    // Notify any waiting content scripts
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        try {
          const url = new URL(tab.url);
          if (url.hostname === data.domain || url.hostname.endsWith('.' + data.domain)) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'BYPASS_APPROVED',
              domain: data.domain,
              duration: data.duration
            }).catch(() => {});
          }
        } catch (e) {}
      });
    });
  }

  /**
   * Broadcast event to extension components
   */
  broadcastToExtension(event) {
    // Send to popup if open
    chrome.runtime.sendMessage({
      type: 'SPIRAL_EVENT',
      event
    }).catch(() => {
      // Popup might not be open
    });
  }

  /**
   * Queue an event for sync
   */
  queueSync(eventType, data) {
    this.syncQueue.push({
      type: eventType,
      data,
      timestamp: Date.now()
    });

    this.processSyncQueue();
  }

  /**
   * Process the sync queue
   */
  async processSyncQueue() {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;

    while (this.syncQueue.length > 0) {
      const event = this.syncQueue.shift();

      try {
        if (this.spiral) {
          this.spiral.pushStateChange(event.type, event.data);
        }
      } catch (error) {
        console.error('[SyncManager] Sync error:', error);
        // Re-queue failed event
        this.syncQueue.unshift(event);
        break;
      }
    }

    this.isSyncing = false;
  }

  /**
   * Start periodic sync
   */
  startPeriodicSync() {
    // Sync every 5 minutes
    setInterval(() => {
      this.performPeriodicSync();
    }, 300000);
  }

  /**
   * Perform periodic sync
   */
  async performPeriodicSync() {
    if (!this.spiral || !this.spiral.isConnected) {
      return;
    }

    // Request full sync from cloud
    this.spiral.requestFullSync();

    // Sync mode states
    this.syncModesToCloud();
  }

  /**
   * Sync mode states to cloud
   */
  syncModesToCloud() {
    const modeStates = {
      witness: this.modes.witness?.getStatus() || null,
      conscience: this.modes.conscience?.getStatus() || null,
      conductor: this.modes.conductor?.getMetrics() || null
    };

    if (this.spiral) {
      this.spiral.pushStateChange('MODE_STATES', modeStates);
    }
  }

  /**
   * Report an access event
   */
  reportAccess(domain, category, decision) {
    if (this.spiral) {
      this.spiral.reportAccessAttempt(domain, category, decision);
    }

    // Also log locally
    this.logAccessEvent(domain, category, decision);
  }

  /**
   * Log access event locally
   */
  async logAccessEvent(domain, category, decision) {
    chrome.storage.local.get(['accessLog'], (result) => {
      const log = result.accessLog || [];

      log.push({
        domain,
        category,
        decision,
        timestamp: Date.now()
      });

      // Keep last 1000 events
      if (log.length > 1000) {
        log.shift();
      }

      chrome.storage.local.set({ accessLog: log });
    });
  }

  /**
   * Request bypass from guardian
   */
  async requestBypass(domain, reason, duration) {
    if (!this.spiral) {
      return { success: false, error: 'Not connected to cloud' };
    }

    try {
      const result = await this.spiral.requestBypass(domain, reason, duration);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current system state
   */
  getSystemState() {
    return {
      spiral: this.spiral?.getState() || null,
      connection: this.spiral?.getConnectionStatus() || null,
      modes: {
        witness: this.modes.witness?.getStatus() || null,
        conscience: this.modes.conscience?.getStatus() || null,
        conductor: this.modes.conductor?.getMetrics() || null
      },
      syncQueueLength: this.syncQueue.length
    };
  }

  /**
   * Check if access should be allowed
   */
  checkAccess(category) {
    if (!this.spiral) {
      // No SPIRAL connection - use local restrictions
      return this.checkLocalRestrictions(category);
    }

    return this.spiral.isAccessAllowed(category);
  }

  /**
   * Check local restrictions when offline
   */
  async checkLocalRestrictions(category) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['digiRestrictions'], (result) => {
        const restrictions = result.digiRestrictions || {};
        const blockedCategories = restrictions.blockedCategories || [];

        if (blockedCategories.includes(category)) {
          resolve({
            allowed: false,
            reason: 'category_blocked',
            category
          });
        } else {
          resolve({ allowed: true });
        }
      });
    });
  }
}

// Export singleton
if (typeof window !== 'undefined') {
  window.DigiSyncManager = new SyncManager();
}

if (typeof self !== 'undefined' && self.ServiceWorkerGlobalScope) {
  self.DigiSyncManager = new SyncManager();
}
