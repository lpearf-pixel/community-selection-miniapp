const ALLOWED_TONES = Object.freeze(['brand', 'info', 'success', 'warning', 'danger', 'neutral']);

function normalizeTone(value) {
  return ALLOWED_TONES.includes(value) ? value : 'neutral';
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    text: {
      type: String,
      value: '',
    },
    tone: {
      type: String,
      value: 'neutral',
      observer(value) {
        this.setData({ resolvedTone: normalizeTone(value) });
      },
    },
  },
  data: {
    resolvedTone: 'neutral',
  },
  lifetimes: {
    attached() {
      this.setData({ resolvedTone: normalizeTone(this.properties.tone) });
    },
  },
});

module.exports = { ALLOWED_TONES, normalizeTone };
