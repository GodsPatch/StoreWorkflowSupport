/**
 * Logic.gs: hàm thuần, không gọi dịch vụ Google, để test được ngoài Google.
 * Tiền tính bằng đồng, số nguyên. Mọi số liệu đếm theo phần; khoá nội bộ vẫn tên cups.
 * Đơn vị hiện cho người dùng lấy từ unit_label trong Cấu hình, mặc định "phần".
 */

var LIMITS = {
  submission_id: 200,
  name: 100,
  contact: 300,
  address: 300,
  note: 500,
  item_lines: 30,
  body_chars: 20000
};

/**
 * Mỗi kênh quy định nguồn đơn, cách thanh toán và giới hạn riêng.
 * Kênh được chọn phía server theo cổng vào, trang gửi lên không đổi được.
 */
var CHANNELS = {
  landing: {
    source: 'landing',
    requireSourceField: true,
    payments: ['cod', 'chuyen_khoan'],
    transferNeedsConfig: true,
    limitPerPhone: true,
    allowManualCall: false
  },
  staff: {
    source: 'messenger',
    requireSourceField: false,
    payments: ['cod', 'chuyen_khoan'],
    transferNeedsConfig: false,
    limitPerPhone: false,
    allowManualCall: true
  },
  backup: {
    source: 'backup',
    requireSourceField: false,
    payments: ['cod'],
    transferNeedsConfig: false,
    limitPerPhone: true,
    allowManualCall: false
  }
};

var ZONES = ['trong_2km', 'den_10km'];
var ZONE_LABELS = { trong_2km: 'Trong 2km', den_10km: 'Đến 10km' };
var STATUS_VALUES = ['moi', 'dang_lam', 'dang_giao', 'xong', 'huy', 'bom'];

/** Kênh khách tự đặt, không qua nhân viên: dùng chung giới hạn phần theo SĐT. */
var PUBLIC_SOURCES = ['landing', 'backup'];

/**
 * Google Maps nhận tối đa 3 điểm dừng giữa đường trên trình duyệt điện thoại và 9 ở nơi khác,
 * cộng một điểm đích. URL tối đa 2.048 ký tự.
 */
var DEFAULT_MAPS_MAX_STOPS = 4;
var MAPS_HARD_MAX_STOPS = 10;
var MAPS_URL_MAX_CHARS = 2000;

function errorResponse(code, message) {
  return { ok: false, error_code: code, message: message };
}

function invalidInput(message) {
  return errorResponse('INVALID_INPUT', message);
}

/** Trả về SĐT 10 số bắt đầu bằng 0, hoặc chuỗi rỗng nếu không hợp lệ. */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  var digits = String(raw).trim().replace(/^'/, '').replace(/[\s.\-()]/g, '');
  if (/^\+?84\d{9}$/.test(digits)) digits = '0' + digits.slice(-9);
  // Sheets có thể đã đổi SĐT thành số và mất số 0 đầu khi nhóm gõ tay.
  if (/^[35789]\d{8}$/.test(digits)) digits = '0' + digits;
  return /^0[35789]\d{8}$/.test(digits) ? digits : '';
}

/** Gom ký tự điều khiển và xuống dòng thành một dấu cách, rồi bỏ khoảng trắng hai đầu. */
function cleanText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
}

/**
 * Luôn thêm dấu ' để Sheets coi giá trị là chữ: không chạy công thức,
 * không đổi "0912345678" thành số, không đổi "5/11" thành ngày.
 * Giá trị rỗng giữ nguyên rỗng để ô không có dấu ' đứng một mình.
 */
function sanitizeForSheet(value) {
  var text = String(value);
  return text === '' ? '' : "'" + text;
}

