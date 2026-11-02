'use strict';
/**
 * Chạy script thật của Staff.html với DOM giả tối thiểu (vm, không thêm thư viện).
 * DOM giả chỉ đủ cho các phần trang dùng: id, class, radio cùng nhóm, form.reset, sự kiện nổi bọt.
 * google.script.run được ghi lại để test tự trả lời từng lần gọi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../apps-script/Staff.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const CONFIG = {
  ok: true, orders_open: true, transfer_enabled: false,
  products: [{ product_id: 'ts', name: 'Trà sữa', price: 49000 }, { product_id: 'mt', name: 'Matcha', price: 55000 }],
  toppings: [{ topping_id: 'tc', name: 'Trân châu', price: 0 }, { topping_id: 'pm', name: 'Phô mai', price: 5000 }],
  shipping_fees: { tu_lay: 0, trong_2km: 0, den_10km: 10000 },
};
const UI = { cancel_reasons: ['Khách huỷ', 'Nhập nhầm', 'Hết hàng', 'Khác'], cancel_other_max: 100, confirm_actions: ['cancel', 'bom', 'paid'] };
const STATUS = { orders_open: true, remaining_cups: 412, low_stock: false, held_count: 2, unit_label: 'phần' };
const SETTINGS = {
  orders_open: true, unit_label: 'phần',
  fields: { max_cups: '600', low_stock_alert_cups: '550', max_cups_per_phone_public: '10', call_threshold_cups: '5',
    shipping_fee_tu_lay: '0', shipping_fee_trong_2km: '0', shipping_fee_den_10km: '10000' },
  products: [{ product_id: 'ts', name: 'Trà sữa', price: 49000, active: true }, { product_id: 'mt', name: 'Matcha', price: 55000, active: true }],
};

function loadPage({ config = CONFIG, status = STATUS } = {}) {
  const all = [];
  const focused = { current: null };
  let root = null;

  class El {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parent = null;
      this.listeners = {};
      this.attrs = {};
      this.hidden = false;
      this.className = '';
      this.value = '';
      this.disabled = false;
      this._text = '';
      Object.assign(this, attrs);
      this.defaultChecked = this.checked;
      all.push(this);
    }
    get parentNode() { return this.parent; }
    set checked(v) {
      this._checked = Boolean(v);
      if (this._checked && this.type === 'radio' && this.name) {
        all.forEach((e) => { if (e !== this && e.type === 'radio' && e.name === this.name) e._checked = false; });
      }
    }
    get checked() { return Boolean(this._checked); }
    set textContent(v) { this._text = String(v); this.children.forEach((c) => { c.parent = null; }); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      if (this.tagName === 'SELECT' && this.value === '') this.value = c.value;
      return c;
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, preventDefault() { event.prevented = true; }, ...extra };
      for (let n = this; n; n = n.parent) (n.listeners[type] || []).forEach((fn) => fn(event));
      return event;
    }
    click() { this.dispatch('click'); }
    focus() { focused.current = this; }
    scrollIntoView() {}
    reset() {
      descendants(this).forEach((e) => {
        if (e.tagName === 'INPUT') {
          if (e.type === 'radio' || e.type === 'checkbox') e._checked = e.defaultChecked;
          else e.value = '';
        }
        if (e.tagName === 'TEXTAREA') e.value = '';
      });
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) { return descendants(this).filter((e) => matches(e, sel)); }
    get isConnected() { let n = this; while (n.parent) n = n.parent; return n === root; }
  }
  const descendants = (el) => {
    const out = [];
    (function walk(n) { n.children.forEach((c) => { out.push(c); walk(c); }); })(el);
    return out;
  };
  function matches(e, sel) {
    let m = /^\.([\w-]+)(:checked)?$/.exec(sel);
    if (m) return e.className.split(' ').includes(m[1]) && (!m[2] || e.checked);
    if (/^[a-z]+$/.test(sel)) return e.tagName === sel.toUpperCase();
    m = /^input\[name=([\w-]+)\](:checked)?$/.exec(sel);
    if (m) return e.tagName === 'INPUT' && e.name === m[1] && (!m[2] || e.checked);
    throw new Error(`DOM giả chưa hỗ trợ selector ${sel}`);
  }

  root = new El('body');
  const ids = {};
  const make = (id, tag = 'div', attrs = {}) => { const e = new El(tag, { id, ...attrs }); ids[id] = e; return e; };
  // Cây tĩnh giống HTML: form chứa ô nhập và radio; các vùng còn lại tạo khi được gọi tới.
  const form = root.appendChild(make('order-form', 'form'));
  ['name', 'phone', 'contact', 'address'].forEach((id) => form.appendChild(make(id, 'input', { type: 'text' })));
  form.appendChild(make('note', 'textarea'));
  form.appendChild(make('needs-call', 'input', { type: 'checkbox' }));
  ['lines', 'zones', 'delivery-fields', 'transfer-hint', 'name-error', 'phone-error', 'zones-error', 'address-error']
    .forEach((id) => form.appendChild(make(id)));
  form.appendChild(make('add-line', 'button'));
  [['delivery', 'giao', true], ['delivery', 'tu_lay'], ['payment', 'cod', true], ['payment', 'chuyen_khoan']]
    .forEach(([name, value, checked]) => form.appendChild(new El('input', { type: 'radio', name, value, checked: Boolean(checked) })));
  ['view-prep', 'view-delivery', 'view-held'].forEach((id, i) =>
    root.appendChild(make(id, 'input', { type: 'radio', name: 'list-view', value: id.slice(5), checked: i === 0 })));
  ['open', 'closed'].forEach((value) => root.appendChild(new El('input', { type: 'radio', name: 'setting-open', value })));

  const documentListeners = {};
  const document = {
    addEventListener: (type, fn) => { (documentListeners[type] = documentListeners[type] || []).push(fn); },
    dispatch: (type, extra = {}) => {
      const event = { type, preventDefault() { event.prevented = true; }, ...extra };
      (documentListeners[type] || []).forEach((fn) => fn(event));
      return event;
    },
    getElementById: (id) => ids[id] || all.find((e) => e.id === id && e.isConnected) || root.appendChild(make(id)),
    createElement: (tag) => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };

  const calls = [];
  const run = () => {
    const call = { success: null, failure: null };
    const api = {
      withSuccessHandler(fn) { call.success = fn; return api; },
      withFailureHandler(fn) { call.failure = fn; return api; },
    };
    for (const fn of ['staffSubmit', 'staffOpsLists', 'managerSettings', 'managerSave', 'managerToday', 'staffOrderAction', 'staffOrderDetail']) {
      api[fn] = (...args) => { calls.push({ fn, args, call }); };
    }
    return api;
  };
  const storage = {};
  let uuid = 0;
  const window = {
    scrollTo() {},
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
  };
  const context = {
    document, window, console,
    google: { script: { get run() { return run(); } } },
    crypto: { randomUUID: () => `uuid-${++uuid}` },
    setTimeout: () => 1, clearTimeout: () => {},
  };
  window.crypto = context.crypto;
  const source = script
    .replace('<?!= configJson ?>', JSON.stringify(config))
    .replace('<?!= statusJson ?>', JSON.stringify(status))
    .replace('<?!= keyJson ?>', '"khoa"')
    .replace('<?!= uiJson ?>', JSON.stringify(UI));
  vm.createContext(context);
  vm.runInContext(source, context);

  const page = {
    document, calls, storage, form,
    focused: () => focused.current,
    byId: (id) => document.getElementById(id),
    text: (id) => document.getElementById(id).textContent,
    last: (fn) => calls.filter((c) => c.fn === fn).at(-1),
    radio: (name, value) => document.querySelectorAll(`input[name=${name}]`).find((r) => r.value === value),
    choose(name, value) {
      const radio = page.radio(name, value);
      radio.checked = true;
      radio.dispatch('change');
    },
    line: (index = 0) => document.querySelectorAll('.line')[index],
    fillCustomer() {
      page.byId('name').value = 'Lan';
      page.byId('phone').value = '0912 345 678';
      page.byId('address').value = '12 Nguyễn Trãi';
    },
    submit: () => form.dispatch('submit'),
  };
  return page;
}

const json = (value) => JSON.parse(JSON.stringify(value));

test('trang: tổng xem trước 108.000đ cho 2 phần giao đến 10km; chưa chọn khu vực thì chưa tính ship', () => {
  const page = loadPage();
  assert.equal(page.radio('zone', 'den_10km').checked, false, 'không chọn sẵn khu vực');
  assert.equal(page.radio('zone', 'trong_2km').checked, false);
  page.line().querySelector('.plus').click();
  assert.equal(page.line().querySelector('.qty').value, '2');
  assert.equal(page.text('total'), '98.000đ');
  assert.equal(page.text('total-sub'), '2 phần · chưa chọn khu vực');
  page.choose('zone', 'den_10km');
  assert.equal(page.text('total'), '108.000đ');
  assert.equal(page.text('total-sub'), '2 phần · ship 10.000đ');
  page.line().querySelector('.minus').click();
  page.line().querySelector('.minus').click();
  assert.equal(page.line().querySelector('.qty').value, '1', 'không xuống dưới 1');
});

test('trang: phải chọn khu vực khi giao, lỗi nằm dưới ô; chọn xong thì gửi đúng khu vực', () => {
  const page = loadPage();
  page.fillCustomer();
  page.submit();
  assert.equal(page.last('staffSubmit'), undefined, 'không gửi khi thiếu khu vực');
  assert.equal(page.text('zones-error'), 'Chọn khu vực giao.');
  assert.equal(page.byId('zones-error').hidden, false);
  assert.equal(page.byId('zones').getAttribute('aria-invalid'), 'true');

  page.choose('zone', 'trong_2km');
  assert.equal(page.byId('zones-error').hidden, true, 'chọn xong thì hết lỗi');
  page.submit();
  assert.equal(page.last('staffSubmit').args[0].zone, 'trong_2km');

  // Tự đến lấy thì không cần khu vực.
  const pickup = loadPage();
  pickup.fillCustomer();
  pickup.choose('delivery', 'tu_lay');
  pickup.submit();
  assert.equal(pickup.last('staffSubmit').args[0].zone, '');
});

test('trang: lưu lỗi mạng thì giữ nguyên submission_id; Nhập đơn tiếp theo tạo mã mới và bỏ chọn khu vực', () => {
  const page = loadPage();
  page.fillCustomer();
  page.choose('zone', 'den_10km');
  page.submit();
  const first = page.last('staffSubmit');
  assert.equal(page.byId('submit').disabled, true);
  assert.equal(page.text('submit'), 'Đang lưu…');
  first.call.failure(new Error('mạng'));
  assert.match(page.text('error'), /^Chưa lưu được\. Kiểm tra mạng/);
  assert.equal(page.byId('submit').disabled, false);

  page.submit();
  const retry = page.last('staffSubmit');
  assert.equal(retry.args[0].submission_id, first.args[0].submission_id, 'bấm lại không tạo đơn trùng');
  retry.call.success({ ok: true, order_code: 'TS-0042', total: 59000, cups: 1, needs_call: true, call_reason: 'đơn lớn, trả tiền mặt' });
  assert.equal(page.text('result-code'), 'TS-0042');
  assert.equal(page.text('result-call'), 'Cần gọi trước khi làm: đơn lớn, trả tiền mặt');

  page.byId('next-order').click();
  assert.equal(page.byId('result').hidden, true);
  assert.equal(page.radio('zone', 'den_10km').checked, false, 'khu vực về chưa chọn');
  assert.equal(page.radio('zone', 'trong_2km').checked, false);
  page.fillCustomer();
  page.choose('zone', 'den_10km');
  page.submit();
  assert.notEqual(page.last('staffSubmit').args[0].submission_id, first.args[0].submission_id, 'đơn mới có mã mới');
});

test('trang: đang đóng cửa thì khoá Lưu đơn và không gửi', () => {
  const page = loadPage({ status: { ...STATUS, orders_open: false } });
  assert.equal(page.text('open-text'), 'Đang đóng cửa');
  assert.equal(page.byId('submit').disabled, true);
  assert.equal(page.byId('closed').hidden, false);
  page.fillCustomer();
  page.choose('zone', 'den_10km');
  page.submit();
  assert.equal(page.last('staffSubmit'), undefined);

  // Dải đổi sang mở sau khi làm mới thì mở khoá.
  page.last('staffOpsLists').call.success({
    ok: true, generated_at: '2026-11-04 12:04:00',
    prep: { total_cups: 0, lines: [], unparsed: [] }, delivery: { stops: 0, amount_due_total: 0, zones: [] },
    pickup: { amount_due_total: 0, orders: [] }, held: [], status: STATUS,
  });
  assert.equal(page.byId('submit').disabled, false);
});

test('trang: cờ chuyển khoản theo cách trả đã gửi, không theo ô chọn lúc nhận phản hồi', () => {
  const page = loadPage();
  page.fillCustomer();
  page.choose('zone', 'den_10km');
  page.choose('payment', 'chuyen_khoan');
  page.submit();
  assert.equal(page.last('staffSubmit').args[0].payment_method, 'chuyen_khoan');
  page.choose('payment', 'cod');
  page.last('staffSubmit').call.success({ ok: true, order_code: 'TS-0001', total: 59000, cups: 1, needs_call: false, call_reason: '' });
  assert.equal(page.byId('result-transfer-flag').hidden, false);
  assert.equal(page.byId('transfer-missing').hidden, false, 'báo chưa có tài khoản nhận tiền');
});

test('trang: SĐT được nhận giống normalizePhone của server', () => {
  for (const phone of ['912345678', "'0912345678", '+84 912 345 678', '84912345678', '(091) 234-5678']) {
    const page = loadPage();
    page.fillCustomer();
    page.byId('phone').value = phone;
    page.choose('zone', 'den_10km');
    page.submit();
    assert.equal(page.byId('phone-error').hidden, true, phone);
    assert.ok(page.last('staffSubmit'), phone);
  }
  const page = loadPage();
  page.fillCustomer();
  page.byId('phone').value = '0212345678';
  page.choose('zone', 'den_10km');
  page.submit();
  assert.equal(page.text('phone-error'), 'Số điện thoại cần 10 số, bắt đầu bằng 0.');
});

function openSettings(page) {
  page.byId('open-settings').click();
  page.byId('manager-password').value = 'dung';
  page.byId('manager-unlock').click();
  const call = page.last('managerSettings');
  assert.deepEqual(json(call.args), ['khoa', 'dung']);
  call.call.success({ ok: true, settings: SETTINGS });
  assert.equal(page.byId('settings-body').hidden, false);
}

test('trang: lưu cài đặt cập nhật menu, phí ship và tổng tiền; giữ món đang chọn nếu còn bán', () => {
  const page = loadPage();
  page.line().querySelector('.product').value = 'mt';
  page.byId('add-line').click();
  page.line(1).querySelector('.product').value = 'ts';
  page.choose('zone', 'den_10km');
  assert.equal(page.text('total'), '114.000đ');

  openSettings(page);
  const matchaSwitch = page.byId('setting-products').querySelectorAll('input')[1];
  matchaSwitch.checked = false;
  matchaSwitch.dispatch('change');
  const save = page.last('managerSave');
  assert.deepEqual(json(save.args), ['khoa', 'dung', { field: 'product', product_id: 'mt', active: false }]);
  save.call.success({
    ok: true,
    settings: { ...SETTINGS, products: [SETTINGS.products[0], { ...SETTINGS.products[1], active: false }] },
    status: STATUS,
    config: { products: [CONFIG.products[0]], toppings: CONFIG.toppings, shipping_fees: { ...CONFIG.shipping_fees, den_10km: 15000 }, unit_label: 'phần' },
  });
  assert.equal(page.byId('saved-product-mt').hidden, false, '"Đã lưu" hiện trên dòng của món');
  assert.equal(page.byId('backup-form-hint').hidden, false, 'nhắc chạy lại setupBackupForm');
  assert.equal(page.line(0).querySelector('.product').value, 'ts', 'món đã tắt thì chọn món còn bán');
  assert.equal(page.line(1).querySelector('.product').value, 'ts', 'giữ món đang chọn');
  assert.equal(page.line(0).querySelector('.product').children.length, 1);
  assert.match(page.radio('zone', 'den_10km').parentNode.textContent, /Đến 10km · 15\.000đ/);
  assert.equal(page.text('total'), '113.000đ', '2 x 49.000đ + ship mới 15.000đ');

  // Ô số: lưu xong ghi lại giá trị đã chuẩn hoá.
  const fee = page.byId('setting-shipping_fee_den_10km');
  fee.value = ' 15000 ';
  fee.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(json(page.last('managerSave').args[2]), { field: 'shipping_fee_den_10km', value: ' 15000 ' });
  page.last('managerSave').call.success({
    ok: true, settings: { ...SETTINGS, fields: { ...SETTINGS.fields, shipping_fee_den_10km: '15000' } }, status: STATUS,
    config: { products: [CONFIG.products[0]], toppings: CONFIG.toppings, shipping_fees: { ...CONFIG.shipping_fees, den_10km: 15000 }, unit_label: 'phần' },
  });
  assert.equal(fee.value, '15000');
  assert.equal(page.byId('saved-shipping_fee_den_10km').hidden, false);
});

test('trang: lưu cài đặt xong mà server không đọc lại được thì vẫn báo đã lưu, không đảo công tắc', () => {
  const page = loadPage();
  openSettings(page);
  const tea = page.byId('setting-products').querySelectorAll('input')[0];
  tea.checked = false;
  tea.dispatch('change');
  page.last('managerSave').call.success({ ok: true, refresh_failed: true, message: 'Đã lưu, nhưng chưa tải lại được số mới. Tải lại trang để xem.' });
  assert.equal(tea.checked, false, 'giữ trạng thái đã lưu');
  assert.equal(page.byId('saved-product-ts').hidden, false);
  assert.match(page.text('settings-error'), /Tải lại trang/);

  const fee = page.byId('setting-max_cups');
  fee.value = '700';
  fee.dispatch('keydown', { key: 'Enter' });
  page.last('managerSave').call.success({ ok: true, refresh_failed: true, message: 'Đã lưu, nhưng chưa tải lại được số mới. Tải lại trang để xem.' });
  assert.equal(fee.value, '700');
});

test('trang: mật khẩu chỉ trong bộ nhớ; Khoá hoặc tải lại trang thì phải nhập lại', () => {
  const page = loadPage();
  openSettings(page);
  assert.equal(page.byId('manager-password').value, '');
  assert.ok(!JSON.stringify(page.storage).includes('dung'));
  page.byId('manager-lock').click();
  assert.equal(page.byId('settings-login').hidden, false);
  page.byId('tab-entry').click();
  page.byId('open-settings').click();
  assert.equal(page.byId('settings-login').hidden, false);
  assert.equal(page.storage['storeops.staff.tab'], 'entry', 'không nhớ mục Cài đặt');
  const reopened = loadPage();
  reopened.byId('open-settings').click();
  assert.equal(reopened.byId('settings-body').hidden, true);
});

/* ---------- Đổi trạng thái, xác nhận lần hai, chi tiết đơn ---------- */

