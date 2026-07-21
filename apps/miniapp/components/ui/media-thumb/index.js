const activeTheme = require('../../../themes/active.generated');

const LEGACY_PLACEHOLDER = '/images/products/placeholder.png';

function normalizeSource(value) {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source || source === LEGACY_PLACEHOLDER) return '';
  if (/^(https?:\/\/|wxfile:\/\/|cloud:\/\/|\/|\.\.\/|\.\/)/.test(source)) return source;
  return '';
}

function fallbackOffset(index) {
  const numericIndex = Number(index);
  const normalizedIndex = Number.isInteger(numericIndex) && numericIndex >= 0 ? numericIndex % 5 : 0;
  return normalizedIndex === 0 ? '0%' : '-' + normalizedIndex * 100 + '%';
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    src: {
      type: String,
      value: '',
      observer(value) {
        this.applySource(value);
      },
    },
    categoryIndex: {
      type: Number,
      value: 0,
      observer(value) {
        this.setData({ fallbackOffset: fallbackOffset(value) });
      },
    },
    mode: {
      type: String,
      value: 'aspectFill',
    },
  },
  data: {
    currentSrc: '',
    usingFallback: true,
    fallbackSource: activeTheme.assets.catalogSprite,
    fallbackOffset: '0%',
  },
  lifetimes: {
    attached() {
      this.applySource(this.properties.src);
      this.setData({ fallbackOffset: fallbackOffset(this.properties.categoryIndex) });
    },
  },
  methods: {
    applySource(value) {
      const currentSrc = normalizeSource(value);
      this.setData({ currentSrc, usingFallback: !currentSrc });
    },
    onImageError() {
      if (!this.data.currentSrc || this.data.usingFallback) return;
      this.setData({ currentSrc: '', usingFallback: true });
    },
  },
});

module.exports = { fallbackOffset, normalizeSource };
