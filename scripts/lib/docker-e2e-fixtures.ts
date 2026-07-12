import type { PrismaClient } from '@prisma/client';

export const DOCKER_E2E_ADMIN_ID = 'docker-e2e-admin';
export const DOCKER_E2E_OPERATOR_ADMIN_ID = 'docker-e2e-operator';
export const DOCKER_E2E_STORE_MANAGER_ADMIN_ID = 'docker-e2e-store-manager';
export const DOCKER_E2E_INACTIVE_ADMIN_ID = 'docker-e2e-inactive-admin';
export const DOCKER_E2E_CATEGORY_ID = 'docker-e2e-category';
export const DOCKER_E2E_PRODUCT_ID = 'docker-e2e-product';
export const DOCKER_E2E_INSUFFICIENT_STOCK_PRODUCT_ID = 'docker-e2e-insufficient-stock-product';
export const DOCKER_E2E_COMMUNITY_ID = 'docker-e2e-community';
export const DOCKER_E2E_PICKUP_STORE_ID = 'docker-e2e-pickup-store';
export const DOCKER_E2E_DELIVERY_RULE_ID = 'docker-e2e-delivery-rule';
export const DOCKER_E2E_INITIAL_STOCK = 100000;

export async function ensureDockerE2eFixtures(prisma: PrismaClient) {
  await prisma.category.upsert({
    where: { id: DOCKER_E2E_CATEGORY_ID },
    update: { name: 'Docker E2E 测试分类', status: 'active', sort_order: 9999 },
    create: { id: DOCKER_E2E_CATEGORY_ID, name: 'Docker E2E 测试分类', status: 'active', sort_order: 9999 }
  });

  await prisma.product.upsert({
    where: { id: DOCKER_E2E_PRODUCT_ID },
    update: {
      category_id: DOCKER_E2E_CATEGORY_ID,
      name: 'Docker E2E 测试商品',
      price_cents: 4590,
      cost_price_cents: 2000,
      stock: DOCKER_E2E_INITIAL_STOCK,
      unit: '份',
      stock_unit: '份',
      sale_unit: '份',
      stock_deduct_quantity: 1,
      is_group_enabled: true,
      status: 'active'
    },
    create: {
      id: DOCKER_E2E_PRODUCT_ID,
      name: 'Docker E2E 测试商品',
      category_id: DOCKER_E2E_CATEGORY_ID,
      price_cents: 4590,
      cost_price_cents: 2000,
      stock: DOCKER_E2E_INITIAL_STOCK,
      unit: '份',
      stock_unit: '份',
      sale_unit: '份',
      stock_deduct_quantity: 1,
      is_group_enabled: true,
      status: 'active'
    }
  });

  await prisma.product.upsert({
    where: { id: DOCKER_E2E_INSUFFICIENT_STOCK_PRODUCT_ID },
    update: {
      category_id: DOCKER_E2E_CATEGORY_ID,
      name: 'Docker E2E 低库存测试商品',
      price_cents: 1000,
      cost_price_cents: 500,
      stock: 2,
      unit: '份',
      stock_unit: '份',
      sale_unit: '份',
      stock_deduct_quantity: 3,
      is_group_enabled: false,
      status: 'active'
    },
    create: {
      id: DOCKER_E2E_INSUFFICIENT_STOCK_PRODUCT_ID,
      name: 'Docker E2E 低库存测试商品',
      category_id: DOCKER_E2E_CATEGORY_ID,
      price_cents: 1000,
      cost_price_cents: 500,
      stock: 2,
      unit: '份',
      stock_unit: '份',
      sale_unit: '份',
      stock_deduct_quantity: 3,
      is_group_enabled: false,
      status: 'active'
    }
  });

  await prisma.community.upsert({
    where: { id: DOCKER_E2E_COMMUNITY_ID },
    update: { name: 'Docker E2E 测试社区', address: 'Docker E2E 测试社区地址', status: 'active' },
    create: { id: DOCKER_E2E_COMMUNITY_ID, name: 'Docker E2E 测试社区', address: 'Docker E2E 测试社区地址', status: 'active' }
  });

  await prisma.pickupStore.upsert({
    where: { id: DOCKER_E2E_PICKUP_STORE_ID },
    update: { name: 'Docker E2E 测试自提点', address: 'Docker E2E 测试自提点地址', phone: '13800000000', status: 'active' },
    create: { id: DOCKER_E2E_PICKUP_STORE_ID, name: 'Docker E2E 测试自提点', address: 'Docker E2E 测试自提点地址', phone: '13800000000', status: 'active' }
  });

  await prisma.deliveryRuleConfig.upsert({
    where: { id: DOCKER_E2E_DELIVERY_RULE_ID },
    update: {
      pickup_store_id: DOCKER_E2E_PICKUP_STORE_ID,
      enabled: true,
      base_fee_cents: 300,
      free_threshold_cents: null,
      max_distance_km: null,
      service_radius_text: 'Docker E2E 测试配送范围',
      notice: 'Docker E2E 测试配送规则',
      time_windows_json: [{ code: 'docker_e2e_window', label: 'Docker E2E 时段', start_time: '10:00', end_time: '12:00' }]
    },
    create: {
      id: DOCKER_E2E_DELIVERY_RULE_ID,
      pickup_store_id: DOCKER_E2E_PICKUP_STORE_ID,
      enabled: true,
      base_fee_cents: 300,
      free_threshold_cents: null,
      max_distance_km: null,
      service_radius_text: 'Docker E2E 测试配送范围',
      notice: 'Docker E2E 测试配送规则',
      time_windows_json: [{ code: 'docker_e2e_window', label: 'Docker E2E 时段', start_time: '10:00', end_time: '12:00' }]
    }
  });

  await prisma.adminUser.upsert({
    where: { id: DOCKER_E2E_ADMIN_ID },
    update: { role: 'super_admin', status: 'active' },
    create: {
      id: DOCKER_E2E_ADMIN_ID,
      username: 'docker-e2e-admin-user',
      password_hash: 'docker-e2e-placeholder-not-for-login',
      role: 'super_admin',
      status: 'active'
    }
  });

  await prisma.adminUser.upsert({
    where: { id: DOCKER_E2E_OPERATOR_ADMIN_ID },
    update: { role: 'operator', status: 'active' },
    create: {
      id: DOCKER_E2E_OPERATOR_ADMIN_ID,
      username: 'docker-e2e-operator-user',
      password_hash: 'docker-e2e-placeholder-not-for-login',
      role: 'operator',
      status: 'active'
    }
  });

  await prisma.adminUser.upsert({
    where: { id: DOCKER_E2E_STORE_MANAGER_ADMIN_ID },
    update: { role: 'store_manager', status: 'active' },
    create: {
      id: DOCKER_E2E_STORE_MANAGER_ADMIN_ID,
      username: 'docker-e2e-store-manager-user',
      password_hash: 'docker-e2e-placeholder-not-for-login',
      role: 'store_manager',
      status: 'active'
    }
  });

  await prisma.adminUser.upsert({
    where: { id: DOCKER_E2E_INACTIVE_ADMIN_ID },
    update: { role: 'super_admin', status: 'inactive' },
    create: {
      id: DOCKER_E2E_INACTIVE_ADMIN_ID,
      username: 'docker-e2e-inactive-admin-user',
      password_hash: 'docker-e2e-placeholder-not-for-login',
      role: 'super_admin',
      status: 'inactive'
    }
  });
}
