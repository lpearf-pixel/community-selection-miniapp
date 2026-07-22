Component({
  properties: {
    title: { type: String, value: '' },
    hint: { type: String, value: '' },
    items: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
    variant: { type: String, value: '' },
  },
  methods: {
    openGroupBuy(event) {
      this.triggerEvent('navigate', {
        target: 'group-buy-detail',
        id: event.currentTarget.dataset.id,
      });
    },
    retry() {
      this.triggerEvent('retry', { resource: 'groupBuys' });
    },
  },
});
