/**
 * Code.gs: nối Logic.gs với Sheets, Lock, Script Properties và Google Form dự phòng.
 *
 * Quyền truy cập khai báo ở appsscript.json: Sheets chỉ trong file hiện tại, cộng quyền tạo Form và trigger.
 * Hàm kết thúc bằng dấu _ là hàm riêng, trang web không gọi được qua google.script.run.
 * Cột được tra theo tên ở dòng tiêu đề, nên đợt sau thêm cột không ảnh hưởng dữ liệu cũ.
 * Dòng tiêu đề hiện tiếng Việt, còn code luôn dùng khoá nội bộ; headerKeys_ là chỗ duy nhất đổi qua lại.
 */

var HEADER_BACKGROUND = '#FFD54F';
var HEADER_TEXT_COLOR = '#3E2723';

var SHEET_ORDERS = 'Đơn hàng';
var SHEET_CONFIG = 'Cấu hình';
var SHEET_PRODUCTS = 'Món';
var SHEET_TOPPINGS = 'Topping';
var SHEET_BACKUP_ERRORS = 'Đơn lỗi';
/** Tên tab cũ vẫn tìm được, để bản code mới chạy trên Sheet chưa chạy lại setup. */
var SHEET_OLD_NAMES = {
  'Đơn hàng': 'Orders',
  'Cấu hình': 'Config',
  'Món': 'Products',
  'Topping': 'Toppings',
  'Đơn lỗi': 'Backup_Loi'
};

var TIME_ZONE = 'Asia/Ho_Chi_Minh';
var DATE_TIME_FORMAT_CELL = 'yyyy-mm-dd hh:mm:ss';
var DATE_TIME_FORMAT_TEXT = 'yyyy-MM-dd HH:mm:ss';
var LOCK_WAIT_MS = 20000;
var PENDING_BATCH_SIZE = 50;

var PROP_N8N_KEY = 'N8N_KEY';
var PROP_STAFF_KEY = 'STAFF_KEY';
var PROP_LAST_ORDER_NUMBER = 'LAST_ORDER_NUMBER';
var PROP_LOW_STOCK_ALERTED_AT = 'LOW_STOCK_ALERTED_AT';
var PROP_OPS_LISTS_SIGNATURE = 'OPS_LISTS_SIGNATURE';
var PROP_BACKUP_FORM_ID = 'BACKUP_FORM_ID';
/** Bản Cấu hình hợp lệ gần nhất của các ô số bắt buộc, dùng khi tab Cấu hình có ô sai. */
var PROP_CONFIG_LAST_GOOD = 'CONFIG_LAST_GOOD';
/** Dấu của lỗi Cấu hình đã email, để mỗi lỗi mới chỉ báo một lần. Xoá khi Cấu hình hết lỗi. */
var PROP_CONFIG_ALERTED = 'CONFIG_ALERTED';
/** Mật khẩu quản lý cho mục Cài đặt trên trang nhập đơn. Nhóm tự đặt; chưa đặt thì luôn từ chối. */
var PROP_MANAGER_PASSWORD = 'MANAGER_PASSWORD';
/** Số lần nhập sai liên tiếp, và thời điểm (mili giây) hết khoá tạm. Script tự quản lý. */
var PROP_MANAGER_FAILS = 'MANAGER_FAILS';
var PROP_MANAGER_LOCKED_UNTIL = 'MANAGER_LOCKED_UNTIL';
var MANAGER_MAX_FAILS = 5;
var MANAGER_LOCK_MS = 10 * 60 * 1000;
/** Ô số sửa được ở mục Cài đặt. Giá, tài khoản ngân hàng, địa chỉ quán, đơn vị vẫn chỉ sửa trong Sheet. */
var MANAGER_NUMBER_KEYS = [
  'max_cups', 'low_stock_alert_cups', 'max_cups_per_phone_public', 'call_threshold_cups',
  'shipping_fee_tu_lay', 'shipping_fee_trong_2km', 'shipping_fee_den_10km'
];

var BACKUP_TRIGGER_HANDLER = 'onBackupFormSubmit';
var BACKUP_FORM_TITLE = 'Đặt trà sữa (kênh dự phòng)';

/** Cột thêm sau đợt 1. Sheet chưa chạy lại setup vẫn nhận đơn được, chỉ chưa lưu link QR hay lý do gọi. */
var ORDER_COLUMN_QR_URL = 'transfer_qr_url';
var ORDER_COLUMN_CALL_REASON = 'call_reason';
var ORDER_COLUMN_CANCEL_REASON = 'cancel_reason';
var ORDER_OPTIONAL_COLUMNS = [ORDER_COLUMN_QR_URL, ORDER_COLUMN_CALL_REASON, ORDER_COLUMN_CANCEL_REASON];
var ORDER_HEADERS = [
  'order_code', 'created_at', 'status', 'payment_status', 'needs_call', 'call_done', ORDER_COLUMN_CALL_REASON,
  'name', 'phone', 'contact', 'items_text', 'cups',
  'delivery_method', 'zone', 'address', 'payment_method',
  'shipping_fee', 'total', 'note', ORDER_COLUMN_CANCEL_REASON, 'source', 'notified_at', 'submission_id', 'items',
  ORDER_COLUMN_QR_URL
];
var ORDER_HIDDEN_COLUMNS = ['notified_at', 'submission_id', 'items', ORDER_COLUMN_QR_URL];
var ORDER_WARNING_COLUMNS = ['cups', 'total', 'notified_at', 'submission_id', 'items', ORDER_COLUMN_QR_URL];
var PROTECTION_PREFIX = 'store-ops: ';
var MONEY_FORMAT_CELL = '#,##0';
var ORDER_WRAP_COLUMNS = ['items_text', 'address', 'note', 'cancel_reason'];
/** Đủ chỗ cho nhãn và mũi tên bộ lọc; cột văn bản dài giữ rộng để dễ đọc. */
var ORDER_COLUMN_WIDTHS = {
  order_code: 80, created_at: 150, status: 120, payment_status: 135, needs_call: 95, call_done: 85, call_reason: 200, cancel_reason: 160,
  name: 130, phone: 105, contact: 130, items_text: 240, cups: 105,
  delivery_method: 75, zone: 95, address: 240, payment_method: 100,
  shipping_fee: 70, total: 85, note: 180, source: 85
};
var ORDER_HEADER_NOTES = {
  status: 'Trạng thái: moi, dang_lam, dang_giao, xong, huy, bom',
  payment_status: 'Thanh toán: cod, cho_chuyen_khoan, da_nhan',
  needs_call: 'Đơn cần gọi trước khi làm',
  call_done: 'Tích sau khi đã gọi',
  call_reason: 'Vì sao đơn cần gọi, hệ thống tự ghi lúc tạo đơn',
  cancel_reason: 'Vì sao đơn bị huỷ, ghi khi huỷ trên trang nhập đơn',
  cups: 'Số phần của đơn. Không sửa tay',
  delivery_method: 'Nhận: giao, tu_lay',
  zone: 'Khu vực: trong_2km, den_10km',
  payment_method: 'Trả bằng: cod, chuyen_khoan',
  total: 'Không sửa tay'
};
/** Ghi chú cũ chỉ lặp lại tên cột, nên xoá khi chạy lại setup. */
var ORDER_DROPPED_NOTES = ['order_code', 'created_at', 'items_text', 'source'];
var CATALOG_STATUS_NOTE = 'Trạng thái: active là đang bán, inactive là ngừng bán';

/** Nhãn tiếng Việt ở dòng 1 theo từng tab, vì cùng một khoá có thể có nhãn khác nhau giữa các tab. */
var HEADER_LABELS = {
  'Đơn hàng': {
    order_code: 'Mã', created_at: 'Giờ đặt', status: 'Trạng thái', payment_status: 'Thanh toán',
    needs_call: 'Cần gọi', call_done: 'Đã gọi', call_reason: 'Lý do gọi', cancel_reason: 'Lý do huỷ',
    name: 'Tên', phone: 'SĐT', contact: 'Liên hệ',
    items_text: 'Món', cups: 'Số lượng', delivery_method: 'Nhận', zone: 'Khu vực', address: 'Địa chỉ',
    payment_method: 'Trả bằng', shipping_fee: 'Ship', total: 'Tổng', note: 'Ghi chú', source: 'Kênh',
    notified_at: 'Đã báo', submission_id: 'Mã gửi', items: 'Chi tiết', transfer_qr_url: 'QR'
  },
  'Cấu hình': { ghi_chu: 'Ý nghĩa', value: 'Giá trị', key: 'Khoá' },
  'Món': { product_id: 'Mã', name: 'Tên', price: 'Giá', status: 'Trạng thái' },
  'Topping': { topping_id: 'Mã', name: 'Tên', price: 'Giá', status: 'Trạng thái' },
  'Đơn lỗi': {
    response_id: 'Mã', created_at: 'Giờ', error_code: 'Lỗi', message: 'Lý do',
    answers: 'Nội dung', notified_at: 'Đã báo'
  }
};
/** Nhãn từng dùng trước đây, vẫn đọc được để setup đổi tại chỗ thay vì thêm cột mới. Một khoá có thể có nhiều nhãn cũ. */
var HEADER_OLD_LABELS = {
  'Đơn hàng': {
    order_code: 'Mã đơn', created_at: 'Lúc đặt', name: 'Tên khách', cups: ['Số cốc', 'Cốc'], delivery_method: 'Cách nhận',
    payment_method: 'Cách trả', shipping_fee: 'Phí ship', total: 'Tổng tiền', notified_at: 'Đã báo lúc',
    submission_id: 'Mã lần đặt', items: 'Chi tiết hệ thống', transfer_qr_url: 'Link QR'
  },
  'Cấu hình': { ghi_chu: 'Ghi chú' },
  'Món': { product_id: 'Mã món', name: 'Tên món' },
  'Topping': { topping_id: 'Mã topping', name: 'Tên topping' },
  'Đơn lỗi': {
    response_id: 'Mã phản hồi', created_at: 'Lúc gửi', error_code: 'Mã lỗi', answers: 'Nội dung đã gửi',
    notified_at: 'Đã báo lúc'
  }
};
var CONFIG_COLUMN_WIDTHS = { ghi_chu: 480, value: 220, key: 220 };
var PRODUCT_COLUMN_WIDTHS = { product_id: 190, name: 260, price: 100, status: 100 };
var TOPPING_COLUMN_WIDTHS = { topping_id: 170, name: 240, price: 100, status: 100 };
var BACKUP_COLUMN_WIDTHS = { response_id: 180, created_at: 150, error_code: 130, message: 300, answers: 460, notified_at: 150 };
var PAYMENT_STATUS_VALUES = ['cod', 'cho_chuyen_khoan', 'da_nhan'];
var BACKUP_ERROR_HEADERS = ['response_id', 'created_at', 'error_code', 'message', 'answers', 'notified_at'];

