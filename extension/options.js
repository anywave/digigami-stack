/**
 * DIGIGAMI Guardian - Options Page Script
 */

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

const DEFAULT_SETTINGS = {
  enabled: true,
  notifications: true,
  coherenceMode: false,
  cloudSync: false,
  hederaAnchor: false,
  timeLimit: 4,
  blockedCategories: ['gambling', 'adult']
};

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  // General toggles
  document.getElementById('enabled').checked = settings.enabled;
  document.getElementById('notifications').checked = settings.notifications;
  document.getElementById('coherenceMode').checked = settings.coherenceMode;
  document.getElementById('cloudSync').checked = settings.cloudSync;
  document.getElementById('hederaAnchor').checked = settings.hederaAnchor;

  // Time limit
  document.getElementById('timeLimit').value = settings.timeLimit;
  document.getElementById('timeLimitValue').textContent = `${settings.timeLimit} hours`;

  // Categories
  document.querySelectorAll('.category-item').forEach(item => {
    const category = item.dataset.category;
    if (settings.blockedCategories.includes(category)) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function setupEventListeners() {
  // Category toggles
  document.querySelectorAll('.category-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('active');
    });
  });

  // Time limit slider
  document.getElementById('timeLimit').addEventListener('input', (e) => {
    document.getElementById('timeLimitValue').textContent = `${e.target.value} hours`;
  });

  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetSettings);

  // Clear data button
  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
}

async function saveSettings() {
  const blockedCategories = Array.from(document.querySelectorAll('.category-item.active'))
    .map(item => item.dataset.category);

  const settings = {
    enabled: document.getElementById('enabled').checked,
    notifications: document.getElementById('notifications').checked,
    coherenceMode: document.getElementById('coherenceMode').checked,
    cloudSync: document.getElementById('cloudSync').checked,
    hederaAnchor: document.getElementById('hederaAnchor').checked,
    timeLimit: parseInt(document.getElementById('timeLimit').value),
    blockedCategories
  };

  try {
    await chrome.storage.sync.set(settings);

    // Notify background script
    chrome.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      settings
    });

    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    showStatus('Failed to save settings: ' + error.message, 'error');
  }
}

async function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;

  try {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    loadSettings();
    showStatus('Settings reset to defaults.', 'success');
  } catch (error) {
    showStatus('Failed to reset settings: ' + error.message, 'error');
  }
}

async function clearAllData() {
  if (!confirm('This will clear ALL DIGIGAMI data including consent history. Are you sure?')) return;

  try {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    loadSettings();
    showStatus('All data cleared.', 'success');
  } catch (error) {
    showStatus('Failed to clear data: ' + error.message, 'error');
  }
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;

  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}
