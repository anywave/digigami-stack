/**
 * DIGIGAMI Guardian - Background Service Worker
 *
 * Handles:
 * - Web request interception
 * - Consent state management
 * - Cloud synchronization (SPIRAL protocol)
 * - Push notification coordination
 * - Cross-layer communication
 * - Mode coordination (Witness, Conscience, Conductor)
 */

// Import SPIRAL sync module
importScripts('core/spiral-sync.js', 'core/sync-manager.js');

// ============ SPIRAL INTEGRATION ============
let spiralSync = null;
let syncManager = null;

async function initializeSPIRAL() {
  try {
    // Initialize SPIRAL protocol sync
    if (typeof SPIRALSync !== 'undefined') {
      spiralSync = self.SPIRALSync;
      await spiralSync.initialize();

      // Listen for SPIRAL events
      spiralSync.onStateChange((event) => {
        handleSPIRALEvent(event);
      });

      console.log('[DIGIGAMI] SPIRAL sync initialized');
    }

    // Initialize sync manager
    if (typeof SyncManager !== 'undefined') {
      syncManager = self.DigiSyncManager;
      await syncManager.initialize();
      console.log('[DIGIGAMI] Sync manager initialized');
    }
  } catch (error) {
    console.error('[DIGIGAMI] SPIRAL initialization error:', error);
  }
}

function handleSPIRALEvent(event) {
  console.log('[DIGIGAMI] SPIRAL event:', event.type);

  switch (event.type) {
    case 'stateUpdated':
      // Update local state from SPIRAL
      if (event.data.restrictions) {
        state.restrictions = event.data.restrictions;
      }
      if (event.data.consentState) {
        state.consentState = event.data.consentState;
      }
      break;

    case 'restrictionsChanged':
      state.restrictions = event.data;
      // Re-evaluate any pending requests
      reevaluatePendingBlocks();
      break;

    case 'emergencyLock':
      triggerPanicMode();
      break;

    case 'bypassApproved':
      handleBypassApproval(event.data);
      break;
  }
}

function reevaluatePendingBlocks() {
  // Notify all tabs to re-check their current page
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'REEVALUATE_ACCESS'
      }).catch(() => {});
    });
  });
}

function handleBypassApproval(data) {
  // Store bypass in local storage for quick access
  chrome.storage.local.get(['activeBypasses'], (result) => {
    const bypasses = result.activeBypasses || {};
    bypasses[data.domain] = {
      expiresAt: Date.now() + (data.duration * 60000),
      approvedBy: data.guardianId
    };
    chrome.storage.local.set({ activeBypasses: bypasses });
  });
}

// ============ CONFIGURATION ============
const CONFIG = {
  cloudEndpoint: 'wss://api.digigami.ai/v1/sync',
  syncInterval: 30000, // 30 seconds
  categories: {
    gambling: { minAge: 21, severity: 'high' },
    alcohol: { minAge: 21, severity: 'medium' },
    tobacco: { minAge: 21, severity: 'medium' },
    adult: { minAge: 18, severity: 'high' },
    cannabis: { minAge: 21, severity: 'medium' },
    firearms: { minAge: 18, severity: 'medium' },
    dating: { minAge: 18, severity: 'low' },
    socialMedia: { minAge: 13, severity: 'low' },
  }
};

// ============ STATE ============
let state = {
  profile: null,
  consentState: null,
  restrictions: null,
  isConnected: false,
  lastSync: null,
  pendingBlocks: [],
  wsConnection: null,
};

// ============ CATEGORY DETECTION ============
// Domain-to-category mapping (simplified - real implementation would use ML classifier)
const DOMAIN_CATEGORIES = {
  // Gambling
  'casino.com': 'gambling',
  'pokerstars.com': 'gambling',
  'draftkings.com': 'gambling',
  'fanduel.com': 'gambling',
  'bet365.com': 'gambling',
  'bovada.lv': 'gambling',
  
  // Alcohol
  'wine.com': 'alcohol',
  'totalwine.com': 'alcohol',
  'drizly.com': 'alcohol',
  'reservebar.com': 'alcohol',
  
  // Adult
  // (not listing explicit domains, but pattern matching would catch them)
  
  // Social Media (for time limits)
  'tiktok.com': 'socialMedia',
  'instagram.com': 'socialMedia',
  'twitter.com': 'socialMedia',
  'x.com': 'socialMedia',
  'facebook.com': 'socialMedia',
  'snapchat.com': 'socialMedia',
};