var CATALOG_STATUS_VALUES = ['active', 'inactive'];
var PRODUCT_HEADERS = ['product_id', 'name', 'price', 'status'];
var TOPPING_HEADERS = ['topping_id', 'name', 'price', 'status'];
var CONFIG_HEADERS = ['ghi_chu', 'value', 'key'];

/** Mỗi dòng: khoá, giá trị, ý nghĩa. Ý nghĩa là thứ nhân viên đọc, vì cột khoá bị ẩn. */
var SEED_CONFIG = [
  // Giá trị viết thẳng, không dùng hằng của Logic.gs: Apps Script có thể nạp Code.gs trước.
  ['orders_open', 'Mở cửa', 'Nhận đơn: Mở cửa hoặc Đóng cửa. Chọn Đóng cửa để tạm dừng mọi kênh đặt hàng'],
  ['unit_label', 'phần','Đơn vị đếm hiện trên trang nhập đơn, email và danh sách, ví dụ phần, hộp, suất; để trống thì dùng "phần"'],
  ['max_cups', 600, 'Tổng số phần tối đa nhận trong đợt bán, theo lượng nguyên liệu đã có; ít nhất là 1'],
  ['low_stock_alert_cups', 550, 'Nhận đủ số phần này thì gửi một email báo sắp hết suất; ghi 0 nếu không cần báo'],
  ['call_threshold_cups', 5, 'Đơn trả tiền mặt từ số phần này trở lên phải gọi xác nhận trước khi làm; ít nhất là 1'],
  ['max_cups_per_phone_public', 10, 'Số phần tối đa một số điện thoại được tự đặt trên trang bán hàng và form dự phòng; ít nhất là 1'],
  ['shipping_fee_tu_lay', 0, 'Phí khi khách tự đến lấy, tính bằng đồng, gõ số liền như 10000'],
  ['shipping_fee_trong_2km', 0, 'Phí giao hàng trong 2km, tính bằng đồng, gõ số liền như 10000'],
  ['shipping_fee_den_10km', 10000, 'Phí giao hàng từ 2km đến 10km, tính bằng đồng, gõ số liền như 10000'],
  ['shop_address', '', 'Địa chỉ quán, là điểm xuất phát khi mở bản đồ giao hàng; để trống thì bản đồ lấy vị trí của người giao'],
  ['maps_max_stops', 4, 'Số điểm giao tối đa trong một link bản đồ, nhiều hơn thì tự tách link; để 4 là chắc chắn mở được trên điện thoại, không ghi quá 10'],
  ['bank_code', '', 'Ngân hàng nhận tiền, ghi mã viết tắt như vcb hoặc mã số như 970436; để trống thì khách không chọn được chuyển khoản trên trang bán hàng'],
  ['bank_account', '', 'Số tài khoản nhận tiền, ghi đủ các số kể cả số 0 ở đầu'],
  ['bank_account_name', '', 'Tên chủ tài khoản nhận tiền, ghi đúng như trên app ngân hàng']
];
/**
 * Câu ý nghĩa mặc định của bản trước. setup chỉ thay câu còn đúng nguyên văn này;
 * câu nhóm đã tự sửa được giữ.
 */
var OLD_CONFIG_MEANINGS = {
  orders_open: 'Có đang nhận đơn không: TRUE là đang nhận, FALSE là tạm đóng mọi kênh đặt hàng',
  max_cups: 'Tổng số cốc tối đa nhận trong đợt bán, theo lượng nguyên liệu đã có',
  low_stock_alert_cups: 'Nhận đủ số cốc này thì gửi một email báo sắp hết suất; ghi 0 nếu không cần báo',
  call_threshold_cups: 'Đơn trả tiền mặt từ số cốc này trở lên phải gọi xác nhận trước khi làm',
  max_cups_per_phone_public: 'Số cốc tối đa một số điện thoại được tự đặt trên trang bán hàng và form dự phòng'
};
/** Ô số trong Cấu hình: Google chặn chữ và số dưới mức tối thiểu ngay khi gõ. */
var CONFIG_NUMBER_MINIMUMS = {
  max_cups: 1, low_stock_alert_cups: 0, call_threshold_cups: 1, max_cups_per_phone_public: 1,
  shipping_fee_tu_lay: 0, shipping_fee_trong_2km: 0, shipping_fee_den_10km: 0, maps_max_stops: 0
};
var CONFIG_OPEN_COLOR = '#E3F4E1';
var CONFIG_CLOSED_COLOR = '#FDE4E1';
/** Ô dạng chữ, để Sheets không bỏ số 0 đầu của số tài khoản. */
var CONFIG_TEXT_KEYS = ['bank_code', 'bank_account', 'bank_account_name'];
var SEED_PRODUCTS = [
  ['tra-sua-truyen-thong', 'Trà sữa truyền thống (mẫu)', 49000, 'active'],
  ['tra-sua-matcha', 'Trà sữa matcha (mẫu)', 49000, 'active']
];
var SEED_TOPPINGS = [
  ['tran-chau-den', 'Trân châu đen (mẫu)', 0, 'active'],
  ['thach-pho-mai', 'Thạch phô mai (mẫu)', 5000, 'active']
];

/* ---------- Cổng vào web app ---------- */

/** GET: mặc định trả cấu hình công khai; ?action=pending, ops_lists, report cho n8n; ?page=staff cho form nội bộ. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    if (params.page === 'staff') return staffPage_(params.key);
    if (params.action === 'pending') return jsonOutput_(pendingOrders_(params.key));
    if (params.action === 'ops_lists') {
      if (!keysMatch(scriptProperty_(PROP_N8N_KEY), params.key)) return jsonOutput_(unauthorized_());
      return jsonOutput_(opsListsForN8n_());
    }
    if (params.action === 'report') {
      if (!keysMatch(scriptProperty_(PROP_N8N_KEY), params.key)) return jsonOutput_(unauthorized_());
      return jsonOutput_(dailyReport_());
    }
    if (params.action) return jsonOutput_(invalidInput('Yêu cầu không hợp lệ.'));
    return jsonOutput_(publicConfig_());
  } catch (err) {
    return jsonOutput_(serverError_(err));
  }
}

/** POST: mặc định tạo đơn từ landing; ?action=ack, ops_lists_ack cho n8n. Thân là JSON, gửi dạng text/plain. */
function doPost(e) {
  var params = (e && e.parameter) || {};
  try {
    if (params.action === 'ack') {
      if (!keysMatch(scriptProperty_(PROP_N8N_KEY), params.key)) return jsonOutput_(unauthorized_());
      var ackBody = parseBody_(e);
      return jsonOutput_(ackBody.error ? ackBody.error : ackOrders_(ackBody.value));
    }
    if (params.action === 'ops_lists_ack') {
      if (!keysMatch(scriptProperty_(PROP_N8N_KEY), params.key)) return jsonOutput_(unauthorized_());
      var listsBody = parseBody_(e);
      return jsonOutput_(listsBody.error ? listsBody.error : ackOpsLists_(listsBody.value));
    }
    if (params.action) return jsonOutput_(invalidInput('Yêu cầu không hợp lệ.'));

    var body = parseBody_(e);
    return jsonOutput_(body.error ? body.error : createOrder_(body.value, 'landing'));
  } catch (err) {
    return jsonOutput_(serverError_(err));
  }
}

/** Form nội bộ gọi qua google.script.run. Hàm này phải tự kiểm tra khoá. */
function staffSubmit(payload, key) {
  try {
    if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) return unauthorized_();
    return createOrder_(payload, 'staff');
  } catch (err) {
    return serverError_(err);
  }
}

/**
 * Tab Danh sách và nút Làm mới ở trang nhập đơn. Chỉ đọc: không đổi dấu đã gửi của email.
 * Trả kèm trạng thái cho dải đầu trang, để một lần gọi cập nhật cả hai.
 */
function staffOpsLists(key) {
  try {
    if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) return unauthorized_();
    var built = currentOpsLists_();
    return {
      ok: true,
      generated_at: built.generated_at,
      prep: built.lists.prep,
      delivery: built.lists.delivery,
      pickup: built.lists.pickup,
      // Trang có STAFF_KEY thấy đủ thông tin đơn đang chờ; email và n8n vẫn dùng bản ngắn.
      held: buildHeldDetails(built.orders, formatTime_),
      status: buildStaffStatus(built.orders, built.config)
    };
  } catch (err) {
    return serverError_(err);
  }
}

/** Dải trạng thái của trang nhập đơn: mở hay đóng cửa, số phần còn lại, số đơn đang chờ. */
function staffStatus(key) {
  try {
    if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) return unauthorized_();
    var status = currentStaffStatus_();
    status.ok = true;
    return status;
  } catch (err) {
    return serverError_(err);
  }
}

function currentStaffStatus_() {
  return buildStaffStatus(readOrders_().rows, readConfig_());
}

