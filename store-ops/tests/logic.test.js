'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Logic.gs'), 'utf8'), ctx);

// Object tạo trong vm khác prototype, đổi về object thường trước khi so sánh.
const plain = (value) => JSON.parse(JSON.stringify(value));

const CONFIG = {
  orders_open: true,
  max_cups: 600,
  low_stock_alert_cups: 550,
  call_threshold_cups: 5,
  max_cups_per_phone_public: 10,
  shipping_fees: { tu_lay: 0, trong_2km: 0, den_10km: 10000 },
};
const CATALOG = {
  products: [{ product_id: 'tra-sua', name: 'Trà sữa', price: 49000 }],
  toppings: [
    { topping_id: 'tran-chau', name: 'Trân châu', price: 0 },
    { topping_id: 'thach', name: 'Thạch', price: 5000 },
  ],
};

function validPayload(overrides) {
  return {
    submission_id: 'sub-1',
    source: 'landing',
    name: 'Nguyễn Văn A',
    phone: '0912345678',
    contact: '',
    items: [{ product_id: 'tra-sua', quantity: 2, toppings: [] }],
    delivery_method: 'giao',
    zone: 'den_10km',
    address: '12 Đường Ví Dụ',
    payment_method: 'cod',
    note: '',
    website: '',
    ...overrides,
  };
}

function validate(payload, channel = 'landing') {
  return plain(ctx.validateOrder(payload, { channel: ctx.CHANNELS[channel], catalog: CATALOG, config: CONFIG }));
}

function assertInvalid(result) {
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVALID_INPUT');
  assert.ok(result.message.length > 0, 'phải có message tiếng Việt');
}

test('chuẩn hoá SĐT về 10 số', () => {
  assert.equal(ctx.normalizePhone('0912345678'), '0912345678');
  assert.equal(ctx.normalizePhone('091 234 5678'), '0912345678');
  assert.equal(ctx.normalizePhone('091.234.5678'), '0912345678');
  assert.equal(ctx.normalizePhone('+84912345678'), '0912345678');
  assert.equal(ctx.normalizePhone('84912345678'), '0912345678');
  assert.equal(ctx.normalizePhone(912345678), '0912345678');
  assert.equal(ctx.normalizePhone("'0912345678"), '0912345678');
});

test('SĐT sai trả về rỗng', () => {
  for (const bad of ['', '123', '091234567', '09123456789', '0212345678', 'abcdefghij', null, undefined]) {
    assert.equal(ctx.normalizePhone(bad), '', String(bad));
  }
});

test('đặt hợp lệ tính đúng số trong hợp đồng: 2 cốc, đến 10km = 108.000', () => {
  const result = validate(validPayload());
  assert.equal(result.ok, true);
  assert.equal(result.order.total, 108000);
  assert.equal(result.order.shipping_fee, 10000);
  assert.equal(result.order.cups, 2);
  assert.equal(result.order.payment_status, 'cod');
  assert.equal(result.order.source, 'landing');
});

test('phí ship theo khu vực và tự lấy', () => {
  assert.equal(validate(validPayload({ zone: 'trong_2km' })).order.shipping_fee, 0);
  const pickup = validate(validPayload({ delivery_method: 'tu_lay', zone: 'den_10km', address: 'bỏ qua' }));
  assert.equal(pickup.ok, true);
  assert.equal(pickup.order.shipping_fee, 0);
  assert.equal(pickup.order.total, 98000);
  assert.equal(pickup.order.zone, '');
  assert.equal(pickup.order.address, '');
});

test('topping tính theo từng cốc, bỏ topping chọn trùng', () => {
  const result = validate(validPayload({
    zone: 'trong_2km',
    items: [{ product_id: 'tra-sua', quantity: 3, toppings: ['thach', 'thach', 'tran-chau'] }],
  }));
  assert.equal(result.order.total, 3 * 54000);
  assert.deepEqual(result.order.items[0].toppings, ['thach', 'tran-chau']);
  assert.match(result.order.items_text, /^3 x Trà sữa \(Thạch, Trân châu\)$/);
});

test('nhiều dòng món cộng đúng cốc và tiền', () => {
  const result = validate(validPayload({
    zone: 'trong_2km',
    items: [
      { product_id: 'tra-sua', quantity: 1, toppings: [] },
      { product_id: 'tra-sua', quantity: 2, toppings: ['thach'] },
    ],
  }));
  assert.equal(result.order.cups, 3);
  assert.equal(result.order.total, 49000 + 2 * 54000);
});

test('giá gửi từ trang bị bỏ qua', () => {
  const result = validate(validPayload({
    total: 1,
    price: 1,
    shipping_fee: 0,
    items: [{ product_id: 'tra-sua', quantity: 2, toppings: [], price: 1, unit_price: 1 }],
  }));
  assert.equal(result.order.total, 108000);
  assert.equal(result.order.shipping_fee, 10000);
  assert.equal(result.order.items[0].unit_price, 49000);
});

