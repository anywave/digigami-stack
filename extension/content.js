/**
 * DIGIGAMI Guardian - Content Script
 * Handles overlay injection and page-level consent enforcement
 */

(function() {
  'use strict';

  // State
  let overlayVisible = false;
  let overlayElement = null;
  let consentState = null;

  // Initialize on load
  init();

  function init() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(handleMessage);

    // Request current consent state
    chrome.runtime.sendMessage({ type: 'GET_CONSENT_STATE' }, (response) => {
      if (response) {
        consentState = response;
        checkPageConsent();
      }
    });

    // Observe DOM for dynamic content
    observeDynamicContent();
  }

  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'SHOW_BLOCK_OVERLAY':
        showBlockOverlay(message.reason, message.category);
        sendResponse({ success: true });
        break;

      case 'HIDE_OVERLAY':
        hideOverlay();
        sendResponse({ success: true });
        break;

      case 'CONSENT_STATE_UPDATED':
        consentState = message.state;
        checkPageConsent();
        sendResponse({ success: true });
        break;

      case 'TOGGLE_VISIBILITY':
        toggleOverlay();
        sendResponse({ success: true });
        break;

      case 'PANIC_FREEZE':
        showPanicOverlay();
        sendResponse({ success: true });
        break;
    }
    return true;
  }

  function checkPageConsent() {
    if (!consentState) return;

    const url = window.location.href;

    chrome.runtime.sendMessage({
      type: 'CHECK_URL_CONSENT',
      url: url
    }, (response) => {
      if (response && response.blocked) {
        showBlockOverlay(response.reason, response.category);
      }
    });
  }

  function showBlockOverlay(reason, category) {
    if (overlayElement) {
      hideOverlay();
    }

    overlayElement = document.createElement('div');
    overlayElement.id = 'digigami-block-overlay';
    overlayElement.innerHTML = `
      <div class="digigami-overlay-container">
        <div class="digigami-overlay-content">
          <div class="digigami-avatar">
            <svg viewBox="0 0 100 100" class="digigami-avatar-svg">
              <circle cx="50" cy="50" r="45" class="avatar-ring"/>
              <circle cx="50" cy="50" r="35" class="avatar-core"/>
            </svg>
          </div>

          <h1 class="digigami-title">Pause & Reflect</h1>

          <p class="digigami-reason">${escapeHtml(reason || 'This content requires your attention.')}</p>

          <div class="digigami-category">
            <span class="category-label">Category:</span>
            <span class="category-value">${escapeHtml(category || 'Restricted')}</span>
          </div>

          <div class="digigami-actions">
            <button class="digigami-btn digigami-btn-primary" id="digigami-reflect">
              I'll reflect on this
            </button>
            <button class="digigami-btn digigami-btn-secondary" id="digigami-bypass-request">
              Request access
            </button>
          </div>

          <div class="digigami-coherence">
            <span class="coherence-label">Current coherence:</span>
            <div class="coherence-bar">
              <div class="coherence-fill" style="width: ${(consentState?.coherence || 0.5) * 100}%"></div>
            </div>
          </div>

          <p class="digigami-footer">
            DIGIGAMI is here to support your intentions, not control them.
          </p>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlayElement);
    overlayVisible = true;

    // Add event listeners
    document.getElementById('digigami-reflect')?.addEventListener('click', handleReflect);
    document.getElementById('digigami-bypass-request')?.addEventListener('click', handleBypassRequest);

    // Prevent scrolling
    document.body.style.overflow = 'hidden';
  }

  function showPanicOverlay() {
    if (overlayElement) {
      hideOverlay();
    }

    overlayElement = document.createElement('div');
    overlayElement.id = 'digigami-panic-overlay';
    overlayElement.innerHTML = `
      <div class="digigami-overlay-container digigami-panic">
        <div class="digigami-overlay-content">
          <div class="digigami-avatar panic-pulse">
            <svg viewBox="0 0 100 100" class="digigami-avatar-svg">
              <circle cx="50" cy="50" r="45" class="avatar-ring"/>
              <circle cx="50" cy="50" r="35" class="avatar-core"/>
            </svg>
          </div>

          <h1 class="digigami-title">Consent Frozen</h1>

          <p class="digigami-reason">
            Emergency pause activated. Take a breath.
          </p>

          <div class="digigami-breathing-guide">
            <div class="breathing-circle"></div>
            <span class="breathing-text">Breathe with me...</span>
          </div>

          <button class="digigami-btn digigami-btn-primary" id="digigami-unfreeze">
            I'm ready to continue
          </button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlayElement);
    overlayVisible = true;

    document.getElementById('digigami-unfreeze')?.addEventListener('click', handleUnfreeze);
    document.body.style.overflow = 'hidden';
  }

  function hideOverlay() {
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
      overlayVisible = false;
      document.body.style.overflow = '';
    }
  }

  function toggleOverlay() {
    if (overlayVisible) {
      hideOverlay();
    } else {
      checkPageConsent();
    }
  }

  function handleReflect() {
    chrome.runtime.sendMessage({
      type: 'USER_REFLECTED',
      url: window.location.href
    });

    // Navigate back
    if (document.referrer) {
      window.location.href = document.referrer;
    } else {
      window.history.back();
    }
  }

  function handleBypassRequest() {
    chrome.runtime.sendMessage({
      type: 'BYPASS_REQUEST',
      url: window.location.href
    }, (response) => {
      if (response?.granted) {
        hideOverlay();
      } else {
        // Show denial message
        const reasonEl = overlayElement?.querySelector('.digigami-reason');
        if (reasonEl) {
          reasonEl.textContent = response?.reason || 'Access not granted at this time.';
          reasonEl.classList.add('digigami-shake');
          setTimeout(() => reasonEl.classList.remove('digigami-shake'), 500);
        }
      }
    });
  }

  function handleUnfreeze() {
    chrome.runtime.sendMessage({ type: 'PANIC_UNFREEZE' });
    hideOverlay();
  }

  function observeDynamicContent() {
    const observer = new MutationObserver((mutations) => {
      // Check for dynamically loaded content that might need consent
      // This is a lightweight check - heavy lifting is in background.js
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

})();