/** Màn hình chi tiết một đơn ở trang nhập đơn: đủ thông tin, trạng thái hiện tại và các nút hợp lệ. */
function staffOrderDetail(key, orderCode) {
  try {
    if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) return unauthorized_();
    if (typeof orderCode !== 'string' || orderCode.trim() === '') return invalidInput('Mã đơn không hợp lệ.');
    var code = orderCode.trim();
    var rows = readOrders_().rows;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].order_code).trim() === code) {
        return { ok: true, generated_at: formatTime_(new Date()), order: buildOrderDetail(rows[i], formatTime_) };
      }
    }
    return invalidInput('Không tìm thấy đơn ' + code + '.');
  } catch (err) {
    return serverError_(err);
  }
}

/**
 * Nút đổi trạng thái trong tab Danh sách. request: { order_code, action, expected_status }.
 * expected_status là trạng thái trang đang thấy; Sheet đã khác thì không ghi, để hai người bấm cùng lúc
 * chỉ một thao tác được ghi. Ghi đúng cột Sheet đang dùng nên suất, danh sách và báo cáo khớp ngay.
 */
function staffOrderAction(key, request) {
  try {
    if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) return unauthorized_();
    if (request === null || typeof request !== 'object' || Array.isArray(request) ||
        typeof request.order_code !== 'string' || request.order_code.trim() === '' ||
        typeof request.action !== 'string' || typeof request.expected_status !== 'string') {
      return invalidInput('Yêu cầu đổi trạng thái không hợp lệ.');
    }
    var code = request.order_code.trim();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) return serverError_(new Error('Hết thời gian chờ lock'));
    try {
      var table = readOrders_();
      var row = null;
      for (var i = 0; i < table.rows.length; i++) {
        if (String(table.rows[i].order_code).trim() === code) { row = table.rows[i]; break; }
      }
      if (!row) return invalidInput('Không tìm thấy đơn ' + code + '.');
      var plan = planOrderAction(row, request.action, request.expected_status);
      if (plan.invalid) return invalidInput(plan.invalid);
      var cancelReason = null;
      if (request.action === 'cancel') {
        cancelReason = cancelReasonText(request.cancel_reason, request.cancel_other);
        if (cancelReason.error) return invalidInput(cancelReason.error);
      }
      if (plan.stale) return errorResponse('STALE', staleOrderMessage(code));
      Object.keys(plan.changes).forEach(function (field) {
        var column = table.headers.indexOf(field) + 1;
        if (column < 1) throw new Error('Tab ' + SHEET_ORDERS + ' thiếu cột ' + field);
        table.sheet.getRange(row._row, column).setValue(plan.changes[field]);
      });
      // Không xoá dòng: huỷ giữ mã đơn, chống trùng và lịch sử. Sheet chưa có cột Lý do huỷ vẫn huỷ được.
      var reasonColumn = table.headers.indexOf(ORDER_COLUMN_CANCEL_REASON) + 1;
      if (cancelReason && reasonColumn > 0) {
        table.sheet.getRange(row._row, reasonColumn).setValue(sanitizeForSheet(cancelReason.value));
      }
      SpreadsheetApp.flush();
      return { ok: true, order_code: code, action: request.action };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return serverError_(err);
  }
}

/* ---------- Mục Cài đặt của quản lý ---------- */

/**
 * Mở hoặc làm mới mục Cài đặt. Kiểm tra STAFF_KEY và mật khẩu quản lý mỗi lần gọi.
 * Trả giá trị hiện tại trong tab Cấu hình và tab Món; không bao giờ trả mật khẩu.
 */
function managerSettings(key, password) {
  return withManager_(key, password, function () {
    var result = { ok: true, settings: managerSettingsView_(), today: null };
    // Lỗi khi tính số liệu hôm nay không được chặn mở Cài đặt.
    try {
      result.today = managerTodayView_();
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      result.today_error = 'Chưa tính được số liệu hôm nay. Bấm Làm mới để thử lại.';
    }
    return result;
  });
}

/** Nút Làm mới của ô Hôm nay. Cần mật khẩu quản lý như mục Cài đặt. */
function managerToday(key, password) {
  return withManager_(key, password, function () {
    return { ok: true, today: managerTodayView_() };
  });
}

/** Ô Hôm nay: cùng hàm tính với báo cáo 22h, chỉ lấy phần hôm nay, không có dữ liệu khách. */
function managerTodayView_() {
  var report = dailyReport_();
  var byStatus = [];
  STATUS_VALUES.concat(['khac']).forEach(function (status) {
    var entry = report.today.by_status[status];
    if (entry && entry.orders) {
      byStatus.push({ status: status, label: STATUS_LABELS[status], orders: entry.orders, cups: entry.cups });
    }
  });
  return {
    date: report.date,
    generated_at: formatTime_(new Date()),
    cups: report.today.cups,
    revenue: report.today.revenue,
    bom_rate_percent: report.today.bom_rate_percent,
    by_status: byStatus,
    remaining_cups: report.remaining_cups,
    max_cups: report.max_cups,
    unit_label: report.unit_label
  };
}

/**
 * Lưu một ô. change là một trong:
 * { field: 'orders_open', open: true|false }
 * { field: 'max_cups' | ... (MANAGER_NUMBER_KEYS), value: '600' }
 * { field: 'product', product_id: 'tra-sua', active: true|false }
 * Sai thì không ghi, trả INVALID_INPUT kèm field để trang báo dưới ô.
 */
function managerSave(key, password, change) {
  return withManager_(key, password, function () {
    var error = applyManagerChange_(change);
    if (error) return error;
    SpreadsheetApp.flush();
    // Đã ghi xong: lỗi khi đọc lại không được làm trang tưởng là chưa lưu.
    try {
      return {
        ok: true,
        settings: managerSettingsView_(),
        status: currentStaffStatus_(),
        config: staffConfig_()
      };
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      return { ok: true, refresh_failed: true, message: 'Đã lưu, nhưng chưa tải lại được số mới. Tải lại trang để xem.' };
    }
  });
}

/**
 * Chạy fn khi khoá và mật khẩu đúng, trong lock, để đếm lần sai và ghi Sheet không chen nhau.
 * Nhập sai MANAGER_MAX_FAILS lần thì khoá MANAGER_LOCK_MS cho mọi người, kể cả khi sau đó nhập đúng.
 */
function withManager_(key, password, fn) {
  try {
    if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) return unauthorized_();
    var expected = scriptProperty_(PROP_MANAGER_PASSWORD);
    if (typeof expected !== 'string' || expected === '') {
      return errorResponse(
        'NOT_CONFIGURED',
        'Chưa đặt mật khẩu quản lý. Đặt thuộc tính MANAGER_PASSWORD trong Cài đặt dự án của Apps Script.'
      );
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) return serverError_(new Error('Hết thời gian chờ lock'));
    try {
      var props = PropertiesService.getScriptProperties();
      var now = nowMs_();
      var lockedUntil = Number(props.getProperty(PROP_MANAGER_LOCKED_UNTIL)) || 0;
      if (lockedUntil > now) return managerLocked_();
      if (lockedUntil) {
        props.deleteProperty(PROP_MANAGER_LOCKED_UNTIL);
        props.deleteProperty(PROP_MANAGER_FAILS);
      }
      if (!keysMatch(expected, password)) {
        var fails = (Number(props.getProperty(PROP_MANAGER_FAILS)) || 0) + 1;
        if (fails >= MANAGER_MAX_FAILS) {
          props.setProperty(PROP_MANAGER_LOCKED_UNTIL, String(now + MANAGER_LOCK_MS));
          props.deleteProperty(PROP_MANAGER_FAILS);
          return managerLocked_();
        }
        props.setProperty(PROP_MANAGER_FAILS, String(fails));
        var wrong = errorResponse('UNAUTHORIZED', 'Mật khẩu chưa đúng.');
        wrong.reason = 'password';
        return wrong;
      }
      if (props.getProperty(PROP_MANAGER_FAILS) !== null) props.deleteProperty(PROP_MANAGER_FAILS);
      return fn();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return serverError_(err);
  }
}

/** Menu, topping, phí ship và đơn vị cho trang nhập đơn, để tổng tiền và lựa chọn cập nhật sau khi lưu cài đặt. */
function staffConfig_() {
  var config = publicConfig_();
  return {
    products: config.products,
    toppings: config.toppings,
    shipping_fees: config.shipping_fees,
    unit_label: readConfig_().unit_label
  };
}

function managerLocked_() {
  return errorResponse('LOCKED', 'Nhập sai quá nhiều lần, thử lại sau 10 phút.');
}

/** Tách ra để test giả được thời gian. */
function nowMs_() {
  return Date.now();
}

/** Giá trị đang ghi trong Sheet, kể cả ô đang sai, để quản lý thấy và sửa đúng ô đó. */
function managerSettingsView_() {
  var raw = readConfigRaw_();
  var fields = {};
  MANAGER_NUMBER_KEYS.forEach(function (key) {
    var value = raw[key];
    fields[key] = value === undefined || value === null ? '' : String(value).trim();
  });
  var products = readTable_(SHEET_PRODUCTS).rows
    .map(function (row) {
      var id = cleanText(row.product_id === undefined ? '' : row.product_id);
      return {
        product_id: id,
        name: cleanText(row.name === undefined ? '' : row.name) || id,
        price: parseWholeNumber(row.price),
        active: cleanText(row.status === undefined ? '' : row.status).toLowerCase() === 'active'
      };
    })
    .filter(function (product) { return product.product_id !== ''; });
  return {
    orders_open: parseOpenState(raw.orders_open),
    unit_label: parseUnitLabel(raw.unit_label),
    fields: fields,
    products: products
  };
}

function managerFieldError_(field, message) {
  var error = invalidInput(message);
  error.field = field;
  return error;
}

