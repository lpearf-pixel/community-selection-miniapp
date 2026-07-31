import { CommissionType, ProductStatus, UserRole } from '@prisma/client';
import { prisma } from '../apps/api/src/db.js';
import type { AdminAccessContext } from '../apps/api/src/modules/admin-access/admin-access-control.js';
import {
  executeReviewProductCompliance,
  executeSubmitProductCompliance,
  getProductComplianceState,
} from '../apps/api/src/modules/compliance/product-compliance-executor.js';

const complianceAdminId = 'seed-compliance-admin';
const complianceSupplierId = 'seed-compliance-supplier';
const complianceContext: AdminAccessContext = {
  admin_user_id: complianceAdminId,
  role: 'super_admin',
  permissions: ['admin.full_access'],
  is_super_admin: true,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: true,
    can_access_all_communities: true,
  },
  data_scope_source: 'session',
};
const complianceAdminMeta = {
  ip_address: '127.0.0.1',
  user_agent: 'community-selection-seed',
};

const categories = [
  { name: '有机蔬菜', compliance_code: 'vegetable', sort_order: 1 },
  { name: '鸡蛋', compliance_code: 'egg', sort_order: 2 },
  { name: '水果', compliance_code: 'fruit', sort_order: 3 },
  { name: '杂粮', compliance_code: 'grain', sort_order: 4 },
  { name: '干货', compliance_code: 'primary_dried_goods', sort_order: 5 }
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

  await prisma.adminUser.upsert({
    where: { username: complianceAdminId },
    update: { status: 'active', role: 'super_admin' },
    create: {
      id: complianceAdminId,
      username: complianceAdminId,
      password_hash: 'seed-compliance-only',
      role: 'super_admin',
      status: 'active',
    },
  });

  await prisma.supplier.upsert({
    where: { name: '社区甄选演示供应商' },
    update: {
      subject_type: 'company',
      profile_fingerprint: 'seed-supplier-profile-v1',
      profile_version: 1,
      status: 'active',
    },
    create: {
      id: complianceSupplierId,
      name: '社区甄选演示供应商',
      subject_type: 'company',
      profile_fingerprint: 'seed-supplier-profile-v1',
      profile_version: 1,
      status: 'active',
    },
  });

  await prisma.supplierQualification.upsert({
    where: {
      supplier_id_qualification_type_version: {
        supplier_id: complianceSupplierId,
        qualification_type: 'business_license',
        version: 1,
      },
    },
    update: {
      status: 'approved',
      critical_fingerprint: 'seed-business-license-v1',
      reviewed_by_admin_id: complianceAdminId,
      reviewed_at: new Date('2026-01-01T00:00:00.000Z'),
      valid_from: new Date('2025-01-01T00:00:00.000Z'),
      expires_at: new Date('2035-01-01T00:00:00.000Z'),
    },
    create: {
      supplier_id: complianceSupplierId,
      qualification_type: 'business_license',
      version: 1,
      status: 'approved',
      object_key: 'demo/compliance/business-license.pdf',
      file_sha256: 'a'.repeat(64),
      masked_summary: { holder: '社***商' },
      critical_fingerprint: 'seed-business-license-v1',
      submitted_by_admin_id: complianceAdminId,
      reviewed_by_admin_id: complianceAdminId,
      reviewed_at: new Date('2026-01-01T00:00:00.000Z'),
      review_note: '演示种子资质',
      valid_from: new Date('2025-01-01T00:00:00.000Z'),
      expires_at: new Date('2035-01-01T00:00:00.000Z'),
    },
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

  const seededProducts = [];
  for (const [productIndex, product] of products.entries()) {
    const category_id = categoryMap.get(product.category);
    if (!category_id) throw new Error(`Missing category: ${product.category}`);
    const seededProduct = await prisma.product.upsert({
      where: { name: product.name },
      update: {
        category_id,
        price_cents: product.price_cents,
        cost_price_cents: product.cost_price_cents,
        stock: product.stock,
        unit: product.unit,
        primary_supplier_id: complianceSupplierId,
        origin_text: '社区甄选演示产地',
        labels: ['演示商品'],
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
        primary_supplier_id: complianceSupplierId,
        origin_text: '社区甄选演示产地',
        labels: ['演示商品'],
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
    seededProducts.push({ product: seededProduct, index: productIndex });
  }

  for (const seeded of seededProducts) {
    const batchId = `seed-compliance-batch-${seeded.index + 1}`;
    const batchNo = `SEED-COMPLIANCE-${seeded.index + 1}`;
    const evidenceId = `seed-compliance-evidence-${seeded.index + 1}`;
    await prisma.productBatch.upsert({
      where: { batch_no: batchNo },
      update: {
        product_id: seeded.product.id,
        supplier_id: complianceSupplierId,
        product_name_snapshot: seeded.product.name,
        supplier_name_snapshot: '社区甄选演示供应商',
        stock_unit: 'piece',
        initial_quantity: seeded.product.stock,
        remaining_quantity: seeded.product.stock,
        origin_text: '社区甄选演示产地',
        arrival_date: new Date('2026-01-01T00:00:00.000Z'),
        status: 'active',
      },
      create: {
        id: batchId,
        batch_no: batchNo,
        product_id: seeded.product.id,
        supplier_id: complianceSupplierId,
        product_name_snapshot: seeded.product.name,
        supplier_name_snapshot: '社区甄选演示供应商',
        stock_unit: 'piece',
        initial_quantity: seeded.product.stock,
        remaining_quantity: seeded.product.stock,
        origin_text: '社区甄选演示产地',
        arrival_date: new Date('2026-01-01T00:00:00.000Z'),
        status: 'active',
      },
    });
    await prisma.productBatchEvidence.upsert({
      where: { id: evidenceId },
      update: {
        batch_id: batchId,
        status: 'active',
        evidence_fingerprint: `seed-purchase-evidence-v1-${seeded.index + 1}`,
      },
      create: {
        id: evidenceId,
        batch_id: batchId,
        evidence_type: 'purchase_voucher',
        status: 'active',
        object_key: `demo/compliance/purchase-voucher-${seeded.index + 1}.pdf`,
        file_sha256: 'b'.repeat(64),
        masked_summary: { voucher: `演***${seeded.index + 1}` },
        evidence_fingerprint: `seed-purchase-evidence-v1-${seeded.index + 1}`,
        created_by_admin_id: complianceAdminId,
      },
    });

    const state = await getProductComplianceState(seeded.product.id);
    if (!state.latest_review?.effective_valid) {
      const submitted = await executeSubmitProductCompliance({
        product_id: seeded.product.id,
        context: complianceContext,
        admin_meta: complianceAdminMeta,
        command: {
          expected_fingerprint: state.current_fingerprint,
          expected_updated_at: null,
          idempotency_key: `seed-product-${seeded.index + 1}-submit-v1`,
        },
      });
      await executeReviewProductCompliance({
        review_id: submitted.id,
        context: complianceContext,
        admin_meta: complianceAdminMeta,
        command: {
          decision: 'approve',
          expected_status: 'submitted',
          review_note: '演示种子商品合规通过',
          idempotency_key: `seed-product-${seeded.index + 1}-review-v1`,
        },
      });
    }
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