test('sai dữ liệu trả INVALID_INPUT', () => {
  const cases = {
    'SĐT sai': { phone: '123' },
    'SĐT không phải chuỗi': { phone: 912345678 },
    'thiếu tên': { name: '   ' },
    'tên không phải chuỗi': { name: { a: 1 } },
    'tên quá dài': { name: 'a'.repeat(101) },
    'thiếu địa chỉ khi giao': { address: '' },
    'thiếu khu vực khi giao': { zone: '' },
    'khu vực lạ': { zone: 'mars' },
    'ngoài 10km': { zone: 'ngoai_10km' },
    'cách nhận lạ': { delivery_method: 'bay' },
    'không có món': { items: [] },
    'items không phải mảng': { items: 'x' },
    'dòng món hỏng': { items: [null] },
    'sai món': { items: [{ product_id: 'khong-co', quantity: 1, toppings: [] }] },
    'sai topping': { items: [{ product_id: 'tra-sua', quantity: 1, toppings: ['khong-co'] }] },
    'toppings không phải mảng': { items: [{ product_id: 'tra-sua', quantity: 1, toppings: 'thach' }] },
    'số cốc 0': { items: [{ product_id: 'tra-sua', quantity: 0, toppings: [] }] },
    'số cốc âm': { items: [{ product_id: 'tra-sua', quantity: -1, toppings: [] }] },
    'số cốc lẻ': { items: [{ product_id: 'tra-sua', quantity: 1.5, toppings: [] }] },
    'số cốc là chuỗi': { items: [{ product_id: 'tra-sua', quantity: '2', toppings: [] }] },
    'số cốc NaN': { items: [{ product_id: 'tra-sua', quantity: NaN, toppings: [] }] },
    'nguồn sai': { source: 'messenger' },
    'thiếu nguồn': { source: undefined },
    'cách trả tiền lạ': { payment_method: 'bitcoin' },
    'landing không nhận chuyển khoản': { payment_method: 'chuyen_khoan' },
  };
  for (const [label, overrides] of Object.entries(cases)) {
    const result = validate(validPayload(overrides));
    assert.equal(result.ok, false, label);
    assertInvalid(result);
  }
});

test('precheck: bot điền ô ẩn, thiếu mã lần đặt, payload hỏng đều INVALID_INPUT', () => {
  assertInvalid(plain(ctx.precheckOrder(validPayload({ website: 'http://spam.example' }))));
  assertInvalid(plain(ctx.precheckOrder(validPayload({ submission_id: '' }))));
  assertInvalid(plain(ctx.precheckOrder(validPayload({ submission_id: 123 }))));
  assertInvalid(plain(ctx.precheckOrder(null)));
  assertInvalid(plain(ctx.precheckOrder([])));
  assert.equal(ctx.precheckOrder(validPayload()).ok, true);
});

test('form nội bộ: nhận chuyển khoản, ghi cho_chuyen_khoan, luôn là nguồn messenger', () => {
  const result = validate(validPayload({ payment_method: 'chuyen_khoan', source: 'landing' }), 'staff');
  assert.equal(result.ok, true);
  assert.equal(result.order.payment_status, 'cho_chuyen_khoan');
  assert.equal(result.order.source, 'messenger');
});

test('needs_call: COD đủ ngưỡng, không áp dụng cho chuyển khoản', () => {
  assert.equal(ctx.computeNeedsCall('cod', 5, 5, false), true);
  assert.equal(ctx.computeNeedsCall('cod', 4, 5, false), false);
  assert.equal(ctx.computeNeedsCall('chuyen_khoan', 50, 5, false), false);
  assert.equal(ctx.computeNeedsCall('chuyen_khoan', 1, 5, true), true);
});

test('needs_call: chỉ form nội bộ được đánh dấu tay', () => {
  assert.equal(validate(validPayload({ needs_call: true })).order.needs_call, false);
  assert.equal(validate(validPayload({ needs_call: true }), 'staff').order.needs_call, true);
  assert.equal(validate(validPayload({ needs_call: 'true' }), 'staff').order.needs_call, false);
});

test('chống công thức: luôn thêm dấu nháy đơn', () => {
  assert.equal(ctx.sanitizeForSheet('=IMPORTXML("http://x","//a")'), '\'=IMPORTXML("http://x","//a")');
  assert.equal(ctx.sanitizeForSheet('+1'), "'+1");
  assert.equal(ctx.sanitizeForSheet('0912345678'), "'0912345678");
  assert.equal(ctx.sanitizeForSheet(''), '');
});

test('cleanText bỏ xuống dòng và ký tự điều khiển', () => {
  assert.equal(ctx.cleanText('  a\r\nb\tc\u2028d '), 'a b c d');
});

test('đếm suất: trừ huy, vẫn tính bom', () => {
  const orders = [
    { cups: 2, status: 'moi' },
    { cups: 3, status: 'huy' },
    { cups: 4, status: 'bom' },
    { cups: 1, status: ' HUY ' },
    { cups: 5, status: 'xong' },
  ];
  assert.equal(ctx.countCups(orders), 11);
});

test('giới hạn SĐT chỉ đếm đơn landing chưa huỷ của đúng SĐT', () => {
  const phone = '0912345678';
  const orders = [
    { cups: 2, status: 'moi', source: 'landing', phone },
    { cups: 3, status: 'huy', source: 'landing', phone },
    { cups: 4, status: 'moi', source: 'messenger', phone },
    { cups: 5, status: 'moi', source: 'landing', phone: '0987654321' },
    { cups: 1, status: 'bom', source: 'landing', phone: 912345678 },
  ];
  assert.equal(ctx.countPublicCupsForPhone(orders, phone), 3);
});

test('mã đơn: tăng dần, không cấp lại khi dòng cuối bị xoá', () => {
  assert.equal(ctx.nextOrderNumber([], null), 1);
  assert.equal(ctx.nextOrderNumber(['TS-0001', 'TS-0042', 'rác'], '10'), 43);
  assert.equal(ctx.nextOrderNumber(['TS-0001'], '42'), 43);
  assert.equal(ctx.formatOrderCode(42), 'TS-0042');
  assert.equal(ctx.formatOrderCode(12345), 'TS-12345');
});