/** Ghi một thay đổi. Trả lỗi nếu sai, hoặc null nếu đã ghi. */
function applyManagerChange_(change) {
  if (change === null || typeof change !== 'object' || Array.isArray(change)) {
    return invalidInput('Dữ liệu cài đặt không hợp lệ.');
  }
  if (change.field === 'orders_open') {
    if (typeof change.open !== 'boolean') return managerFieldError_('orders_open', 'Chọn Mở cửa hoặc Đóng cửa.');
    return writeConfigValue_('orders_open', change.open ? OPEN_LABEL : CLOSED_LABEL);
  }
  if (MANAGER_NUMBER_KEYS.indexOf(change.field) !== -1) {
    var spec = configSpec_(change.field);
    var value = typeof change.value === 'number' ? change.value : String(change.value === undefined ? '' : change.value).trim();
    var problem = configNumberProblem_(spec, value);
    if (problem) return managerFieldError_(change.field, managerNumberMessage_(spec, problem));
    return writeConfigValue_(change.field, parseWholeNumber(value));
  }
  if (change.field === 'product') {
    if (typeof change.active !== 'boolean' || typeof change.product_id !== 'string') {
      return managerFieldError_('product', 'Dữ liệu món không hợp lệ.');
    }
    return writeProductStatus_(change.product_id, change.active);
  }
  return invalidInput('Ô này không sửa được ở trang nhập đơn.');
}

function managerNumberMessage_(spec, problem) {
  if (problem === 'đang trống') return 'Nhập một số.';
  if (spec.money && problem.indexOf('999') !== -1) return 'Số từ 1 đến 999đ có thể đã gõ thiếu số 0. Gõ số liền như 10000.';
  return 'Nhập số nguyên từ ' + spec.min + ' trở lên, gõ liền như ' + (spec.money ? '10000' : '600') + '.';
}

function writeConfigValue_(key, value) {
  var table = readTable_(SHEET_CONFIG);
  var column = table.headers.indexOf('value') + 1;
  for (var i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i].key).trim() === key) {
      table.sheet.getRange(table.rows[i]._row, column).setValue(value);
      return null;
    }
  }
  return managerFieldError_(key, 'Tab ' + SHEET_CONFIG + ' chưa có dòng này. Chạy setup trong Apps Script.');
}

function writeProductStatus_(productId, active) {
  var table = readTable_(SHEET_PRODUCTS);
  var column = table.headers.indexOf('status') + 1;
  var id = cleanText(productId);
  for (var i = 0; i < table.rows.length; i++) {
    if (cleanText(table.rows[i].product_id === undefined ? '' : table.rows[i].product_id) === id && id !== '') {
      table.sheet.getRange(table.rows[i]._row, column).setValue(active ? 'active' : 'inactive');
      return null;
    }
  }
  return managerFieldError_('product', 'Không tìm thấy món này trong tab ' + SHEET_PRODUCTS + '.');
}

/* ---------- Tạo đơn ---------- */

function createOrder_(payload, channelName) {
  var channel = CHANNELS[channelName];
  var precheck = precheckOrder(payload);
  if (!precheck.ok) return precheck;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return serverError_(new Error('Hết thời gian chờ lock'));
  try {
    var table = readOrders_();

    // Gửi lại phải nhận đúng đơn cũ, kể cả khi đã hết suất hoặc đã đóng đơn.
    var existing = findBySubmissionId_(table.rows, precheck.submission_id);
    if (existing) return orderResponse_(existing, channel);

    var config = readConfig_();
    var isStaff = channel.allowManualCall;
    if (!config.orders_open) {
      return errorResponse('SOLD_OUT', isStaff ? 'Đang đóng cửa, chưa nhận đơn.' : 'Hiện đang tạm đóng nhận đơn.');
    }

    var checked = validateOrder(payload, {
      channel: channel,
      config: config,
      catalog: readCatalog_(),
      orders: table.rows
    });
    if (!checked.ok) return checked;
    var order = checked.order;

    var counted = countCups(table.rows);
    if (counted + order.cups > config.max_cups) {
      // Chỉ nhân viên thấy số phần còn lại; landing không lộ số suất.
      return errorResponse('SOLD_OUT', isStaff
        ? 'Hết suất. Còn ' + Math.max(0, config.max_cups - counted) + ' ' + config.unit_label + ' trong đợt này.'
        : 'Đã hết suất đợt này');
    }
    if (channel.limitPerPhone &&
        countPublicCupsForPhone(table.rows, order.phone) + order.cups > config.max_cups_per_phone_public) {
      return errorResponse(
        'LIMIT_EXCEEDED',
        'Số điện thoại này đã đặt quá giới hạn trên form. Vui lòng nhắn Messenger để đặt thêm.'
      );
    }

    var codes = table.rows.map(function (row) { return row.order_code; });
    var orderNumber = nextOrderNumber(codes, scriptProperty_(PROP_LAST_ORDER_NUMBER));
    order.order_code = formatOrderCode(orderNumber);
    order.submission_id = precheck.submission_id;
    var transfer = order.payment_method === 'chuyen_khoan'
      ? buildTransfer(config.transfer, order.order_code, order.total)
      : null;
    order.transfer_qr_url = transfer ? transfer.qr_url : '';
    appendOrder_(table, order);
    PropertiesService.getScriptProperties().setProperty(PROP_LAST_ORDER_NUMBER, String(orderNumber));
    return orderResponse_(order, channel);
  } catch (err) {
    return serverError_(err);
  } finally {
    lock.releaseLock();
  }
}

/** Chỉ ghi giá trị do người dùng nhập qua sanitizeForSheet. Đọc lại ngay được nhờ flush. */
function appendOrder_(table, order) {
  var values = {
    order_code: order.order_code,
    created_at: new Date(),
    status: 'moi',
    payment_status: order.payment_status,
    needs_call: order.needs_call,
    call_done: false,
    call_reason: sanitizeForSheet(order.call_reason),
    name: sanitizeForSheet(order.name),
    phone: sanitizeForSheet(order.phone),
    contact: sanitizeForSheet(order.contact),
    items_text: sanitizeForSheet(order.items_text),
    cups: order.cups,
    delivery_method: order.delivery_method,
    zone: order.zone,
    address: sanitizeForSheet(order.address),
    payment_method: order.payment_method,
    shipping_fee: order.shipping_fee,
    total: order.total,
    note: sanitizeForSheet(order.note),
    source: order.source,
    notified_at: '',
    submission_id: sanitizeForSheet(order.submission_id),
    items: sanitizeForSheet(JSON.stringify(order.items)),
    transfer_qr_url: sanitizeForSheet(order.transfer_qr_url)
  };
  var sheet = table.sheet;
  var rowNumber = appendByHeaders_(sheet, table.headers, values);

  // Ô đánh dấu đặt theo từng dòng đã có dữ liệu. Đặt sẵn cho cả cột sẽ làm getLastRow sai.
  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(rowNumber, table.headers.indexOf('needs_call') + 1).setDataValidation(checkbox);
  sheet.getRange(rowNumber, table.headers.indexOf('call_done') + 1).setDataValidation(checkbox);
  SpreadsheetApp.flush();
}

/** Ghi một dòng vào cuối tab theo tên cột, thêm lưới nếu hết dòng. Trả về số dòng vừa ghi. */
function appendByHeaders_(sheet, headers, values) {
  var row = headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '';
  });
  var rowNumber = sheet.getLastRow() + 1;
  if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  return rowNumber;
}

/**
 * QR đã cấp lúc tạo đơn được trả lại nguyên vẹn khi gửi lại, kể cả khi Config đã đổi.
 * Chỉ tính lại với dòng không có link đã lưu, như đơn tạo trước đợt 2.
 */
function transferForOrder_(order) {
  if (order.payment_method !== 'chuyen_khoan') return null;
  var code = String(order.order_code);
  var amount = parseWholeNumber(order.total);
  var saved = String(order.transfer_qr_url === undefined ? '' : order.transfer_qr_url).replace(/^'/, '');
  var issued = saved ? transferFromQrUrl(saved, code, amount) : null;
  if (issued) return issued;
  return buildTransfer(readConfig_().transfer, code, amount);
}

/** Kênh nội bộ được thấy thêm số phần và cần gọi; hợp đồng landing giữ đúng các trường đã công bố. */
function orderResponse_(order, channel) {
  var response = {
    ok: true,
    order_code: String(order.order_code),
    total: parseWholeNumber(order.total),
    shipping_fee: parseWholeNumber(order.shipping_fee),
    message: 'Đã nhận đơn'
  };
  if (channel.allowManualCall) {
    response.cups = parseWholeNumber(order.cups);
    response.needs_call = isTrue_(order.needs_call);
    response.call_reason = response.needs_call ? callReasonOf(order) : '';
  }
  var transfer = transferForOrder_(order);
  if (transfer) response.transfer = transfer;
  return response;
}

function findBySubmissionId_(rows, submissionId) {
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].submission_id === submissionId) return rows[i];
  }
  return null;
}

/* ---------- Endpoint cho n8n ---------- */

/**
 * Đơn chưa báo và chưa huỷ, cũ trước, kèm trạng thái cảnh báo sắp hết suất. Chỉ đọc: không đánh dấu đơn nào.
 * Đơn huỷ khi chưa báo bị bỏ qua mà không ghi Đã báo, nên mở lại đơn thì vẫn được báo. has_more đếm theo cùng danh sách.
 */
