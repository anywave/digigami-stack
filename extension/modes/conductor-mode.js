/**
 * DIGIGAMI Guardian - Conductor Mode
 * Real-time presentation coaching
 */

class ConductorMode {
  constructor() {
    this.isActive = false;
    this.presentation = null;
    this.metrics = {
      wordsPerMinute: 0,
      fillerWords: 0,
      pauses: 0,
      duration: 0
    };
    this.recognition = null;
    this.startTime = null;
    this.wordCount = 0;
    this.fillerWordCount = 0;
    this.onGestureCallback = null;
  }

  /**
   * Initialize speech recognition
   */
  initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.log('[DIGIGAMI Conductor] Speech recognition not supported');
      return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event) => {
      this.processSpeech(event);
    };

    this.recognition.onerror = (error) => {
      console.log('[DIGIGAMI Conductor] Recognition error:', error);
    };

    return true;
  }

  /**
   * Start Conductor Mode
   */
  async start(options = {}) {
    if (this.isActive) {
      return { success: false, reason: 'already_active' };
    }

    this.presentation = {
      id: crypto.randomUUID(),
      title: options.title || 'Untitled Presentation',
      targetDuration: options.targetDuration || 30, // minutes
      slides: options.slideCount || 0
    };

    if (!this.initSpeechRecognition()) {
      return { success: false, reason: 'speech_recognition_unavailable' };
    }

    this.recognition.start();
    this.startTime = Date.now();
    this.isActive = true;
    this.wordCount = 0;
    this.fillerWordCount = 0;

    // Start metrics update loop
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 5000);

    console.log('[DIGIGAMI Conductor] Started');
    return { success: true, presentation: this.presentation };
  }

  /**
   * Stop Conductor Mode
   */
  stop() {
    if (!this.isActive) {
      return { success: false, reason: 'not_active' };
    }

    if (this.recognition) {
      this.recognition.stop();
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    const finalReport = this.generateReport();
    this.isActive = false;

    console.log('[DIGIGAMI Conductor] Stopped');
    return { success: true, report: finalReport };
  }

  /**
   * Process speech recognition results
   */
  processSpeech(event) {
    const results = event.results;
    const lastResult = results[results.length - 1];

    if (lastResult.isFinal) {
      const transcript = lastResult[0].transcript.toLowerCase();

      // Count words
      const words = transcript.split(/\s+/).filter(w => w.length > 0);
      this.wordCount += words.length;

      // Detect filler words
      const fillerWords = ['um', 'uh', 'like', 'you know', 'so', 'actually', 'basically', 'literally'];
      for (const filler of fillerWords) {
        const regex = new RegExp(`\\b${filler}\\b`, 'gi');
        const matches = transcript.match(regex);
        if (matches) {
          this.fillerWordCount += matches.length;
          this.emitGesture('filler_detected', { word: filler });
        }
      }

      // Check for pacing
      this.checkPacing();
    }
  }

  /**
   * Update metrics and check for issues
   */
  updateMetrics() {
    if (!this.isActive) return;

    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    this.metrics.wordsPerMinute = Math.round(this.wordCount / elapsedMinutes);
    this.metrics.fillerWords = this.fillerWordCount;
    this.metrics.duration = Math.round(elapsedMinutes);

    // Check WPM and emit gestures
    if (this.metrics.wordsPerMinute > 180) {
      this.emitGesture('slow_down', {
        current: this.metrics.wordsPerMinute,
        target: 150
      });
    } else if (this.metrics.wordsPerMinute < 100 && elapsedMinutes > 1) {
      this.emitGesture('speed_up', {
        current: this.metrics.wordsPerMinute,
        target: 130
      });
    }

    // Check time remaining
    if (this.presentation.targetDuration) {
      const remaining = this.presentation.targetDuration - elapsedMinutes;
      if (remaining < 5 && remaining > 4) {
        this.emitGesture('time_warning', { remaining: Math.round(remaining) });
      } else if (remaining < 1) {
        this.emitGesture('wrap_up', { remaining: Math.round(remaining * 60) });
      }
    }
  }

  /**
   * Check speaking pace
   */
  checkPacing() {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    if (elapsedMinutes < 0.5) return; // Wait at least 30 seconds

    const wpm = this.wordCount / elapsedMinutes;

    if (wpm > 200) {
      this.emitGesture('slow_down', { urgency: 'high' });
    } else if (wpm > 170) {
      this.emitGesture('slow_down', { urgency: 'medium' });
    }
  }

  /**
   * Emit a gesture/cue to the UI
   */
  emitGesture(type, data = {}) {
    const gesture = {
      type,
      data,
      timestamp: Date.now(),
      message: this.getGestureMessage(type, data)
    };

    if (this.onGestureCallback) {
      this.onGestureCallback(gesture);
    }

    // Also send to any listeners
    window.dispatchEvent(new CustomEvent('digigami-conductor-gesture', {
      detail: gesture
    }));

    console.log('[DIGIGAMI Conductor] Gesture:', gesture);
  }

  /**
   * Get human-readable message for gesture
   */
  getGestureMessage(type, data) {
    const messages = {
      'slow_down': data.urgency === 'high'
        ? '🖐️ ↓↓↓ Slow down!'
        : '🖐️ ↓ Ease your pace',
      'speed_up': '🖐️ ↑ Pick up the pace',
      'filler_detected': `💬 Watch the "${data.word}"`,
      'time_warning': `⏱️ ${data.remaining} minutes remaining`,
      'wrap_up': `✂️ Time to wrap up`,
      'pause': '✋ Pause for effect',
      'emphasize': '🎯 Key point - emphasize!',
      'energy': '💪 Add more energy',
      'breathe': '😮‍💨 Take a breath',
      'eye_contact': '👀 Make eye contact',
      'good_pace': '✓ Good pace, maintain'
    };

    return messages[type] || type;
  }

  /**
   * Register callback for gestures
   */
  onGesture(callback) {
    this.onGestureCallback = callback;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      isActive: this.isActive,
      elapsed: this.startTime ? (Date.now() - this.startTime) / 1000 : 0
    };
  }

  /**
   * Generate final report
   */
  generateReport() {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;

    return {
      presentation: this.presentation,
      duration: {
        actual: Math.round(elapsedMinutes),
        target: this.presentation.targetDuration,
        difference: Math.round(this.presentation.targetDuration - elapsedMinutes)
      },
      speech: {
        wordCount: this.wordCount,
        averageWPM: Math.round(this.wordCount / elapsedMinutes),
        fillerWords: this.fillerWordCount,
        fillerRate: (this.fillerWordCount / this.wordCount * 100).toFixed(2) + '%'
      },
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate recommendations based on metrics
   */
  generateRecommendations() {
    const recommendations = [];
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const wpm = this.wordCount / elapsedMinutes;

    if (wpm > 160) {
      recommendations.push({
        area: 'Pacing',
        issue: 'Speaking too fast',
        suggestion: 'Practice pausing between sections. Aim for 130-150 WPM.'
      });
    }

    if (this.fillerWordCount > this.wordCount * 0.02) {
      recommendations.push({
        area: 'Fluency',
        issue: 'Frequent filler words',
        suggestion: 'Replace fillers with pauses. Silence is powerful.'
      });
    }

    if (Math.abs(this.presentation.targetDuration - elapsedMinutes) > 3) {
      recommendations.push({
        area: 'Timing',
        issue: 'Missed target duration',
        suggestion: 'Practice with timer. Adjust content length accordingly.'
      });
    }

    return recommendations;
  }

  /**
   * Get gesture vocabulary reference
   */
  getGestureVocabulary() {
    return {
      tempo: [
        { gesture: '🖐️ ↓↓↓', meaning: 'Slow down, you\'re rushing' },
        { gesture: '🖐️ ↑↑↑', meaning: 'Pick up the pace' },
        { gesture: '✋', meaning: 'Good pace, maintain' },
        { gesture: '🤚 ~~~', meaning: 'Smooth transition here' }
      ],
      energy: [
        { gesture: '👐 →←', meaning: 'Project more, speak louder' },
        { gesture: '👐 ←→', meaning: 'Softer, more intimate' },
        { gesture: '💪', meaning: 'More energy!' },
        { gesture: '🙏', meaning: 'Calm, centered, gravitas' }
      ],
      pauses: [
        { gesture: '😮‍💨', meaning: 'Breathe - you\'re tense' },
        { gesture: '✋⏸️', meaning: 'Pause here for effect' },
        { gesture: '👆', meaning: 'Let that land - silence is power' },
        { gesture: '⏱️', meaning: 'Time check' }
      ],
      content: [
        { gesture: '👉', meaning: 'Next slide/section' },
        { gesture: '👈', meaning: 'Go back - missed something' },
        { gesture: '🎯', meaning: 'Key point - emphasize!' },
        { gesture: '❓', meaning: 'Ask the audience' }
      ]
    };
  }
}

// Export singleton
window.DigiConductor = new ConductorMode();