test('cảnh báo sắp hết suất: báo một lần, tụt ngưỡng thì mở lại', () => {
  assert.equal(ctx.lowStockState(549, CONFIG, false).alert, false);
  assert.equal(ctx.lowStockState(550, CONFIG, false).alert, true);
  assert.equal(ctx.lowStockState(560, CONFIG, true).alert, false);
  assert.equal(ctx.lowStockState(560, CONFIG, true).rearm, false);
  assert.equal(ctx.lowStockState(500, CONFIG, true).rearm, true);
  assert.equal(ctx.lowStockState(590, { ...CONFIG, low_stock_alert_cups: 0 }, false).alert, false);
  assert.equal(ctx.lowStockState(590, CONFIG, false).remaining_cups, 10);
  // Ngưỡng lớn hơn max_cups: dùng max_cups để cảnh báo vẫn chạy được.
  const high = { ...CONFIG, low_stock_alert_cups: 700 };
  assert.equal(ctx.lowStockState(599, high, false).alert, false);
  assert.equal(ctx.lowStockState(600, high, false).alert, true);
  assert.equal(ctx.lowStockState(600, high, false).threshold_cups, 600);
});

test('so sánh khoá: chưa đặt khoá thì luôn từ chối', () => {
  assert.equal(ctx.keysMatch('abc', 'abc'), true);
  assert.equal(ctx.keysMatch('abc', 'abd'), false);
  assert.equal(ctx.keysMatch('abc', 'abcd'), false);
  assert.equal(ctx.keysMatch('abc', undefined), false);
  assert.equal(ctx.keysMatch(null, ''), false);
  assert.equal(ctx.keysMatch('', ''), false);
  assert.equal(ctx.keysMatch(null, undefined), false);
});

test('đọc số trong cấu hình', () => {
  assert.equal(ctx.parseWholeNumber(49000), 49000);
  assert.equal(ctx.parseWholeNumber('49000'), 49000);
  assert.equal(ctx.parseWholeNumber('49.000'), 49000);
  assert.equal(ctx.parseWholeNumber('49,000'), 49000);
  for (const bad of ['', 'abc', '49.5', -1, 1.5, null, undefined, true]) {
    assert.equal(ctx.parseWholeNumber(bad), null, String(bad));
  }
});

test('cấu hình sai thì ném lỗi, orders_open lạ tính là tắt', () => {
  const raw = {
    orders_open: true,
    max_cups: 600,
    low_stock_alert_cups: 550,
    call_threshold_cups: 5,
    max_cups_per_phone_public: 10,
    shipping_fee_tu_lay: 0,
    shipping_fee_trong_2km: 0,
    shipping_fee_den_10km: 10000,
  };
  assert.equal(ctx.parseConfig(raw).shipping_fees.den_10km, 10000);
  assert.throws(() => ctx.parseConfig({ ...raw, max_cups: 'nhiều' }));
  assert.throws(() => ctx.parseConfig({ ...raw, shipping_fee_den_10km: '' }));
  assert.throws(() => ctx.parseConfig({ ...raw, shipping_fee_den_10km: 10 }));
  assert.equal(ctx.parseConfig({ ...raw, shipping_fee_den_10km: 0 }).shipping_fees.den_10km, 0);
  assert.equal(ctx.parseConfig({ ...raw, shipping_fee_den_10km: 1000 }).shipping_fees.den_10km, 1000);
  assert.equal(ctx.parseConfig({ ...raw, orders_open: 'có' }).orders_open, false);
  assert.equal(ctx.parseConfig({ ...raw, orders_open: 'TRUE' }).orders_open, true);
  assert.equal(ctx.parseConfig({ ...raw, orders_open: false }).orders_open, false);
});

test('menu: bỏ dòng ẩn và dòng sai giá', () => {
  const list = plain(ctx.buildCatalogList([
    { product_id: 'a', name: 'A', price: 1000, status: 'active' },
    { product_id: 'b', name: 'B', price: 1000, status: 'inactive' },
    { product_id: 'c', name: 'C', price: 'hỏi shop', status: 'active' },
    { product_id: '', name: 'D', price: 1000, status: 'active' },
  ], 'product_id'));
  assert.deepEqual(list, [{ name: 'A', price: 1000, product_id: 'a' }]);
});

test('menu: giá món 1 đến 999đ bị ẩn, topping 0đ vẫn bán', () => {
  const products = plain(ctx.buildCatalogList([
    { product_id: 'a', name: 'A', price: 49, status: 'active' },
    { product_id: 'b', name: 'B', price: 999, status: 'active' },
    { product_id: 'c', name: 'C', price: 1000, status: 'active' },
  ], 'product_id'));
  assert.deepEqual(products.map((p) => p.product_id), ['c']);
  const toppings = plain(ctx.buildCatalogList([
    { topping_id: 't', name: 'T', price: 0, status: 'active' },
  ], 'topping_id'));
  assert.equal(toppings.length, 1);
});

/* ---------- Đợt 2 ---------- */

const RAW_CONFIG = {
  orders_open: true,
  max_cups: 600,
  low_stock_alert_cups: 550,
  call_threshold_cups: 5,
  max_cups_per_phone_public: 10,
  shipping_fee_tu_lay: 0,
  shipping_fee_trong_2km: 0,
  shipping_fee_den_10km: 10000,
};

