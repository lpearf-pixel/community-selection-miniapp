module.exports = Object.freeze({
  key: 'chunhuaqiushi',
  pageClass: 'theme-chunhuaqiushi',
  brand: {
    name: '春华秋实',
    subtitle: '社区甄选',
    slogan: '健康源于自然，温暖来自邻里',
    logoPath: '/assets/brand/chunhuaqiushi-logo.jpg',
  },
  services: [
    { key: 'organic', label: '有机甄选' },
    { key: 'fresh', label: '今日新鲜' },
    { key: 'neighbor', label: '邻里服务' },
  ],
  categories: [
    { key: 'vegetables', label: '蔬菜', keyword: '蔬菜', icon: '🥬' },
    { key: 'fruits', label: '水果', keyword: '水果', icon: '🍎' },
    { key: 'eggs', label: '禽蛋', keyword: '鸡蛋', icon: '🥚' },
    { key: 'grains', label: '粮油', keyword: '粮油', icon: '🌾' },
    { key: 'pantry', label: '副食', keyword: '副食', icon: '🫙' },
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
});