function pendingOrders_(key) {
  if (!keysMatch(scriptProperty_(PROP_N8N_KEY), key)) return unauthorized_();

  var table = readOrders_();
  var rows = table.rows;
  // Đơn đang huỷ mà chưa báo thì không email và không ghi gì: nếu đơn được mở lại (đổi về moi) thì vẫn được báo.
  var waiting = rows.filter(function (row) { return row.notified_at === '' && !isCancelled_(row); });
  var batch = waiting.slice(0, PENDING_BATCH_SIZE);

  var configState = readConfigState_();
  var config = configState.config;
  var alertedAt = scriptProperty_(PROP_LOW_STOCK_ALERTED_AT);
  var lowStock = lowStockState(countCups(rows), config, Boolean(alertedAt));
  if (lowStock.rearm) PropertiesService.getScriptProperties().deleteProperty(PROP_LOW_STOCK_ALERTED_AT);

  var problemSignature = configProblemsSignature(configState.problems);
  return {
    ok: true,
    unit_label: config.unit_label,
    config_alert: {
      alert: problemSignature !== '' && scriptProperty_(PROP_CONFIG_ALERTED) !== problemSignature,
      signature: problemSignature,
      messages: configState.problems.map(function (entry) { return configProblemMessage(entry, config.unit_label); })
    },
    orders: batch.map(toNotification_),
    has_more: waiting.length > batch.length,
    backup_errors: readBackupErrors_().rows
      .filter(function (row) { return row.notified_at === ''; })
      .slice(0, PENDING_BATCH_SIZE)
      .map(toBackupErrorNotification_),
    low_stock: {
      alert: lowStock.alert,
      counted_cups: lowStock.counted_cups,
      threshold_cups: lowStock.threshold_cups,
      max_cups: lowStock.max_cups,
      remaining_cups: lowStock.remaining_cups
    }
  };
}

function toNotification_(row) {
  return {
    order_code: String(row.order_code),
    created_at: formatTime_(row.created_at),
    source: row.source,
    status: row.status,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    needs_call: isTrue_(row.needs_call),
    call_reason: isTrue_(row.needs_call) ? callReasonOf(row) : '',
    name: String(row.name),
    phone: normalizePhone(row.phone) || String(row.phone),
    contact: String(row.contact),
    items_text: String(row.items_text),
    cups: parseWholeNumber(row.cups) || 0,
    delivery_method: row.delivery_method,
    zone: row.zone,
    address: String(row.address),
    shipping_fee: parseWholeNumber(row.shipping_fee) || 0,
    total: parseWholeNumber(row.total) || 0,
    note: String(row.note)
  };
}

/**
 * n8n gọi sau khi gửi email xong.
 * Body: { codes: ["TS-0001"], low_stock: true, backup_errors: ["mã phản hồi"], config_alert: "dấu lỗi Cấu hình" }.
 * Đơn đã có notified_at giữ nguyên thời điểm cũ, nên gọi lại không sao.
 */