test('isInPrep_: Chuẩn bị gồm moi và dang_lam đã đủ điều kiện tiền và gọi', () => {
  const base = { status: 'moi', payment_method: 'cod', payment_status: 'cod', needs_call: false, call_done: false };
  assert.equal(ctx.isInPrep_(base), true);
  assert.equal(ctx.isInPrep_({ ...base, status: 'dang_lam' }), true, 'đơn đang làm vẫn ở Chuẩn bị');
  for (const status of ['dang_giao', 'xong', 'huy', 'bom', '']) assert.equal(ctx.isInPrep_({ ...base, status }), false, status);
  assert.equal(ctx.isInPrep_({ ...base, status: ' MOI ' }), true);
  const transfer = { ...base, payment_method: 'chuyen_khoan' };
  assert.equal(ctx.isInPrep_({ ...transfer, payment_status: 'cho_chuyen_khoan' }), false);
  assert.equal(ctx.isInPrep_({ ...transfer, payment_status: 'cod' }), false);
  assert.equal(ctx.isInPrep_({ ...transfer, payment_status: 'da_nhan' }), true);
  assert.equal(ctx.isInPrep_({ ...base, payment_status: 'cho_chuyen_khoan' }), false, 'COD đổi sang chờ chuyển khoản');
  assert.equal(ctx.isInPrep_({ ...base, needs_call: true }), false);
  assert.equal(ctx.isInPrep_({ ...base, needs_call: true, call_done: true }), true);
  assert.equal(ctx.isInPrep_({ ...base, needs_call: 'TRUE', call_done: 'FALSE' }), false, 'ô Sheets dạng chữ');
});

const NAMES = {
  products: { a: 'Món A', b: 'Món B' },
  toppings: { x: 'Topping X', y: 'Topping Y' },
};
const prepOrder = (code, items, extra) => ({
  order_code: code, status: 'moi', payment_method: 'cod', payment_status: 'cod',
  needs_call: false, call_done: false, cups: 1, items: JSON.stringify(items), items_text: 'chữ', ...extra,
});

test('pha chế: topping khác thứ tự vẫn gom một dòng; đơn nhiều món hiện mã ở từng dòng, không lặp mã', () => {
  const prep = plain(ctx.buildPrepList([
    prepOrder('TS-1', [{ product_id: 'a', quantity: 2, toppings: ['x', 'y'] }, { product_id: 'b', quantity: 1, toppings: [] }]),
    prepOrder('TS-2', [{ product_id: 'a', quantity: 3, toppings: ['y', 'x'] }, { product_id: 'a', quantity: 1, toppings: ['x', 'y'] }]),
  ], NAMES));
  assert.equal(prep.total_cups, 7);
  assert.equal(prep.lines.length, 2);
  const line = prep.lines.find((l) => l.product_id === 'a');
  assert.equal(line.cups, 6);
  assert.deepEqual(line.toppings, ['Topping X', 'Topping Y']);
  assert.deepEqual(line.order_codes, ['TS-1', 'TS-2']);
});

test('pha chế: cột items hỏng thì báo xem tay, vẫn tính cốc, không làm hỏng danh sách', () => {
  const prep = plain(ctx.buildPrepList([
    prepOrder('TS-1', [{ product_id: 'a', quantity: 2, toppings: [] }]),
    { ...prepOrder('TS-2', []), items: '{hỏng', cups: 4 },
    { ...prepOrder('TS-3', []), items: '', cups: 1 },
    prepOrder('TS-4', [{ product_id: 'a', quantity: '2' }], { cups: 2 }),
  ], NAMES));
  assert.equal(prep.total_cups, 9);
  assert.deepEqual(prep.unparsed.map((u) => u.order_code), ['TS-2', 'TS-3', 'TS-4']);
  assert.match(ctx.formatOpsListsText({ prep, delivery: { stops: 0, amount_due_total: 0, zones: [] }, pickup: { orders: [], amount_due_total: 0 }, held: [] }, 'x'), /XEM TAY TS-2, 4 phần/);
});

test('pha chế: ghi chú đi kèm mã đơn ở mọi dòng của đơn, không lặp, gồm cả đơn cần xem tay', () => {
  const prep = plain(ctx.buildPrepList([
    prepOrder('TS-1', [
      { product_id: 'a', quantity: 1, toppings: [] },
      { product_id: 'a', quantity: 1, toppings: [] },
      { product_id: 'b', quantity: 1, toppings: [] },
    ], { note: 'ít đường' }),
    prepOrder('TS-2', [{ product_id: 'a', quantity: 1, toppings: [] }]),
    { ...prepOrder('TS-3', []), items: '{hỏng', note: 'không đá' },
  ], NAMES));
  const note = [{ order_code: 'TS-1', note: 'ít đường' }];
  assert.deepEqual(prep.lines.map((l) => l.notes), [note, note]);
  assert.equal(prep.unparsed[0].note, 'không đá');
});