/** Nhận 49000, "49000", "49.000", "49,000". Trả về null nếu không phải số nguyên không âm. */
function parseWholeNumber(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  var text = value.trim();
  if (!/^\d+$/.test(text) && !/^\d{1,3}([.,]\d{3})+$/.test(text)) return null;
  var parsed = Number(text.replace(/[.,]/g, ''));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Giá trị lạ tính là tắt, để lỗi gõ cấu hình không vô tình mở bán. */
function parseBool(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

/** Hai giá trị của ô Nhận đơn trong tab Cấu hình. */
var OPEN_LABEL = 'Mở cửa';
var CLOSED_LABEL = 'Đóng cửa';
var DEFAULT_UNIT_LABEL = 'phần';

/** Nhận Mở cửa, và TRUE của Sheet cũ. Giá trị lạ hoặc trống coi là Đóng cửa. */
function parseOpenState(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  var text = value.trim().normalize('NFC').toLowerCase();
  return text === 'true' || text === OPEN_LABEL.toLowerCase();
}

/** Ô Nhận đơn theo chữ mới: Sheet cũ ghi TRUE/FALSE được đổi khi chạy setup. */
function openStateLabel(value) {
  return parseOpenState(value) ? OPEN_LABEL : CLOSED_LABEL;
}

/**
 * Các ô số bắt buộc, kèm số nhỏ nhất và tên hiện trong email cảnh báo.
 * Thiếu hoặc sai thì hệ thống dùng giá trị hợp lệ gần nhất; chưa từng có thì từ chối đơn.
 */
var CONFIG_REQUIRED_NUMBERS = [
  { key: 'max_cups', min: 1, label: 'Giới hạn tổng số phần' },
  { key: 'low_stock_alert_cups', min: 0, label: 'Ngưỡng báo sắp hết suất' },
  { key: 'call_threshold_cups', min: 1, label: 'Ngưỡng đơn lớn cần gọi' },
  { key: 'max_cups_per_phone_public', min: 1, label: 'Giới hạn phần mỗi số điện thoại' },
  { key: 'shipping_fee_tu_lay', min: 0, label: 'Phí khi tự đến lấy', money: true },
  { key: 'shipping_fee_trong_2km', min: 0, label: 'Phí ship trong 2km', money: true },
  { key: 'shipping_fee_den_10km', min: 0, label: 'Phí ship đến 10km', money: true }
];

function isBlankValue_(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** Kiểm tra một ô số bắt buộc. Trả về null nếu đúng, hoặc câu mô tả lỗi. */
function configNumberProblem_(spec, value) {
  if (isBlankValue_(value)) return 'đang trống';
  var parsed = parseWholeNumber(value);
  if (parsed === null) return 'không phải số nguyên hợp lệ';
  if (parsed < spec.min) return 'phải từ ' + spec.min + ' trở lên';
  if (spec.money && isTooSmallMoney_(parsed)) return 'từ 1 đến 999đ, có thể đã gõ thiếu số 0';
  return null;
}

/** Liệt kê các ô số bắt buộc đang sai: [{ key, label, problem }]. */
function configProblems(raw) {
  var problems = [];
  CONFIG_REQUIRED_NUMBERS.forEach(function (spec) {
    var problem = configNumberProblem_(spec, raw[spec.key]);
    if (problem) problems.push({ key: spec.key, label: spec.label, problem: problem });
  });
  return problems;
}

/** Giá trị đã chuẩn hoá của các ô số bắt buộc, để lưu làm bản hợp lệ gần nhất. Chỉ gọi khi không có lỗi. */
function requiredConfigValues(raw) {
  var values = {};
  CONFIG_REQUIRED_NUMBERS.forEach(function (spec) { values[spec.key] = parseWholeNumber(raw[spec.key]); });
  return values;
}

/**
 * Thay ô sai bằng giá trị hợp lệ gần nhất. lastGood: kết quả requiredConfigValues đã lưu, hoặc null.
 * Trả về { raw, problems, usable }: usable false nghĩa là có ô sai mà chưa từng có giá trị hợp lệ.
 */
function applyConfigFallback(raw, lastGood) {
  var problems = configProblems(raw);
  var merged = {};
  Object.keys(raw).forEach(function (key) { merged[key] = raw[key]; });
  var usable = true;
  problems.forEach(function (entry) {
    var spec = configSpec_(entry.key);
    var saved = lastGood && Object.prototype.hasOwnProperty.call(lastGood, entry.key) ? lastGood[entry.key] : null;
    if (saved === null || configNumberProblem_(spec, saved)) {
      usable = false;
      return;
    }
    merged[entry.key] = saved;
    entry.fallback = saved;
  });
  return { raw: merged, problems: problems, usable: usable };
}

function configSpec_(key) {
  for (var i = 0; i < CONFIG_REQUIRED_NUMBERS.length; i++) {
    if (CONFIG_REQUIRED_NUMBERS[i].key === key) return CONFIG_REQUIRED_NUMBERS[i];
  }
  return null;
}

/** Một dòng trong email cảnh báo Cấu hình, ví dụ: Ô "Phí ship đến 10km" đang trống. Hệ thống tạm dùng giá trị cũ: 10.000đ. */
function configProblemMessage(entry, unit) {
  var spec = configSpec_(entry.key) || {};
  var shown = spec.money ? formatMoney(entry.fallback) : entry.fallback + ' ' + (unit || DEFAULT_UNIT_LABEL);
  return 'Ô "' + entry.label + '" ' + entry.problem + '. Hệ thống tạm dùng giá trị cũ: ' + shown + '.';
}

/** Dấu của tập lỗi, để mỗi lỗi mới chỉ báo một lần. */
function configProblemsSignature(problems) {
  return problems
    .map(function (entry) { return entry.key + ':' + entry.problem; })
    .sort()
    .join('|');
}

/** Đổi bảng khoá/giá trị của tab Config thành cấu hình. Thiếu hoặc sai số thì ném lỗi. */
function parseConfig(raw) {
  var problems = configProblems(raw);
  if (problems.length) throw new Error('Config sai hoặc thiếu: ' + problems.map(function (p) { return p.key; }).join(', '));
  var config = {
    orders_open: parseOpenState(raw.orders_open),
    shipping_fees: {}
  };
  ['max_cups', 'low_stock_alert_cups', 'call_threshold_cups', 'max_cups_per_phone_public'].forEach(function (key) {
    config[key] = parseWholeNumber(raw[key]);
  });
  ['tu_lay', 'trong_2km', 'den_10km'].forEach(function (method) {
    config.shipping_fees[method] = parseWholeNumber(raw['shipping_fee_' + method]);
  });
  // Các khoá không chặn nhận đơn: thiếu thì tắt chuyển khoản trên landing và dùng mặc định cho bản đồ, đơn vị.
  config.shop_address = cleanText(raw.shop_address === undefined || raw.shop_address === null ? '' : raw.shop_address);
  config.maps_max_stops = parseMapsMaxStops_(raw.maps_max_stops);
  config.transfer = parseTransferConfig_(raw);
  config.unit_label = parseUnitLabel(raw.unit_label);
  return config;
}

/** Đơn vị đếm hiện cho người dùng. Trống thì dùng "phần". */
function parseUnitLabel(value) {
  var text = isBlankValue_(value) ? '' : cleanText(value);
  return text ? text.slice(0, 30) : DEFAULT_UNIT_LABEL;
}

/** Số lạ hoặc 0 thì dùng mặc định; quá giới hạn của Google thì hạ xuống, để link không mở thiếu điểm. */
function parseMapsMaxStops_(value) {
  var parsed = parseWholeNumber(value);
  if (!parsed) return DEFAULT_MAPS_MAX_STOPS;
  return Math.min(parsed, MAPS_HARD_MAX_STOPS);
}

/** Sheets theo locale coi 49.000 là số thập phân và lưu 49. Số tiền từ 1 đến 999đ coi là gõ sai. */
function isTooSmallMoney_(amount) {
  return amount > 0 && amount < 1000;
}

/**
 * Lập danh sách đang bán từ tab Products hoặc Toppings.
 * Dòng ẩn, thiếu mã hoặc sai giá thì không bán, không làm hỏng cả menu.
 */
function buildCatalogList(rows, idField) {
  var list = [];
  rows.forEach(function (row) {
    var id = cleanText(row[idField] === undefined ? '' : row[idField]);
    var price = parseWholeNumber(row.price);
    var status = cleanText(row.status === undefined ? '' : row.status).toLowerCase();
    if (!id || price === null || status !== 'active') return;
    if (isTooSmallMoney_(price)) return;
    var entry = { name: cleanText(row.name === undefined ? '' : row.name) || id, price: price };
    entry[idField] = id;
    list.push(entry);
  });
  return list;
}

function findById_(list, idField, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i][idField] === id) return list[i];
  }
  return null;
}

/** Trường văn bản. Trả về { value } hoặc { error }. */
function readText_(payload, field, label, maxLength, required) {
  var raw = payload[field];
  if (raw === undefined || raw === null) raw = '';
  if (typeof raw !== 'string') return { error: label + ' không hợp lệ.' };
  var value = cleanText(raw);
  if (required && !value) return { error: 'Vui lòng nhập ' + label.toLowerCase() + '.' };
  if (value.length > maxLength) return { error: label + ' quá dài.' };
  return { value: value };
}

/** Kiểm tra phần không cần đến cấu hình, chạy trước khi xin lock. */
function precheckOrder(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalidInput('Dữ liệu đơn không hợp lệ.');
  }
  if (payload.website !== undefined && payload.website !== null && String(payload.website).trim() !== '') {
    return invalidInput('Không thể tạo đơn. Vui lòng nhắn Messenger để được hỗ trợ.');
  }
  var id = readText_(payload, 'submission_id', 'Mã lần đặt', LIMITS.submission_id, true);
  if (id.error) return invalidInput('Mã lần đặt không hợp lệ. Vui lòng tải lại trang.');
  return { ok: true, submission_id: id.value };
}