const PREP_ORDER = { order_code: 'TS-0040', status: 'moi', delivery_method: 'giao', actions: ['start', 'finish', 'cancel'] };
const DOING_ORDER = { order_code: 'TS-0041', status: 'dang_lam', delivery_method: 'tu_lay', actions: ['finish', 'cancel'] };
const LISTS = {
  ok: true, generated_at: '2026-11-04 12:04:00',
  prep: {
    total_cups: 3,
    lines: [{
      product_name: 'Trà sữa', toppings: [], cups: 3, order_codes: ['TS-0040', 'TS-0041'],
      orders: [PREP_ORDER, DOING_ORDER], notes: [],
    }],
    unparsed: [],
  },
  delivery: {
    stops: 1, amount_due_total: 108000,
    zones: [{
      zone: 'den_10km', label: 'Đến 10km', stops: 1, amount_due_total: 108000, map_links: [],
      orders: [{ order_code: 'TS-0039', name: 'Lan', phone: '0912345678', address: '12', items_text: '2 x Trà sữa',
        cups: 2, amount_due: 108000, status: 'dang_giao', delivery_method: 'giao', note: '', actions: ['deliver', 'bom', 'cancel'] }],
    }],
  },
  pickup: { amount_due_total: 0, orders: [] },
  held: [{
    order_code: 'TS-0042', created_at: '2026-11-03 21:15:00', status: 'moi', name: 'Minh', phone: '0987654321',
    contact: 'https://facebook.com/minh', items_text: '5 x Trà sữa', cups: 5, delivery_method: 'giao', zone_label: 'Đến 10km',
    address: '5 Lê Lợi', amount: 255000, payment_method: 'cod', payment_status: 'cod',
    reason: 'chờ gọi: đơn lớn, trả tiền mặt', call_reason: 'đơn lớn, trả tiền mặt', note: 'gọi trước 11h',
    actions: ['call_done', 'cancel'],
  }],
  status: STATUS,
};