test('đơn đang chờ: đủ lý do, bỏ đơn đã kết thúc và đơn đủ điều kiện', () => {
  const base = { order_code: 'TS-1', status: 'moi', payment_method: 'cod', payment_status: 'cod', phone: 912345678, total: 108000 };
  const held = plain(ctx.buildHeldList([
    { ...base, needs_call: true },
    { ...base, order_code: 'TS-2', payment_method: 'chuyen_khoan', payment_status: 'cho_chuyen_khoan', status: 'dang_lam' },
    { ...base, order_code: 'TS-3', payment_method: 'chuyen_khoan', payment_status: 'cho_chuyen_khoan', needs_call: true, call_reason: "'nhân viên đánh dấu" },
    { ...base, order_code: 'TS-4', needs_call: true, status: 'huy' },
    { ...base, order_code: 'TS-5', needs_call: true, status: 'bom' },
    { ...base, order_code: 'TS-6', needs_call: true, status: 'xong' },
    { ...base, order_code: 'TS-7' },
    { ...base, order_code: 'TS-8', needs_call: true, call_done: true },
  ]));
  assert.deepEqual(held, [
    { order_code: 'TS-1', phone: '0912345678', amount: 108000, reason: 'chờ gọi', status: 'moi', actions: ['call_done', 'cancel'] },
    { order_code: 'TS-2', phone: '0912345678', amount: 108000, reason: 'chờ chuyển khoản', status: 'dang_lam', actions: ['paid', 'cancel'] },
    { order_code: 'TS-3', phone: '0912345678', amount: 108000, reason: 'chờ chuyển khoản; chờ gọi: nhân viên đánh dấu', status: 'moi', actions: ['call_done', 'paid', 'cancel'] },
  ]);
});

test('mã lần đặt: nhận đến 200 ký tự cho mã phản hồi Form dài', () => {
  assert.equal(ctx.precheckOrder(validPayload({ submission_id: 'a'.repeat(200) })).ok, true);
  assertInvalid(plain(ctx.precheckOrder(validPayload({ submission_id: 'a'.repeat(201) }))));
});

test('dựng lại transfer từ link đã cấp giữ đúng tài khoản; link lạ trả null', () => {
  const issued = plain(ctx.buildTransfer(ctx.parseConfig({ ...RAW_CONFIG, ...BANK }).transfer, 'TS-1', 49000));
  assert.equal(issued.bank_account, '0123456789');
  assert.deepEqual(plain(ctx.transferFromQrUrl(issued.qr_url, 'TS-1', 49000)), issued);
  assert.equal(ctx.transferFromQrUrl('https://example.com/qr.png', 'TS-1', 49000), null);
});

test('tiền phải thu: COD bằng total, da_nhan bằng 0', () => {
  assert.equal(ctx.amountDue({ payment_status: 'cod', total: 108000 }), 108000);
  assert.equal(ctx.amountDue({ payment_status: 'da_nhan', total: 108000 }), 0);
});

const stops = (addresses) => addresses.map((address, i) => ({ order_code: `TS-${i + 1}`, address }));
const pointsOf = (url) => {
  const params = new URL(url).searchParams;
  const waypoints = params.get('waypoints');
  return (waypoints ? waypoints.split('|') : []).concat(params.get('destination'));
};

test('link bản đồ: địa chỉ có dấu, &, /, | vẫn đúng từng điểm, không tách sai', () => {
  const addresses = ['12/3 Đường Lê Lợi & Hai Bà Trưng', 'Nhà A | Ngõ 5', '7 #B + C?x=1', 'Cuối'];
  const [link] = plain(ctx.buildMapLinks(stops(addresses), 'Điểm bán | Số 1', 10));
  assert.deepEqual(pointsOf(link.url), [
    '12/3 Đường Lê Lợi & Hai Bà Trưng', 'Nhà A, Ngõ 5', '7 #B + C?x=1', 'Cuối',
  ]);
  assert.equal(new URL(link.url).searchParams.get('origin'), 'Điểm bán, Số 1');
  assert.equal(new URL(link.url).searchParams.get('api'), '1');
  assert.ok(!link.url.includes(' '));
  assert.ok(!/[|&]\s/.test(link.url));
  const raw = link.url.split('waypoints=')[1];
  assert.equal(raw.split('%7C').length, 3, 'ngăn cách bằng %7C theo tài liệu Google');
  assert.ok(raw.includes('%26'));
  assert.ok(raw.includes('%2F'));
});

test('link bản đồ: nửa cặp surrogate không làm lỗi cả danh sách', () => {
  const [link] = plain(ctx.buildMapLinks(stops(['Nhà \ud83d A', 'Có emoji 🏠']), '', 4));
  assert.deepEqual(pointsOf(link.url), ['Nhà   A', 'Có emoji 🏠']);
});

test('link bản đồ: chia đúng giới hạn, không mất điểm, giữ thứ tự, biên bằng và hơn một', () => {
  const addresses = ['A', 'B', 'C', 'D', 'E'];
  assert.equal(ctx.buildMapLinks(stops(addresses.slice(0, 4)), 'S', 4).length, 1);
  const links = plain(ctx.buildMapLinks(stops(addresses), 'S', 4));
  assert.equal(links.length, 2);
  assert.deepEqual(links.flatMap((l) => pointsOf(l.url)), addresses);
  assert.deepEqual(links.map((l) => l.order_codes.length), [4, 1]);
  assert.equal(new URL(links[1].url).searchParams.get('origin'), 'S');
  assert.equal(new URL(links[1].url).searchParams.has('waypoints'), false);
  assert.deepEqual(plain(ctx.buildMapLinks([], 'S', 4)), []);
});

test('link bản đồ: quá dài thì tách link dù chưa đủ số điểm; không có shop_address thì bỏ origin', () => {
  const longAddress = 'Đường Nguyễn Thị Minh Khai '.repeat(10);
  const links = plain(ctx.buildMapLinks(stops(Array(10).fill(longAddress)), '', 10));
  assert.ok(links.length > 1);
  assert.ok(links.every((l) => l.url.length <= 2048));
  assert.equal(links.flatMap((l) => pointsOf(l.url)).length, 10);
  assert.equal(new URL(links[0].url).searchParams.has('origin'), false);
});

