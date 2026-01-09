/**
 * DIGIGAMI Guardian - Popup Script
 */

// ============ DOM ELEMENTS ============
const elements = {
  // Screens
  loginScreen: document.getElementById('login-screen'),
  mainContent: document.getElementById('main-content'),
  
  // Header
  avatar: document.getElementById('avatar'),
  statusDot: document.getElementById('status-dot'),
  userName: document.getElementById('user-name'),
  connectionStatus: document.getElementById('connection-status'),
  
  // Consent state
  thetaValue: document.getElementById('theta-value'),
  phiValue: document.getElementById('phi-value'),
  harmonicValue: document.getElementById('harmonic-value'),
  coherenceValue: document.getElementById('coherence-value'),
  coherenceFill: document.getElementById('coherence-fill'),
  
  // Page status
  pageIcon: document.getElementById('page-icon'),
  pageDomain: document.getElementById('page-domain'),
  pageCategory: document.getElementById('page-category'),
  
  // Stats
  statBlocked: document.getElementById('stat-blocked'),
  statSocialTime: document.getElementById('stat-social-time'),
  statSafeScore: document.getElementById('stat-safe-score'),
  
  // Footer
  syncStatus: document.getElementById('sync-status'),
  
  // Buttons
  loginBtn: document.getElementById('login-btn'),
  btnSettings: document.getElementById('btn-settings'),
  btnHistory: document.getElementById('btn-history'),
  btnTimeLimits: document.getElementById('btn-time-limits'),
  btnPanic: document.getElementById('btn-panic'),
  linkDashboard: document.getElementById('link-dashboard'),
};

// ============ THETA SECTOR NAMES ============
const THETA_SECTORS = [
  'GENE', 'MEMORY', 'WITNESS', 'DREAM', 
  'BRIDGE', 'GUARDIAN', 'VOICE', 'MIRROR', 'ORIGIN'
];

// ============ STATE ============
let state = {
  isLoggedIn: false,
  profile: null,
  consentState: null,
  restrictions: null,
  isConnected: false,
  currentTab: null,
};

// ============ INITIALIZATION ============
async function init() {
  // Get current state from background
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  
  if (response.profile) {
    state.isLoggedIn = true;
    state.profile = response.profile;
    state.consentState = response.consentState;
    state.restrictions = response.restrictions;
    state.isConnected = response.isConnected;
    
    showMainContent();
    updateUI();
  } else {
    showLoginScreen();
  }
  
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    state.currentTab = tab;
    updatePageStatus(tab.url);
  }
  
  // Load today's stats
  loadStats();
  
  // Set up event listeners
  setupEventListeners();
}

function showLoginScreen() {
  elements.loginScreen.classList.add('active');
  elements.mainContent.classList.add('hidden');
}

function showMainContent() {
  elements.loginScreen.classList.remove('active');
  elements.mainContent.classList.remove('hidden');
}

// ============ UI UPDATES ============
function updateUI() {
  // Update connection status
  if (state.isConnected) {
    elements.statusDot.className = 'status-dot connected';
    elements.connectionStatus.textContent = '● Connected';
    elements.connectionStatus.style.color = '#5bd6a2';
  } else {
    elements.statusDot.className = 'status-dot disconnected';
    elements.connectionStatus.textContent = '○ Offline';
    elements.connectionStatus.style.color = '#f28d7d';
  }
  
  // Update profile info
  if (state.profile) {
    elements.userName.textContent = state.profile.name || 'My Digigami';
    
    if (state.profile.avatarUrl) {
      elements.avatar.innerHTML = `<img src="${state.profile.avatarUrl}" alt="Avatar">`;
    }
  }
  
  // Update consent state
  if (state.consentState) {
    const theta = state.consentState.theta || 0;
    elements.thetaValue.textContent = THETA_SECTORS[theta] || 'UNKNOWN';
    elements.phiValue.textContent = state.consentState.phi || 'GROUNDED';
    elements.harmonicValue.textContent = `h=${state.consentState.harmonic || 1}`;
    
    const coherence = Math.round((state.consentState.coherence || 0) * 100);
    elements.coherenceValue.textContent = `${coherence}%`;
    elements.coherenceFill.style.width = `${coherence}%`;
    
    // Color based on coherence
    if (coherence >= 70) {
      elements.coherenceValue.style.color = '#5bd6a2';
    } else if (coherence >= 40) {
      elements.coherenceValue.style.color = '#f3e06e';
    } else {
      elements.coherenceValue.style.color = '#f28d7d';
    }
  }
  
  // Update sync status
  updateSyncStatus();
}