function validateItems_(rawItems, catalog) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return { error: 'Vui lòng chọn ít nhất một món.' };
  if (rawItems.length > LIMITS.item_lines) return { error: 'Đơn có quá nhiều dòng món.' };

  var result = { items: [], texts: [], cups: 0, subtotal: 0 };
  for (var i = 0; i < rawItems.length; i++) {
    var line = rawItems[i];
    if (line === null || typeof line !== 'object' || Array.isArray(line)) return { error: 'Món không hợp lệ.' };

    var product = findById_(catalog.products, 'product_id', line.product_id);
    if (!product) return { error: 'Có món không còn bán hoặc không đúng. Vui lòng chọn lại.' };
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return { error: 'Số lượng không hợp lệ.' };

    var rawToppings = line.toppings === undefined || line.toppings === null ? [] : line.toppings;
    if (!Array.isArray(rawToppings)) return { error: 'Topping không hợp lệ.' };

    var toppingIds = [];
    var toppingNames = [];
    var unitPrice = product.price;
    for (var t = 0; t < rawToppings.length; t++) {
      var topping = findById_(catalog.toppings, 'topping_id', rawToppings[t]);
      if (!topping) return { error: 'Có topping không còn bán hoặc không đúng. Vui lòng chọn lại.' };
      if (toppingIds.indexOf(topping.topping_id) !== -1) continue;
      toppingIds.push(topping.topping_id);
      toppingNames.push(topping.name);
      unitPrice += topping.price;
    }

    result.items.push({
      product_id: product.product_id,
      quantity: line.quantity,
      toppings: toppingIds,
      unit_price: unitPrice
    });
    result.texts.push(
      line.quantity + ' x ' + product.name + (toppingNames.length ? ' (' + toppingNames.join(', ') + ')' : '')
    );
    result.cups += line.quantity;
    result.subtotal += line.quantity * unitPrice;
  }
  return result;
}

/**
 * Kiểm tra và tính tiền đơn. Bỏ qua mọi trường giá trang gửi lên.
 * ctx: { channel, catalog: { products, toppings }, config }
 */
function validateOrder(payload, ctx) {
  var channel = ctx.channel;
  if (channel.requireSourceField && payload.source !== channel.source) {
    return invalidInput('Nguồn đơn không hợp lệ.');
  }

  var name = readText_(payload, 'name', 'Tên', LIMITS.name, true);
  if (name.error) return invalidInput(name.error);

  if (typeof payload.phone !== 'string') return invalidInput('Vui lòng nhập số điện thoại.');
  var phone = normalizePhone(payload.phone);
  if (!phone) return invalidInput('Số điện thoại không đúng. Vui lòng nhập số di động Việt Nam 10 số.');

  var contact = readText_(payload, 'contact', 'Link liên hệ', LIMITS.contact, false);
  if (contact.error) return invalidInput(contact.error);
  var note = readText_(payload, 'note', 'Ghi chú', LIMITS.note, false);
  if (note.error) return invalidInput(note.error);

  var checked = validateItems_(payload.items, ctx.catalog);
  if (checked.error) return invalidInput(checked.error);

  var method = payload.delivery_method;
  if (method !== 'giao' && method !== 'tu_lay') return invalidInput('Vui lòng chọn giao hàng hoặc tự đến lấy.');

  var zone = '';
  var address = '';
  var feeKey = 'tu_lay';
  if (method === 'giao') {
    if (ZONES.indexOf(payload.zone) === -1) return invalidInput('Vui lòng chọn khu vực giao.');
    var addressText = readText_(payload, 'address', 'Địa chỉ', LIMITS.address, true);
    if (addressText.error) return invalidInput(addressText.error);
    zone = payload.zone;
    address = addressText.value;
    feeKey = zone;
  }

  if (channel.payments.indexOf(payload.payment_method) === -1) {
    return invalidInput('Cách thanh toán không hợp lệ.');
  }
  if (payload.payment_method === 'chuyen_khoan' && channel.transferNeedsConfig &&
      !(ctx.config.transfer && ctx.config.transfer.enabled)) {
    return invalidInput('Hiện chưa nhận chuyển khoản. Vui lòng chọn trả tiền mặt khi nhận hàng.');
  }

  var shippingFee = ctx.config.shipping_fees[feeKey];
  var isCod = payload.payment_method === 'cod';
  var callReasons = needsCallReasons(
    payload.payment_method,
    checked.cups,
    ctx.config.call_threshold_cups,
    channel.allowManualCall && payload.needs_call === true,
    bomOrderCode(ctx.orders || [], phone)
  );
  return {
    ok: true,
    order: {
      source: channel.source,
      name: name.value,
      phone: phone,
      contact: contact.value,
      note: note.value,
      items: checked.items,
      items_text: checked.texts.join('; '),
      cups: checked.cups,
      delivery_method: method,
      zone: zone,
      address: address,
      payment_method: payload.payment_method,
      payment_status: isCod ? 'cod' : 'cho_chuyen_khoan',
      shipping_fee: shippingFee,
      total: checked.subtotal + shippingFee,
      needs_call: callReasons.length > 0,
      call_reason: callReasons.join('; ')
    }
  };
}

/** Cần gọi: nhân viên đánh dấu, hoặc đơn COD đủ ngưỡng phần, hoặc đơn COD từ SĐT từng bom. */
function computeNeedsCall(paymentMethod, cups, threshold, manualFlag, hasBom) {
  return manualFlag === true || (paymentMethod === 'cod' && (cups >= threshold || hasBom === true));
}

/**
 * Lý do cần gọi, ghi rõ để người gọi biết hỏi gì: đơn lớn trả tiền mặt, SĐT từng bom kèm mã đơn, nhân viên đánh dấu.
 * Mảng rỗng là không cần gọi. Cùng điều kiện với computeNeedsCall.
 */
function needsCallReasons(paymentMethod, cups, threshold, manualFlag, bomCode) {
  var reasons = [];
  if (paymentMethod === 'cod' && cups >= threshold) reasons.push('đơn lớn, trả tiền mặt');
  if (paymentMethod === 'cod' && bomCode) reasons.push('SĐT từng bom ' + bomCode);
  if (manualFlag === true) reasons.push('nhân viên đánh dấu');
  return reasons;
}

function phoneHasBom(orders, phone) {
  return bomOrderCode(orders, phone) !== '';
}

/** Mã đơn bom gần nhất của SĐT này, hoặc chuỗi rỗng. */
function bomOrderCode(orders, phone) {
  var code = '';
  orders.forEach(function (order) {
    if (fieldCode_(order, 'status') === 'bom' && normalizePhone(order.phone) === phone) code = String(order.order_code);
  });
  return code;
}