// Pattern-based detection
const CATEGORY_PATTERNS = {
  gambling: [/casino/i, /poker/i, /slots/i, /betting/i, /wager/i, /jackpot/i],
  alcohol: [/wine/i, /liquor/i, /spirits/i, /brewery/i, /distillery/i],
  adult: [/xxx/i, /porn/i, /adult/i],
  cannabis: [/dispensary/i, /cannabis/i, /marijuana/i, /weed/i],
};

function detectCategory(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    
    // Direct domain match
    if (DOMAIN_CATEGORIES[domain]) {
      return DOMAIN_CATEGORIES[domain];
    }
    
    // Pattern matching
    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(url)) {
          return category;
        }
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// ============ CONSENT CHECK ============
function checkConsent(url, category) {
  if (!state.profile || !state.restrictions) {
    // No profile loaded - allow but log
    console.log('[DIGIGAMI] No profile loaded, allowing:', url);
    return { allowed: true, reason: 'no_profile' };
  }
  
  if (!category) {
    // No category detected - allow
    return { allowed: true, reason: 'uncategorized' };
  }
  
  const categoryConfig = CONFIG.categories[category];
  if (!categoryConfig) {
    return { allowed: true, reason: 'unknown_category' };
  }
  
  // Age check
  const userAge = state.restrictions.age;
  if (userAge < categoryConfig.minAge) {
    return {
      allowed: false,
      reason: 'age_restricted',
      category,
      requiredAge: categoryConfig.minAge,
      userAge,
      severity: categoryConfig.severity,
    };
  }
  
  // Explicit block list check
  if (state.restrictions.blocked_categories?.includes(category)) {
    return {
      allowed: false,
      reason: 'category_blocked',
      category,
      severity: categoryConfig.severity,
    };
  }
  
  // Time limits check (for social media, etc.)
  if (state.restrictions.time_limits?.[category]) {
    const timeSpent = getTimeSpentToday(category);
    const limit = state.restrictions.time_limits[category];
    if (timeSpent >= limit) {
      return {
        allowed: false,
        reason: 'time_limit_exceeded',
        category,
        timeSpent,
        limit,
      };
    }
  }
  
  // Coherence check (if biometric data available)
  if (state.consentState?.coherence < 0.3) {
    // Very low coherence - might want to pause
    return {
      allowed: true,
      warning: 'low_coherence',
      coherence: state.consentState.coherence,
    };
  }
  
  return { allowed: true, reason: 'passed_all_checks' };
}

// ============ TIME TRACKING ============
const timeTracking = {};

function getTimeSpentToday(category) {
  const today = new Date().toDateString();
  return timeTracking[today]?.[category] || 0;
}

function trackTime(category, minutes) {
  const today = new Date().toDateString();
  if (!timeTracking[today]) {
    timeTracking[today] = {};
  }
  timeTracking[today][category] = (timeTracking[today][category] || 0) + minutes;
  
  // Persist
  chrome.storage.local.set({ timeTracking });
}

// ============ WEB REQUEST INTERCEPTION ============
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only check main frame navigations
  if (details.frameId !== 0) return;
  
  const url = details.url;
  const category = detectCategory(url);
  const consentResult = checkConsent(url, category);
  
  if (!consentResult.allowed) {
    // Block this navigation
    console.log('[DIGIGAMI] Blocking:', url, consentResult);
    
    // Store the block info for the content script
    state.pendingBlocks.push({
      tabId: details.tabId,
      url,
      result: consentResult,
      timestamp: Date.now(),
    });
    
    // Send message to content script to show overlay
    try {
      await chrome.tabs.sendMessage(details.tabId, {
        type: 'SHOW_BLOCK_OVERLAY',
        data: consentResult,
        url,
      });
    } catch (e) {
      // Content script may not be ready yet
      console.log('[DIGIGAMI] Content script not ready, will retry');
    }
    
    // Redirect to block page
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL(`block.html?reason=${encodeURIComponent(JSON.stringify(consentResult))}`)
    });
    
    // Log to cloud
    syncBlockEvent(url, consentResult);
    
    // Send push notification if high severity
    if (consentResult.severity === 'high') {
      sendPushNotification(url, consentResult);
    }
  } else if (consentResult.warning) {
    // Allow but warn
    try {
      await chrome.tabs.sendMessage(details.tabId, {
        type: 'SHOW_WARNING',
        data: consentResult,
        url,
      });
    } catch (e) {
      console.log('[DIGIGAMI] Could not send warning');
    }
  }
});

// ============ CLOUD SYNCHRONIZATION ============
function initCloudSync() {
  // Initial sync
  syncWithCloud();
  
  // Periodic sync
  chrome.alarms.create('cloud-sync', { periodInMinutes: 0.5 });
  
  // WebSocket for real-time updates
  connectWebSocket();
}

