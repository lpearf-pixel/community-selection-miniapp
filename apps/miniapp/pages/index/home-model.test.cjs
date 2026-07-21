const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHomeProduct,
  normalizeHomeGroupBuy,
} = require('./home-model');

test('normalizes product cents and stock without leaking API shape', () => {
  assert.deepEqual(
    normalizeHomeProduct({
      product_id: 'p-1',
      name: '有机番茄',
      cover_image: 'https://img/p-1.png',
      price_cents: 3330,
      stock: 8,
      unit: '斤',
    }),
    {
      id: 'p-1',
      name: '有机番茄',
      coverImage: 'https://img/p-1.png',
      priceYuan: '33.30',
      stockLabel: '库存：8斤',
      outOfStock: false,
    },
  );
});

test('normalizes group progress and fallback labels', () => {
  assert.deepEqual(
    normalizeHomeGroupBuy({
      id: 'g-1',
      price_cents: 1990,
      current_people: 1,
      min_people: 3,
      product: { name: '邻里蔬菜包' },
      community: { name: '春华社区' },
    }),
    {
      id: 'g-1',
      name: '邻里蔬菜包',
      communityName: '春华社区',
      coverImage: '',
      priceYuan: '19.90',
      progressText: '1/3 人',
    },
  );
});