/** Lý do cần gọi đã lưu cùng đơn. Đơn tạo trước khi có cột này thì trả chuỗi rỗng. */
function callReasonOf(order) {
  var value = order.call_reason;
  return cleanText(value === undefined || value === null ? '' : value).replace(/^'/, '');
}

function orderCups_(order) {
  return parseWholeNumber(order.cups) || 0;
}

function isCancelled_(order) {
  return cleanText(order.status === undefined ? '' : order.status).toLowerCase() === 'huy';
}

/** Đếm suất: tổng phần của mọi đơn trừ huy. Đơn bom vẫn tính vì đã làm. */
function countCups(orders) {
  return orders.reduce(function (sum, order) {
    return isCancelled_(order) ? sum : sum + orderCups_(order);
  }, 0);
}

/** Số phần SĐT này đã đặt qua các form công khai, trừ đơn huy. */
function countPublicCupsForPhone(orders, phone) {
  return orders.reduce(function (sum, order) {
    var counted = !isCancelled_(order) && PUBLIC_SOURCES.indexOf(order.source) !== -1 &&
      normalizePhone(order.phone) === phone;
    return counted ? sum + orderCups_(order) : sum;
  }, 0);
}

/** Số lớn nhất giữa bộ đếm đã lưu và mã trong Sheet, để không cấp lại mã khi có dòng bị xoá. */
function nextOrderNumber(orderCodes, lastNumber) {
  var max = parseWholeNumber(lastNumber) || 0;
  orderCodes.forEach(function (code) {
    var match = /^TS-(\d+)$/.exec(String(code));
    if (match) max = Math.max(max, Number(match[1]));
  });
  return max + 1;
}

function formatOrderCode(number) {
  return 'TS-' + ('000' + number).slice(-Math.max(4, String(number).length));
}

/** Đạt ngưỡng và chưa báo thì báo. Tụt dưới ngưỡng (đơn huỷ, đổi ngưỡng) thì lần sau được báo lại. */
function lowStockState(counted, config, alreadyAlerted) {
  var threshold = Math.min(config.low_stock_alert_cups, config.max_cups);
  var reached = threshold > 0 && counted >= threshold;
  return {
    alert: reached && !alreadyAlerted,
    rearm: !reached && alreadyAlerted,
    counted_cups: counted,
    threshold_cups: threshold,
    max_cups: config.max_cups,
    remaining_cups: Math.max(0, config.max_cups - counted)
  };
}

/**
 * Dải trạng thái của trang nhập đơn: mở hay đóng, số phần còn lại, số đơn đang chờ.
 * Chỉ trả cho người có STAFF_KEY; landing không thấy số này.
 */
function buildStaffStatus(orders, config) {
  var counted = countCups(orders);
  var low = lowStockState(counted, config, false);
  return {
    orders_open: config.orders_open === true,
    remaining_cups: low.remaining_cups,
    low_stock: low.threshold_cups > 0 && counted >= low.threshold_cups,
    held_count: buildHeldList(orders).length,
    unit_label: config.unit_label || DEFAULT_UNIT_LABEL
  };
}

/* ---------- Điều kiện làm và giao ---------- */

function fieldCode_(order, field) {
  var value = order[field];
  return cleanText(value === undefined || value === null ? '' : value).toLowerCase();
}

/** Lý do đơn chưa được làm: chuyển khoản phải da_nhan, needs_call phải call_done. */
function holdReasons_(order) {
  var reasons = [];
  var payment = fieldCode_(order, 'payment_status');
  var awaitsTransfer = fieldCode_(order, 'payment_method') === 'chuyen_khoan' || payment === 'cho_chuyen_khoan';
  if (awaitsTransfer && payment !== 'da_nhan') reasons.push('chờ chuyển khoản');
  if (parseBool(order.needs_call) && !parseBool(order.call_done)) {
    var why = callReasonOf(order);
    reasons.push(why ? 'chờ gọi: ' + why : 'chờ gọi');
  }
  return reasons;
}

function isCleared_(order) {
  return holdReasons_(order).length === 0;
}

function isFinished_(order) {
  return ['xong', 'huy', 'bom'].indexOf(fieldCode_(order, 'status')) !== -1;
}


/** Đơn nằm trong danh sách chuẩn bị: chưa làm hoặc đang làm, đã đủ điều kiện tiền và gọi. */
function isInPrep_(order) {
  var status = fieldCode_(order, 'status');
  return (status === 'moi' || status === 'dang_lam') && isCleared_(order);
}

/* ---------- Đổi trạng thái từ trang nhập đơn ---------- */

var OPEN_STATUSES = ['moi', 'dang_lam', 'dang_giao'];

/** Mỗi thao tác ghi đúng cột hệ thống mà nhóm vẫn sửa tay trong Sheet. */
var ORDER_ACTION_CHANGES = {
  call_done: { call_done: true },
  paid: { payment_status: 'da_nhan' },
  start: { status: 'dang_lam' },
  finish: { status: 'dang_giao' },
  deliver: { status: 'xong' },
  bom: { status: 'bom' },
  cancel: { status: 'huy' }
};

/** Nút hiện ở từng mục của tab Danh sách. */
var SECTION_ACTIONS = {
  held: ['call_done', 'paid', 'cancel'],
  prep: ['start', 'finish', 'cancel'],
  handover: ['deliver', 'bom', 'cancel']
};

/**
 * Các thao tác hợp lệ với đơn ở trạng thái hiện tại. Đơn đã xong, huỷ hoặc bom không đổi được nữa.
 * Đơn còn chờ tiền hoặc chờ gọi chỉ được xác nhận tiền, gọi hoặc huỷ; chưa được làm hay giao.
 */
function allowedOrderActions(order) {
  var status = fieldCode_(order, 'status');
  if (OPEN_STATUSES.indexOf(status) === -1) return [];
  var payment = fieldCode_(order, 'payment_status');
  var awaitsTransfer = (fieldCode_(order, 'payment_method') === 'chuyen_khoan' || payment === 'cho_chuyen_khoan') &&
    payment !== 'da_nhan';
  var awaitsCall = parseBool(order.needs_call) && !parseBool(order.call_done);
  var actions = [];
  if (awaitsCall) actions.push('call_done');
  if (awaitsTransfer) actions.push('paid');
  if (!awaitsCall && !awaitsTransfer) {
    if (status === 'moi') actions.push('start');
    if (status === 'moi' || status === 'dang_lam') actions.push('finish');
    if (status === 'dang_giao') {
      actions.push('deliver');
      actions.push('bom');
    }
  }
  actions.push('cancel');
  return actions;
}

function sectionActions(order, section) {
  var allowed = allowedOrderActions(order);
  return SECTION_ACTIONS[section].filter(function (action) { return allowed.indexOf(action) !== -1; });
}

/**
 * Kiểm tra một lần bấm. expectedStatus là trạng thái trang đang thấy: khác trạng thái trong Sheet nghĩa là
 * người khác vừa đổi, nên không ghi để hai lần bấm không chồng nhau.
 * Trả về { changes } nếu được ghi, { stale: true } nếu đơn đã đổi, { invalid: message } nếu yêu cầu sai.
 */
function planOrderAction(order, action, expectedStatus) {
  if (!Object.prototype.hasOwnProperty.call(ORDER_ACTION_CHANGES, action)) return { invalid: 'Thao tác không hợp lệ.' };
  if (fieldCode_(order, 'status') !== expectedStatus || allowedOrderActions(order).indexOf(action) === -1) {
    return { stale: true };
  }
  return { changes: ORDER_ACTION_CHANGES[action] };
}

/** Lý do huỷ chọn bằng chip trên trang. Khác cần thêm một dòng ngắn. */
var CANCEL_REASONS = ['Khách huỷ', 'Nhập nhầm', 'Hết hàng', 'Khác'];
var CANCEL_OTHER_MAX = 100;
/** Thao tác khó hoàn tác: trang phải hỏi xác nhận lần hai. Đã nhận tiền cũng vậy, vì cần xem app ngân hàng trước. */
var CONFIRM_ACTIONS = ['cancel', 'bom', 'paid'];

/** Cấu hình riêng của trang nhập đơn, để trang không giữ bản sao danh sách lý do và giới hạn. */
function staffUiConfig() {
  return { cancel_reasons: CANCEL_REASONS, cancel_other_max: CANCEL_OTHER_MAX, confirm_actions: CONFIRM_ACTIONS };
}

/** Trả về { value } là chữ lưu vào cột Lý do huỷ, hoặc { error }. */
function cancelReasonText(reason, other) {
  if (CANCEL_REASONS.indexOf(reason) === -1) return { error: 'Chọn lý do huỷ.' };
  if (reason !== 'Khác') return { value: reason };
  var text = cleanText(typeof other === 'string' ? other : '');
  if (!text) return { error: 'Ghi ngắn lý do huỷ.' };
  if (text.length > CANCEL_OTHER_MAX) return { error: 'Lý do huỷ quá dài.' };
  return { value: 'Khác: ' + text };
}

function staleOrderMessage(orderCode) {
  return 'Đơn ' + orderCode + ' đã đổi trạng thái, danh sách đã được làm mới.';
}

/**
 * Dùng chung cho đơn giao và đơn tự lấy: chuẩn bị xong mới giao, nên chỉ đơn dang_giao đã đủ điều kiện.
 * Một đơn không bao giờ nằm cùng lúc ở Chuẩn bị (moi, dang_lam) và Giao (dang_giao).
 */
function isOpenForHandover_(order) {
  return fieldCode_(order, 'status') === 'dang_giao' && isCleared_(order);
}

function isHeld_(order) {
  return !isFinished_(order) && !isCleared_(order);
}

/** Đơn chưa kết thúc đang chờ tiền hoặc chờ gọi, để không bị bỏ quên khi chưa vào danh sách nào. */
function buildHeldList(orders) {
  return orders
    .filter(isHeld_)
    .map(function (order) {
      return {
        order_code: String(order.order_code),
        phone: normalizePhone(order.phone) || cleanText(order.phone === undefined || order.phone === null ? '' : order.phone),
        amount: parseWholeNumber(order.total) || 0,
        reason: holdReasons_(order).join('; '),
        status: fieldCode_(order, 'status'),
        actions: sectionActions(order, 'held')
      };
    });
}

/**
 * Mục Đang chờ của trang nhập đơn: đủ thông tin để gọi khách hay đối chiếu tiền mà không mở Sheet.
 * Chỉ dùng cho trang có STAFF_KEY; email và n8n vẫn dùng buildHeldList.
 * formatTime đổi created_at thành 'yyyy-MM-dd HH:mm:ss' giờ Việt Nam.
 */
function buildHeldDetails(orders, formatTime) {
  return orders.filter(isHeld_).map(function (order) {
    var detail = buildOrderDetail(order, formatTime);
    detail.actions = sectionActions(order, 'held');
    return detail;
  });
}

/**
 * Toàn bộ thông tin một đơn cho màn hình chi tiết của trang nhập đơn, kèm mọi nút hợp lệ lúc này.
 * Không có cột hệ thống (mã gửi, chi tiết JSON, link QR).
 */
function buildOrderDetail(order, formatTime) {
  var text = function (field) {
    return cleanText(order[field] === undefined || order[field] === null ? '' : order[field]);
  };
  var zone = fieldCode_(order, 'zone');
  return {
    order_code: String(order.order_code),
    created_at: formatTime(order.created_at),
    status: fieldCode_(order, 'status'),
    name: text('name'),
    phone: normalizePhone(order.phone) || text('phone'),
    contact: text('contact'),
    items_text: text('items_text'),
    cups: orderCups_(order),
    delivery_method: fieldCode_(order, 'delivery_method'),
    zone_label: zone ? ZONE_LABELS[zone] || zone : '',
    address: text('address'),
    amount: parseWholeNumber(order.total) || 0,
    payment_method: fieldCode_(order, 'payment_method'),
    payment_status: fieldCode_(order, 'payment_status'),
    reason: isFinished_(order) ? '' : holdReasons_(order).join('; '),
    call_reason: parseBool(order.needs_call) ? callReasonOf(order) : '',
    note: text('note'),
    actions: allowedOrderActions(order)
  };
}

/** COD thu đủ total, đã nhận chuyển khoản thì thu 0. */
function amountDue(order) {
  return fieldCode_(order, 'payment_status') === 'da_nhan' ? 0 : parseWholeNumber(order.total) || 0;
}

/* ---------- Danh sách chuẩn bị ---------- */

/** Đọc cột items. Dòng bị sửa tay thành sai định dạng thì trả null để báo riêng, không làm hỏng cả danh sách. */
function parseOrderItems_(order) {
  var items;
  try {
    items = JSON.parse(String(order.items).replace(/^'/, ''));
  } catch (err) {
    return null;
  }
  if (!Array.isArray(items) || items.length === 0) return null;
  var valid = items.every(function (item) {
    return item !== null && typeof item === 'object' &&
      typeof item.product_id === 'string' && item.product_id !== '' &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
      (item.toppings === undefined || Array.isArray(item.toppings));
  });
  return valid ? items : null;
}

function nameOf_(names, id) {
  return Object.prototype.hasOwnProperty.call(names, id) ? names[id] : id;
}

/** names: { products: { id: tên }, toppings: { id: tên } }, gồm cả món đã ngừng bán vì đơn cũ vẫn phải chuẩn bị. */
function buildPrepList(orders, names) {
  var byKey = {};
  var unparsed = [];
  var totalCups = 0;

  // Đơn đang làm vẫn ở lại với nhãn Đang làm cho đến khi bấm Làm xong.
  orders.filter(isInPrep_).forEach(function (order) {
    var code = String(order.order_code);
    var note = cleanText(order.note === undefined || order.note === null ? '' : order.note);
    var entry = {
      order_code: code,
      status: fieldCode_(order, 'status'),
      delivery_method: fieldCode_(order, 'delivery_method'),
      actions: sectionActions(order, 'prep')
    };
    var items = parseOrderItems_(order);
    if (!items) {
      totalCups += orderCups_(order);
      unparsed.push({
        order_code: code, cups: orderCups_(order), items_text: cleanText(order.items_text || ''), note: note,
        status: entry.status, delivery_method: entry.delivery_method, actions: entry.actions
      });
      return;
    }
    items.forEach(function (item) {
      // Cùng bộ topping chọn khác thứ tự vẫn là một dòng.
      var toppingIds = (item.toppings || []).map(String).sort();
      var key = JSON.stringify([item.product_id, toppingIds]);
      if (!Object.prototype.hasOwnProperty.call(byKey, key)) {
        byKey[key] = {
          product_id: item.product_id,
          product_name: nameOf_(names.products, item.product_id),
          toppings: toppingIds.map(function (id) { return nameOf_(names.toppings, id); }),
          cups: 0,
          order_codes: [],
          orders: [],
          notes: []
        };
      }
      byKey[key].cups += item.quantity;
      totalCups += item.quantity;
      if (byKey[key].order_codes.indexOf(code) === -1) {
        byKey[key].order_codes.push(code);
        byKey[key].orders.push(entry);
        // Ghi chú thuộc cả đơn, nên đơn nhiều món hiện ở mọi dòng của đơn đó.
        if (note) byKey[key].notes.push({ order_code: code, note: note });
      }
    });
  });

  var lines = Object.keys(byKey).sort().map(function (key) { return byKey[key]; });
  return { total_cups: totalCups, lines: lines, unparsed: unparsed };
}

/* ---------- Link bản đồ ---------- */

/** encodeURIComponent ném lỗi với nửa cặp surrogate; một ký tự lạ không được làm hỏng cả danh sách. */
function encodeUrlPart_(text) {
  return encodeURIComponent(
    String(text).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ')
  );
}

/** Maps dùng | để ngăn cách các điểm, kể cả khi mã hoá thành %7C, nên | trong địa chỉ phải đổi đi. */
function mapPlace_(address) {
  return cleanText(address === undefined || address === null ? '' : address)
    .replace(/\s*\|+\s*/g, ', ');
}

function buildMapUrl_(places, origin) {
  var url = 'https://www.google.com/maps/dir/?api=1';
  if (origin) url += '&origin=' + encodeUrlPart_(origin);
  url += '&destination=' + encodeUrlPart_(places[places.length - 1]);
  if (places.length > 1) url += '&waypoints=' + places.slice(0, -1).map(encodeUrlPart_).join('%7C');
  return url;
}

/**
 * Chia điểm thành nhiều link, giữ nguyên thứ tự, mỗi link đi từ shop_address.
 * Chia khi vượt maps_max_stops hoặc khi URL vượt giới hạn độ dài của Google.
 * stops: [{ order_code, address }]. Đơn không có địa chỉ không có điểm để đưa vào link.
 */
function buildMapLinks(stops, shopAddress, maxStops) {
  var origin = mapPlace_(shopAddress);
  var links = [];
  var places = [];
  var codes = [];

  function flush() {
    if (places.length) links.push({ url: buildMapUrl_(places, origin), order_codes: codes });
    places = [];
    codes = [];
  }

  stops.forEach(function (stop) {
    var place = mapPlace_(stop.address);
    if (!place) return;
    var tooMany = places.length >= maxStops;
    var tooLong = places.length > 0 && buildMapUrl_(places.concat(place), origin).length > MAPS_URL_MAX_CHARS;
    if (tooMany || tooLong) flush();
    places.push(place);
    codes.push(String(stop.order_code));
  });
  flush();
  return links;
}

/* ---------- Danh sách giao và tự lấy ---------- */

function handoverEntry_(order) {
  var text = function (field) {
    return cleanText(order[field] === undefined || order[field] === null ? '' : order[field]);
  };
  return {
    order_code: String(order.order_code),
    name: text('name'),
    phone: normalizePhone(order.phone) || text('phone'),
    address: text('address'),
    items_text: text('items_text'),
    cups: orderCups_(order),
    amount_due: amountDue(order),
    status: fieldCode_(order, 'status'),
    delivery_method: fieldCode_(order, 'delivery_method'),
    actions: sectionActions(order, 'handover'),
    note: text('note')
  };
}

function sumAmountDue_(entries) {
  return entries.reduce(function (sum, entry) { return sum + entry.amount_due; }, 0);
}

function buildDeliveryList(orders, config) {
  var byZone = {};
  orders.forEach(function (order) {
    if (fieldCode_(order, 'delivery_method') !== 'giao' || !isOpenForHandover_(order)) return;
    var zone = fieldCode_(order, 'zone');
    if (!Object.prototype.hasOwnProperty.call(byZone, zone)) byZone[zone] = [];
    byZone[zone].push(handoverEntry_(order));
  });

  // Khu vực lạ do sửa tay vẫn hiện ở cuối, không làm mất đơn.
  var extraZones = Object.keys(byZone).filter(function (zone) { return ZONES.indexOf(zone) === -1; }).sort();
  var zones = ZONES.concat(extraZones)
    .filter(function (zone) { return Object.prototype.hasOwnProperty.call(byZone, zone); })
    .map(function (zone) {
      var entries = byZone[zone];
      return {
        zone: zone,
        label: ZONE_LABELS[zone] || zone || 'Chưa rõ khu vực',
        stops: entries.length,
        amount_due_total: sumAmountDue_(entries),
        orders: entries,
        map_links: buildMapLinks(entries, config.shop_address, config.maps_max_stops)
      };
    });

  return {
    stops: zones.reduce(function (sum, zone) { return sum + zone.stops; }, 0),
    amount_due_total: zones.reduce(function (sum, zone) { return sum + zone.amount_due_total; }, 0),
    zones: zones
  };
}

function buildPickupList(orders) {
  var entries = orders
    .filter(function (order) { return fieldCode_(order, 'delivery_method') === 'tu_lay' && isOpenForHandover_(order); })
    .map(handoverEntry_);
  return { amount_due_total: sumAmountDue_(entries), orders: entries };
}

function buildOpsLists(orders, names, config) {
  return {
    prep: buildPrepList(orders, names),
    delivery: buildDeliveryList(orders, config),
    pickup: buildPickupList(orders),
    held: buildHeldList(orders)
  };
}

/**
 * Bản danh sách gửi n8n và dùng để tính dấu thay đổi: bỏ trường chỉ trang nhập đơn cần (nút, trạng thái không hiện
 * trong email), để đổi trạng thái không làm đổi nội dung email thì không gửi lại email giống hệt.
 * Chuẩn bị giữ trạng thái từng đơn vì email ghi "đang làm" cạnh mã đơn.
 */
function opsListsForEmail(lists) {
  var prepOrder = function (entry) { return { order_code: entry.order_code, status: entry.status }; };
  var withoutUi = function (entry) {
    var copy = {};
    Object.keys(entry).forEach(function (key) {
      if (key !== 'actions' && key !== 'status' && key !== 'delivery_method') copy[key] = entry[key];
    });
    return copy;
  };
  return {
    prep: {
      total_cups: lists.prep.total_cups,
      lines: lists.prep.lines.map(function (line) {
        var copy = withoutUi(line);
        copy.orders = (line.orders || []).map(prepOrder);
        return copy;
      }),
      unparsed: lists.prep.unparsed.map(function (entry) {
        var copy = withoutUi(entry);
        copy.status = entry.status;
        return copy;
      })
    },
    delivery: {
      stops: lists.delivery.stops,
      amount_due_total: lists.delivery.amount_due_total,
      zones: lists.delivery.zones.map(function (zone) {
        var copy = withoutUi(zone);
        copy.orders = zone.orders.map(withoutUi);
        return copy;
      })
    },
    pickup: { amount_due_total: lists.pickup.amount_due_total, orders: lists.pickup.orders.map(withoutUi) },
    held: lists.held.map(withoutUi)
  };
}

function isOpsListsEmpty(lists) {
  return lists.prep.total_cups === 0 && lists.prep.unparsed.length === 0 &&
    lists.delivery.stops === 0 && lists.pickup.orders.length === 0 && lists.held.length === 0;
}

function formatMoney(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

/** Tên món kèm topping, cách nhau bằng dấu chấm giữa: Trà sữa · Trân châu đen. */
function prepLineName(line) {
  return [line.product_name].concat(line.toppings).join(' · ');
}

function handoverLines_(entry, unit) {
  var lines = [
    entry.order_code + ' · ' + entry.cups + ' ' + unit + ' · Thu: ' + formatMoney(entry.amount_due),
    '  ' + entry.name + ' · ' + entry.phone
  ];
  if (entry.address) lines.push('  ' + entry.address);
  lines.push('  ' + entry.items_text);
  if (entry.note) lines.push('  Ghi chú: ' + entry.note);
  return lines.join('\n');
}

/** Tiêu đề nói số việc: cần chuẩn bị bao nhiêu, giao mấy điểm; thêm tự lấy và đang chờ khi có. */
function opsListsSubject(lists, unit) {
  unit = unit || DEFAULT_UNIT_LABEL;
  var parts = ['📋 Cần chuẩn bị ' + lists.prep.total_cups + ' ' + unit, 'giao ' + lists.delivery.stops + ' điểm'];
  if (lists.pickup.orders.length) parts.push(lists.pickup.orders.length + ' đơn tự lấy');
  if (lists.held.length) parts.push(lists.held.length + ' đơn đang chờ');
  return parts.join(' · ');
}

/**
 * Email văn bản thuần, mở thẳng vào mục CHUẨN BỊ. Việc cần làm ghi trên dòng của từng đơn.
 * Thời điểm tạo chỉ để đọc, không tính vào dấu so sánh thay đổi.
 */
function formatOpsListsText(lists, generatedAt, unit) {
  unit = unit || DEFAULT_UNIT_LABEL;
  var out = ['CHUẨN BỊ · ' + lists.prep.total_cups + ' ' + unit];
  lists.prep.lines.forEach(function (line) {
    var codes = (line.orders || []).map(function (entry) {
      return entry.order_code + (entry.status === 'dang_lam' ? ' đang làm' : '');
    });
    out.push('- ' + line.cups + ' ' + unit + ': ' + prepLineName(line) + ' (' + codes.join(', ') + ')');
    line.notes.forEach(function (entry) {
      out.push('    ' + entry.order_code + ': ' + entry.note);
    });
  });
  lists.prep.unparsed.forEach(function (entry) {
    out.push('- XEM TAY ' + entry.order_code + (entry.status === 'dang_lam' ? ' đang làm' : '') + ', ' +
      entry.cups + ' ' + unit + ': ' + entry.items_text);
    if (entry.note) out.push('    ' + entry.order_code + ': ' + entry.note);
  });
  if (lists.prep.total_cups === 0 && lists.prep.unparsed.length === 0) out.push('Chưa có đơn cần chuẩn bị.');

  out.push('', 'GIAO · ' + lists.delivery.stops + ' điểm · thu ' + formatMoney(lists.delivery.amount_due_total));
  if (!lists.delivery.zones.length) out.push('Chưa có đơn cần giao.');
  lists.delivery.zones.forEach(function (zone) {
    out.push('', '== ' + zone.label + ' · ' + zone.stops + ' điểm ==');
    zone.map_links.forEach(function (link, index) {
      var name = zone.map_links.length > 1 ? 'Mở bản đồ ' + (index + 1) : 'Mở bản đồ';
      out.push(name + ' (' + link.order_codes.join(', ') + '): ' + link.url);
    });
    zone.orders.forEach(function (entry) { out.push('', handoverLines_(entry, unit)); });
    out.push('', 'Tổng thu nhóm này: ' + formatMoney(zone.amount_due_total));
  });

  if (lists.pickup.orders.length) {
    out.push('', 'TỰ LẤY · ' + lists.pickup.orders.length + ' đơn · thu ' + formatMoney(lists.pickup.amount_due_total));
    lists.pickup.orders.forEach(function (entry) { out.push('', handoverLines_(entry, unit)); });
  }

  if (lists.held.length) {
    out.push('', 'ĐANG CHỜ · ' + lists.held.length + ' đơn');
    lists.held.forEach(function (entry) {
      out.push('- ' + entry.order_code + ' · ' + entry.phone + ' · ' + formatMoney(entry.amount) + ' · ' + entry.reason);
    });
  }

  out.push('', 'Cập nhật lúc ' + generatedAt);
  return out.join('\n');
}

/* ---------- Báo cáo ---------- */

/** Doanh thu đã thu: đơn COD đã xong, cộng đơn đã nhận tiền chưa huỷ (kể cả bom vì tiền đã vào). */
function isCollected_(order) {
  var payment = fieldCode_(order, 'payment_status');
  if (payment === 'da_nhan') return !isCancelled_(order);
  return payment === 'cod' && fieldCode_(order, 'status') === 'xong';
}

function reportBucket_(orders) {
  var byStatus = {};
  STATUS_VALUES.forEach(function (status) { byStatus[status] = { orders: 0, cups: 0 }; });
  var revenue = 0;
  orders.forEach(function (order) {
    var status = fieldCode_(order, 'status');
    if (STATUS_VALUES.indexOf(status) === -1) status = 'khac';
    if (!byStatus[status]) byStatus[status] = { orders: 0, cups: 0 };
    byStatus[status].orders += 1;
    byStatus[status].cups += orderCups_(order);
    if (isCollected_(order)) revenue += parseWholeNumber(order.total) || 0;
  });
  var bom = byStatus.bom.cups;
  var denominator = bom + byStatus.xong.cups;
  return {
    cups: countCups(orders),
    by_status: byStatus,
    // Đếm theo phần như mọi số liệu khác. Chưa có đơn xong hay bom thì 0%.
    bom_rate_percent: denominator === 0 ? 0 : Math.round((bom / denominator) * 1000) / 10,
    revenue: revenue
  };
}

/** dayOf(order) trả về ngày 'yyyy-MM-dd' theo giờ Việt Nam của created_at. */
function buildReport(orders, config, today, dayOf) {
  return {
    date: today,
    today: reportBucket_(orders.filter(function (order) { return dayOf(order) === today; })),
    cumulative: reportBucket_(orders),
    max_cups: config.max_cups,
    remaining_cups: Math.max(0, config.max_cups - countCups(orders)),
    unit_label: config.unit_label || DEFAULT_UNIT_LABEL
  };
}

var STATUS_LABELS = {
  moi: 'Mới', dang_lam: 'Đang làm', dang_giao: 'Đang giao', xong: 'Xong', huy: 'Huỷ', bom: 'Bom', khac: 'Khác'
};

function reportSubject(report) {
  var unit = report.unit_label || DEFAULT_UNIT_LABEL;
  return '📊 Hôm nay: ' + report.today.cups + ' ' + unit + ' · ' + formatMoney(report.today.revenue);
}

/** Một dòng mỗi trạng thái có đơn, kèm tỷ lệ bom. Số phần không tính đơn huỷ. */
function reportBucketLines_(bucket, unit) {
  var lines = [];
  Object.keys(bucket.by_status).forEach(function (status) {
    var entry = bucket.by_status[status];
    if (!entry.orders) return;
    lines.push('  ' + (STATUS_LABELS[status] || status) + ': ' + entry.orders + ' đơn · ' + entry.cups + ' ' + unit);
  });
  if (!lines.length) return ['  Chưa có đơn.'];
  lines.push('  Tỷ lệ bom: ' + bucket.bom_rate_percent + '%');
  return lines;
}

function formatReportText(report) {
  var unit = report.unit_label || DEFAULT_UNIT_LABEL;
  return [
    'Hôm nay bán ' + report.today.cups + ' ' + unit + ', thu ' + formatMoney(report.today.revenue) +
      ', còn ' + report.remaining_cups + '/' + report.max_cups + ' ' + unit + '.',
    '',
    'HÔM NAY (đơn tạo ngày ' + report.date + ')'
  ]
    .concat(reportBucketLines_(report.today, unit))
    .concat(['', 'CẢ ĐỢT · ' + report.cumulative.cups + ' ' + unit + ' · ' + formatMoney(report.cumulative.revenue)])
    .concat(reportBucketLines_(report.cumulative, unit))
    .join('\n');
}

/* ---------- QR chuyển khoản ---------- */

/** Chỉ bật khi đủ ba giá trị. Mã ngân hàng và số tài khoản nằm trong đường dẫn nên chỉ nhận chữ và số. */
function parseTransferConfig_(raw) {
  var read = function (key) {
    return raw[key] === undefined || raw[key] === null ? '' : cleanText(raw[key]);
  };
  var bankCode = read('bank_code');
  var bankAccount = read('bank_account').replace(/[\s.\-]/g, '');
  var accountName = read('bank_account_name');
  return {
    enabled: /^[A-Za-z0-9]+$/.test(bankCode) && /^[A-Za-z0-9]+$/.test(bankAccount) && accountName !== '',
    bank_code: bankCode,
    bank_account: bankAccount,
    bank_account_name: accountName
  };
}

/** Link ảnh VietQR có số tiền và nội dung là mã đơn. Thiếu cấu hình thì trả null. */
function buildTransfer(transferConfig, orderCode, amount) {
  if (!transferConfig || !transferConfig.enabled) return null;
  var content = String(orderCode);
  return {
    qr_url: 'https://img.vietqr.io/image/' +
      encodeUrlPart_(transferConfig.bank_code) + '-' + encodeUrlPart_(transferConfig.bank_account) + '-compact2.png' +
      '?amount=' + encodeUrlPart_(amount) +
      '&addInfo=' + encodeUrlPart_(content) +
      '&accountName=' + encodeUrlPart_(transferConfig.bank_account_name),
    amount: amount,
    content: content,
    bank_code: transferConfig.bank_code,
    bank_account: transferConfig.bank_account,
    bank_account_name: transferConfig.bank_account_name
  };
}

/** Dựng lại transfer từ link đã cấp, để gửi lại trả đúng tài khoản cũ dù Config đã đổi. Link lạ thì trả null. */
function transferFromQrUrl(url, orderCode, amount) {
  var match = /\/image\/([A-Za-z0-9]+)-([A-Za-z0-9]+)-[^\/?]+\?(?:.*&)?accountName=([^&]*)/.exec(url);
  if (!match) return null;
  return {
    qr_url: url,
    amount: amount,
    content: String(orderCode),
    bank_code: match[1],
    bank_account: match[2],
    bank_account_name: decodeURIComponent(match[3])
  };
}

/* ---------- Form dự phòng ---------- */

/** Tiêu đề câu hỏi trong Google Form; câu trả lời được đọc lại theo đúng các tiêu đề này. */
var BACKUP_FIELDS = {
  name: 'Tên',
  phone: 'Số điện thoại',
  product: 'Món',
  quantity: 'Số lượng',
  toppings: 'Topping',
  delivery: 'Nhận hàng',
  zone: 'Khu vực giao',
  address: 'Địa chỉ giao',
  note: 'Ghi chú'
};
/** Tiêu đề câu hỏi cũ: setupBackupForm đổi tại chỗ, câu trả lời gửi trước khi đổi vẫn đọc được. */
var BACKUP_OLD_FIELDS = { quantity: 'Số cốc' };

/** Câu trả lời theo tiêu đề mới, hoặc tiêu đề cũ nếu Form chưa được cập nhật. */
function backupAnswer_(answers, field) {
  var value = answers[BACKUP_FIELDS[field]];
  if ((value === undefined || value === null) && BACKUP_OLD_FIELDS[field]) value = answers[BACKUP_OLD_FIELDS[field]];
  return value;
}

/** Tên và SĐT khách lấy từ nội dung đã lưu trong tab Đơn lỗi, để email nói rõ đơn của ai. */
function backupErrorWho(answersText) {
  var read = function (title) {
    var parts = String(answersText === undefined || answersText === null ? '' : answersText).split(' | ');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(title + ': ') === 0) return parts[i].slice(title.length + 2);
    }
    return '';
  };
  return { name: read(BACKUP_FIELDS.name), phone: read(BACKUP_FIELDS.phone) };
}
var BACKUP_DELIVERY_LABELS = { giao: 'Giao hàng', tu_lay: 'Tự đến lấy' };

function keyByLabel_(labels, label) {
  var keys = Object.keys(labels);
  for (var i = 0; i < keys.length; i++) {
    if (labels[keys[i]] === label) return keys[i];
  }
  return '';
}

function idByName_(list, idField, name) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) return list[i][idField];
  }
  return '';
}

