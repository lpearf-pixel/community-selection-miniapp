const descriptor = require('./theme.json');

const catalogSpritePath = descriptor.assets.catalogSprite;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

module.exports = deepFreeze({
  ...descriptor,
  key: descriptor.id,
  catalogSpritePath,
  brand: {
    name: descriptor.displayName,
    subtitle: '社区甄选',
    slogan: '健康源于自然，温暖来自邻里',
    logoPath: descriptor.assets.logo,
    heroImagePath: descriptor.assets.hero,
  },
  services: [
    { key: 'organic', label: '有机甄选' },
    { key: 'fresh', label: '今日新鲜' },
    { key: 'neighbor', label: '邻里服务' },
  ],
  catalog: [
    { key: 'vegetables', label: '蔬菜', keyword: '蔬菜', imagePath: catalogSpritePath, spriteOffset: '0%' },
    { key: 'fruits', label: '水果', keyword: '水果', imagePath: catalogSpritePath, spriteOffset: '-100%' },
    { key: 'eggs', label: '禽蛋', keyword: '鸡蛋', imagePath: catalogSpritePath, spriteOffset: '-200%' },
    { key: 'grains', label: '粮油', keyword: '粮油', imagePath: catalogSpritePath, spriteOffset: '-300%' },
    { key: 'pantry', label: '副食', keyword: '副食', imagePath: catalogSpritePath, spriteOffset: '-400%' },
  ],
  categories: [
    { key: 'vegetables', label: '蔬菜', keyword: '蔬菜', imagePath: catalogSpritePath, spriteOffset: '0%' },
    { key: 'fruits', label: '水果', keyword: '水果', imagePath: catalogSpritePath, spriteOffset: '-100%' },
    { key: 'eggs', label: '禽蛋', keyword: '鸡蛋', imagePath: catalogSpritePath, spriteOffset: '-200%' },
    { key: 'grains', label: '粮油', keyword: '粮油', imagePath: catalogSpritePath, spriteOffset: '-300%' },
    { key: 'pantry', label: '副食', keyword: '副食', imagePath: catalogSpritePath, spriteOffset: '-400%' },
  ],
  sections: [
    { type: 'brandHero', variant: 'light-premium' },
    { type: 'categoryGrid', variant: 'soft-grid' },
    { type: 'productShowcase', variant: 'fresh-cards' },
    { type: 'groupBuyShowcase', variant: 'neighbor-card' },
    { type: 'quickActions', variant: 'compact' },
  ],
  sectionTitles: {
    products: '今日甄选',
    productsHint: '新鲜到店，安心带回家',
    groupBuys: '邻里团购',
    groupBuysHint: '社区邻里一起拼',
  },
  copy: {
    loading: '正在加载…',
    empty: '暂时没有内容',
    error: '加载失败，请稍后重试',
    retry: '重新加载',
  },
  variants: {
    primary: 'brand',
    secondary: 'surface',
    danger: 'danger',
  },
  imageFallback: {
    legacyPlaceholder: '/images/products/placeholder.png',
    source: catalogSpritePath,
  },
});