function pageWithLists() {
  const page = loadPage();
  page.last('staffOpsLists').call.success(LISTS);
  page.byId('tab-lists').click();
  return page;
}

const buttonsIn = (el) => el.querySelectorAll('button');
const actionButton = (el, action) => buttonsIn(el).find((b) => b.getAttribute('data-action') === action);

test('trang: nút trên đơn gửi trạng thái đang thấy; xong thì báo và làm mới danh sách', () => {
  const page = pageWithLists();
  const lists = page.byId('lists');
  assert.match(lists.textContent, /TS-0041Đang làm/, 'đơn đang làm có nhãn');
  const before = page.calls.filter((c) => c.fn === 'staffOpsLists').length;
  actionButton(lists, 'start').click();
  const call = page.last('staffOrderAction');
  assert.deepEqual(json(call.args), ['khoa', { order_code: 'TS-0040', action: 'start', expected_status: 'moi' }]);
  call.call.success({ ok: true, order_code: 'TS-0040', action: 'start' });
  assert.equal(page.text('list-message'), 'Đã cập nhật đơn TS-0040.');
  assert.equal(page.calls.filter((c) => c.fn === 'staffOpsLists').length, before + 1, 'làm mới danh sách và dải');
});

test('trang: người khác vừa đổi đơn thì báo rõ và làm mới danh sách', () => {
  const page = pageWithLists();
  actionButton(page.byId('lists'), 'finish').click();
  const before = page.calls.filter((c) => c.fn === 'staffOpsLists').length;
  page.last('staffOrderAction').call.success({
    ok: false, error_code: 'STALE', message: 'Đơn TS-0040 đã đổi trạng thái, danh sách đã được làm mới.',
  });
  assert.equal(page.text('list-message'), 'Đơn TS-0040 đã đổi trạng thái, danh sách đã được làm mới.');
  assert.equal(page.byId('list-message').className, 'notice error');
  assert.equal(page.calls.filter((c) => c.fn === 'staffOpsLists').length, before + 1);
});

