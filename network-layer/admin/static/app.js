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

// Auto-refresh pending count every 30 seconds
setInterval(loadPendingCount, 30000);