test('Config đợt 2: maps_max_stops lạ dùng mặc định, quá lớn thì hạ xuống; khoá mới không chặn nhận đơn', () => {
  assert.equal(ctx.parseConfig(RAW_CONFIG).maps_max_stops, 4);
  assert.equal(ctx.parseConfig({ ...RAW_CONFIG, maps_max_stops: 'nhiều' }).maps_max_stops, 4);
  assert.equal(ctx.parseConfig({ ...RAW_CONFIG, maps_max_stops: 0 }).maps_max_stops, 4);
  assert.equal(ctx.parseConfig({ ...RAW_CONFIG, maps_max_stops: 2 }).maps_max_stops, 2);
  assert.equal(ctx.parseConfig({ ...RAW_CONFIG, maps_max_stops: 50 }).maps_max_stops, 10);
  assert.equal(ctx.parseConfig(RAW_CONFIG).transfer.enabled, false);
  assert.equal(ctx.parseConfig(RAW_CONFIG).shop_address, '');
});

const BANK = { bank_code: 'vcb', bank_account: '0123456789', bank_account_name: 'NGUYỄN VĂN A & B' };

test('QR: đủ cấu hình mới bật; link mã hoá đúng; số tài khoản lạ thì tắt', () => {
  const transfer = plain(ctx.buildTransfer(ctx.parseConfig({ ...RAW_CONFIG, ...BANK }).transfer, 'TS-0042', 108000));
  assert.equal(transfer.amount, 108000);
  assert.equal(transfer.content, 'TS-0042');
  const url = new URL(transfer.qr_url);
  assert.equal(url.pathname, '/image/vcb-0123456789-compact2.png');
  assert.equal(url.searchParams.get('amount'), '108000');
  assert.equal(url.searchParams.get('addInfo'), 'TS-0042');
  assert.equal(url.searchParams.get('accountName'), 'NGUYỄN VĂN A & B');

  const parse = (extra) => ctx.parseConfig({ ...RAW_CONFIG, ...BANK, ...extra }).transfer;
  assert.equal(parse({ bank_account: '0123 456 789' }).bank_account, '0123456789');
  assert.equal(parse({ bank_account: 123456789 }).enabled, true);
  for (const extra of [{ bank_code: '' }, { bank_account: '  ' }, { bank_account_name: '' }, { bank_account: '12/../x' }, { bank_code: 'a?b=1' }]) {
    assert.equal(parse(extra).enabled, false, JSON.stringify(extra));
  }
  assert.equal(ctx.buildTransfer(parse({ bank_code: '' }), 'TS-1', 1000), null);
});

test('landing nhận chuyển khoản khi có cấu hình; kênh dự phòng luôn chỉ COD', () => {
  const config = { ...CONFIG, transfer: { enabled: true } };
  const run = (overrides, channel) => plain(ctx.validateOrder(validPayload(overrides), { channel: ctx.CHANNELS[channel], catalog: CATALOG, config }));
  const landing = run({ payment_method: 'chuyen_khoan' }, 'landing');
  assert.equal(landing.ok, true);
  assert.equal(landing.order.payment_status, 'cho_chuyen_khoan');
  assertInvalid(run({ payment_method: 'chuyen_khoan' }, 'backup'));
  assert.equal(run({}, 'backup').order.source, 'backup');
});

test('needs_call: SĐT từng bom chỉ áp dụng cho COD', () => {
  assert.equal(ctx.computeNeedsCall('cod', 1, 5, false, true), true);
  assert.equal(ctx.computeNeedsCall('chuyen_khoan', 1, 5, false, true), false);
  assert.equal(ctx.computeNeedsCall('cod', 1, 5, false, false), false);
  const orders = [{ status: 'bom', phone: 912345678 }, { status: 'huy', phone: '0987654321' }];
  assert.equal(ctx.phoneHasBom(orders, '0912345678'), true);
  assert.equal(ctx.phoneHasBom(orders, '0987654321'), false);
  const flagged = ctx.validateOrder(validPayload({ items: [{ product_id: 'tra-sua', quantity: 1, toppings: [] }] }), {
    channel: ctx.CHANNELS.landing, catalog: CATALOG, config: CONFIG, orders,
  });
  assert.equal(flagged.order.needs_call, true);
});

test('giới hạn SĐT đếm cả đơn dự phòng vì cũng là form công khai', () => {
  const phone = '0912345678';
  assert.equal(ctx.countPublicCupsForPhone([
    { cups: 2, status: 'moi', source: 'backup', phone },
    { cups: 1, status: 'moi', source: 'landing', phone },
  ], phone), 3);
});

test('báo cáo: làm tròn tỷ lệ bom, trạng thái lạ không làm sai tổng', () => {
  const orders = [
    { status: 'bom', cups: 1, payment_status: 'cod', total: 1000 },
    { status: 'xong', cups: 2, payment_status: 'cod', total: 2000 },
    { status: 'la', cups: 3, payment_status: 'cod', total: 3000 },
    { status: 'bom', cups: 0, payment_status: 'da_nhan', total: 500 },
    { status: 'xong', cups: 0, payment_status: 'da_nhan', total: 700 },
  ];
  const report = plain(ctx.buildReport(orders, CONFIG, '2026-11-07', () => '2026-11-07'));
  assert.equal(report.today.bom_rate_percent, 33.3);
  assert.deepEqual(report.today.by_status.khac, { orders: 1, cups: 3 });
  assert.equal(report.today.revenue, 2000 + 500 + 700, 'không cộng COD bom, COD chưa xong; da_nhan chỉ tính một lần');
  assert.equal(report.remaining_cups, 594);
  const over = plain(ctx.buildReport([{ status: 'moi', cups: 700 }], CONFIG, 'x', () => 'x'));
  assert.equal(over.remaining_cups, 0);
});