test('trang: Huỷ cần xác nhận lần hai và chọn lý do; Khác cần một dòng; Thôi thì đóng lại', () => {
  const page = pageWithLists();
  const lists = page.byId('lists');
  actionButton(lists, 'cancel').click();
  assert.equal(page.last('staffOrderAction'), undefined, 'bấm lần đầu chưa gửi');
  const box = lists.querySelectorAll('.confirm').find((b) => !b.hidden);
  assert.match(box.textContent, /Huỷ đơn TS-0040\? Suất được trả lại\./);
  assert.deepEqual(box.querySelectorAll('input').filter((i) => i.type === 'radio').map((i) => i.value),
    ['Khách huỷ', 'Nhập nhầm', 'Hết hàng', 'Khác']);
  const yes = box.querySelector('.confirm-yes');
  yes.click();
  assert.equal(page.last('staffOrderAction'), undefined);
  assert.match(box.textContent, /Chọn lý do huỷ\./);

  const other = box.querySelector('.cancel-other');
  assert.equal(other.hidden, true);
  const khac = box.querySelectorAll('input').find((i) => i.value === 'Khác');
  khac.checked = true;
  khac.dispatch('change');
  assert.equal(other.hidden, false);
  yes.click();
  assert.equal(page.last('staffOrderAction'), undefined);
  assert.match(box.textContent, /Ghi ngắn lý do huỷ\./);
  other.value = 'Khách đổi ý';
  yes.click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), {
    order_code: 'TS-0040', action: 'cancel', expected_status: 'moi', cancel_reason: 'Khác', cancel_other: 'Khách đổi ý',
  });

  const page2 = pageWithLists();
  actionButton(page2.byId('lists'), 'cancel').click();
  const box2 = page2.byId('lists').querySelectorAll('.confirm').find((b) => !b.hidden);
  box2.querySelector('.confirm-no').click();
  assert.equal(box2.hidden, true);
  assert.equal(page2.last('staffOrderAction'), undefined);
});