async function syncWithCloud() {
  try {
    const token = await getAuthToken();
    if (!token) {
      console.log('[DIGIGAMI] No auth token, skipping sync');
      return;
    }
    
    const response = await fetch('https://api.digigami.ai/v1/profile/sync', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client: 'extension',
        version: chrome.runtime.getManifest().version,
        lastSync: state.lastSync,
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      state.profile = data.profile;
      state.consentState = data.consentState;
      state.restrictions = data.restrictions;
      state.lastSync = new Date().toISOString();
      
      // Persist to local storage
      chrome.storage.local.set({
        profile: state.profile,
        consentState: state.consentState,
        restrictions: state.restrictions,
        lastSync: state.lastSync,
      });
      
      console.log('[DIGIGAMI] Synced with cloud');
    }
  } catch (e) {
    console.error('[DIGIGAMI] Sync failed:', e);
  }
}

function connectWebSocket() {
  if (state.wsConnection) {
    state.wsConnection.close();
  }
  
  state.wsConnection = new WebSocket(CONFIG.cloudEndpoint);
  
  state.wsConnection.onopen = () => {
    console.log('[DIGIGAMI] WebSocket connected');
    state.isConnected = true;
    
    // Authenticate
    getAuthToken().then(token => {
      if (token) {
        state.wsConnection.send(JSON.stringify({
          type: 'AUTH',
          token,
        }));
      }
    });
  };
  
  state.wsConnection.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleCloudMessage(message);
    } catch (e) {
      console.error('[DIGIGAMI] Invalid message:', e);
    }
  };
  
  state.wsConnection.onclose = () => {
    console.log('[DIGIGAMI] WebSocket disconnected');
    state.isConnected = false;
    
    // Reconnect after delay
    setTimeout(connectWebSocket, 5000);
  };
  
  state.wsConnection.onerror = (error) => {
    console.error('[DIGIGAMI] WebSocket error:', error);
  };
}

function handleCloudMessage(message) {
  switch (message.type) {
    case 'CONSENT_UPDATE':
      // Guardian updated restrictions
      state.restrictions = message.restrictions;
      chrome.storage.local.set({ restrictions: state.restrictions });
      
      // Notify popup if open
      chrome.runtime.sendMessage({
        type: 'RESTRICTIONS_UPDATED',
        restrictions: state.restrictions,
      });
      break;
      
    case 'COHERENCE_UPDATE':
      // Biometric update from another device
      state.consentState = message.consentState;
      chrome.storage.local.set({ consentState: state.consentState });
      break;
      
    case 'EMERGENCY_FREEZE':
      // Guardian triggered emergency freeze
      handleEmergencyFreeze(message);
      break;
      
    case 'NETWORK_BLOCK_EVENT':
      // Network layer blocked something, show notification
      showNetworkBlockNotification(message);
      break;
  }
}

// ============ BLOCK EVENT LOGGING ============
async function syncBlockEvent(url, result) {
  try {
    const token = await getAuthToken();
    if (!token) return;
    
    await fetch('https://api.digigami.ai/v1/events/block', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: new URL(url).hostname, // Only send domain, not full URL for privacy
        category: result.category,
        reason: result.reason,
        timestamp: new Date().toISOString(),
        client: 'extension',
      }),
    });
  } catch (e) {
    console.error('[DIGIGAMI] Failed to sync block event:', e);
  }
}

// ============ PUSH NOTIFICATIONS ============
function sendPushNotification(url, result) {
  const domain = new URL(url).hostname;
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/digigami-128.png',
    title: '🛡️ DIGIGAMI Guardian',
    message: `Blocked access to ${domain} (${result.category})`,
    priority: 2,
  });
}

function showNetworkBlockNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/digigami-128.png',
    title: '🌐 Network Block',
    message: `GUARDIAN blocked ${message.domain} on your network`,
    priority: 1,
  });
}

// ============ EMERGENCY FREEZE ============
function handleEmergencyFreeze(message) {
  console.log('[DIGIGAMI] Emergency freeze activated');
  
  // Close all tabs matching blocked categories
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      const category = detectCategory(tab.url);
      if (category && CONFIG.categories[category]?.severity === 'high') {
        chrome.tabs.remove(tab.id);
      }
    });
  });
  
  // Show notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/digigami-128.png',
    title: '🚨 Emergency Freeze',
    message: message.reason || 'Guardian has activated emergency protections',
    priority: 2,
    requireInteraction: true,
  });
  
  // Update state
  state.restrictions = {
    ...state.restrictions,
    emergency_freeze: true,
    freeze_reason: message.reason,
    freeze_until: message.until,
  };
  
  chrome.storage.local.set({ restrictions: state.restrictions });
}