async function updatePageStatus(url) {
  if (!url) return;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    elements.pageDomain.textContent = domain;
    
    // Check URL against consent rules
    const result = await chrome.runtime.sendMessage({ 
      type: 'CHECK_URL', 
      url 
    });
    
    if (!result.allowed) {
      elements.pageIcon.className = 'page-icon blocked';
      elements.pageIcon.textContent = '✗';
      elements.pageCategory.textContent = `Blocked • ${result.reason}`;
      elements.pageCategory.style.color = '#f28d7d';
    } else if (result.warning) {
      elements.pageIcon.className = 'page-icon warning';
      elements.pageIcon.textContent = '!';
      elements.pageCategory.textContent = `Warning • ${result.warning}`;
      elements.pageCategory.style.color = '#f3e06e';
    } else {
      elements.pageIcon.className = 'page-icon safe';
      elements.pageIcon.textContent = '✓';
      elements.pageCategory.textContent = 'Safe • No restrictions';
      elements.pageCategory.style.color = '#5bd6a2';
    }
  } catch (e) {
    elements.pageDomain.textContent = 'Unknown';
    elements.pageCategory.textContent = 'Cannot analyze';
  }
}

function updateSyncStatus() {
  chrome.storage.local.get(['lastSync'], (result) => {
    if (result.lastSync) {
      const syncDate = new Date(result.lastSync);
      const now = new Date();
      const diffMs = now - syncDate;
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) {
        elements.syncStatus.textContent = 'Last sync: just now';
      } else if (diffMins < 60) {
        elements.syncStatus.textContent = `Last sync: ${diffMins}m ago`;
      } else {
        elements.syncStatus.textContent = `Last sync: ${Math.floor(diffMins / 60)}h ago`;
      }
    } else {
      elements.syncStatus.textContent = 'Not synced';
    }
  });
}

async function loadStats() {
  const today = new Date().toDateString();
  
  chrome.storage.local.get(['blockEvents', 'timeTracking'], (result) => {
    // Count blocks today
    const blocks = result.blockEvents || [];
    const todayBlocks = blocks.filter(b => 
      new Date(b.timestamp).toDateString() === today
    ).length;
    elements.statBlocked.textContent = todayBlocks;
    
    // Social media time
    const timeTracking = result.timeTracking || {};
    const todayTime = timeTracking[today]?.socialMedia || 0;
    const limit = state.restrictions?.time_limits?.socialMedia || 120;
    elements.statSocialTime.textContent = `${todayTime}m / ${limit}m`;
    
    if (todayTime >= limit) {
      elements.statSocialTime.style.color = '#f28d7d';
    } else if (todayTime >= limit * 0.8) {
      elements.statSocialTime.style.color = '#f3e06e';
    }
    
    // Safe browsing score (simplified)
    const totalRequests = blocks.length > 0 ? blocks.length + 100 : 100;
    const safeScore = Math.round((1 - todayBlocks / totalRequests) * 100);
    elements.statSafeScore.textContent = `${safeScore}%`;
  });
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
  // Login button
  elements.loginBtn.addEventListener('click', () => {
    // Open authentication page
    chrome.tabs.create({
      url: 'https://digigami.ai/auth/extension'
    });
  });
  
  // Settings
  elements.btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Activity history
  elements.btnHistory.addEventListener('click', () => {
    chrome.tabs.create({
      url: 'https://digigami.ai/dashboard/activity'
    });
  });
  
  // Time limits
  elements.btnTimeLimits.addEventListener('click', () => {
    chrome.tabs.create({
      url: 'https://digigami.ai/dashboard/time-limits'
    });
  });
  
  // Panic button
  elements.btnPanic.addEventListener('click', async () => {
    if (confirm('🚨 Panic Mode will close all potentially sensitive tabs. Continue?')) {
      await chrome.runtime.sendMessage({ type: 'PANIC_BUTTON' });
      window.close();
    }
  });
  
  // Dashboard link
  elements.linkDashboard.addEventListener('click', () => {
    chrome.tabs.create({
      url: 'https://digigami.ai/dashboard'
    });
  });
}

// ============ MESSAGE HANDLING ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'RESTRICTIONS_UPDATED':
      state.restrictions = message.restrictions;
      updateUI();
      break;
      
    case 'CONSENT_STATE_UPDATED':
      state.consentState = message.consentState;
      updateUI();
      break;
  }
});

// Initialize popup
init();
