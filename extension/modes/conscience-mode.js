/**
 * DIGIGAMI Guardian - Conscience Mode
 * Ethical guidance based on user-chosen values
 */

class ConscienceMode {
  constructor() {
    this.isActive = false;
    this.values = [];
    this.situationalRules = [];
    this.lastGuidance = null;
  }

  /**
   * Initialize Conscience Mode with user's values
   */
  async initialize() {
    const settings = await this.loadSettings();
    this.values = settings.values || [];
    this.situationalRules = settings.situationalRules || [];
    this.isActive = settings.conscienceEnabled || false;

    console.log('[DIGIGAMI Conscience] Initialized with', this.values.length, 'values');
    return { success: true, values: this.values };
  }

  /**
   * Load conscience settings from storage
   */
  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['conscienceSettings'], (result) => {
        resolve(result.conscienceSettings || {
          conscienceEnabled: false,
          values: [],
          situationalRules: []
        });
      });
    });
  }

  /**
   * Save conscience settings
   */
  async saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ conscienceSettings: settings }, () => {
        this.values = settings.values || [];
        this.situationalRules = settings.situationalRules || [];
        this.isActive = settings.conscienceEnabled || false;
        resolve({ success: true });
      });
    });
  }

  /**
   * Activate Conscience Mode
   */
  activate() {
    this.isActive = true;
    chrome.storage.sync.set({
      conscienceSettings: {
        ...this.getCurrentSettings(),
        conscienceEnabled: true
      }
    });
    console.log('[DIGIGAMI Conscience] Activated');
    return { success: true };
  }

  /**
   * Deactivate Conscience Mode
   */
  deactivate() {
    this.isActive = false;
    chrome.storage.sync.set({
      conscienceSettings: {
        ...this.getCurrentSettings(),
        conscienceEnabled: false
      }
    });
    console.log('[DIGIGAMI Conscience] Deactivated');
    return { success: true };
  }

  /**
   * Get current settings object
   */
  getCurrentSettings() {
    return {
      conscienceEnabled: this.isActive,
      values: this.values,
      situationalRules: this.situationalRules
    };
  }

  /**
   * Add a value to the user's value set
   */
  addValue(value) {
    const valueObj = {
      id: crypto.randomUUID(),
      name: value.name,
      description: value.description,
      priority: value.priority || 'medium',
      source: value.source || 'self', // self, family, faith, community, etc.
      addedAt: new Date().toISOString()
    };

    this.values.push(valueObj);
    this.saveSettings(this.getCurrentSettings());

    console.log('[DIGIGAMI Conscience] Added value:', value.name);
    return valueObj;
  }

  /**
   * Remove a value
   */
  removeValue(valueId) {
    this.values = this.values.filter(v => v.id !== valueId);
    this.saveSettings(this.getCurrentSettings());
    return { success: true };
  }

  /**
   * Get guidance for a situation
   * This is a simplified version - full implementation would use AI
   */
  getGuidance(context) {
    if (!this.isActive || this.values.length === 0) {
      return null;
    }

    const guidance = {
      timestamp: Date.now(),
      context: context,
      relevantValues: [],
      suggestion: null
    };

    // Simple keyword matching (real implementation would use AI)
    const contextLower = (context.situation || '').toLowerCase();

    // Check each value for relevance
    for (const value of this.values) {
      const keywords = this.getValueKeywords(value.name);
      for (const keyword of keywords) {
        if (contextLower.includes(keyword)) {
          guidance.relevantValues.push(value);
          break;
        }
      }
    }

    // Generate suggestion based on relevant values
    if (guidance.relevantValues.length > 0) {
      guidance.suggestion = this.generateSuggestion(guidance.relevantValues, context);
    }

    this.lastGuidance = guidance;
    return guidance;
  }

  /**
   * Get keywords associated with a value
   */
  getValueKeywords(valueName) {
    const keywordMap = {
      'honesty': ['lie', 'truth', 'honest', 'deceive', 'fake', 'pretend'],
      'kindness': ['mean', 'cruel', 'help', 'hurt', 'kind', 'nice', 'rude'],
      'courage': ['afraid', 'fear', 'brave', 'stand up', 'coward', 'difficult'],
      'responsibility': ['blame', 'fault', 'own', 'accountable', 'mistake'],
      'respect': ['disrespect', 'honor', 'dignity', 'rude', 'polite'],
      'fairness': ['unfair', 'cheat', 'equal', 'just', 'bias'],
      'integrity': ['compromise', 'principles', 'values', 'right', 'wrong'],
      'patience': ['rush', 'wait', 'hurry', 'impatient', 'frustrated'],
      'gratitude': ['thankful', 'appreciate', 'grateful', 'take for granted'],
      'compassion': ['suffer', 'pain', 'help', 'care', 'empathy']
    };

    return keywordMap[valueName.toLowerCase()] || [];
  }

  /**
   * Generate a suggestion based on relevant values
   */
  generateSuggestion(values, context) {
    const suggestions = {
      'honesty': "Consider: Is this the full truth?",
      'kindness': "Pause: How might this affect them?",
      'courage': "Remember: Standing up matters, even when hard.",
      'responsibility': "Ask: Am I owning my part in this?",
      'respect': "Check: Am I treating them with dignity?",
      'fairness': "Consider: Is this fair to everyone involved?",
      'integrity': "Reflect: Does this align with who I want to be?",
      'patience': "Breathe: Is rushing serving you here?",
      'gratitude': "Notice: What can you appreciate in this moment?",
      'compassion': "Feel: What might they be experiencing?"
    };

    // Get suggestion for highest priority value
    const highPriority = values.find(v => v.priority === 'high') || values[0];
    return suggestions[highPriority.name.toLowerCase()] ||
           `Remember your commitment to ${highPriority.name}.`;
  }

  /**
   * Add a situational rule
   */
  addSituationalRule(rule) {
    const ruleObj = {
      id: crypto.randomUUID(),
      name: rule.name,
      trigger: rule.trigger, // location, time, calendar, etc.
      triggerValue: rule.triggerValue,
      guidance: rule.guidance,
      priority: rule.priority || 'medium',
      addedAt: new Date().toISOString()
    };

    this.situationalRules.push(ruleObj);
    this.saveSettings(this.getCurrentSettings());

    return ruleObj;
  }

  /**
   * Check situational rules
   */
  checkSituationalRules(context) {
    const triggeredRules = [];

    for (const rule of this.situationalRules) {
      let triggered = false;

      switch (rule.trigger) {
        case 'location':
          if (context.location &&
              context.location.toLowerCase().includes(rule.triggerValue.toLowerCase())) {
            triggered = true;
          }
          break;

        case 'time':
          const now = new Date();
          const [hours, minutes] = rule.triggerValue.split(':').map(Number);
          if (now.getHours() === hours && Math.abs(now.getMinutes() - minutes) < 15) {
            triggered = true;
          }
          break;

        case 'website':
          if (context.url && context.url.includes(rule.triggerValue)) {
            triggered = true;
          }
          break;

        case 'keyword':
          if (context.text && context.text.toLowerCase().includes(rule.triggerValue.toLowerCase())) {
            triggered = true;
          }
          break;
      }

      if (triggered) {
        triggeredRules.push(rule);
      }
    }

    return triggeredRules;
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      isActive: this.isActive,
      valueCount: this.values.length,
      ruleCount: this.situationalRules.length,
      lastGuidance: this.lastGuidance
    };
  }

  /**
   * Get predefined value sets
   */
  getValueSets() {
    return {
      'core-virtues': [
        { name: 'Honesty', description: 'Tell the truth even when difficult' },
        { name: 'Kindness', description: 'Consider others feelings' },
        { name: 'Courage', description: 'Stand up for what is right' },
        { name: 'Responsibility', description: 'Own my actions and mistakes' },
        { name: 'Respect', description: 'Treat others with dignity' },
        { name: 'Fairness', description: 'Give everyone a fair chance' }
      ],
      'mindfulness': [
        { name: 'Patience', description: 'Allow things to unfold naturally' },
        { name: 'Gratitude', description: 'Appreciate what I have' },
        { name: 'Compassion', description: 'Understand others suffering' },
        { name: 'Presence', description: 'Stay in the current moment' }
      ],
      'professional': [
        { name: 'Integrity', description: 'Act consistently with my principles' },
        { name: 'Excellence', description: 'Strive to do my best work' },
        { name: 'Accountability', description: 'Take responsibility for outcomes' },
        { name: 'Collaboration', description: 'Work well with others' }
      ]
    };
  }
}

// Export singleton
window.DigiConscience = new ConscienceMode();
