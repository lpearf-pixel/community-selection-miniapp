const { formatYuan } = require('../../utils/api');

const catalogFallbackImage = '/assets/catalog/chunhuaqiushi-catalog-sprite.jpg';
const legacyPlaceholderImage = '/images/products/placeholder.png';

function selectHomeImage(source, index = 0) {
  const normalizedSource = typeof source === 'string' ? source.trim() : '';
  const hasUsableImage = normalizedSource && normalizedSource !== legacyPlaceholderImage;
  if (hasUsableImage) {
    return { coverImage: normalizedSource, fallbackImage: '', fallbackOffset: '0%' };
  }
  const normalizedIndex = Number.isInteger(index) && index >= 0 ? index % 5 : 0;
  return {
    coverImage: '',
    fallbackImage: catalogFallbackImage,
    fallbackOffset: normalizedIndex === 0 ? '0%' : `-${normalizedIndex * 100}%`,
  };
}

function normalizeHomeProduct(raw = {}, index = 0) {
  const stockKnown = typeof raw.stock === 'number';
  const outOfStock = stockKnown && raw.stock <= 0;
  return {
    id: raw.product_id || raw.id || '',
    name: raw.name || '社区甄选好物',
    ...selectHomeImage(raw.cover_image, index),
    priceYuan: formatYuan(raw.price_cents),
    stockLabel: stockKnown
      ? (outOfStock ? '库存不足' : `库存：${raw.stock}${raw.unit || ''}`)
      : '库存以门店确认为准',
    outOfStock,
  };
}

function normalizeHomeGroupBuy(raw = {}, index = 0) {
  const product = raw.product || {};
  const community = raw.community || {};
  const current = Number(raw.current_people || 0);
  const minimum = Number(raw.min_people || 0);
  return {
    id: raw.group_buy_id || raw.id || '',
    name: product.name || raw.product_name || '邻里团购',
    communityName: community.name || raw.community_name || '附近社区',
    ...selectHomeImage(product.cover_image || raw.cover_image, index),
    priceYuan: formatYuan(raw.price_cents),
    progressText: `${current}/${minimum} 人`,
  };
}

module.exports = { normalizeHomeProduct, normalizeHomeGroupBuy, selectHomeImage };
