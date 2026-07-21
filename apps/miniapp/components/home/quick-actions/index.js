Component({
  properties: {
    variant: { type: String, value: '' },
  },
  methods: {
    navigate(event) {
      this.triggerEvent('navigate', { target: event.currentTarget.dataset.target });
    },
  },
});