test('trang: Bom cần xác nhận lần hai ở mục Giao; Đang chờ có đủ thông tin và nút Đã gọi', () => {
  const page = pageWithLists();
  page.choose('list-view', 'delivery');
  const lists = page.byId('lists');
  actionButton(lists, 'bom').click();
  assert.equal(page.last('staffOrderAction'), undefined);
  const box = lists.querySelectorAll('.confirm').find((b) => !b.hidden);
  assert.match(box.textContent, /Đánh dấu bom đơn TS-0039\? Suất vẫn tính\./);
  box.querySelector('.confirm-yes').click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), { order_code: 'TS-0039', action: 'bom', expected_status: 'dang_giao' });
  page.last('staffOrderAction').call.success({ ok: true });

  page.choose('list-view', 'held');
  const held = page.byId('lists').textContent;
  for (const text of ['TS-0042', '03/11 21:15', 'Minh', '0987654321', 'https://facebook.com/minh', '5 x Trà sữa', '5 phần',
    'Giao tận nơi · Đến 10km', '5 Lê Lợi', '255.000đ', 'Tiền mặt', 'chờ gọi: đơn lớn, trả tiền mặt', 'gọi trước 11h']) {
    assert.ok(held.includes(text), text);
  }
  const tel = page.byId('lists').querySelectorAll('a').find((a) => a.href === 'tel:0987654321');
  assert.ok(tel, 'SĐT bấm gọi được');
  actionButton(page.byId('lists'), 'call_done').click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), { order_code: 'TS-0042', action: 'call_done', expected_status: 'moi' });
});

