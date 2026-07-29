import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import ts from 'typescript';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';
import {
  enableConsumerVerifierMockIdentity,
  injectAsConsumer,
} from './lib/consumer-verifier-request.js';

enableConsumerVerifierMockIdentity();
process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l22-${Date.now()}`;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function json(response: Awaited<ReturnType<typeof app.inject>>) { const body = response.json() as { success: boolean; data: any; message: string }; assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`); return body.data; }
function source(path: string) { return readFileSync(path, 'utf8'); }
function assertNotExposed(payload: unknown, label: string) { const text = JSON.stringify(payload); for (const field of ['cost_price_cents','commission_value','commission_type','stock_deduct_quantity','receiver_phone']) assert(!text.includes(`"${field}"`), `${label} exposed ${field}`); for (const phone of ['13812342222','13912342222','13712342222']) assert(!text.includes(phone), `${label} exposed full receiver phone`); }

function ast(path: string) { return ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); }
function walk(node: ts.Node, collect: (node: ts.Node) => void) { collect(node); ts.forEachChild(node, (child) => walk(child, collect)); }
function key(member: ts.ObjectLiteralElementLike) {
  const name = member.name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) return name.text;
  if (name && ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
}
function member(object: ts.ObjectLiteralExpression, name: string) {
  const found = object.properties.filter((item) => key(item) === name);
  return found.length === 1 ? found[0] : undefined;
}
function value(object: ts.ObjectLiteralExpression, name: string) {
  const found = member(object, name);
  return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}