function ackOrders_(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalidInput('Dữ liệu ack không hợp lệ.');
  }
  var codes = body.codes === undefined ? [] : body.codes;
  if (!Array.isArray(codes) || !codes.every(function (code) { return typeof code === 'string'; })) {
    return invalidInput('Danh sách mã đơn không hợp lệ.');
  }
  var backupIds = body.backup_errors;
  if (backupIds !== undefined &&
      (!Array.isArray(backupIds) || !backupIds.every(function (id) { return typeof id === 'string'; }))) {
    return invalidInput('Danh sách đơn dự phòng lỗi không hợp lệ.');
  }
  if (body.config_alert !== undefined && typeof body.config_alert !== 'string') {
    return invalidInput('Dấu cảnh báo Cấu hình không hợp lệ.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return serverError_(new Error('Hết thời gian chờ lock'));
  try {
    var table = readOrders_();
    var column = table.headers.indexOf('notified_at') + 1;
    var now = new Date();
    var acked = 0;
    table.rows.forEach(function (row) {
      if (row.notified_at !== '' || codes.indexOf(String(row.order_code)) === -1) return;
      table.sheet.getRange(row._row, column).setValue(now);
      acked++;
    });
    if (body.low_stock === true) {
      PropertiesService.getScriptProperties().setProperty(PROP_LOW_STOCK_ALERTED_AT, formatTime_(now));
    }
    // Chỉ ghi dấu nếu lỗi đó vẫn còn: ô đã được sửa trong lúc gửi thì không ghi, để lần hỏng sau vẫn được báo.
    if (body.config_alert && currentConfigProblemSignature_() === body.config_alert) {
      PropertiesService.getScriptProperties().setProperty(PROP_CONFIG_ALERTED, body.config_alert);
    }
    var result = { ok: true, acked: acked };
    if (backupIds !== undefined) result.backup_acked = markBackupErrorsNotified_(backupIds, now);
    SpreadsheetApp.flush();
    return result;
  } catch (err) {
    return serverError_(err);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Danh sách và báo cáo ---------- */

/** Tên đầy đủ gồm cả món đã ngừng bán, vì đơn cũ vẫn phải chuẩn bị. */
function catalogNames_(sheetName, idField) {
  var names = {};
  readTable_(sheetName).rows.forEach(function (row) {
    var id = cleanText(row[idField] === undefined ? '' : row[idField]);
    if (id) names[id] = cleanText(row.name === undefined ? '' : row.name) || id;
  });
  return names;
}

function currentOpsLists_() {
  var orders = readOrders_().rows;
  var config = readConfig_();
  return {
    generated_at: formatTime_(new Date()),
    orders: orders,
    config: config,
    lists: buildOpsLists(
      orders,
      { products: catalogNames_(SHEET_PRODUCTS, 'product_id'), toppings: catalogNames_(SHEET_TOPPINGS, 'topping_id') },
      config
    )
  };
}

/** Dấu của nội dung danh sách, không gồm thời điểm tạo. */
function opsListsSignature_(lists) {
  return Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(lists),
    Utilities.Charset.UTF_8
  ));
}

/** Chưa từng gửi và chưa có gì để làm thì không tính là thay đổi, để không gửi email trống. */
function opsListsForN8n_() {
  var built = currentOpsLists_();
  var lists = built.lists;
  // Nút và trạng thái chỉ dành cho trang; bỏ đi trước khi gửi n8n và tính dấu.
  var emailLists = opsListsForEmail(lists);
  var signature = opsListsSignature_(emailLists);
  var previous = scriptProperty_(PROP_OPS_LISTS_SIGNATURE);
  return {
    ok: true,
    changed: previous ? signature !== previous : !isOpsListsEmpty(lists),
    signature: signature,
    generated_at: built.generated_at,
    subject: opsListsSubject(lists, built.config.unit_label),
    text: formatOpsListsText(lists, built.generated_at, built.config.unit_label),
    prep: emailLists.prep,
    delivery: emailLists.delivery,
    pickup: emailLists.pickup,
    held: emailLists.held
  };
}

/** n8n gọi sau khi gửi email xong. Lưu đúng dấu của bản đã gửi, nên đơn đổi trong lúc gửi vẫn được báo lần sau. */
function ackOpsLists_(body) {
  if (body === null || typeof body !== 'object' || typeof body.signature !== 'string' || body.signature === '') {
    return invalidInput('Dấu danh sách không hợp lệ.');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_OPS_LISTS_SIGNATURE, body.signature);
  return { ok: true };
}

function dayOfCreatedAt_(order) {
  return formatTime_(order.created_at).slice(0, 10);
}

function dailyReport_() {
  var report = buildReport(
    readOrders_().rows,
    readConfig_(),
    formatTime_(new Date()).slice(0, 10),
    dayOfCreatedAt_
  );
  report.ok = true;
  report.subject = reportSubject(report);
  report.text = formatReportText(report);
  return report;
}

/* ---------- Form dự phòng ---------- */

/**
 * Chạy tay trong trình soạn thảo. Chạy lại được: dùng lại Form cũ, cập nhật thực đơn và không tạo trigger trùng.
 * Trả về và ghi log link để gửi cho khách.
 */
function setupBackupForm() {
  var form = openBackupForm_();
  if (!form) {
    form = FormApp.create(BACKUP_FORM_TITLE, true);
    PropertiesService.getScriptProperties().setProperty(PROP_BACKUP_FORM_ID, form.getId());
  }
  syncBackupForm_(form);
  ensureBackupTrigger_(form);
  var url = form.getPublishedUrl();
  console.log('Link Form dự phòng: ' + url);
  return url;
}

/** Lỗi mở Form có thể chỉ là tạm thời. Không tự tạo Form mới, vì trigger sẽ rời khỏi link đã gửi cho khách. */
function openBackupForm_() {
  var id = scriptProperty_(PROP_BACKUP_FORM_ID);
  if (!id) return null;
  try {
    return FormApp.openById(id);
  } catch (err) {
    throw new Error(
      'Không mở được Form dự phòng ' + id + ': ' + err + '. Link cũ và trigger được giữ nguyên. ' +
      'Chỉ xoá thuộc tính ' + PROP_BACKUP_FORM_ID + ' nếu thật sự muốn tạo Form mới với link mới.'
    );
  }
}

function backupFormDescription_(config, catalog) {
  var prices = catalog.products.map(function (p) { return p.name + ': ' + formatMoney(p.price); });
  var toppings = catalog.toppings.map(function (t) { return t.name + ': ' + (t.price ? '+' + formatMoney(t.price) : 'miễn phí'); });
  return [
    'Mỗi lần gửi đặt một món, trả tiền mặt khi nhận hàng. Muốn đặt món khác thì gửi thêm một lần.',
    'Giá: ' + prices.join('; ') + (toppings.length ? '. Topping tính mỗi ' + config.unit_label + ': ' + toppings.join('; ') : '') + '.',
    'Phí ship: ' + ZONE_LABELS.trong_2km + ' ' + formatMoney(config.shipping_fees.trong_2km) +
      ', ' + ZONE_LABELS.den_10km + ' ' + formatMoney(config.shipping_fees.den_10km) +
      ', tự lấy ' + formatMoney(config.shipping_fees.tu_lay) + '.',
    'Số điện thoại và địa chỉ chỉ dùng để giao hàng.'
  ].join('\n');
}

function syncBackupForm_(form) {
  var catalog = readCatalog_();
  var config = readConfig_();
  if (!catalog.products.length) throw new Error('Tab ' + SHEET_PRODUCTS + ' chưa có món đang bán');

  form.setTitle(BACKUP_FORM_TITLE);
  form.setDescription(backupFormDescription_(config, catalog));
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(true);
  form.setConfirmationMessage('Đã nhận thông tin. Nhóm sẽ gọi lại nếu đơn cần xác nhận hoặc không nhận được.');

  var items = {};
  form.getItems().forEach(function (item) { items[item.getTitle()] = item; });
  // Đổi tiêu đề câu hỏi cũ tại chỗ, để Form không có hai câu hỏi số lượng.
  Object.keys(BACKUP_OLD_FIELDS).forEach(function (field) {
    var old = items[BACKUP_OLD_FIELDS[field]];
    if (!old || items[BACKUP_FIELDS[field]]) return;
    old.setTitle(BACKUP_FIELDS[field]);
    items[BACKUP_FIELDS[field]] = old;
    delete items[BACKUP_OLD_FIELDS[field]];
  });
  var names = function (list) { return list.map(function (entry) { return entry.name; }); };

  if (!items[BACKUP_FIELDS.name]) form.addTextItem().setTitle(BACKUP_FIELDS.name).setRequired(true);
  if (!items[BACKUP_FIELDS.phone]) form.addTextItem().setTitle(BACKUP_FIELDS.phone).setRequired(true);

  if (items[BACKUP_FIELDS.product]) {
    items[BACKUP_FIELDS.product].asListItem().setChoiceValues(names(catalog.products));
  } else {
    form.addListItem().setTitle(BACKUP_FIELDS.product).setRequired(true).setChoiceValues(names(catalog.products));
  }

  if (!items[BACKUP_FIELDS.quantity]) {
    form.addTextItem().setTitle(BACKUP_FIELDS.quantity).setRequired(true)
      .setValidation(FormApp.createTextValidation().requireWholeNumber().build());
  }

  if (items[BACKUP_FIELDS.toppings]) {
    if (catalog.toppings.length) {
      items[BACKUP_FIELDS.toppings].asCheckboxItem().setChoiceValues(names(catalog.toppings));
    } else {
      form.deleteItem(items[BACKUP_FIELDS.toppings]);
    }
  } else if (catalog.toppings.length) {
    form.addCheckboxItem().setTitle(BACKUP_FIELDS.toppings).setChoiceValues(names(catalog.toppings));
  }

  if (!items[BACKUP_FIELDS.delivery]) {
    form.addMultipleChoiceItem().setTitle(BACKUP_FIELDS.delivery).setRequired(true)
      .setChoiceValues([BACKUP_DELIVERY_LABELS.giao, BACKUP_DELIVERY_LABELS.tu_lay]);
  }
  if (!items[BACKUP_FIELDS.zone]) {
    form.addMultipleChoiceItem().setTitle(BACKUP_FIELDS.zone).setHelpText('Bắt buộc nếu chọn Giao hàng.')
      .setChoiceValues([ZONE_LABELS.trong_2km, ZONE_LABELS.den_10km]);
  }
  if (!items[BACKUP_FIELDS.address]) {
    form.addTextItem().setTitle(BACKUP_FIELDS.address).setHelpText('Bắt buộc nếu chọn Giao hàng.');
  }
  if (!items[BACKUP_FIELDS.note]) form.addParagraphTextItem().setTitle(BACKUP_FIELDS.note);
}

function ensureBackupTrigger_(form) {
  var formId = form.getId();
  var found = false;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() !== BACKUP_TRIGGER_HANDLER) return;
    if (trigger.getTriggerSourceId() === formId && !found) {
      found = true;
    } else {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  if (!found) ScriptApp.newTrigger(BACKUP_TRIGGER_HANDLER).forForm(form).onFormSubmit().create();
}

function backupAnswers_(response) {
  var answers = {};
  response.getItemResponses().forEach(function (itemResponse) {
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });
  return answers;
}

/**
 * Trigger khi khách gửi Form. Form không từ chối khách được, nên đơn không tạo được thì ghi vào tab Đơn lỗi.
 * Tham số từ google.script.run không có hàm, nên trang web không giả được phản hồi Form.
 */
function onBackupFormSubmit(e) {
  if (!e || !e.response || typeof e.response.getId !== 'function') return;
  var responseId = e.response.getId();
  var answers = backupAnswers_(e.response);
  var result;
  try {
    result = createOrder_(backupPayload(answers, responseId, readCatalog_()), 'backup');
  } catch (err) {
    result = serverError_(err);
  }
  if (!result.ok) recordBackupError_(responseId, answers, result);
}

/** Lỗi ở đây để ném ra: phản hồi vẫn nằm trong Form và Google báo trigger lỗi cho chủ script. */
function recordBackupError_(responseId, answers, result) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('Hết thời gian chờ lock khi ghi ' + SHEET_BACKUP_ERRORS);
  try {
    var table = readTable_(SHEET_BACKUP_ERRORS);
    var seen = table.rows.some(function (row) { return String(row.response_id) === responseId; });
    if (seen) return;
    appendByHeaders_(table.sheet, table.headers, {
      response_id: sanitizeForSheet(responseId),
      created_at: new Date(),
      error_code: result.error_code,
      message: sanitizeForSheet(result.message),
      answers: sanitizeForSheet(backupAnswersText(answers)),
      notified_at: ''
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** Sheet chưa chạy lại setup thì chưa có tab này: coi như không có lỗi, không chặn báo đơn. */
function readBackupErrors_() {
  if (!findSheet_(SHEET_BACKUP_ERRORS)) return { headers: [], rows: [] };
  return readTable_(SHEET_BACKUP_ERRORS);
}

function toBackupErrorNotification_(row) {
  var who = backupErrorWho(row.answers);
  return {
    response_id: String(row.response_id),
    created_at: formatTime_(row.created_at),
    error_code: String(row.error_code),
    message: String(row.message),
    answers: String(row.answers),
    name: who.name,
    phone: who.phone
  };
}

function markBackupErrorsNotified_(ids, now) {
  var table = readBackupErrors_();
  var column = table.headers.indexOf('notified_at') + 1;
  var marked = 0;
  table.rows.forEach(function (row) {
    if (row.notified_at !== '' || ids.indexOf(String(row.response_id)) === -1) return;
    table.sheet.getRange(row._row, column).setValue(now);
    marked++;
  });
  return marked;
}

/* ---------- Trang và cấu hình công khai ---------- */

/** Cấu hình cho trang: không có số phần đã bán, không có dữ liệu khách. */
function publicConfig_() {
  var config = readConfig_();
  var catalog = readCatalog_();
  return {
    ok: true,
    orders_open: config.orders_open,
    transfer_enabled: config.transfer.enabled,
    products: catalog.products,
    toppings: catalog.toppings,
    shipping_fees: config.shipping_fees
  };
}

/** Trang báo link hết dùng được: không có dữ liệu, chỉ một câu hướng dẫn. */
var STAFF_DENIED_HTML =
  '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><style>' +
  ':root{color-scheme:light}body{margin:0;padding:48px 16px;background:#FFFBF0;color:#3E2723;' +
  'font:16px/1.5 "Be Vietnam Pro",system-ui,sans-serif;text-align:center}' +
  'p{max-width:420px;margin:0 auto;padding:16px;border-radius:14px;background:#FFFFFF;border:1px solid #F0E2C2}' +
  '</style></head><body><p>Link này không còn dùng được. Hỏi quản lý link mới.</p></body></html>';

function staffPage_(key) {
  if (!keysMatch(scriptProperty_(PROP_STAFF_KEY), key)) {
    return HtmlService.createHtmlOutput(STAFF_DENIED_HTML)
      .setTitle('Link không dùng được')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var template = HtmlService.createTemplateFromFile('Staff');
  template.configJson = jsonForHtml(publicConfig_());
  template.statusJson = jsonForHtml(currentStaffStatus_());
  template.uiJson = jsonForHtml(staffUiConfig());
  template.keyJson = jsonForHtml(key);
  return template.evaluate()
    .setTitle('Nhập đơn')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- Đọc Sheets ---------- */

function spreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Tìm theo tên mới trước, rồi tên cũ. Có cả hai thì dùng tab tên mới. */
function findSheet_(name) {
  var ss = spreadsheet_();
  return ss.getSheetByName(name) || ss.getSheetByName(SHEET_OLD_NAMES[name]);
}

/** Đổi tên cũ về tên mới, để bảng nhãn tra được cả khi tab chưa đổi tên. */
function canonicalTabName_(name) {
  var names = Object.keys(SHEET_OLD_NAMES);
  for (var i = 0; i < names.length; i++) {
    if (SHEET_OLD_NAMES[names[i]] === name) return names[i];
  }
  return name;
}

function requireSheet_(name) {
  var sheet = findSheet_(name);
  if (!sheet) throw new Error('Thiếu tab ' + name + ', hãy chạy setup()');
  return sheet;
}

function headerText_(cell) {
  return String(cell).trim().normalize('NFC');
}

/**
 * Đổi dòng tiêu đề thành khoá nội bộ, nhận cả nhãn tiếng Việt lẫn khoá tiếng Anh cũ.
 * Mỗi khoá chỉ gắn với cột đầu tiên khớp, tính từ trái sang, vì cột của nhóm nằm bên phải cột hệ thống.
 * Cột khác giữ nguyên tên; cột của nhóm trùng tên khoá trả về rỗng để code không đọc hay ghi vào đó.
 */
function headerKeys_(tabName, cells) {
  var tab = canonicalTabName_(tabName);
  var labels = HEADER_LABELS[tab] || {};
  var oldLabels = HEADER_OLD_LABELS[tab] || {};
  var texts = cells.map(headerText_);
  var keys = texts.map(function (text) {
    return Object.prototype.hasOwnProperty.call(labels, text) ? '' : text;
  });
  Object.keys(labels).forEach(function (key) {
    var old = [].concat(oldLabels[key] || []);
    for (var c = 0; c < texts.length; c++) {
      if (texts[c] === key || texts[c] === labels[key] || old.indexOf(texts[c]) !== -1) {
        keys[c] = key;
        return;
      }
    }
  });
  return keys;
}

function headerCells_(sheet) {
  var lastColumn = sheet.getLastColumn();
  return lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
}

function sheetHeaderKeys_(sheet) {
  return headerKeys_(sheet.getName(), headerCells_(sheet));
}

/** Đọc một tab thành các object theo khoá nội bộ. Dòng trống bị bỏ qua. */
function readTable_(name) {
  var sheet = requireSheet_(name);
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? headerKeys_(name, values[0]) : [];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var isBlank = values[r].every(function (cell) { return cell === '' || cell === null; });
    if (isBlank) continue;
    var row = { _row: r + 1 };
    headers.forEach(function (header, c) {
      if (header) row[header] = values[r][c];
    });
    rows.push(row);
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

function readOrders_() {
  var table = readTable_(SHEET_ORDERS);
  ORDER_HEADERS.forEach(function (header) {
    if (ORDER_OPTIONAL_COLUMNS.indexOf(header) !== -1) return;
    if (table.headers.indexOf(header) === -1) throw new Error('Tab ' + SHEET_ORDERS + ' thiếu cột ' + header + ', hãy chạy setup()');
  });
  // Dòng không có mã đơn (ghi chú, cột riêng của nhóm) không phải là đơn.
  table.rows = table.rows.filter(function (row) { return String(row.order_code).trim() !== ''; });
  table.rows.forEach(function (row) {
    row.submission_id = String(row.submission_id).replace(/^'/, '');
  });
  return table;
}

function readConfigRaw_() {
  var raw = {};
  readTable_(SHEET_CONFIG).rows.forEach(function (row) {
    raw[String(row.key).trim()] = row.value;
  });
  return raw;
}

function readConfig_() {
  return readConfigState_().config;
}

/**
 * Cấu hình an toàn. Hợp lệ: lưu làm bản gần nhất và xoá dấu cảnh báo cũ.
 * Có ô số sai: dùng giá trị hợp lệ gần nhất cho ô đó và trả danh sách lỗi để email cảnh báo.
 * Chưa từng có giá trị hợp lệ cho ô sai: ném lỗi như trước, đơn bị từ chối.
 */
function readConfigState_() {
  var raw = readConfigRaw_();
  var props = PropertiesService.getScriptProperties();
  var problems = configProblems(raw);
  if (!problems.length) {
    var good = JSON.stringify(requiredConfigValues(raw));
    if (props.getProperty(PROP_CONFIG_LAST_GOOD) !== good) props.setProperty(PROP_CONFIG_LAST_GOOD, good);
    if (props.getProperty(PROP_CONFIG_ALERTED) !== null) props.deleteProperty(PROP_CONFIG_ALERTED);
    return { config: parseConfig(raw), problems: [] };
  }
  var fallback = applyConfigFallback(raw, lastGoodConfig_());
  if (!fallback.usable) return { config: parseConfig(raw), problems: problems };
  console.log('Tab ' + SHEET_CONFIG + ' có ô sai, đang dùng giá trị cũ: ' + configProblemsSignature(fallback.problems));
  return { config: parseConfig(fallback.raw), problems: fallback.problems };
}

/** Dấu lỗi Cấu hình hiện tại, hoặc chuỗi rỗng nếu không có lỗi hay không đọc được. */
function currentConfigProblemSignature_() {
  try {
    return configProblemsSignature(readConfigState_().problems);
  } catch (err) {
    return '';
  }
}

function lastGoodConfig_() {
  var saved = scriptProperty_(PROP_CONFIG_LAST_GOOD);
  if (!saved) return null;
  try {
    var parsed = JSON.parse(saved);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function readCatalog_() {
  return {
    products: buildCatalogList(readTable_(SHEET_PRODUCTS).rows, 'product_id'),
    toppings: buildCatalogList(readTable_(SHEET_TOPPINGS).rows, 'topping_id')
  };
}

/* ---------- Hàm phụ ---------- */

function scriptProperty_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function parseBody_(e) {
  var contents = e && e.postData && e.postData.contents;
  if (typeof contents !== 'string' || contents.length > LIMITS.body_chars) {
    return { error: invalidInput('Dữ liệu gửi lên không hợp lệ.') };
  }
  try {
    return { value: JSON.parse(contents) };
  } catch (err) {
    return { error: invalidInput('Dữ liệu gửi lên không hợp lệ.') };
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function unauthorized_() {
  return errorResponse('UNAUTHORIZED', 'Không có quyền truy cập.');
}

/** Ghi nguyên nhân vào log của Apps Script, không trả chi tiết cho trang. */
function serverError_(err) {
  console.error(err && err.stack ? err.stack : err);
  return errorResponse('SERVER_ERROR', 'Hệ thống đang lỗi. Vui lòng nhắn Messenger để đặt hàng.');
}

function isTrue_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function formatTime_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TIME_ZONE, DATE_TIME_FORMAT_TEXT);
  }
  return String(value);
}

/* ---------- Dựng Sheet ---------- */

/** Chạy tay trong trình soạn thảo. Chạy lại nhiều lần được: chỉ thêm phần thiếu, không xoá hay ghi đè. */
function setup() {
  var ss = spreadsheet_();
  ss.setSpreadsheetTimeZone(TIME_ZONE);

  var orders = ensureSheet_(ss, SHEET_ORDERS, ORDER_HEADERS);
  applyOrderFormats_(orders);

  var config = ensureSheet_(ss, SHEET_CONFIG, CONFIG_HEADERS);
  moveConfigColumns_(config);
  addMissingConfig_(config);
  upgradeConfigRows_(config);
  applyConfigValidation_(config);
  sheetHideColumnByKey_(config, 'key');
  protectColumnsWarningOnly_(config, ['key']);
  // Cột giá trị lẫn đúng sai, số và chữ, nên không đặt định dạng số ở đây.
  applyTabStyle_(config, CONFIG_COLUMN_WIDTHS, ['ghi_chu']);

  var products = ensureSheet_(ss, SHEET_PRODUCTS, PRODUCT_HEADERS);
  seedIfEmpty_(products, SEED_PRODUCTS);
  applyCatalogFormats_(products, PRODUCT_COLUMN_WIDTHS);

  var toppings = ensureSheet_(ss, SHEET_TOPPINGS, TOPPING_HEADERS);
  seedIfEmpty_(toppings, SEED_TOPPINGS);
  applyCatalogFormats_(toppings, TOPPING_COLUMN_WIDTHS);

  var backupErrors = ensureSheet_(ss, SHEET_BACKUP_ERRORS, BACKUP_ERROR_HEADERS);
  columnRange_(backupErrors, 'created_at').setNumberFormat(DATE_TIME_FORMAT_CELL);
  columnRange_(backupErrors, 'notified_at').setNumberFormat(DATE_TIME_FORMAT_CELL);
  applyTabStyle_(backupErrors, BACKUP_COLUMN_WIDTHS, ['message', 'answers']);
}

/** Tab tên cũ được đổi tên tại chỗ nên giữ nguyên dữ liệu. Có cả hai tên thì dùng tab mới, không xoá tab cũ. */
function ensureTab_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  var old = ss.getSheetByName(SHEET_OLD_NAMES[name]);
  if (!old) return ss.insertSheet(name);
  old.setName(name);
  return old;
}

function ensureSheet_(ss, name, headers) {
  var sheet = ensureTab_(ss, name);
  renameLegacyHeaders_(sheet);
  var lastColumn = sheet.getLastColumn();
  var existing = sheetHeaderKeys_(sheet);
  var missing = headers.filter(function (header) { return existing.indexOf(header) === -1; });
  if (missing.length) {
    var extra = lastColumn + missing.length - sheet.getMaxColumns();
    if (extra > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), extra);
    var labels = missing.map(function (header) { return HEADER_LABELS[name][header]; });
    sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([labels]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Đổi tiêu đề tiếng Anh cũ sang nhãn ngay tại chỗ, không chuyển cột.
 * Nhãn đã có ở cột khác (thường là cột của nhóm) thì giữ tên cũ: đọc vẫn đúng và không tạo hai cột trùng tên.
 */
function renameLegacyHeaders_(sheet) {
  var name = sheet.getName();
  var cells = headerCells_(sheet);
  var texts = cells.map(headerText_);
  headerKeys_(name, cells).forEach(function (key, index) {
    if (!Object.prototype.hasOwnProperty.call(HEADER_LABELS[name], key)) return;
    var label = HEADER_LABELS[name][key];
    if (texts[index] === label) return;
    if (texts.indexOf(label) !== -1) {
      console.log('Tab ' + name + ': giữ tiêu đề ' + texts[index] + ' vì đã có cột khác tên ' + label);
      return;
    }
    sheet.getRange(1, index + 1).setValue(label);
  });
}

/**
 * Đưa ba cột Config về thứ tự CONFIG_HEADERS ở đầu tab. Cả cột được chuyển nên giá trị đã sửa đi cùng.
 * Xếp từ trái sang nên cột cần chuyển luôn ở bên phải vị trí đích. Đúng thứ tự rồi thì không làm gì.
 */
function moveConfigColumns_(sheet) {
  CONFIG_HEADERS.forEach(function (header, index) {
    var current = sheetHeaderKeys_(sheet).indexOf(header) + 1;
    if (current !== index + 1) sheet.moveColumns(sheet.getRange(1, current), index + 1);
  });
}

function sheetHideColumnByKey_(sheet, header) {
  sheet.hideColumns(sheetHeaderKeys_(sheet).indexOf(header) + 1);
}

function addMissingConfig_(sheet) {
  var existing = readTable_(sheet.getName()).rows.map(function (row) { return String(row.key).trim(); });
  var headers = sheetHeaderKeys_(sheet);
  SEED_CONFIG.forEach(function (entry) {
    if (existing.indexOf(entry[0]) !== -1) return;
    appendByHeaders_(sheet, headers, { key: entry[0], value: entry[1], ghi_chu: entry[2] });
  });
  var table = readTable_(sheet.getName());
  var valueColumn = table.headers.indexOf('value') + 1;
  table.rows.forEach(function (row) {
    if (CONFIG_TEXT_KEYS.indexOf(String(row.key).trim()) !== -1) {
      sheet.getRange(row._row, valueColumn).setNumberFormat('@');
    }
  });
}

/**
 * Ô Nhận đơn ghi TRUE/FALSE của bản trước đổi sang Mở cửa/Đóng cửa; giá trị lạ vốn đã tính là đóng nên ghi Đóng cửa.
 * Câu ý nghĩa còn đúng nguyên văn mặc định cũ được thay bằng câu mới; câu nhóm tự sửa được giữ.
 */
function upgradeConfigRows_(sheet) {
  var table = readTable_(sheet.getName());
  var valueColumn = table.headers.indexOf('value') + 1;
  var meaningColumn = table.headers.indexOf('ghi_chu') + 1;
  var seedMeanings = {};
  SEED_CONFIG.forEach(function (entry) { seedMeanings[entry[0]] = entry[2]; });
  table.rows.forEach(function (row) {
    var key = String(row.key).trim();
    if (key === 'orders_open') {
      var label = openStateLabel(row.value);
      if (row.value !== label) sheet.getRange(row._row, valueColumn).setValue(label);
    }
    var oldMeaning = OLD_CONFIG_MEANINGS[key];
    if (oldMeaning && headerText_(row.ghi_chu === undefined ? '' : row.ghi_chu) === oldMeaning) {
      sheet.getRange(row._row, meaningColumn).setValue(seedMeanings[key]);
    }
  });
}

/**
 * Ô chọn cho Nhận đơn, kiểm tra số cho các ô số. Google từ chối giá trị sai ngay khi gõ.
 * Ô vẫn có thể bị xoá trống: khi đó hệ thống dùng giá trị hợp lệ gần nhất và gửi email cảnh báo.
 */
/**
 * Công thức thay cho kiểm tra số thường, vì kiểm tra số thường vẫn nhận số lẻ như 1.5.
 * Công thức không có dấu ngăn đối số, vì Sheet theo vùng Việt Nam dùng dấu chấm phẩy thay dấu phẩy.
 * Đúng khi ô là số nguyên từ min trở lên: dưới min thì vế phải lớn hơn đúng 1 nên không bằng INT;
 * ô chữ làm INT báo lỗi nên bị từ chối.
 */
function wholeNumberFormula_(ref, min) {
  return '=INT(' + ref + ')=' + ref + '+(' + ref + '<' + min + ')';
}

function applyWholeNumberValidation_(cell, ref, min) {
  cell.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(wholeNumberFormula_(ref, min))
    .setAllowInvalid(false)
    .setHelpText('Nhập số nguyên từ ' + min + ' trở lên, gõ liền như 10000.')
    .build());
}

function applyConfigValidation_(sheet) {
  var table = readTable_(sheet.getName());
  var valueColumn = table.headers.indexOf('value') + 1;
  var openCell = null;
  table.rows.forEach(function (row) {
    var key = String(row.key).trim();
    var cell = sheet.getRange(row._row, valueColumn);
    if (key === 'orders_open') {
      openCell = cell;
      cell.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList([OPEN_LABEL, CLOSED_LABEL], true)
        .setAllowInvalid(false)
        .setHelpText('Chọn Mở cửa hoặc Đóng cửa.')
        .build());
    } else if (Object.prototype.hasOwnProperty.call(CONFIG_NUMBER_MINIMUMS, key)) {
      var min = CONFIG_NUMBER_MINIMUMS[key];
      var ref = columnLetter_(valueColumn) + row._row;
      applyWholeNumberValidation_(cell, ref, min);
    }
  });
  // setConditionalFormatRules ghi đè toàn bộ, nên chỉ thêm khi tab chưa có luật nào.
  if (openCell && sheet.getConditionalFormatRules().length === 0) {
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(OPEN_LABEL)
        .setBackground(CONFIG_OPEN_COLOR).setRanges([openCell]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CLOSED_LABEL)
        .setBackground(CONFIG_CLOSED_COLOR).setRanges([openCell]).build()
    ]);
  }
}

function seedIfEmpty_(sheet, rows) {
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/** Vùng dữ liệu của một cột, từ dòng 2 đến hết lưới hiện có. */
function columnRange_(sheet, header) {
  return sheet.getRange(2, sheetHeaderKeys_(sheet).indexOf(header) + 1, sheet.getMaxRows() - 1, 1);
}

function applyDropdown_(sheet, header, values) {
  columnRange_(sheet, header).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build()
  );
}

/** Giá vẫn lưu là số nên cách đọc giá không đổi; định dạng chỉ đổi cách hiển thị. */
function applyCatalogFormats_(sheet, widths) {
  applyDropdown_(sheet, 'status', CATALOG_STATUS_VALUES);
  columnRange_(sheet, 'price').setNumberFormat(MONEY_FORMAT_CELL);
  applyTabStyle_(sheet, widths, []);
  sheet.getRange(1, sheetHeaderKeys_(sheet).indexOf('status') + 1).setNote(CATALOG_STATUS_NOTE);
}

function applyOrderFormats_(sheet) {
  applyDropdown_(sheet, 'status', STATUS_VALUES);
  applyDropdown_(sheet, 'payment_status', PAYMENT_STATUS_VALUES);
  columnRange_(sheet, 'created_at').setNumberFormat(DATE_TIME_FORMAT_CELL);
  columnRange_(sheet, 'notified_at').setNumberFormat(DATE_TIME_FORMAT_CELL);
  applyOrderView_(sheet);
}

/** Làm tab Orders gọn cho nhân viên. Chỉ đổi cách hiển thị, không đụng dữ liệu; chạy lại không bị nhân đôi. */
function applyOrderView_(sheet) {
  var lastColumn = sheet.getLastColumn();
  var headers = sheetHeaderKeys_(sheet);

  ORDER_HIDDEN_COLUMNS.forEach(function (header) {
    sheet.hideColumns(headers.indexOf(header) + 1);
  });

  protectColumnsWarningOnly_(sheet, ORDER_WARNING_COLUMNS);

  // setConditionalFormatRules ghi đè toàn bộ, nên chỉ thêm khi chưa có luật nào để giữ luật của nhóm.
  if (sheet.getConditionalFormatRules().length === 0) {
    var rows = sheet.getRange(2, 1, sheet.getMaxRows() - 1, lastColumn);
    sheet.setConditionalFormatRules(orderColorRules_(headers).map(function (rule) {
      return SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(rule.formula)
        .setBackground(rule.color)
        .setRanges([rows])
        .build();
    }));
  }

  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), lastColumn).createFilter();

  applyOrderLayout_(sheet, headers);
}

/** Chỉ cảnh báo người sửa tay; script vẫn ghi được. Tra theo mô tả nên chạy lại không nhân đôi. */
function protectColumnsWarningOnly_(sheet, headers) {
  var protectedNames = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).map(function (protection) {
    return protection.getDescription();
  });
  headers.forEach(function (header) {
    var description = PROTECTION_PREFIX + header;
    if (protectedNames.indexOf(description) !== -1) return;
    columnRange_(sheet, header).protect().setDescription(description).setWarningOnly(true);
  });
}

function applyOrderLayout_(sheet, headers) {
  applyTabStyle_(sheet, ORDER_COLUMN_WIDTHS, ORDER_WRAP_COLUMNS);
  sheet.setFrozenColumns(1);
  // Mũi tên bộ lọc nằm bên phải ô, nên canh trái để nhãn không bị che.
  sheet.getRange(1, 1, 1, headers.length).setHorizontalAlignment('left');

  headers.forEach(function (header, index) {
    var column = index + 1;
    if (ORDER_HEADER_NOTES[header]) sheet.getRange(1, column).setNote(ORDER_HEADER_NOTES[header]);
    if (ORDER_DROPPED_NOTES.indexOf(header) !== -1) sheet.getRange(1, column).setNote('');
  });
  ['shipping_fee', 'total'].forEach(function (header) {
    columnRange_(sheet, header).setNumberFormat(MONEY_FORMAT_CELL);
  });
}

/** Kiểu chung của mọi tab. Chỉ đổi cách hiển thị; chạy lại không nhân đôi màu xen kẽ. */
function applyTabStyle_(sheet, widths, wrapColumns) {
  var headers = sheetHeaderKeys_(sheet);
  styleHeader_(sheet, headers.length);

  var rows = sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length);
  rows.setFontSize(11).setVerticalAlignment('middle');
  if (sheet.getBandings().length === 0) rows.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  headers.forEach(function (header, index) {
    if (widths[header]) sheet.setColumnWidth(index + 1, widths[header]);
    if (wrapColumns.indexOf(header) !== -1) sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setWrap(true);
  });
}

function styleHeader_(sheet, lastColumn) {
  sheet.getRange(1, 1, 1, lastColumn)
    .setBackground(HEADER_BACKGROUND)
    .setFontColor(HEADER_TEXT_COLOR)
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(1, 36);
}

/** Luật đứng trước được ưu tiên: đơn đã huỷ hoặc bom thì không tô màu cần xử lý. */
function orderColorRules_(headers) {
  var cell = function (header) { return '$' + columnLetter_(headers.indexOf(header) + 1) + '2'; };
  var status = cell('status');
  return [
    { formula: '=' + status + '="huy"', color: '#d9d9d9' },
    { formula: '=' + status + '="bom"', color: '#f4c7c3' },
    { formula: '=AND(' + cell('needs_call') + '=TRUE,' + cell('call_done') + '<>TRUE)', color: '#fce5cd' },
    { formula: '=' + cell('payment_status') + '="cho_chuyen_khoan"', color: '#fff2cc' }
  ];
}

function columnLetter_(index) {
  var letters = '';
  for (var n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  }
  return letters;
}
