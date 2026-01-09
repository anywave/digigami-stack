/**
 * DIGIGAMI Guardian Admin Dashboard
 * Frontend JavaScript Application
 */

// API Base URL
const API_BASE = '/api';

// State
let currentPage = 'dashboard';
let logsPage = 1;
let auditPage = 1;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const requestBadge = document.getElementById('request-badge');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
  // Login form
  loginForm.addEventListener('submit', handleLogin);

  // Logout button
  logoutBtn.addEventListener('click', handleLogout);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      showPage(page);
    });
  });

  // Log category filter
  document.getElementById('log-category-filter').addEventListener('change', () => {
    logsPage = 1;
    loadLogs();
  });

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      closeModal();
    }
  });
}

// Authentication
async function checkAuth() {
  try {
    const response = await fetch(`${API_BASE}/dashboard`);
    if (response.ok) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  loginError.textContent = '';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok) {
      showDashboard();
    } else {
      loginError.textContent = data.error || 'Login failed';
    }
  } catch (e) {
    loginError.textContent = 'Connection error. Please try again.';
  }
}

async function handleLogout() {
  try {
    await fetch(`${API_BASE}/logout`, { method: 'POST' });
  } catch (e) {}
  showLogin();
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  dashboardScreen.classList.add('hidden');
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  loadDashboard();
  loadPendingCount();
}

// Navigation
function showPage(pageName) {
  currentPage = pageName;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageName);
  });

  // Hide all pages
  document.querySelectorAll('.page').forEach(page => {
    page.classList.add('hidden');
  });

  // Show selected page
  const page = document.getElementById(`page-${pageName}`);
  if (page) {
    page.classList.remove('hidden');
  }

  // Load page data
  switch (pageName) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'devices':
      loadDevices();
      break;
    case 'logs':
      loadLogs();
      break;
    case 'requests':
      loadBypassRequests();
      break;
    case 'bypasses':
      loadActiveBypasses();
      break;
    case 'audit':
      loadAuditLog();
      break;
    case 'nextdns':
      loadNextDNSAnalytics();
      break;
    case 'network':
      loadNetworkStatus();
      break;
    case 'alerts':
      loadAlerts();
      break;
  }
}

// Dashboard
async function loadDashboard() {
  try {
    const response = await fetch(`${API_BASE}/dashboard`);
    const data = await response.json();

    // Update stats
    document.getElementById('stat-blocks').textContent = data.blocks_today || 0;
    document.getElementById('stat-devices').textContent = data.active_devices || 0;
    document.getElementById('stat-profiles').textContent = data.total_profiles || 0;
    document.getElementById('stat-pending').textContent = data.pending_requests || 0;

    // Update category chart
    renderCategoryChart(data.blocks_by_category || []);

    // Update recent blocks
    renderRecentBlocks(data.recent_blocks || []);
  } catch (e) {
    console.error('Failed to load dashboard:', e);
  }
}

function renderCategoryChart(categories) {
  const container = document.getElementById('category-chart');
  const maxCount = Math.max(...categories.map(c => c.count), 1);

  if (categories.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>No blocks recorded today</p></div>';
    return;
  }

  container.innerHTML = categories.map(cat => `
    <div class="chart-bar">
      <span class="chart-bar-label">${cat.category}</span>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width: ${(cat.count / maxCount) * 100}%">
          ${cat.count}
        </div>
      </div>
    </div>
  `).join('');
}