test('trang: bấm mã đơn mở chi tiết, đổi trạng thái ngay trong chi tiết, Đóng về đúng mục đang xem', () => {
  const page = pageWithLists();
  const code = buttonsIn(page.byId('lists')).find((b) => b.className === 'code-link' && b.textContent === 'TS-0040');
  assert.equal(code.getAttribute('aria-label'), 'Xem chi tiết đơn TS-0040');
  code.click();
  assert.deepEqual(json(page.last('staffOrderDetail').args), ['khoa', 'TS-0040']);
  assert.equal(page.byId('lists-main').hidden, true);
  assert.equal(page.byId('order-detail').hidden, false);
  page.last('staffOrderDetail').call.success({
    ok: true,
    order: { ...LISTS.held[0], order_code: 'TS-0040', status: 'moi', reason: '', call_reason: '', actions: ['start', 'finish', 'cancel'] },
  });
  // DOM giả không lồng phần tử theo HTML, nên đọc thẳng phần thân của chi tiết.
  const detail = page.byId('order-detail-body');
  assert.equal(page.text('order-detail-title'), 'Đơn TS-0040');
  assert.match(detail.textContent, /Mới/);
  assert.match(detail.textContent, /Minh/);
  assert.equal(detail.querySelectorAll('.code-link').length, 0, 'chi tiết không mở thêm lớp nào');

  actionButton(detail, 'finish').click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), { order_code: 'TS-0040', action: 'finish', expected_status: 'moi' });
  const detailCalls = page.calls.filter((c) => c.fn === 'staffOrderDetail').length;
  page.last('staffOrderAction').call.success({ ok: true });
  assert.equal(page.text('order-detail-message'), 'Đã cập nhật đơn TS-0040.');
  assert.equal(page.calls.filter((c) => c.fn === 'staffOrderDetail').length, detailCalls + 1, 'chi tiết được làm mới');
  page.last('staffOrderDetail').call.success({ ok: true, order: { ...LISTS.held[0], order_code: 'TS-0040', status: 'dang_giao', reason: '', actions: ['deliver', 'bom', 'cancel'] } });
  assert.match(detail.textContent, /Đang giao/);

  page.byId('order-detail-close').click();
  assert.equal(page.byId('order-detail').hidden, true);
  assert.equal(page.byId('lists-main').hidden, false);
  assert.equal(page.radio('list-view', 'prep').checked, true, 'về đúng mục Chuẩn bị');

  // Phím Escape cũng đóng.
  buttonsIn(page.byId('lists')).find((b) => b.textContent === 'TS-0041').click();
  assert.equal(page.byId('order-detail').hidden, false);
  page.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(page.byId('order-detail').hidden, true);
});

