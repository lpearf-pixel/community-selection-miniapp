import { PrismaClient, CommissionType, ProductStatus, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  { name: '有机蔬菜', sort_order: 1 },
  { name: '鸡蛋', sort_order: 2 },
  { name: '水果', sort_order: 3 },
  { name: '杂粮', sort_order: 4 },
  { name: '干货', sort_order: 5 }
];

const products = [
  { name: '有机上海青', category: '有机蔬菜', price_cents: 590, cost_price_cents: 350, stock: 200, unit: '份', commission_type: CommissionType.percent, commission_value: 8 },
  { name: '本地菠菜', category: '有机蔬菜', price_cents: 690, cost_price_cents: 420, stock: 180, unit: '份', commission_type: CommissionType.percent, commission_value: 8 },
  { name: '散养土鸡蛋 10 枚', category: '鸡蛋', price_cents: 1680, cost_price_cents: 1100, stock: 120, unit: '盒', commission_type: CommissionType.fixed, commission_value: 100 },
  { name: '无抗鲜鸡蛋 15 枚', category: '鸡蛋', price_cents: 1980, cost_price_cents: 1350, stock: 100, unit: '盒', commission_type: CommissionType.fixed, commission_value: 120 },
  { name: '烟台红富士苹果', category: '水果', price_cents: 2990, cost_price_cents: 2100, stock: 160, unit: '箱', commission_type: CommissionType.percent, commission_value: 6 },
  { name: '赣南脐橙', category: '水果', price_cents: 3990, cost_price_cents: 2850, stock: 150, unit: '箱', commission_type: CommissionType.percent, commission_value: 6 },
  { name: '东北五常大米', category: '杂粮', price_cents: 5990, cost_price_cents: 4300, stock: 80, unit: '袋', commission_type: CommissionType.fixed, commission_value: 200 },
  { name: '农家小米', category: '杂粮', price_cents: 2590, cost_price_cents: 1800, stock: 90, unit: '袋', commission_type: CommissionType.percent, commission_value: 5 },
  { name: '宁夏枸杞', category: '干货', price_cents: 3290, cost_price_cents: 2300, stock: 70, unit: '罐', commission_type: CommissionType.fixed, commission_value: 150 },
  { name: '福建香菇干', category: '干货', price_cents: 4590, cost_price_cents: 3300, stock: 60, unit: '包', commission_type: CommissionType.percent, commission_value: 5 }
];

const communities = [
  { name: '幸福里社区', address: '幸福路 88 号' },
  { name: '阳光花园社区', address: '阳光大道 168 号' },
  { name: '滨河家园社区', address: '滨河路 36 号' }
];

async function main() {
  await prisma.user.upsert({
    where: { openid: 'admin-openid' },
    update: {
      nickname: '管理员',
      role: UserRole.admin,
      status: 'active'
    },
    create: {
      openid: 'admin-openid',
      nickname: '管理员',
      phone: '13800000000',
      role: UserRole.admin,
      status: 'active'
    }
  });


  await prisma.user.upsert({
    where: { openid: 'leader-openid' },
    update: {
      nickname: '测试开团人',
      role: UserRole.leader,
      status: 'active'
    },
    create: {
      openid: 'leader-openid',
      nickname: '测试开团人',
      phone: '13800000001',
      role: UserRole.leader,
      status: 'active'
    }
  });

  await prisma.user.upsert({
    where: { openid: 'customer-openid' },
    update: {
      nickname: '测试用户',
      role: UserRole.customer,
      status: 'active'
    },
    create: {
      openid: 'customer-openid',
      nickname: '测试用户',
      phone: '13800000002',
      role: UserRole.customer,
      status: 'active'
    }
  });

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: category,
      create: category
    });
  }

  const categoryMap = new Map(
    (await prisma.category.findMany()).map((category) => [category.name, category.id])
  );

  for (const product of products) {
    const category_id = categoryMap.get(product.category);
    if (!category_id) throw new Error(`Missing category: ${product.category}`);
    await prisma.product.upsert({
      where: { name: product.name },
      update: {
        category_id,
        price_cents: product.price_cents,
        cost_price_cents: product.cost_price_cents,
        stock: product.stock,
        unit: product.unit,
        stock_unit: 'piece',
        sale_unit: product.unit,
        sale_spec_name: product.unit === '盒' ? product.name.replace(/.*?(\d+\s*枚.*)/, '$1') : null,
        stock_deduct_quantity: 1,
        is_group_enabled: true,
        commission_type: product.commission_type,
        commission_value: product.commission_value,
        status: ProductStatus.active
      },
      create: {
        name: product.name,
        category_id,
        cover_image: '/images/products/placeholder.png',
        images: [],
        description: `${product.name}，社区甄选测试商品。`,
        price_cents: product.price_cents,
        cost_price_cents: product.cost_price_cents,
        stock: product.stock,
        unit: product.unit,
        stock_unit: 'piece',
        sale_unit: product.unit,
        sale_spec_name: product.unit === '盒' ? product.name.replace(/.*?(\d+\s*枚.*)/, '$1') : null,
        stock_deduct_quantity: 1,
        is_group_enabled: true,
        commission_type: product.commission_type,
        commission_value: product.commission_value,
        status: ProductStatus.active
      }
    });
  }

  for (const community of communities) {
    await prisma.community.upsert({
      where: { name: community.name },
      update: community,
      create: community
    });
  }

  await prisma.pickupStore.upsert({
    where: { id: 'main-pickup-store' },
    update: {
      name: '社区甄选自提点',
      address: '中心街 18 号实体店',
      phone: '021-88888888',
      latitude: 31.230416,
      longitude: 121.473701,
      status: 'active'
    },
    create: {
      id: 'main-pickup-store',
      name: '社区甄选自提点',
      address: '中心街 18 号实体店',
      phone: '021-88888888',
      latitude: 31.230416,
      longitude: 121.473701,
      status: 'active'
    }
  });

  const defaultDeliveryRule = await (prisma as any).deliveryRuleConfig.findFirst({ where: { pickup_store_id: null } });
  const defaultDeliveryRuleData = {
    pickup_store_id: null,
    enabled: true,
    base_fee_cents: 0,
    free_threshold_cents: null,
    max_distance_km: null,
    service_radius_text: '门店周边 3-5km，具体以门店确认为准',
    notice: '当前为门店配送，暂不接第三方配送。配送范围与时段以门店确认为准。',
    time_windows_json: [
      { code: 'today_afternoon', label: '今日下午', start_time: '14:00', end_time: '18:00' },
      { code: 'today_evening', label: '今日晚上', start_time: '18:00', end_time: '21:00' },
      { code: 'tomorrow_morning', label: '明日上午', start_time: '09:00', end_time: '12:00' }
    ]
  };
  if (defaultDeliveryRule) await (prisma as any).deliveryRuleConfig.update({ where: { id: defaultDeliveryRule.id }, data: defaultDeliveryRuleData });
  else await (prisma as any).deliveryRuleConfig.create({ data: defaultDeliveryRuleData });

}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
