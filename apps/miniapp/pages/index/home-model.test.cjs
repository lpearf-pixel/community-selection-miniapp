const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHomeProduct,
  normalizeHomeGroupBuy,
} = require('./home-model');
const { resolveHomeTemplate } = require('./templates');

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
      fallbackImage: '',
      fallbackOffset: '0%',
    },
  );
});

test('uses deterministic local photography when a product image is missing', () => {
  assert.deepEqual(
    normalizeHomeProduct({
      product_id: 'p-2',
      name: '本地菠菜',
      cover_image: '/images/products/placeholder.png',
      price_cents: 690,
      stock: 18,
      unit: '份',
    }, 1),
    {
      id: 'p-2',
      name: '本地菠菜',
      coverImage: '',
      fallbackImage: '/assets/catalog/chunhuaqiushi-catalog-sprite.jpg',
      fallbackOffset: '-100%',
      priceYuan: '6.90',
      stockLabel: '库存：18份',
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
      fallbackImage: '/assets/catalog/chunhuaqiushi-catalog-sprite.jpg',
      fallbackOffset: '0%',
      priceYuan: '19.90',
      progressText: '1/3 人',
    },
  );
});

test('preserves an uploaded group-buy image instead of replacing it', () => {
  const item = normalizeHomeGroupBuy({
    id: 'g-2',
    price_cents: 2990,
    product: {
      name: '有机蔬菜箱',
      cover_image: 'https://cdn.example.com/vegetables.jpg',
    },
  }, 4);

  assert.equal(item.coverImage, 'https://cdn.example.com/vegetables.jpg');
  assert.equal(item.fallbackImage, '');
  assert.equal(item.fallbackOffset, '0%');
});

test('falls back to the approved default template', () => {
  const template = resolveHomeTemplate('missing');
  assert.equal(template.key, 'chunhuaqiushi');
  assert.deepEqual(
    template.sections.map((section) => section.type),
    ['brandHero', 'categoryGrid', 'productShowcase', 'groupBuyShowcase', 'quickActions'],
  );
});