test('trang: màn hình đã lưu có Huỷ đơn này, cần xác nhận và lý do', () => {
  const page = loadPage();
  page.fillCustomer();
  page.choose('zone', 'den_10km');
  page.submit();
  page.last('staffSubmit').call.success({ ok: true, order_code: 'TS-0050', total: 59000, cups: 1, needs_call: false, call_reason: '' });
  const cancel = page.byId('cancel-saved');
  assert.equal(cancel.hidden, false);
  cancel.click();
  assert.equal(page.last('staffOrderAction'), undefined);
  const box = page.byId('result-cancel-box');
  assert.equal(box.hidden, false);
  const reason = box.querySelectorAll('input').find((i) => i.value === 'Nhập nhầm');
  reason.checked = true;
  reason.dispatch('change');
  box.querySelector('.confirm-yes').click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), {
    order_code: 'TS-0050', action: 'cancel', expected_status: 'moi', cancel_reason: 'Nhập nhầm', cancel_other: '',
  });
  page.last('staffOrderAction').call.success({ ok: true });
  assert.equal(page.text('result-message'), 'Đã huỷ đơn TS-0050.');
  assert.equal(cancel.hidden, true);
  page.byId('next-order').click();
  assert.equal(page.byId('result-message').hidden, true);
});

test('trang: ô Hôm nay hiện sau mật khẩu, có Làm mới; Khoá thì xoá số liệu', () => {
  const page = loadPage();
  page.byId('open-settings').click();
  page.byId('manager-password').value = 'dung';
  page.byId('manager-unlock').click();
  const today = {
    date: '2026-11-04', generated_at: '2026-11-04 14:32:10', cups: 48, revenue: 2352000, bom_rate_percent: 2,
    by_status: [{ status: 'xong', label: 'Xong', orders: 41, cups: 44 }, { status: 'bom', label: 'Bom', orders: 1, cups: 1 }],
    remaining_cups: 412, max_cups: 600, unit_label: 'phần',
  };
  page.last('managerSettings').call.success({ ok: true, settings: SETTINGS, today });
  const body = page.text('today-body');
  for (const text of ['Đã bán48 phần', 'Đã thu2.352.000đ', 'Còn lại412/600 phần', 'Xong: 41 đơn · 44 phần', 'Bom: 1 đơn · 1 phần', 'Tỷ lệ bom: 2%']) {
    assert.ok(body.includes(text), text);
  }
  assert.equal(page.text('today-updated'), 'Cập nhật lúc 14:32');
  page.byId('today-refresh').click();
  assert.deepEqual(json(page.last('managerToday').args), ['khoa', 'dung']);
  page.last('managerToday').call.success({ ok: true, today: { ...today, cups: 50, generated_at: '2026-11-04 14:40:00' } });
  assert.ok(page.text('today-body').includes('Đã bán50 phần'));
  page.byId('manager-lock').click();
  assert.equal(page.text('today-body'), '');
});

/* ---------- Sửa sau review đợt trạng thái ---------- */

const PICKUP_READY = {
  order_code: 'TS-0038', name: 'Hà', phone: '0901234567', address: '', items_text: '1 x Trà sữa', cups: 1,
  amount_due: 49000, status: 'dang_giao', delivery_method: 'tu_lay', note: '', actions: ['deliver', 'bom', 'cancel'],
};

test('trang: đơn tự lấy đã làm xong có nhãn Chờ khách lấy và nút Đã trao', () => {
  const page = loadPage();
  page.last('staffOpsLists').call.success({ ...LISTS, pickup: { amount_due_total: 49000, orders: [PICKUP_READY] } });
  page.byId('tab-lists').click();
  page.choose('list-view', 'delivery');
  const lists = page.byId('lists');
  assert.match(lists.textContent, /Chờ khách lấy/);
  const deliver = buttonsIn(lists).filter((b) => b.getAttribute('data-action') === 'deliver');
  assert.deepEqual(deliver.map((b) => b.textContent), ['Đã giao', 'Đã trao']);
  deliver[1].click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), { order_code: 'TS-0038', action: 'deliver', expected_status: 'dang_giao' });
});

test('trang: Đã nhận tiền cần xác nhận lần hai, nhắc xem app ngân hàng', () => {
  const page = loadPage();
  const held = { ...LISTS.held[0], reason: 'chờ chuyển khoản', call_reason: '', payment_method: 'chuyen_khoan', payment_status: 'cho_chuyen_khoan', actions: ['paid', 'cancel'] };
  page.last('staffOpsLists').call.success({ ...LISTS, held: [held] });
  page.byId('tab-lists').click();
  page.choose('list-view', 'held');
  const lists = page.byId('lists');
  actionButton(lists, 'paid').click();
  assert.equal(page.last('staffOrderAction'), undefined, 'bấm lần đầu chưa ghi');
  const box = lists.querySelectorAll('.confirm').find((b) => !b.hidden);
  assert.match(box.textContent, /app ngân hàng/);
  box.querySelector('.confirm-yes').click();
  assert.deepEqual(json(page.last('staffOrderAction').args[1]), { order_code: 'TS-0042', action: 'paid', expected_status: 'moi' });
});

test('trang: bấm khi thao tác trước chưa xong thì báo chờ; xong thì báo và đưa focus tới thông báo', () => {
  const page = pageWithLists();
  actionButton(page.byId('lists'), 'start').click();
  const first = page.last('staffOrderAction');
  actionButton(page.byId('lists'), 'finish').click();
  assert.equal(page.calls.filter((c) => c.fn === 'staffOrderAction').length, 1);
  assert.equal(page.text('list-message'), 'Đang lưu thao tác trước, chờ một chút.');
  first.call.success({ ok: true });
  assert.equal(page.text('list-message'), 'Đã cập nhật đơn TS-0040.');
  assert.equal(page.focused(), page.byId('list-message'));
});