function renderRecentBlocks(blocks) {
  const container = document.getElementById('recent-blocks');

  if (blocks.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🚫</div><p>No recent blocks</p></div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Domain</th>
          <th>Category</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${blocks.map(block => `
          <tr>
            <td class="cell-domain">${escapeHtml(block.domain)}</td>
            <td><span class="cell-category ${block.category}">${block.category}</span></td>
            <td class="cell-time">${formatTime(block.timestamp)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Devices
async function loadDevices() {
  const container = document.getElementById('devices-list');
  container.innerHTML = '<div class="loading">Loading devices</div>';

  try {
    const response = await fetch(`${API_BASE}/devices`);
    const data = await response.json();

    if (data.devices.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📱</div><p>No devices registered</p></div>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Device ID</th>
            <th>Profile</th>
            <th>Age</th>
            <th>Blocked Categories</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.devices.map(device => {
            const restrictions = device.restrictions || {};
            const blockedCats = restrictions.blocked_categories || [];
            const isFrozen = restrictions.emergency_freeze;
            return `
              <tr>
                <td><code>${escapeHtml(device.device_id.substring(0, 16))}...</code></td>
                <td>${device.profile?.name || 'Unknown'}</td>
                <td>${restrictions.age || '-'}</td>
                <td>
                  ${blockedCats.length > 0
                    ? blockedCats.map(c => `<span class="cell-category ${c}">${c}</span>`).join(' ')
                    : '<span class="cell-category">none</span>'}
                </td>
                <td>
                  ${isFrozen
                    ? '<span class="cell-status denied">🔒 Frozen</span>'
                    : '<span class="cell-status approved">Active</span>'}
                </td>
                <td class="cell-actions">
                  <button class="btn btn-sm btn-secondary" onclick="viewDevice('${device.device_id}')">View</button>
                  ${isFrozen
                    ? `<button class="btn btn-sm btn-success" onclick="liftFreeze('${device.device_id}')">Unfreeze</button>`
                    : `<button class="btn btn-sm btn-danger" onclick="showFreezeModal('${device.device_id}')">Freeze</button>`
                  }
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Failed to load devices</p></div>';
  }
}

async function viewDevice(deviceId) {
  const page = document.getElementById('page-device-detail');
  const content = document.getElementById('device-detail-content');
  const title = document.getElementById('device-detail-title');

  // Hide other pages and show device detail
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  page.classList.remove('hidden');

  content.innerHTML = '<div class="loading">Loading device details</div>';

  try {
    const response = await fetch(`${API_BASE}/devices/${deviceId}`);
    const device = await response.json();

    title.textContent = `Device: ${deviceId.substring(0, 16)}...`;

    const restrictions = device.restrictions || {};
    const blockedCats = restrictions.blocked_categories || [];
    const isFrozen = restrictions.emergency_freeze;

    content.innerHTML = `
      ${isFrozen ? `
        <div class="freeze-banner">
          <div class="freeze-banner-content">
            <span class="icon">🔒</span>
            <div>
              <strong>Emergency Freeze Active</strong>
              <p style="color: var(--text-secondary); font-size: 0.875rem;">
                ${restrictions.freeze_reason || 'No reason provided'}
              </p>
            </div>
          </div>
          <button class="btn btn-success" onclick="liftFreeze('${deviceId}')">Lift Freeze</button>
        </div>
      ` : ''}

      <div class="device-info-grid">
        <div class="info-card">
          <h4>Device ID</h4>
          <div class="value"><code>${deviceId}</code></div>
        </div>
        <div class="info-card">
          <h4>User DID</h4>
          <div class="value">${device.user_did || 'Not linked'}</div>
        </div>
        <div class="info-card">
          <h4>Age</h4>
          <div class="value">${restrictions.age || 'Not set'}</div>
        </div>
        <div class="info-card">
          <h4>Last Updated</h4>
          <div class="value">${formatTime(device.updated_at)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 1.5rem;">
        <h3>Blocked Categories</h3>
        <div class="restrictions-list">
          ${blockedCats.length > 0
            ? blockedCats.map(c => `<span class="restriction-tag">${c}</span>`).join('')
            : '<span style="color: var(--text-muted);">No categories blocked</span>'}
        </div>
      </div>

      <div class="card" style="margin-bottom: 1.5rem;">
        <h3>Active Bypasses</h3>
        ${device.active_bypasses?.length > 0 ? `
          <table>
            <thead><tr><th>Domain</th><th>Expires</th><th>Granted By</th><th>Actions</th></tr></thead>
            <tbody>
              ${device.active_bypasses.map(b => `
                <tr>
                  <td class="cell-domain">${escapeHtml(b.domain)}</td>
                  <td class="cell-time">${formatTime(b.expires_at)}</td>
                  <td>${b.granted_by || 'System'}</td>
                  <td><button class="btn btn-sm btn-danger" onclick="revokeBypass(${b.id})">Revoke</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="empty-state"><p>No active bypasses</p></div>'}
      </div>

      <div class="card">
        <h3>Recent Blocks</h3>
        ${device.recent_blocks?.length > 0 ? `
          <table>
            <thead><tr><th>Domain</th><th>Category</th><th>Reason</th><th>Time</th></tr></thead>
            <tbody>
              ${device.recent_blocks.slice(0, 20).map(b => `
                <tr>
                  <td class="cell-domain">${escapeHtml(b.domain)}</td>
                  <td><span class="cell-category ${b.category}">${b.category}</span></td>
                  <td>${b.reason}</td>
                  <td class="cell-time">${formatTime(b.timestamp)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="empty-state"><p>No recent blocks</p></div>'}
      </div>
    `;
  } catch (e) {
    content.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Failed to load device details</p></div>';
  }
}

// Block Logs
async function loadLogs() {
  const container = document.getElementById('logs-list');
  const pagination = document.getElementById('logs-pagination');
  const category = document.getElementById('log-category-filter').value;

  container.innerHTML = '<div class="loading">Loading logs</div>';

  try {
    const params = new URLSearchParams({ page: logsPage, limit: 50 });
    if (category) params.append('category', category);

    const response = await fetch(`${API_BASE}/logs?${params}`);
    const data = await response.json();

    if (data.logs.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>No logs found</p></div>';
      pagination.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Domain</th>
            <th>Category</th>
            <th>Reason</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${data.logs.map(log => `
            <tr>
              <td><code>${log.device_id.substring(0, 12)}...</code></td>
              <td class="cell-domain">${escapeHtml(log.domain)}</td>
              <td><span class="cell-category ${log.category}">${log.category}</span></td>
              <td>${log.reason}</td>
              <td class="cell-time">${formatTime(log.timestamp)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Pagination
    renderPagination(pagination, logsPage, data.pages, (page) => {
      logsPage = page;
      loadLogs();
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Failed to load logs</p></div>';
  }
}

// Bypass Requests
async function loadBypassRequests() {
  const container = document.getElementById('requests-list');
  const status = document.getElementById('request-status-filter').value;

  container.innerHTML = '<div class="loading">Loading requests</div>';

  try {
    const response = await fetch(`${API_BASE}/bypass-requests?status=${status}`);
    const data = await response.json();

    if (data.requests.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🔔</div><p>No ${status} requests</p></div>`;
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Domain</th>
            <th>Reason</th>
            <th>Requested</th>
            <th>Status</th>
            ${status === 'pending' ? '<th>Actions</th>' : '<th>Reviewed By</th>'}
          </tr>
        </thead>
        <tbody>
          ${data.requests.map(req => `
            <tr>
              <td><code>${req.device_id.substring(0, 12)}...</code></td>
              <td class="cell-domain">${escapeHtml(req.domain)}</td>
              <td>${escapeHtml(req.reason || '-')}</td>
              <td class="cell-time">${formatTime(req.requested_at)}</td>
              <td><span class="cell-status ${req.status}">${req.status}</span></td>
              ${status === 'pending' ? `
                <td class="cell-actions">
                  <button class="btn btn-sm btn-success" onclick="showReviewModal(${req.id}, 'approve')">Approve</button>
                  <button class="btn btn-sm btn-danger" onclick="showReviewModal(${req.id}, 'deny')">Deny</button>
                </td>
              ` : `
                <td>${req.reviewed_by || '-'}</td>
              `}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Failed to load requests</p></div>';
  }
}

async function loadPendingCount() {
  try {
    const response = await fetch(`${API_BASE}/bypass-requests?status=pending`);
    const data = await response.json();
    const count = data.requests?.length || 0;

    if (count > 0) {
      requestBadge.textContent = count;
      requestBadge.classList.remove('hidden');
    } else {
      requestBadge.classList.add('hidden');
    }
  } catch (e) {}
}

// Active Bypasses
async function loadActiveBypasses() {
  const container = document.getElementById('bypasses-list');
  container.innerHTML = '<div class="loading">Loading bypasses</div>';

  try {
    const response = await fetch(`${API_BASE}/bypasses/active`);
    const data = await response.json();

    if (data.bypasses.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🔓</div><p>No active bypasses</p></div>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Domain</th>
            <th>Expires</th>
            <th>Granted By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.bypasses.map(bypass => `
            <tr>
              <td><code>${bypass.device_id.substring(0, 12)}...</code></td>
              <td class="cell-domain">${escapeHtml(bypass.domain)}</td>
              <td class="cell-time">${formatTime(bypass.expires_at)}</td>
              <td>${bypass.granted_by || 'System'}</td>
              <td>
                <button class="btn btn-sm btn-danger" onclick="revokeBypass(${bypass.id})">Revoke</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Failed to load bypasses</p></div>';
  }
}

async function revokeBypass(bypassId) {
  if (!confirm('Are you sure you want to revoke this bypass?')) return;

  try {
    const response = await fetch(`${API_BASE}/bypasses/${bypassId}`, { method: 'DELETE' });
    if (response.ok) {
      loadActiveBypasses();
    } else {
      alert('Failed to revoke bypass');
    }
  } catch (e) {
    alert('Error revoking bypass');
  }
}

// Audit Log
async function loadAuditLog() {
  const container = document.getElementById('audit-list');
  const pagination = document.getElementById('audit-pagination');

  container.innerHTML = '<div class="loading">Loading audit log</div>';

  try {
    const response = await fetch(`${API_BASE}/audit?page=${auditPage}&limit=50`);
    const data = await response.json();

    if (data.logs.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📝</div><p>No audit entries</p></div>';
      pagination.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Admin</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${data.logs.map(log => `
            <tr>
              <td>${log.admin_user || 'System'}</td>
              <td><code>${log.action}</code></td>
              <td>${log.target || '-'}</td>
              <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(log.details || '-')}</td>
              <td class="cell-time">${formatTime(log.timestamp)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    renderPagination(pagination, auditPage, data.pages, (page) => {
      auditPage = page;
      loadAuditLog();
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Failed to load audit log</p></div>';
  }
}

// Freeze Actions
function showFreezeModal(deviceId) {
  const modal = document.getElementById('modal-content');
  modal.innerHTML = `
    <div class="modal-header">
      <h3>🔒 Emergency Freeze</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom: 1rem; color: var(--text-secondary);">
        This will immediately block ALL content for this device until manually lifted.
      </p>
      <div class="form-group">
        <label>Reason (optional)</label>
        <input type="text" id="freeze-reason" placeholder="Enter reason for freeze">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="activateFreeze('${deviceId}')">Activate Freeze</button>
    </div>
  `;
  openModal();
}

async function activateFreeze(deviceId) {
  const reason = document.getElementById('freeze-reason').value;

  try {
    const response = await fetch(`${API_BASE}/devices/${deviceId}/freeze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });

    if (response.ok) {
      closeModal();
      loadDevices();
    } else {
      alert('Failed to activate freeze');
    }
  } catch (e) {
    alert('Error activating freeze');
  }
}

async function liftFreeze(deviceId) {
  if (!confirm('Are you sure you want to lift the emergency freeze?')) return;

  try {
    const response = await fetch(`${API_BASE}/devices/${deviceId}/unfreeze`, { method: 'POST' });
    if (response.ok) {
      loadDevices();
      if (currentPage === 'device-detail') viewDevice(deviceId);
    } else {
      alert('Failed to lift freeze');
    }
  } catch (e) {
    alert('Error lifting freeze');
  }
}

// Review Modal
function showReviewModal(requestId, action) {
  const modal = document.getElementById('modal-content');
  const isApprove = action === 'approve';

  modal.innerHTML = `
    <div class="modal-header">
      <h3>${isApprove ? '✅ Approve' : '❌ Deny'} Bypass Request</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      ${isApprove ? `
        <div class="form-group">
          <label>Duration (minutes)</label>
          <select id="bypass-duration" class="select" style="width: 100%;">
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60" selected>1 hour</option>
            <option value="120">2 hours</option>
            <option value="480">8 hours</option>
            <option value="1440">24 hours</option>
          </select>
        </div>
      ` : ''}
      <div class="form-group">
        <label>Notes (optional)</label>
        <input type="text" id="review-notes" placeholder="Add notes...">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn ${isApprove ? 'btn-success' : 'btn-danger'}" onclick="submitReview(${requestId}, '${action}')">
        ${isApprove ? 'Approve' : 'Deny'}
      </button>
    </div>
  `;
  openModal();
}

async function submitReview(requestId, action) {
  const duration = document.getElementById('bypass-duration')?.value || 60;
  const notes = document.getElementById('review-notes').value;

  try {
    const response = await fetch(`${API_BASE}/bypass-requests/${requestId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, duration: parseInt(duration), notes })
    });

    if (response.ok) {
      closeModal();
      loadBypassRequests();
      loadPendingCount();
    } else {
      alert('Failed to submit review');
    }
  } catch (e) {
    alert('Error submitting review');
  }
}

// Grant Bypass Modal
function showGrantBypassModal() {
  const modal = document.getElementById('modal-content');
  modal.innerHTML = `
    <div class="modal-header">
      <h3>🔓 Grant Bypass</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Device ID</label>
        <input type="text" id="grant-device-id" placeholder="Enter device ID or IP">
      </div>
      <div class="form-group">
        <label>Domain</label>
        <input type="text" id="grant-domain" placeholder="example.com">
      </div>
      <div class="form-group">
        <label>Duration</label>
        <select id="grant-duration" class="select" style="width: 100%;">
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60" selected>1 hour</option>
          <option value="120">2 hours</option>
          <option value="480">8 hours</option>
          <option value="1440">24 hours</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="grantBypass()">Grant Bypass</button>
    </div>
  `;
  openModal();
}

async function grantBypass() {
  const deviceId = document.getElementById('grant-device-id').value.trim();
  const domain = document.getElementById('grant-domain').value.trim();
  const duration = document.getElementById('grant-duration').value;

  if (!deviceId || !domain) {
    alert('Please fill in all fields');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/bypasses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, domain, duration: parseInt(duration) })
    });

    if (response.ok) {
      closeModal();
      loadActiveBypasses();
    } else {
      alert('Failed to grant bypass');
    }
  } catch (e) {
    alert('Error granting bypass');
  }
}

// Modal Helpers
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Pagination Helper
function renderPagination(container, currentPage, totalPages, callback) {
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous button
  html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="(${callback})(${currentPage - 1})">← Prev</button>`;

  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `<button class="${i === currentPage ? 'active' : ''}" onclick="(${callback})(${i})">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<button disabled>...</button>';
    }
  }

  // Next button
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="(${callback})(${currentPage + 1})">Next →</button>`;

  container.innerHTML = html;
}

// Utility Functions
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Less than 1 minute
  if (diff < 60000) return 'Just now';

  // Less than 1 hour
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

  // Less than 24 hours
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  // Otherwise show date
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============ NextDNS Analytics ============

async function loadNextDNSAnalytics() {
  const statusBanner = document.getElementById('nextdns-status-banner');
  const statsGrid = document.getElementById('nextdns-stats');
  const period = document.getElementById('nextdns-period').value;

  // First check NextDNS status
  try {
    const statusResponse = await fetch(`${API_BASE}/nextdns/status`);
    const status = await statusResponse.json();

    if (!status.available) {
      statusBanner.innerHTML = `
        <div class="status-banner-content warning">
          <span class="icon">⚠️</span>
          <div>
            <strong>NextDNS Module Not Available</strong>
            <p>The NextDNS client library is not installed.</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner warning';
      statsGrid.classList.add('hidden');
      return;
    }

    if (!status.enabled) {
      statusBanner.innerHTML = `
        <div class="status-banner-content info">
          <span class="icon">ℹ️</span>
          <div>
            <strong>NextDNS Integration Disabled</strong>
            <p>Enable NextDNS by setting NEXTDNS_ENABLED=true in environment.</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner info';
      statsGrid.classList.add('hidden');
      return;
    }

    if (!status.configured) {
      statusBanner.innerHTML = `
        <div class="status-banner-content warning">
          <span class="icon">⚙️</span>
          <div>
            <strong>NextDNS Not Configured</strong>
            <p>Set NEXTDNS_API_KEY and NEXTDNS_PROFILE_ID environment variables.</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner warning';
      statsGrid.classList.add('hidden');
      return;
    }

    if (status.connected && status.profile) {
      statusBanner.innerHTML = `
        <div class="status-banner-content success">
          <span class="icon">✅</span>
          <div>
            <strong>Connected to NextDNS</strong>
            <p>Profile: ${escapeHtml(status.profile.name)} (${status.profile.id})</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner success';
      statsGrid.classList.remove('hidden');
    } else {
      statusBanner.innerHTML = `
        <div class="status-banner-content error">
          <span class="icon">❌</span>
          <div>
            <strong>Connection Failed</strong>
            <p>${status.error || 'Unable to connect to NextDNS API'}</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner error';
      statsGrid.classList.add('hidden');
      return;
    }
  } catch (e) {
    statusBanner.innerHTML = `
      <div class="status-banner-content error">
        <span class="icon">❌</span>
        <div><strong>Error checking NextDNS status</strong></div>
      </div>
    `;
    statusBanner.className = 'status-banner error';
    return;
  }

  // Load analytics data
  try {
    const analyticsResponse = await fetch(`${API_BASE}/nextdns/analytics?period=${period}`);
    const analytics = await analyticsResponse.json();

    if (analytics.error) {
      console.error('Analytics error:', analytics.error);
    } else {
      document.getElementById('nextdns-total-queries').textContent = formatNumber(analytics.queries_total);
      document.getElementById('nextdns-blocked').textContent = formatNumber(analytics.queries_blocked);
      document.getElementById('nextdns-allowed').textContent = formatNumber(analytics.queries_allowed);
      document.getElementById('nextdns-block-rate').textContent = `${analytics.block_rate}%`;

      // Render top blocked domains
      const topBlockedContainer = document.getElementById('nextdns-top-blocked');
      if (analytics.top_blocked_domains && analytics.top_blocked_domains.length > 0) {
        topBlockedContainer.innerHTML = `
          <table>
            <thead><tr><th>Domain</th><th>Count</th></tr></thead>
            <tbody>
              ${analytics.top_blocked_domains.map(d => `
                <tr>
                  <td class="cell-domain">${escapeHtml(d.domain || d.name || d)}</td>
                  <td>${d.count || d.queries || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else {
        topBlockedContainer.innerHTML = '<div class="empty-state"><p>No blocked domains</p></div>';
      }
    }
  } catch (e) {
    console.error('Failed to load analytics:', e);
  }

  // Load blocklists
  loadNextDNSBlocklists();

  // Load parental controls
  loadNextDNSParental();

  // Load security settings
  loadNextDNSSecurity();
}

async function loadNextDNSBlocklists() {
  const container = document.getElementById('nextdns-blocklists');
  container.innerHTML = '<div class="loading">Loading blocklists</div>';

  try {
    const response = await fetch(`${API_BASE}/nextdns/blocklists`);
    const data = await response.json();

    if (data.error) {
      container.innerHTML = `<div class="empty-state"><p>${data.error}</p></div>`;
      return;
    }

    if (!data.blocklists || data.blocklists.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No blocklists configured</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="blocklist-grid">
        ${data.blocklists.filter(bl => bl.enabled).map(bl => `
          <div class="blocklist-item ${bl.enabled ? 'enabled' : 'disabled'}">
            <div class="blocklist-name">${escapeHtml(bl.name)}</div>
            <div class="blocklist-meta">${formatNumber(bl.entries)} entries</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load blocklists</p></div>';
  }
}

async function loadNextDNSParental() {
  const container = document.getElementById('nextdns-parental');
  container.innerHTML = '<div class="loading">Loading</div>';

  try {
    const response = await fetch(`${API_BASE}/nextdns/parental`);
    const settings = await response.json();

    if (settings.error) {
      container.innerHTML = `<div class="empty-state"><p>${settings.error}</p></div>`;
      return;
    }

    const items = [];
    if (settings.safeSearch) items.push(['Safe Search', settings.safeSearch ? 'Enabled' : 'Disabled']);
    if (settings.youtubeRestrictedMode !== undefined) items.push(['YouTube Restricted', settings.youtubeRestrictedMode ? 'Yes' : 'No']);
    if (settings.blockBypass !== undefined) items.push(['Block Bypass Methods', settings.blockBypass ? 'Yes' : 'No']);
    if (settings.services && settings.services.length > 0) items.push(['Blocked Services', settings.services.join(', ')]);
    if (settings.categories && settings.categories.length > 0) items.push(['Blocked Categories', settings.categories.join(', ')]);

    if (items.length === 0) {
      container.innerHTML = '<div class="settings-list"><p class="muted">No parental controls configured</p></div>';
    } else {
      container.innerHTML = `
        <div class="settings-list">
          ${items.map(([key, value]) => `
            <div class="settings-item">
              <span class="settings-key">${key}</span>
              <span class="settings-value">${escapeHtml(String(value))}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load settings</p></div>';
  }
}

async function loadNextDNSSecurity() {
  const container = document.getElementById('nextdns-security');
  container.innerHTML = '<div class="loading">Loading</div>';

  try {
    const response = await fetch(`${API_BASE}/nextdns/security`);
    const settings = await response.json();

    if (settings.error) {
      container.innerHTML = `<div class="empty-state"><p>${settings.error}</p></div>`;
      return;
    }

    const items = [];
    if (settings.threatIntelligenceFeeds !== undefined) items.push(['Threat Intelligence', settings.threatIntelligenceFeeds ? 'Enabled' : 'Disabled']);
    if (settings.aiThreatDetection !== undefined) items.push(['AI Threat Detection', settings.aiThreatDetection ? 'Enabled' : 'Disabled']);
    if (settings.googleSafeBrowsing !== undefined) items.push(['Google Safe Browsing', settings.googleSafeBrowsing ? 'Enabled' : 'Disabled']);
    if (settings.cryptojacking !== undefined) items.push(['Block Cryptojacking', settings.cryptojacking ? 'Yes' : 'No']);
    if (settings.dnsRebinding !== undefined) items.push(['DNS Rebinding Protection', settings.dnsRebinding ? 'Yes' : 'No']);
    if (settings.idnHomographs !== undefined) items.push(['IDN Homograph Protection', settings.idnHomographs ? 'Yes' : 'No']);
    if (settings.typosquatting !== undefined) items.push(['Typosquatting Protection', settings.typosquatting ? 'Yes' : 'No']);
    if (settings.dga !== undefined) items.push(['DGA Protection', settings.dga ? 'Yes' : 'No']);
    if (settings.nrd !== undefined) items.push(['Block New Domains', settings.nrd ? 'Yes' : 'No']);

    if (items.length === 0) {
      container.innerHTML = '<div class="settings-list"><p class="muted">No security settings configured</p></div>';
    } else {
      container.innerHTML = `
        <div class="settings-list">
          ${items.map(([key, value]) => `
            <div class="settings-item">
              <span class="settings-key">${key}</span>
              <span class="settings-value">${escapeHtml(String(value))}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load settings</p></div>';
  }
}

async function addToDenylist() {
  const input = document.getElementById('denylist-domain');
  const domain = input.value.trim().toLowerCase();

  if (!domain) {
    alert('Please enter a domain');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/nextdns/denylist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });

    const result = await response.json();

    if (response.ok) {
      input.value = '';
      alert(`Domain ${domain} added to denylist`);
      loadNextDNSAnalytics();
    } else {
      alert(result.error || 'Failed to add domain');
    }
  } catch (e) {
    alert('Error adding domain to denylist');
  }
}

// ============ Network Status ============

async function loadNetworkStatus() {
  try {
    const response = await fetch(`${API_BASE}/network/status`);
    const status = await response.json();

    // Update system stats
    if (status.system) {
      document.getElementById('net-cpu').textContent = status.system.cpu_percent !== undefined ? `${status.system.cpu_percent}%` : 'N/A';
      document.getElementById('net-memory').textContent = status.system.memory_percent !== undefined ? `${status.system.memory_percent}%` : 'N/A';
      document.getElementById('net-disk').textContent = status.system.disk_percent !== undefined ? `${status.system.disk_percent}%` : 'N/A';
    }

    // Update NextDNS status
    const nextdnsCard = document.getElementById('net-nextdns-card');
    if (status.nextdns) {
      if (status.nextdns.connected) {
        document.getElementById('net-nextdns-status').textContent = 'Connected';
        nextdnsCard.classList.add('success');
        nextdnsCard.classList.remove('error');
      } else if (status.nextdns.enabled) {
        document.getElementById('net-nextdns-status').textContent = 'Disconnected';
        nextdnsCard.classList.add('error');
        nextdnsCard.classList.remove('success');
      } else {
        document.getElementById('net-nextdns-status').textContent = 'Disabled';
        nextdnsCard.classList.remove('success', 'error');
      }
    }

    // Render system info
    const systemInfo = document.getElementById('system-info');
    const infoItems = [];
    if (status.system) {
      infoItems.push(['Platform', status.system.platform]);
      infoItems.push(['Hostname', status.system.hostname]);
      infoItems.push(['Python', status.system.python_version]);
    }
    if (status.guardian) {
      infoItems.push(['Database', status.guardian.db_exists ? 'Connected' : 'Not Found']);
      infoItems.push(['Total Blocks', formatNumber(status.guardian.total_blocks || 0)]);
      infoItems.push(['Profiles', status.guardian.total_profiles || 0]);
      infoItems.push(['Active Bypasses', status.guardian.active_bypasses || 0]);
    }

    systemInfo.innerHTML = `
      <div class="info-list">
        ${infoItems.map(([key, value]) => `
          <div class="info-item">
            <span class="info-key">${key}</span>
            <span class="info-value">${escapeHtml(String(value))}</span>
          </div>
        `).join('')}
      </div>
    `;

    // Load timeline
    loadBlockTimeline();

    // Load top blocked
    loadTopBlocked();
  } catch (e) {
    console.error('Failed to load network status:', e);
  }
}

async function loadBlockTimeline() {
  const container = document.getElementById('block-timeline');
  container.innerHTML = '<div class="loading">Loading timeline</div>';

  try {
    const response = await fetch(`${API_BASE}/timeline?hours=24`);
    const data = await response.json();

    if (!data.timeline || data.timeline.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No activity in the last 24 hours</p></div>';
      return;
    }

    const maxCount = Math.max(...data.timeline.map(t => t.count), 1);

    container.innerHTML = `
      <div class="timeline-chart">
        ${data.timeline.map(point => {
          const hour = point.hour.split(' ')[1] || point.hour;
          const height = (point.count / maxCount) * 100;
          return `
            <div class="timeline-bar" title="${point.hour}: ${point.count} blocks">
              <div class="timeline-bar-fill" style="height: ${height}%"></div>
              <div class="timeline-bar-label">${hour.substring(0, 2)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load timeline</p></div>';
  }
}

async function loadTopBlocked() {
  const container = document.getElementById('top-blocked-list');
  const period = document.getElementById('top-blocked-period').value;

  container.innerHTML = '<div class="loading">Loading</div>';

  try {
    const response = await fetch(`${API_BASE}/top-blocked?period=${period}&limit=20`);
    const data = await response.json();

    if (!data.domains || data.domains.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No blocked domains in this period</p></div>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Category</th>
            <th>Blocks</th>
            <th>Devices</th>
            <th>Last Blocked</th>
          </tr>
        </thead>
        <tbody>
          ${data.domains.map(d => `
            <tr>
              <td class="cell-domain">${escapeHtml(d.domain)}</td>
              <td><span class="cell-category ${d.category}">${d.category || '-'}</span></td>
              <td>${formatNumber(d.count)}</td>
              <td>${d.devices || 1}</td>
              <td class="cell-time">${formatTime(d.last_blocked)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load data</p></div>';
  }
}

// Number formatting helper
function formatNumber(num) {
  if (num === undefined || num === null) return '-';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// ============ Alerts ============

let alertHistoryPage = 1;

async function loadAlerts() {
  const statusBanner = document.getElementById('alerts-status-banner');

  try {
    // First check alerts status
    const statusResponse = await fetch(`${API_BASE}/alerts/status`);
    const status = await statusResponse.json();

    if (!status.available) {
      statusBanner.innerHTML = `
        <div class="status-banner-content warning">
          <span class="icon">⚠️</span>
          <div>
            <strong>Alert System Not Available</strong>
            <p>The alert module is not loaded.</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner warning';
      return;
    }

    if (!status.enabled) {
      statusBanner.innerHTML = `
        <div class="status-banner-content info">
          <span class="icon">ℹ️</span>
          <div>
            <strong>Alerts Disabled</strong>
            <p>Enable alerts by setting ALERTS_ENABLED=true in environment.</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner info';
    } else {
      statusBanner.innerHTML = `
        <div class="status-banner-content success">
          <span class="icon">✅</span>
          <div>
            <strong>Alert System Active</strong>
            <p>Email: ${status.smtp_configured ? 'Configured' : 'Not configured'} | Webhooks: ${status.webhooks_count || 0}</p>
          </div>
        </div>
      `;
      statusBanner.className = 'status-banner success';
    }

    // Update stats
    document.getElementById('alert-email-count').textContent = status.recipients_count || 0;
    document.getElementById('alert-webhook-count').textContent = status.webhooks_count || 0;
    document.getElementById('alert-sent-today').textContent = status.sent_today || 0;
    document.getElementById('alert-status').textContent = status.enabled ? 'Active' : 'Disabled';

    // Load settings
    await loadAlertSettings();

    // Load recipients
    await loadEmailRecipients();

    // Load webhooks
    await loadWebhooks();

    // Load history
    await loadAlertHistory();

    // Show SMTP config
    renderSMTPConfig(status);

  } catch (e) {
    console.error('Failed to load alerts:', e);
    statusBanner.innerHTML = `
      <div class="status-banner-content error">
        <span class="icon">❌</span>
        <div><strong>Error loading alert settings</strong></div>
      </div>
    `;
    statusBanner.className = 'status-banner error';
  }
}

async function loadAlertSettings() {
  const container = document.getElementById('alert-types-settings');
  container.innerHTML = '<div class="loading">Loading settings</div>';

  try {
    const response = await fetch(`${API_BASE}/alerts/settings`);
    const data = await response.json();

    if (data.error) {
      container.innerHTML = `<div class="empty-state"><p>${data.error}</p></div>`;
      return;
    }

    const alertTypes = [
      { type: 'block_event', label: 'Block Events', description: 'When content is blocked' },
      { type: 'bypass_requested', label: 'Bypass Requests', description: 'When a bypass is requested' },
      { type: 'bypass_approved', label: 'Bypass Approved', description: 'When a bypass is approved' },
      { type: 'bypass_denied', label: 'Bypass Denied', description: 'When a bypass is denied' },
      { type: 'emergency_freeze', label: 'Emergency Freeze', description: 'When a device is frozen' },
      { type: 'freeze_lifted', label: 'Freeze Lifted', description: 'When a freeze is lifted' },
      { type: 'high_block_rate', label: 'High Block Rate', description: 'Unusual blocking activity detected' },
      { type: 'daily_summary', label: 'Daily Summary', description: 'Daily activity summary' }
    ];

    container.innerHTML = `
      <div class="alert-type-grid">
        ${alertTypes.map(at => {
          const setting = data.settings?.find(s => s.alert_type === at.type) || {};
          const enabled = setting.enabled !== false;
          return `
            <div class="alert-type-item">
              <div class="alert-type-info">
                <div class="alert-type-label">${at.label}</div>
                <div class="alert-type-desc">${at.description}</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" ${enabled ? 'checked' : ''}
                       onchange="toggleAlertType('${at.type}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load settings</p></div>';
  }
}

async function toggleAlertType(alertType, enabled) {
  try {
    const response = await fetch(`${API_BASE}/alerts/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_type: alertType, enabled })
    });

    if (!response.ok) {
      alert('Failed to update setting');
      loadAlertSettings();
    }
  } catch (e) {
    alert('Error updating setting');
    loadAlertSettings();
  }
}

async function loadEmailRecipients() {
  const container = document.getElementById('email-recipients-list');

  try {
    const response = await fetch(`${API_BASE}/alerts/settings`);
    const data = await response.json();

    if (!data.recipients || data.recipients.length === 0) {
      container.innerHTML = '<div class="empty-state small"><p>No email recipients configured</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="recipients-list">
        ${data.recipients.map(r => `
          <div class="recipient-item">
            <span class="recipient-email">${escapeHtml(r.email)}</span>
            <button class="btn btn-sm btn-danger" onclick="removeEmailRecipient('${escapeHtml(r.email)}')">Remove</button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state small"><p>Failed to load recipients</p></div>';
  }
}

async function addEmailRecipient() {
  const input = document.getElementById('new-email-recipient');
  const email = input.value.trim();

  if (!email) {
    alert('Please enter an email address');
    return;
  }

  // Basic email validation
  if (!email.includes('@') || !email.includes('.')) {
    alert('Please enter a valid email address');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/alerts/recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const result = await response.json();

    if (response.ok) {
      input.value = '';
      loadEmailRecipients();
      loadAlerts(); // Refresh stats
    } else {
      alert(result.error || 'Failed to add recipient');
    }
  } catch (e) {
    alert('Error adding recipient');
  }
}

async function removeEmailRecipient(email) {
  if (!confirm(`Remove ${email} from recipients?`)) return;

  try {
    const response = await fetch(`${API_BASE}/alerts/recipients`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    if (response.ok) {
      loadEmailRecipients();
      loadAlerts(); // Refresh stats
    } else {
      alert('Failed to remove recipient');
    }
  } catch (e) {
    alert('Error removing recipient');
  }
}

async function loadWebhooks() {
  const container = document.getElementById('webhooks-list');

  try {
    const response = await fetch(`${API_BASE}/alerts/settings`);
    const data = await response.json();

    if (!data.webhooks || data.webhooks.length === 0) {
      container.innerHTML = '<div class="empty-state small"><p>No webhooks configured</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="webhooks-list">
        ${data.webhooks.map(w => `
          <div class="webhook-item">
            <div class="webhook-info">
              <span class="webhook-name">${escapeHtml(w.name)}</span>
              <span class="webhook-url">${escapeHtml(w.url.substring(0, 50))}${w.url.length > 50 ? '...' : ''}</span>
            </div>
            <button class="btn btn-sm btn-danger" onclick="removeWebhook(${w.id})">Remove</button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state small"><p>Failed to load webhooks</p></div>';
  }
}

async function addWebhook() {
  const nameInput = document.getElementById('new-webhook-name');
  const urlInput = document.getElementById('new-webhook-url');
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();

  if (!name || !url) {
    alert('Please enter both name and URL');
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    alert('Please enter a valid URL starting with http:// or https://');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/alerts/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url })
    });

    const result = await response.json();

    if (response.ok) {
      nameInput.value = '';
      urlInput.value = '';
      loadWebhooks();
      loadAlerts(); // Refresh stats
    } else {
      alert(result.error || 'Failed to add webhook');
    }
  } catch (e) {
    alert('Error adding webhook');
  }
}

async function removeWebhook(webhookId) {
  if (!confirm('Remove this webhook?')) return;

  try {
    const response = await fetch(`${API_BASE}/alerts/webhooks/${webhookId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      loadWebhooks();
      loadAlerts(); // Refresh stats
    } else {
      alert('Failed to remove webhook');
    }
  } catch (e) {
    alert('Error removing webhook');
  }
}

function renderSMTPConfig(status) {
  const container = document.getElementById('smtp-config-display');

  const items = [
    ['SMTP Host', status.smtp_host || 'Not configured'],
    ['SMTP Port', status.smtp_port || '-'],
    ['From Email', status.smtp_from || 'Not configured'],
    ['Status', status.smtp_configured ? 'Configured' : 'Not configured']
  ];

  container.innerHTML = `
    <div class="config-list">
      ${items.map(([key, value]) => `
        <div class="config-item">
          <span class="config-key">${key}</span>
          <span class="config-value">${escapeHtml(String(value))}</span>
        </div>
      `).join('')}
    </div>
  `;
}

async function sendTestAlert() {
  const channel = document.getElementById('test-alert-channel').value;
  const resultContainer = document.getElementById('test-alert-result');

  resultContainer.innerHTML = '<div class="loading">Sending test alert...</div>';
  resultContainer.className = 'alert-result';

  try {
    const response = await fetch(`${API_BASE}/alerts/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      resultContainer.innerHTML = `<div class="success">Test alert sent successfully!</div>`;
      resultContainer.className = 'alert-result success';
    } else {
      resultContainer.innerHTML = `<div class="error">${result.error || 'Failed to send test alert'}</div>`;
      resultContainer.className = 'alert-result error';
    }
  } catch (e) {
    resultContainer.innerHTML = `<div class="error">Error sending test alert</div>`;
    resultContainer.className = 'alert-result error';
  }

  // Clear result after 5 seconds
  setTimeout(() => {
    resultContainer.innerHTML = '';
    resultContainer.className = 'alert-result';
  }, 5000);
}

async function loadAlertHistory() {
  const container = document.getElementById('alert-history-list');
  const pagination = document.getElementById('alert-history-pagination');

  container.innerHTML = '<div class="loading">Loading history</div>';

  try {
    const response = await fetch(`${API_BASE}/alerts/history?page=${alertHistoryPage}&limit=20`);
    const data = await response.json();

    if (!data.alerts || data.alerts.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No alerts sent yet</p></div>';
      pagination.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Channel</th>
            <th>Recipient</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${data.alerts.map(alert => `
            <tr>
              <td><code>${alert.alert_type}</code></td>
              <td>${alert.channel}</td>
              <td>${escapeHtml(alert.recipient || '-')}</td>
              <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(alert.subject || '-')}</td>
              <td><span class="cell-status ${alert.success ? 'approved' : 'denied'}">${alert.success ? 'Sent' : 'Failed'}</span></td>
              <td class="cell-time">${formatTime(alert.sent_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Pagination
    if (data.pages > 1) {
      renderPagination(pagination, alertHistoryPage, data.pages, (page) => {
        alertHistoryPage = page;
        loadAlertHistory();
      });
    } else {
      pagination.innerHTML = '';
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Failed to load alert history</p></div>';
  }
}

// Auto-refresh pending count every 30 seconds
setInterval(loadPendingCount, 30000);