test('form dự phòng: đổi câu trả lời về đơn; tên lạ bị từ chối chứ không bỏ qua', () => {
  const fields = ctx.BACKUP_FIELDS;
  const answers = {
    [fields.name]: 'A',
    [fields.phone]: '0912345678',
    [fields.product]: 'Trà sữa',
    [fields.quantity]: ' 2 ',
    [fields.toppings]: ['Thạch'],
    [fields.delivery]: 'Giao hàng',
    [fields.zone]: 'Đến 10km',
    [fields.address]: 'Nhà',
  };
  const payload = plain(ctx.backupPayload(answers, 'id-1', CATALOG));
  assert.equal(payload.submission_id, 'form-id-1');
  assert.equal(payload.payment_method, 'cod');
  assert.deepEqual(payload.items, [{ product_id: 'tra-sua', quantity: 2, toppings: ['thach'] }]);
  assert.equal(payload.delivery_method, 'giao');
  assert.equal(payload.zone, 'den_10km');
  assert.equal(validate(payload, 'backup').order.total, 49000 * 2 + 5000 * 2 + 10000);

  assertInvalid(validate(ctx.backupPayload({ ...answers, [fields.toppings]: ['Không có'] }, 'x', CATALOG), 'backup'));
  assertInvalid(validate(ctx.backupPayload({ ...answers, [fields.product]: 'Không có' }, 'x', CATALOG), 'backup'));
  assertInvalid(validate(ctx.backupPayload({ ...answers, [fields.quantity]: 'hai' }, 'x', CATALOG), 'backup'));
  assertInvalid(validate(ctx.backupPayload({ ...answers, [fields.delivery]: undefined }, 'x', CATALOG), 'backup'));

  const text = ctx.backupAnswersText(answers);
  assert.match(text, /Tên: A \| Số điện thoại: 0912345678/);
  assert.match(text, /Topping: Thạch/);
  assert.doesNotMatch(text, /Ghi chú/);
});

test('JSON in vào trang không thoát được khỏi thẻ script', () => {
  const output = ctx.jsonForHtml({ name: '</script><script>alert(1)</script>&' });
  assert.ok(!output.includes('<'));
  assert.ok(!output.includes('&'));
  assert.equal(JSON.parse(output).name, '</script><script>alert(1)</script>&');
});

/* ---------- Giao diện Trân châu nắng: Cấu hình an toàn, đơn vị, lý do cần gọi ---------- */

test('Nhận đơn: Mở cửa và TRUE là mở; Đóng cửa, FALSE, trống, giá trị lạ là đóng', () => {
  for (const value of ['Mở cửa', ' mở cửa ', 'Mở cửa'.normalize('NFD'), true, 'TRUE', 'true']) {
    assert.equal(ctx.parseOpenState(value), true, String(value));
  }
  for (const value of ['Đóng cửa', false, 'FALSE', '', null, undefined, 'mở', 1]) {
    assert.equal(ctx.parseOpenState(value), false, String(value));
  }
  assert.equal(ctx.openStateLabel(true), 'Mở cửa');
  assert.equal(ctx.openStateLabel('lạ'), 'Đóng cửa');
});

test('đơn vị: mặc định phần khi trống, cắt khoảng trắng', () => {
  assert.equal(ctx.parseConfig(RAW_CONFIG).unit_label, 'phần');
  assert.equal(ctx.parseConfig({ ...RAW_CONFIG, unit_label: ' hộp ' }).unit_label, 'hộp');
  assert.equal(ctx.parseConfig({ ...RAW_CONFIG, unit_label: '   ' }).unit_label, 'phần');
});

test('Cấu hình an toàn: ô sai dùng giá trị hợp lệ gần nhất; chưa có thì không dùng được', () => {
  const good = plain(ctx.requiredConfigValues(RAW_CONFIG));
  const broken = { ...RAW_CONFIG, shipping_fee_den_10km: '', max_cups: 0 };
  const problems = plain(ctx.configProblems(broken));
  assert.deepEqual(problems.map((p) => [p.key, p.problem]), [['max_cups', 'phải từ 1 trở lên'], ['shipping_fee_den_10km', 'đang trống']]);

  const fallback = ctx.applyConfigFallback(broken, good);
  assert.equal(fallback.usable, true);
  const config = ctx.parseConfig(fallback.raw);
  assert.equal(config.max_cups, 600);
  assert.equal(config.shipping_fees.den_10km, 10000);
  assert.equal(ctx.configProblemMessage(fallback.problems[1], 'phần'), 'Ô "Phí ship đến 10km" đang trống. Hệ thống tạm dùng giá trị cũ: 10.000đ.');
  assert.equal(ctx.configProblemMessage(fallback.problems[0], 'hộp'), 'Ô "Giới hạn tổng số phần" phải từ 1 trở lên. Hệ thống tạm dùng giá trị cũ: 600 hộp.');

  assert.equal(ctx.applyConfigFallback(broken, null).usable, false);
  assert.equal(ctx.applyConfigFallback(broken, { max_cups: 600 }).usable, false, 'thiếu giá trị cũ của một ô');
  assert.throws(() => ctx.parseConfig(broken));
  assert.notEqual(ctx.configProblemsSignature(problems), ctx.configProblemsSignature(problems.slice(1)));
  assert.equal(ctx.configProblemsSignature([]), '');
});