test('trang: Đang chờ ghi lý do một lần và bỏ dòng SĐT trống', () => {
  const page = loadPage();
  page.last('staffOpsLists').call.success({ ...LISTS, held: [{ ...LISTS.held[0], phone: '' }] });
  page.byId('tab-lists').click();
  page.choose('list-view', 'held');
  const text = page.byId('lists').textContent;
  assert.equal(text.split('chờ gọi: đơn lớn, trả tiền mặt').length - 1, 1, 'lý do chỉ một lần');
  assert.ok(!text.includes('SĐT'), 'không có dòng SĐT trống');
});

test('trang: Esc đóng hộp xác nhận trước và giữ chi tiết; Esc lần nữa mới đóng chi tiết; tab khác thì không làm gì', () => {
  const page = pageWithLists();
  buttonsIn(page.byId('lists')).find((b) => b.textContent === 'TS-0040').click();
  page.last('staffOrderDetail').call.success({
    ok: true, order: { ...LISTS.held[0], order_code: 'TS-0040', reason: '', actions: ['start', 'finish', 'cancel'] },
  });
  const body = page.byId('order-detail-body');
  const cancel = actionButton(body, 'cancel');
  cancel.click();
  const box = body.querySelectorAll('.confirm').find((b) => !b.hidden);
  const other = box.querySelectorAll('input').find((i) => i.value === 'Khác');
  other.checked = true;
  other.dispatch('change');
  box.querySelector('.cancel-other').value = 'đang gõ dở';
  page.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(box.hidden, true, 'đóng hộp xác nhận');
  assert.equal(page.byId('order-detail').hidden, false, 'chi tiết vẫn mở');
  assert.equal(page.focused(), cancel, 'focus về nút Huỷ');
  page.byId('tab-entry').click();
  page.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(page.byId('order-detail').hidden, false, 'đang ở tab khác thì Esc không đóng');
  page.byId('tab-lists').click();
  page.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(page.byId('order-detail').hidden, true);
});

test('trang: Huỷ ở màn hình đã lưu bị từ chối vì đơn đã đổi thì mở lại nút và lấy lại trạng thái đơn', () => {
  const page = loadPage();
  page.fillCustomer();
  page.choose('zone', 'den_10km');
  page.submit();
  page.last('staffSubmit').call.success({ ok: true, order_code: 'TS-0050', total: 59000, cups: 1, needs_call: false, call_reason: '' });
  page.byId('cancel-saved').click();
  const box = page.byId('result-cancel-box');
  const reason = box.querySelectorAll('input').find((i) => i.value === 'Nhập nhầm');
  reason.checked = true;
  reason.dispatch('change');
  const yes = box.querySelector('.confirm-yes');
  yes.click();
  assert.equal(yes.disabled, true);
  page.last('staffOrderAction').call.success({ ok: false, error_code: 'SERVER_ERROR', message: 'Hệ thống đang lỗi.' });
  assert.equal(yes.disabled, false, 'lỗi thì bấm lại được');
  yes.click();
  page.last('staffOrderAction').call.success({ ok: false, error_code: 'STALE', message: 'Đơn TS-0050 đã đổi trạng thái, danh sách đã được làm mới.' });
  assert.equal(yes.disabled, false);
  assert.equal(page.text('result-message'), 'Đơn TS-0050 đã đổi trạng thái, danh sách đã được làm mới.');
  const detail = page.last('staffOrderDetail');
  assert.deepEqual(json(detail.args), ['khoa', 'TS-0050']);
  detail.call.success({ ok: true, order: { order_code: 'TS-0050', status: 'xong', actions: [] } });
  assert.equal(page.byId('cancel-saved').hidden, true, 'đơn đã xong thì không còn nút huỷ');
  assert.equal(box.hidden, true);
});

test('trang: Hôm nay lỗi khi mở hay khi làm mới thì báo ngắn, không kẹt Đang tải', () => {
  const page = loadPage();
  page.byId('open-settings').click();
  page.byId('manager-password').value = 'dung';
  page.byId('manager-unlock').click();
  page.last('managerSettings').call.success({ ok: true, settings: SETTINGS, today: null, today_error: 'Chưa tính được số liệu hôm nay. Bấm Làm mới để thử lại.' });
  assert.equal(page.byId('settings-body').hidden, false, 'Cài đặt vẫn mở');
  assert.equal(page.text('today-updated'), 'Chưa tính được số liệu hôm nay. Bấm Làm mới để thử lại.');
  page.byId('today-refresh').click();
  assert.equal(page.text('today-updated'), 'Đang tải…');
  page.last('managerToday').call.success({ ok: false, error_code: 'SERVER_ERROR', message: 'Hệ thống đang lỗi.' });
  assert.equal(page.text('today-updated'), 'Chưa tính được số liệu hôm nay. Bấm Làm mới để thử lại.');
  assert.equal(page.byId('today-refresh').disabled, false);
});
