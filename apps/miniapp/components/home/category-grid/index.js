Component({
  properties: {
    categories: { type: Array, value: [] },
    variant: { type: String, value: '' },
  },
  methods: {
    chooseCategory(event) {
      const { keyword } = event.currentTarget.dataset;
      this.triggerEvent('navigate', { target: 'products', keyword });
    },
  },
});