test('lý do cần gọi ghi rõ từng trường hợp', () => {
  assert.deepEqual(plain(ctx.needsCallReasons('cod', 5, 5, false, '')), ['đơn lớn, trả tiền mặt']);
  assert.deepEqual(plain(ctx.needsCallReasons('cod', 1, 5, false, 'TS-0017')), ['SĐT từng bom TS-0017']);
  assert.deepEqual(plain(ctx.needsCallReasons('chuyen_khoan', 9, 5, true, 'TS-0017')), ['nhân viên đánh dấu']);
  assert.deepEqual(plain(ctx.needsCallReasons('chuyen_khoan', 9, 5, false, 'TS-0017')), []);
  const orders = [{ order_code: 'TS-0017', status: 'bom', phone: '0912345678' }];
  const result = plain(ctx.validateOrder(validPayload({ items: [{ product_id: 'tra-sua', quantity: 1, toppings: [] }] }), {
    channel: ctx.CHANNELS.landing, catalog: CATALOG, config: CONFIG, orders,
  }));
  assert.equal(result.order.needs_call, true);
  assert.equal(result.order.call_reason, 'SĐT từng bom TS-0017');
});

test('báo cáo và danh sách: không còn chữ cốc hay pha chế, không có dòng Việc tiếp theo', () => {
  const report = ctx.buildReport([], { ...CONFIG, unit_label: 'phần' }, '2026-11-02', () => '2026-11-02');
  const lists = ctx.buildOpsLists([], { products: {}, toppings: {} }, { shop_address: '', maps_max_stops: 4 });
  for (const text of [ctx.reportSubject(report), ctx.formatReportText(report), ctx.opsListsSubject(lists), ctx.formatOpsListsText(lists, 'x')]) {
    assert.doesNotMatch(text, /cốc|pha chế|Việc tiếp theo/i);
  }
  assert.match(ctx.formatOpsListsText(lists, 'x'), /Chưa có đơn cần chuẩn bị\.[\s\S]*Chưa có đơn cần giao\./);
});

/* ---------- Đổi trạng thái: bước chuyển và nút ---------- */

test('bước chuyển hợp lệ theo trạng thái, tiền và gọi', () => {
  const base = { status: 'moi', payment_method: 'cod', payment_status: 'cod', needs_call: false, call_done: false };
  const actions = (extra) => plain(ctx.allowedOrderActions({ ...base, ...extra }));
  assert.deepEqual(actions({}), ['start', 'finish', 'cancel']);
  assert.deepEqual(actions({ status: 'dang_lam' }), ['finish', 'cancel']);
  assert.deepEqual(actions({ status: 'dang_giao' }), ['deliver', 'bom', 'cancel']);
  for (const status of ['xong', 'huy', 'bom', '', 'la']) assert.deepEqual(actions({ status }), [], status);
  assert.deepEqual(actions({ needs_call: true }), ['call_done', 'cancel']);
  assert.deepEqual(actions({ payment_method: 'chuyen_khoan', payment_status: 'cho_chuyen_khoan' }), ['paid', 'cancel']);
  assert.deepEqual(actions({ payment_method: 'chuyen_khoan', payment_status: 'da_nhan', status: 'dang_giao' }), ['deliver', 'bom', 'cancel']);
  assert.deepEqual(plain(ctx.sectionActions({ ...base, status: 'dang_giao' }, 'prep')), ['cancel']);
});

test('kiểm tra một lần bấm: đúng thì trả cột cần ghi; trạng thái đã đổi thì stale; thao tác lạ thì invalid', () => {
  const order = { status: 'moi', payment_method: 'cod', payment_status: 'cod' };
  assert.deepEqual(plain(ctx.planOrderAction(order, 'start', 'moi')), { changes: { status: 'dang_lam' } });
  assert.deepEqual(plain(ctx.planOrderAction(order, 'finish', 'moi')), { changes: { status: 'dang_giao' } });
  assert.deepEqual(plain(ctx.planOrderAction({ ...order, status: 'dang_giao' }, 'deliver', 'dang_giao')), { changes: { status: 'xong' } });
  assert.deepEqual(plain(ctx.planOrderAction(order, 'cancel', 'moi')), { changes: { status: 'huy' } });
  assert.deepEqual(plain(ctx.planOrderAction({ ...order, needs_call: true }, 'call_done', 'moi')), { changes: { call_done: true } });
  assert.equal(ctx.planOrderAction(order, 'start', 'dang_lam').stale, true, 'trang đang thấy trạng thái khác');
  assert.equal(ctx.planOrderAction({ ...order, status: 'xong' }, 'cancel', 'xong').stale, true);
  assert.equal(ctx.planOrderAction(order, 'deliver', 'moi').stale, true);
  assert.ok(ctx.planOrderAction(order, 'delete', 'moi').invalid);
  assert.equal(ctx.staleOrderMessage('TS-0042'), 'Đơn TS-0042 đã đổi trạng thái, danh sách đã được làm mới.');
});

test('lý do huỷ: chip có sẵn hoặc Khác kèm một dòng ngắn', () => {
  assert.deepEqual(plain(ctx.cancelReasonText('Khách huỷ')), { value: 'Khách huỷ' });
  assert.deepEqual(plain(ctx.cancelReasonText('Khác', '  đổi ý \n ')), { value: 'Khác: đổi ý' });
  for (const [reason, other] of [['', ''], ['xoá', ''], ['Khác', ''], ['Khác', 'x'.repeat(101)], [undefined, undefined]]) {
    assert.ok(ctx.cancelReasonText(reason, other).error, String(reason));
  }
});