function hasOnlyKeys(object: ts.ObjectLiteralExpression, expected: string) {
  const names = object.properties.map(key);
  return object.properties.every(ts.isPropertyAssignment) && names.every(Boolean) && names.sort().join(',') === expected;
}
function pageObject(file: ts.SourceFile) {
  const pages: ts.ObjectLiteralExpression[] = [];
  walk(file, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Page'
      && ts.isObjectLiteralExpression(node.arguments[0])) pages.push(node.arguments[0]);
  });
  return pages.length === 1 ? pages[0] : undefined;
}
function pageMethod(file: ts.SourceFile, name: string) {
  const page = pageObject(file);
  const found = page && member(page, name);
  return found && ts.isMethodDeclaration(found) ? found : undefined;
}
function calls(method: ts.MethodDeclaration | undefined, name: string) {
  const found: ts.CallExpression[] = [];
  if (method) walk(method.body!, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found.push(node);
  });
  return found;
}
function literal(expression: ts.Expression | undefined) {
  return expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) ? expression.text : undefined;
}
function exactOrderUrl(expression: ts.Expression | undefined, head: string, tail = '') {
  if (!expression || !ts.isTemplateExpression(expression) || expression.head.text !== head || expression.templateSpans.length !== 1) return false;
  const id = expression.templateSpans[0].expression;
  return ts.isPropertyAccessExpression(id) && id.name.text === 'order_id'
    && ts.isPropertyAccessExpression(id.expression) && id.expression.name.text === 'data'
    && id.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    && expression.templateSpans[0].literal.text === tail;
}
function isDirectThisCall(call: ts.CallExpression, name: string) {
  return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === name
    && call.expression.expression.kind === ts.SyntaxKind.ThisKeyword;
}
function isRequestChain(call: ts.CallExpression): boolean {
  if (ts.isIdentifier(call.expression)) return call.expression.text === 'request';
  return ts.isPropertyAccessExpression(call.expression) && ['then', 'catch', 'finally'].includes(call.expression.name.text)
    && ts.isCallExpression(call.expression.expression) && isRequestChain(call.expression.expression);
}
function isInsideRequestThen(node: ts.Node, submit: ts.MethodDeclaration) {
  let parent: ts.Node | undefined = node.parent;
  while (parent && parent !== submit) {
    if (ts.isArrowFunction(parent)) {
      const call = parent.parent;
      return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
        && call.expression.name.text === 'then' && ts.isCallExpression(call.expression.expression)
        && isRequestChain(call.expression.expression);
    }
    parent = parent.parent;
  }
  return false;
}
function directlySetsProductRefundLimit(requestCall: ts.CallExpression) {
  const access = requestCall.parent;
  const thenCall = access && ts.isPropertyAccessExpression(access) && access.name.text === 'then' ? access.parent : undefined;
  const callback = thenCall && ts.isCallExpression(thenCall) ? thenCall.arguments[0] : undefined;
  if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body) || !ts.isIdentifier(callback.parameters[0]?.name)) return false;
  const response = callback.parameters[0].name.text;
  return callback.body.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
    const call = statement.expression;
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'setData'
      || call.expression.expression.kind !== ts.SyntaxKind.ThisKeyword || !call.arguments[0] || !ts.isObjectLiteralExpression(call.arguments[0])
      || call.arguments[0].properties.some(ts.isSpreadAssignment)) return false;
    const amount = value(call.arguments[0], 'refund_amount_yuan');
    const argument = amount && ts.isCallExpression(amount) && ts.isIdentifier(amount.expression)
      && amount.expression.text === 'formatOrderAmount' ? amount.arguments[0] : undefined;
    return !!argument && ts.isPropertyAccessExpression(argument)
      && argument.name.text === 'remaining_product_refundable_amount_cents'
      && ts.isIdentifier(argument.expression) && argument.expression.text === response;
  });
}
function quotedAttributes(raw: string) {
  const attributes = new Map<string, string>();
  let rest = raw.replace(/\/\s*$/, '').trim();
  while (rest) {
    const found = rest.match(/^([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/);
    if (!found || attributes.has(found[1])) return undefined;
    attributes.set(found[1], found[2] ?? found[3]);
    rest = rest.slice(found[0].length);
  }
  return attributes;
}
function allowedAttributes(raw: string, allowed: string[]) {
  const attributes = quotedAttributes(raw);
  return attributes && [...attributes.keys()].every((name) => allowed.includes(name)) ? attributes : undefined;
}
function controlAttributes(raw: string, semantic: string[]) {
  const attributes = allowedAttributes(raw, [...semantic, 'class', 'data-testid']);
  if (!attributes) return undefined;
  const className = attributes.get('class');
  const testId = attributes.get('data-testid');
  if ((className !== undefined && !/^[\w -]+$/.test(className))
    || (testId !== undefined && !/^[\w-]+$/.test(testId))) return undefined;
  return attributes;
}

function verifyProductRefundApplicationMiniapp() {
  const orderDetail = ast('apps/miniapp/pages/orders/detail/index.js');
  const apply = ast('apps/miniapp/pages/after-sales/apply/index.js');
  const failures: string[] = [];
  const navMethod = pageMethod(orderDetail, 'applyAfterSale');
  const navigations: ts.CallExpression[] = [];
  if (navMethod) walk(navMethod.body!, (node) => {
    if (ts.isCallExpression(node)) navigations.push(node);
  });
  const navigation = navigations[0];
  const navigationOptions = navigation?.arguments[0];
  if (navigations.length !== 1 || !ts.isPropertyAccessExpression(navigation.expression)
    || navigation.expression.name.text !== 'navigateTo' || !ts.isIdentifier(navigation.expression.expression)
    || navigation.expression.expression.text !== 'wx' || !navigationOptions || !ts.isObjectLiteralExpression(navigationOptions)
    || !hasOnlyKeys(navigationOptions, 'url')
    || !exactOrderUrl(value(navigationOptions, 'url'), '/pages/after-sales/apply/index?order_id=')) {
    failures.push('applyAfterSale must contain exactly one order-id-only wx.navigateTo call');
  }

  const loadRequests = calls(pageMethod(apply, 'loadOrder'), 'request');
  const getOptions = loadRequests[0]?.arguments[0];
  const getMethodCount = getOptions && ts.isObjectLiteralExpression(getOptions)
    ? getOptions.properties.filter((item) => key(item) === 'method').length : -1;
  const safeGet = loadRequests.length === 1 && !!getOptions && ts.isObjectLiteralExpression(getOptions)
    && (hasOnlyKeys(getOptions, 'url') || hasOnlyKeys(getOptions, 'method,url'))
    && exactOrderUrl(value(getOptions, 'url'), '/api/me/orders/')
    && (getMethodCount === 0 || (getMethodCount === 1 && literal(value(getOptions, 'method'))?.toUpperCase() === 'GET'));
  if (!safeGet) failures.push('loadOrder must contain exactly one exact owned-order GET request');

  const refundAssignments: ts.Expression[] = [];
  let unsafeSetData = false;
  const applyPage = pageObject(apply);
  if (applyPage) walk(applyPage, (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'setData'
      && node.expression.kind === ts.SyntaxKind.ThisKeyword
      && (!ts.isCallExpression(node.parent) || node.parent.expression !== node)) unsafeSetData = true;
    if (ts.isElementAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword
      && literal(node.argumentExpression) === 'setData') unsafeSetData = true;
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
      && node.initializer?.kind === ts.SyntaxKind.ThisKeyword
      && node.name.elements.some((item) => (item.propertyName || item.name).getText(apply) === 'setData')) unsafeSetData = true;
    if (!ts.isCallExpression(node) || !isDirectThisCall(node, 'setData')) return;
    let owner: ts.Node | undefined = node.parent;
    while (owner && owner !== applyPage && !ts.isMethodDeclaration(owner)) owner = owner.parent;
    const update = node.arguments[0];
    if (!update || !ts.isObjectLiteralExpression(update) || update.properties.some(ts.isSpreadAssignment)) { unsafeSetData = true; return; }
    for (const item of update.properties) {
      const name = key(item);
      const safeInputField = owner && ts.isMethodDeclaration(owner) && key(owner) === 'onInput' && ts.isPropertyAssignment(item)
        && ts.isComputedPropertyName(item.name) && item.name.expression.getText(apply) === 'event.currentTarget.dataset.field';
      if ((!name && !safeInputField) || (name && !ts.isPropertyAssignment(item))) unsafeSetData = true;
      if (name === 'refund_amount_yuan' && ts.isPropertyAssignment(item)) refundAssignments.push(item.initializer);
    }
  });
  const data = applyPage && value(applyPage, 'data');
  const initialRefund = data && ts.isObjectLiteralExpression(data)
    ? data.properties.filter((item) => key(item) === 'refund_amount_yuan') : [];
  const safeInitialRefund = !!data && ts.isObjectLiteralExpression(data)
    && !data.properties.some((item) => ts.isSpreadAssignment(item) || (ts.isComputedPropertyName(item.name) && !key(item)))
    && initialRefund.length === 1 && ts.isPropertyAssignment(initialRefund[0]) && literal(initialRefund[0].initializer) === '0.00';
  if (unsafeSetData) failures.push('after-sale page setData calls must be explicit and fail closed');
  if (!safeInitialRefund || refundAssignments.length !== 1 || !safeGet || !directlySetsProductRefundLimit(loadRequests[0])) {
    failures.push('refund_amount_yuan must initialize once and display only order.remaining_product_refundable_amount_cents');
  }

  const submitMethod = pageMethod(apply, 'submit');
  const submitRequests = calls(submitMethod, 'request');
  const postOptions = submitRequests[0]?.arguments[0];
  const safePost = submitRequests.length === 1 && !!postOptions && ts.isObjectLiteralExpression(postOptions)
    && hasOnlyKeys(postOptions, 'data,method,url')
    && exactOrderUrl(value(postOptions, 'url'), '/api/me/orders/', '/after-sales')
    && literal(value(postOptions, 'method'))?.toUpperCase() === 'POST';
  if (!safePost) failures.push('submit must contain exactly one exact after-sales POST request');
  if (postOptions && ts.isObjectLiteralExpression(postOptions)) {
    const data = value(postOptions, 'data');
    if (!data || !ts.isObjectLiteralExpression(data)) failures.push('after-sales POST data must be an explicit object literal');
    else {
      const names: string[] = [];
      for (const item of data.properties) {
        const name = key(item);
        if (!name || !ts.isPropertyAssignment(item)) failures.push('after-sales POST data must not use spread, shorthand, methods, or dynamic keys');
        else {
          names.push(name);
          let nested = false;
          walk(item.initializer, (node) => { nested ||= ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node); });
          if (nested) failures.push('after-sales POST data must be flat');
        }
      }
      if (names.sort().join(',') !== 'description,reason,requested_product_refund_cents,type') {
        failures.push('after-sales POST data must contain only type, reason, description, and requested_product_refund_cents');
      }
      const requestedProductRefund = value(data, 'requested_product_refund_cents');
      if (!requestedProductRefund || !ts.isIdentifier(requestedProductRefund)
        || requestedProductRefund.text !== 'requestedProductRefundCents') {
        failures.push('requested_product_refund_cents must use the validated local amount');
      }
    }
  }
  let redirectCount = 0;
  let unsafeSubmitCall = false;
  if (submitMethod) walk(submitMethod.body!, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'request') return;
    if (isRequestChain(node)) {
      if (!ts.isPropertyAccessExpression(node.expression) || node.arguments.length !== 1 || !ts.isArrowFunction(node.arguments[0])) unsafeSubmitCall = true;
      return;
    }
    if (isDirectThisCall(node, 'setData')) return;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'parseRefundYuan'
      && node.arguments.length === 1 && ts.isPropertyAccessExpression(node.arguments[0])
      && node.arguments[0].name.text === 'product_refund_amount_yuan'
      && ts.isPropertyAccessExpression(node.arguments[0].expression)
      && node.arguments[0].expression.name.text === 'data'
      && node.arguments[0].expression.expression.kind === ts.SyntaxKind.ThisKeyword) return;
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'redirectTo'
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'wx'
      && !!node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0]) && hasOnlyKeys(node.arguments[0], 'url')
      && exactOrderUrl(value(node.arguments[0], 'url'), '/pages/after-sales/detail/index?order_id=')
      && isInsideRequestThen(node, submitMethod)) redirectCount += 1;
    else unsafeSubmitCall = true;
  });
  if (unsafeSubmitCall || redirectCount !== 1) failures.push('submit calls must use only the exact request chain, setData, and success redirect');

  const wxml = source('apps/miniapp/pages/after-sales/apply/index.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const displayText = [...wxml.matchAll(/<(view|text)\b[^>]*>([^<]*)<\/\1>/gi)].map((match) => match[2]);
  if (!displayText.some((text) => text.trim() === '申请商品退款金额（元）')) {
    failures.push('after-sale page must label the editable product refund amount');
  }
  if (!displayText.some((text) => /^商品剩余最多可退\s*¥\s*\{\{\s*refund_amount_yuan\s*\}\}$/.test(text.trim()))) {
    failures.push('after-sale page must display the server-owned product refund limit');
  }
  if (/<(?:editor|slider|switch|checkbox(?:-group)?|radio(?:-group)?|form|navigator|picker-view(?:-column)?)\b/i.test(wxml)) {
    failures.push('after-sale page contains a forbidden interactive control');
  }
  const pickers = [...wxml.matchAll(/<picker\b([^>]*)>/gi)];
  const picker = pickers.length === 1 ? allowedAttributes(pickers[0][1], ['range', 'range-key', 'value', 'bindchange', 'class']) : undefined;
  if (!picker || picker.get('range') !== '{{types}}' || picker.get('range-key') !== 'label'
    || picker.get('value') !== '{{typeIndex}}' || picker.get('bindchange') !== 'onTypeChange'
    || (picker.has('class') && !/^[\w -]+$/.test(picker.get('class')!))) failures.push('after-sale page must contain exactly one approved type picker');
  const inputs = [...wxml.matchAll(/<input\b([^>]*)\/?>/gi)];
  const input = inputs.length === 1
    ? controlAttributes(inputs[0][1], ['type', 'data-field', 'value', 'bindinput'])
    : undefined;
  if (!input || input.get('type') !== 'digit'
    || input.get('data-field') !== 'product_refund_amount_yuan'
    || input.get('value') !== '{{product_refund_amount_yuan}}'
    || input.get('bindinput') !== 'onInput') {
    failures.push('after-sale page must contain exactly one approved product refund amount input');
  }
  const textareas = [...wxml.matchAll(/<textarea\b([^>]*)\/?>/gi)];
  const withoutApprovedInputs = wxml
    .replace(/<textarea\b[^>]*\/?>/gi, '')
    .replace(/<input\b[^>]*\/?>/gi, '');
  if (/\bdata-field\s*=/i.test(withoutApprovedInputs)) failures.push('only approved refund form controls may declare data-field');
  const expectedTextarea = new Map([['reason', ['{{reason}}', '请描述遇到的问题']], ['description', ['{{description}}', '可选']]]);
  const textareaFields: string[] = [];
  for (const textarea of textareas) {
    const attributes = controlAttributes(textarea[1], ['data-field', 'value', 'bindinput', 'placeholder']);
    const field = attributes?.get('data-field');
    const expected = field && expectedTextarea.get(field);
    if (!attributes || !field || !expected || attributes.get('value') !== expected[0]
      || attributes.get('placeholder') !== expected[1] || attributes.get('bindinput') !== 'onInput') {
      failures.push('textarea attributes must match the approved reason/description controls');
    }
    else textareaFields.push(field);
  }
  if (textareas.length !== 2 || textareaFields.sort().join(',') !== 'description,reason') failures.push('after-sale page must contain only the reason and description textareas');
  const buttons = [...wxml.matchAll(/<button\b([^>]*)>/gi)];
  const button = buttons.length === 1 ? controlAttributes(buttons[0][1], ['type', 'loading', 'bindtap', 'disabled']) : undefined;
  const type = button?.get('type');
  if (!button || (type !== undefined && type !== 'primary') || button.get('loading') !== '{{submitting}}'
    || button.get('bindtap') !== 'submit' || button.get('disabled') !== '{{!can_submit || submitting || loading}}') {
    failures.push('after-sale page must contain exactly one approved submit button');
  }
  const events = [...wxml.matchAll(/\b((?:bind|catch|capture-bind:|capture-catch:)[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((match) => `${match[1]}:${match[2] ?? match[3] ?? match[4]}`).sort();
  if (events.join(',') !== ['bindchange:onTypeChange', 'bindinput:onInput', 'bindinput:onInput', 'bindinput:onInput', 'bindtap:submit'].sort().join(',')) {
    failures.push('after-sale page contains a non-approved event binding');
  }
  assert(failures.length === 0, `Miniapp product refund application gate failed:\n- ${[...new Set(failures)].join('\n- ')}`);
}

async function main() {
  verifyProductRefundApplicationMiniapp();
  if (process.argv.includes('--static-only')) {
    console.log('L22 miniapp product refund application static verification passed.');
    return;
  }
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 2200, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L22 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup`, address: 'L22 自提点', phone: '13800022000', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L22开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L22用户', role: 'customer', status: 'active' } });
  const other = await prisma.user.create({ data: { openid: `${prefix}-other-openid`, nickname: 'L22其他用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 2200, cost_price_cents: 900, stock: 80, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 1990, start_time: new Date(), end_time: new Date(Date.now() + 86400000), pickup_time: new Date(Date.now() + 172800000), status: 'pending' } });

  const normalOrder = await json(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, client_request_id: `${prefix}-normal`, quantity: 2, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L22普通用户', receiver_phone: '13812342222' } }));
  await json(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));
  const groupOrder = await json(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L22开团用户', receiver_phone: '13912342222' } }));
  await json(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  const otherOrder = await json(await injectAsConsumer(app, other.id, { method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, client_request_id: `${prefix}-other`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L22其他用户', receiver_phone: '13712342222' } }));

  const list = await json(await app.inject({ method: 'GET', url: '/api/me/orders?page_size=100', headers: { 'x-user-id': customer.id } }));
  assert(list.items.some((item: any) => item.order_id === normalOrder.id && item.order_type === 'normal'), 'list should include normal order');
  assert(list.items.some((item: any) => item.order_id === groupOrder.id && item.order_type === 'group_buy'), 'list should include group order');
  assert(!list.items.some((item: any) => item.order_id === otherOrder.id), 'list should not include other user order');
  assertNotExposed(list, 'order list');
  const normals = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=normal&page_size=100', headers: { 'x-user-id': customer.id } }));
  assert(normals.items.every((item: any) => item.order_type === 'normal'), 'normal filter failed');
  const groups = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=group_buy&page_size=100', headers: { 'x-user-id': customer.id } }));
  assert(groups.items.every((item: any) => item.order_type === 'group_buy'), 'group_buy filter failed');

  const detail = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(detail.product.name === product.name, 'detail product mismatch');
  assert(detail.pickup.pickup_store_name === pickupStore.name, 'detail pickup mismatch');
  assert(detail.receiver.receiver_phone_masked && !detail.receiver.receiver_phone_masked.includes('1234'), 'detail should mask phone');
  assertNotExposed(detail, 'order detail');
  const pickup = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/pickup-code`, headers: { 'x-user-id': customer.id } }));
  assert(pickup.pickup_code && pickup.receiver_phone_masked, 'pickup code should include masked phone');
  assertNotExposed(pickup, 'pickup code');
  const expectedFullRefundCents = detail.remaining_refundable_amount_cents;
  assert(expectedFullRefundCents === 4400, 'L22 fixture should have 4400 cents remaining');

  const zeroRemainderOrder = await json(await injectAsConsumer(app, customer.id, {
    method: 'POST',
    url: '/api/orders/normal',
    payload: {
      product_id: product.id,
      client_request_id: `${prefix}-zero-remainder`,
      quantity: 1,
      pickup_store_id: pickupStore.id,
      community_id: community.id,
      receiver_name: 'L22零余额用户',
      receiver_phone: '13612342222',
    },
  }));
  await json(await injectAsConsumer(app, customer.id, {
    method: 'POST',
    url: '/api/payments/mock',
    payload: { order_id: zeroRemainderOrder.id },
  }));
  await prisma.order.update({
    where: { id: zeroRemainderOrder.id },
    data: {
      refund_amount_cents: 2200,
      product_refund_amount_cents: 2200,
      refund_status: 'success',
      order_status: 'refunded',
    },
  });
  const zeroRemainderResponse = await app.inject({
    method: 'POST',
    url: `/api/me/orders/${zeroRemainderOrder.id}/after-sales`,
    headers: { 'x-user-id': customer.id },
    payload: { type: 'bad_quality', reason: '已无可退金额' },
  });
  const zeroRemainderBody = zeroRemainderResponse.json() as {
    success: boolean;
    message: string;
  };
  assert(zeroRemainderResponse.statusCode === 400, 'zero remainder after-sale must return 400');
  assert(zeroRemainderBody.message === '订单没有可退金额', 'zero remainder message mismatch');
  assert(
    !(await prisma.afterSaleCase.findFirst({ where: { order_id: zeroRemainderOrder.id } })),
    'zero remainder after-sale must not create a case',
  );

  const afterSale = await json(await app.inject({
    method: 'POST',
    url: `/api/me/orders/${normalOrder.id}/after-sales`,
    headers: { 'x-user-id': customer.id },
    payload: {
      type: 'bad_quality',
      reason: '品质问题',
      requested_refund_cents: 100,
      requested_product_refund_cents: 1,
      requested_delivery_refund_cents: 99,
    },
  }));
  assert(
    afterSale.requested_refund_cents === expectedFullRefundCents,
    'user after-sale must derive the full remaining refundable amount on the server',
  );
  assert(afterSale.requested_product_refund_cents == null, 'user after-sale must ignore product split amount');
  assert(afterSale.requested_delivery_refund_cents == null, 'user after-sale must ignore delivery split amount');
  assert(afterSale.status === 'submitted', 'after sale should submit');
  assertNotExposed(afterSale, 'after sale create');
  const afterSales = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': customer.id } }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'after sale list should include new case');
  assertNotExposed(afterSales, 'after sale list');

  const requiredFiles = ['apps/miniapp/pages/orders/index.js','apps/miniapp/pages/orders/index.wxml','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','apps/miniapp/pages/pickup/code/index.js','apps/miniapp/pages/pickup/code/index.wxml','apps/miniapp/pages/after-sales/apply/index.js','apps/miniapp/pages/after-sales/apply/index.wxml','apps/miniapp/pages/after-sales/detail/index.js','apps/miniapp/pages/after-sales/detail/index.wxml','apps/miniapp/pages/mine/index.js','apps/miniapp/pages/mine/index.wxml'];
  requiredFiles.forEach((file) => assert(existsSync(file), `${file} should exist`));
  const appJson = source('apps/miniapp/app.json');
  for (const page of ['pages/mine/index','pages/orders/index','pages/orders/detail/index','pages/pickup/code/index','pages/after-sales/apply/index','pages/after-sales/detail/index']) assert(appJson.includes(page), `app.json should include ${page}`);
  const miniappFiles = [...requiredFiles, 'apps/miniapp/app.json', 'apps/miniapp/utils/order.js'];
  const miniappSource = miniappFiles.map(source).join('\n');
  for (const needle of ['/api/me/orders','/pickup-code','/after-sales','bad_quality']) assert(miniappSource.includes(needle), `miniapp source should include ${needle}`);
  assert(miniappSource.includes('receiver_phone_masked') || miniappSource.includes('masked'), 'miniapp source should use masked phone');
  for (const needle of [`type: 'refund'`, `type: "refund"`, 'wx.requestPayment', '/api/payments/wechat', 'wx.login', 'wx.getLocation', 'cost_price_cents', 'commission_value', 'stock_deduct_quantity']) assert(!miniappSource.includes(needle), `miniapp source should not include ${needle}`);
  scanComplianceFiles([...miniappFiles, 'scripts/verify-l22-miniapp-order-center-local.ts', 'docs/reviews/l22-miniapp-order-center.md']);
  console.log('Compliance scan passed.');
  console.log('L22 miniapp order center verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