// ============ AUTH ============
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], (result) => {
      resolve(result.authToken || null);
    });
  });
}

// ============ MESSAGE HANDLING ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATE':
      sendResponse({
        profile: state.profile,
        consentState: state.consentState,
        restrictions: state.restrictions,
        isConnected: state.isConnected,
      });
      break;
      
    case 'CHECK_URL':
      const category = detectCategory(message.url);
      const result = checkConsent(message.url, category);
      sendResponse(result);
      break;
      
    case 'REQUEST_EXCEPTION':
      // User requesting exception to a block
      requestException(message.url, message.reason).then(sendResponse);
      return true; // Async response
      
    case 'TRACK_TIME':
      trackTime(message.category, message.minutes);
      sendResponse({ success: true });
      break;
      
    case 'PANIC_BUTTON':
      // User pressed panic button
      triggerPanicMode();
      sendResponse({ success: true });
      break;

    case 'GET_SPIRAL_STATE':
      // Return full SPIRAL state
      if (spiralSync) {
        sendResponse({
          state: spiralSync.getState(),
          connection: spiralSync.getConnectionStatus()
        });
      } else {
        sendResponse({ state: null, error: 'SPIRAL not initialized' });
      }
      break;

    case 'REQUEST_BYPASS':
      // Request bypass from guardian via SPIRAL
      if (syncManager) {
        syncManager.requestBypass(message.domain, message.reason, message.duration)
          .then(sendResponse);
        return true; // Async response
      } else {
        sendResponse({ success: false, error: 'Sync manager not available' });
      }
      break;

    case 'REPORT_ACCESS':
      // Report access attempt to SPIRAL
      if (syncManager) {
        syncManager.reportAccess(message.domain, message.category, message.decision);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      break;

    case 'GET_SYSTEM_STATE':
      // Return complete system state including modes
      if (syncManager) {
        sendResponse(syncManager.getSystemState());
      } else {
        sendResponse({
          spiral: spiralSync?.getState() || null,
          modes: {},
          error: 'Sync manager not initialized'
        });
      }
      break;

    case 'ACTIVATE_WITNESS_MODE':
      // Activate witness mode (delegated to content script)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'ACTIVATE_WITNESS',
            options: message.options
          });
        }
      });
      sendResponse({ success: true });
      break;
  }
});

async function requestException(url, reason) {
  try {
    const token = await getAuthToken();
    if (!token) return { success: false, error: 'Not authenticated' };
    
    const response = await fetch('https://api.digigami.ai/v1/exceptions/request', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: new URL(url).hostname,
        reason,
        timestamp: new Date().toISOString(),
      }),
    });
    
    if (response.ok) {
      return { success: true, message: 'Exception request sent to guardian' };
    } else {
      return { success: false, error: 'Request failed' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function triggerPanicMode() {
  // Close all potentially sensitive tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      const category = detectCategory(tab.url);
      if (category) {
        chrome.tabs.remove(tab.id);
      }
    });
  });
  
  // Notify cloud
  if (state.wsConnection?.readyState === WebSocket.OPEN) {
    state.wsConnection.send(JSON.stringify({
      type: 'PANIC_TRIGGERED',
      timestamp: new Date().toISOString(),
    }));
  }
  
  // Show clean page
  chrome.tabs.create({
    url: chrome.runtime.getURL('panic.html'),
  });
}

// ============ ALARMS ============
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cloud-sync') {
    syncWithCloud();
  }
});

// ============ COMMANDS ============
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'toggle-digigami':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_DIGIGAMI' });
        }
      });
      break;
      
    case 'panic-button':
      triggerPanicMode();
      break;
  }
});

// ============ INITIALIZATION ============
chrome.runtime.onInstalled.addListener(() => {
  console.log('[DIGIGAMI] Extension installed');

  // Load persisted state
  chrome.storage.local.get(['profile', 'consentState', 'restrictions', 'lastSync'], (result) => {
    if (result.profile) state.profile = result.profile;
    if (result.consentState) state.consentState = result.consentState;
    if (result.restrictions) state.restrictions = result.restrictions;
    if (result.lastSync) state.lastSync = result.lastSync;
  });

  // Initialize SPIRAL protocol
  initializeSPIRAL();
});

// Also initialize on service worker startup (for browser restart)
chrome.runtime.onStartup.addListener(() => {
  console.log('[DIGIGAMI] Browser started, reinitializing...');
  initializeSPIRAL();
});

// Start cloud sync (legacy - SPIRAL handles this now)
initCloudSync();

// Initialize SPIRAL on script load
initializeSPIRAL();

console.log('[DIGIGAMI] Background service worker started');