/**
 * Đổi câu trả lời Form thành đơn theo hợp đồng chung, luôn là một món và COD.
 * Tên không khớp thực đơn thì giữ nguyên để validateOrder từ chối, không âm thầm bỏ topping hay đổi tiền.
 */
function backupPayload(answers, responseId, catalog) {
  var text = function (field) {
    var value = backupAnswer_(answers, field);
    return typeof value === 'string' ? value : '';
  };
  var quantityText = text('quantity').trim();
  var toppingValue = backupAnswer_(answers, 'toppings');
  var toppingNames = Array.isArray(toppingValue) ? toppingValue : [];
  return {
    submission_id: 'form-' + responseId,
    source: 'backup',
    name: text('name'),
    phone: text('phone'),
    contact: '',
    items: [{
      product_id: idByName_(catalog.products, 'product_id', text('product')),
      quantity: /^\d+$/.test(quantityText) ? Number(quantityText) : NaN,
      toppings: toppingNames.map(function (name) {
        return idByName_(catalog.toppings, 'topping_id', name) || name;
      })
    }],
    delivery_method: keyByLabel_(BACKUP_DELIVERY_LABELS, text('delivery')),
    zone: keyByLabel_(ZONE_LABELS, text('zone')),
    address: text('address'),
    payment_method: 'cod',
    note: text('note')
  };
}

/** Giữ đủ những gì khách đã gửi, để nhóm gọi lại và nhập tay. */
function backupAnswersText(answers) {
  return Object.keys(BACKUP_FIELDS)
    .map(function (field) {
      var title = BACKUP_FIELDS[field];
      var value = backupAnswer_(answers, field);
      var shown = Array.isArray(value) ? value.join(', ') : value === undefined || value === null ? '' : String(value);
      return shown === '' ? '' : title + ': ' + cleanText(shown);
    })
    .filter(function (part) { return part !== ''; })
    .join(' | ');
}

/** Khoá chưa đặt phía server thì luôn từ chối, kể cả khi gửi khoá rỗng. */
function keysMatch(expected, provided) {
  if (typeof expected !== 'string' || expected === '' || typeof provided !== 'string') return false;
  if (expected.length !== provided.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/** JSON an toàn khi in vào thẻ script: không thoát được ra khỏi thẻ. */
function jsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
