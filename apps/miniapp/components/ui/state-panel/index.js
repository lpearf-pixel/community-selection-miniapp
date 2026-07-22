Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    state: {
      type: String,
      value: 'empty',
    },
    message: {
      type: String,
      value: '',
    },
    retryable: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    onRetry() {
      if (this.data.state === 'error' && this.data.retryable) {
        this.triggerEvent('retry');
      }
    },
  },
});
