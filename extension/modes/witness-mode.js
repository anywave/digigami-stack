/**
 * DIGIGAMI Guardian - Witness Mode
 * Self-sovereign evidence capture and protection
 */

class WitnessMode {
  constructor() {
    this.isActive = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.startTime = null;
    this.locationData = null;
    this.hashChain = [];
  }

  /**
   * Activate Witness Mode
   * @param {Object} options - Configuration options
   */
  async activate(options = {}) {
    if (this.isActive) {
      console.log('[DIGIGAMI Witness] Already active');
      return { success: false, reason: 'already_active' };
    }

    try {
      // Request media permissions
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: options.includeVideo || false
      });

      // Initialize MediaRecorder
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
          this.addToHashChain(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.finalizeRecording();
      };

      // Start recording
      this.mediaRecorder.start(1000); // Capture in 1-second chunks
      this.startTime = Date.now();
      this.isActive = true;

      // Capture location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.locationData = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              timestamp: new Date().toISOString()
            };
          },
          (err) => console.log('[DIGIGAMI Witness] Location unavailable:', err)
        );
      }

      // Notify background
      chrome.runtime.sendMessage({
        type: 'WITNESS_MODE_ACTIVATED',
        timestamp: this.startTime
      });

      // Store activation in local storage
      chrome.storage.local.set({
        witnessMode: {
          active: true,
          startTime: this.startTime,
          reason: options.reason || 'manual'
        }
      });

      console.log('[DIGIGAMI Witness] Mode activated');
      return { success: true, startTime: this.startTime };

    } catch (error) {
      console.error('[DIGIGAMI Witness] Activation failed:', error);
      return { success: false, reason: error.message };
    }
  }

  /**
   * Deactivate Witness Mode
   */
  async deactivate() {
    if (!this.isActive) {
      return { success: false, reason: 'not_active' };
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    this.isActive = false;

    // Notify background
    chrome.runtime.sendMessage({
      type: 'WITNESS_MODE_DEACTIVATED',
      duration: Date.now() - this.startTime
    });

    // Update storage
    chrome.storage.local.set({
      witnessMode: { active: false }
    });

    console.log('[DIGIGAMI Witness] Mode deactivated');
    return { success: true, duration: Date.now() - this.startTime };
  }

  /**
   * Add data to hash chain for tamper detection
   */
  async addToHashChain(data) {
    const buffer = await data.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const previousHash = this.hashChain.length > 0
      ? this.hashChain[this.hashChain.length - 1].hash
      : '0';

    this.hashChain.push({
      index: this.hashChain.length,
      timestamp: Date.now(),
      hash: hashHex,
      previousHash: previousHash
    });
  }

  /**
   * Finalize and save recording
   */
  async finalizeRecording() {
    if (this.recordedChunks.length === 0) {
      console.log('[DIGIGAMI Witness] No data to save');
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);

    // Create evidence package
    const evidencePackage = {
      id: crypto.randomUUID(),
      type: 'witness_recording',
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      location: this.locationData,
      hashChain: this.hashChain,
      integrityHash: this.hashChain.length > 0
        ? this.hashChain[this.hashChain.length - 1].hash
        : null,
      blobUrl: url,
      size: blob.size
    };

    // Store evidence package reference
    const existing = await this.getStoredEvidence();
    existing.push({
      id: evidencePackage.id,
      startTime: evidencePackage.startTime,
      duration: evidencePackage.duration,
      integrityHash: evidencePackage.integrityHash
    });

    await chrome.storage.local.set({ witnessEvidence: existing });

    // Trigger download
    this.downloadEvidence(blob, evidencePackage);

    // Reset state
    this.recordedChunks = [];
    this.hashChain = [];
    this.startTime = null;
    this.locationData = null;

    console.log('[DIGIGAMI Witness] Evidence package created:', evidencePackage.id);
  }

  /**
   * Download evidence as file
   */
  downloadEvidence(blob, metadata) {
    // Download audio
    const audioFilename = `digigami-witness-${metadata.id.slice(0, 8)}.webm`;
    const audioLink = document.createElement('a');
    audioLink.href = URL.createObjectURL(blob);
    audioLink.download = audioFilename;
    audioLink.click();

    // Download metadata
    const metaFilename = `digigami-witness-${metadata.id.slice(0, 8)}-meta.json`;
    const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const metaLink = document.createElement('a');
    metaLink.href = URL.createObjectURL(metaBlob);
    metaLink.download = metaFilename;
    metaLink.click();
  }

  /**
   * Get stored evidence list
   */
  async getStoredEvidence() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['witnessEvidence'], (result) => {
        resolve(result.witnessEvidence || []);
      });
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isActive: this.isActive,
      startTime: this.startTime,
      duration: this.isActive ? Date.now() - this.startTime : 0,
      chunks: this.recordedChunks.length,
      hasLocation: !!this.locationData
    };
  }
}

// Export singleton
window.DigiWitness = new WitnessMode();
