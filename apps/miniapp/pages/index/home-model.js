const { formatYuan } = require('../../utils/api');

function normalizeHomeProduct(raw = {}) {
  const stockKnown = typeof raw.stock === 'number';
  const outOfStock = stockKnown && raw.stock <= 0;
  return {
    id: raw.product_id || raw.id || '',
    name: raw.name || '社区甄选好物',
    coverImage: raw.cover_image || '',
    priceYuan: formatYuan(raw.price_cents),
    stockLabel: stockKnown
      ? (outOfStock ? '库存不足' : `库存：${raw.stock}${raw.unit || ''}`)
      : '库存以门店确认为准',
    outOfStock,
  };
}

function normalizeHomeGroupBuy(raw = {}) {
  const product = raw.product || {};
  const community = raw.community || {};
  const current = Number(raw.current_people || 0);
  const minimum = Number(raw.min_people || 0);
  return {
    id: raw.group_buy_id || raw.id || '',
    name: product.name || raw.product_name || '邻里团购',
    communityName: community.name || raw.community_name || '附近社区',
    coverImage: product.cover_image || raw.cover_image || '',
    priceYuan: formatYuan(raw.price_cents),
    progressText: `${current}/${minimum} 人`,
  };
}

module.exports = { normalizeHomeProduct, normalizeHomeGroupBuy };
