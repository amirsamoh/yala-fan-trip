/**
 * Yala City Fan Trip — หลังบ้าน (Google Apps Script)
 * เก็บข้อมูลใน Google Sheet ที่ผูกกับสคริปต์นี้ (ชีต Trips และ People)
 * หน้าเว็บ (GitHub Pages) เรียกใช้ผ่าน Web App URL ด้วยรหัสผ่านร่วม
 */

// ตั้งรหัสผ่านที่นี่ก่อนรัน setup() ครั้งแรก แล้วลบกลับเป็น '' หลังรันเสร็จ
const INITIAL_PASSWORD = '';

const SHEETS = {
  Trips:  ['id', 'name', 'datetime', 'place', 'details', 'capacity', 'createdAt'],
  People: ['id', 'tripId', 'name', 'address', 'phone', 'note', 'checkedIn', 'checkedAt', 'createdAt']
};
const MAX_FAILS = 5;   // ใส่รหัสผิดได้กี่ครั้ง
const LOCK_MIN = 5;    // แล้วล็อกกี่นาที

/* ---------- ตั้งค่าครั้งแรก (รันจากเมนู Run ใน Apps Script) ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const cols = SHEETS[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  if (INITIAL_PASSWORD) {
    savePassword_(INITIAL_PASSWORD);
    Logger.log('ตั้งรหัสผ่านแล้ว — กลับไปลบรหัสออกจาก INITIAL_PASSWORD แล้วกดบันทึก');
  } else if (!props.getProperty('PW_HASH')) {
    throw new Error('ยังไม่ได้ตั้งรหัสผ่าน: ใส่ค่าใน INITIAL_PASSWORD แล้วรัน setup ใหม่');
  }
}

/* ---------- ทางเข้า Web App ---------- */
function doGet() {
  return json_({ ok: true, app: 'Yala City Fan Trip API' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_(fail_('bad_request', 'คำขอไม่ถูกต้อง'));
  }
  try {
    return json_(handle_(req));
  } catch (err) {
    if (err && err.code) return json_(fail_(err.code, err.message));
    console.error(err);
    return json_(fail_('server', 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองอีกครั้ง'));
  }
}

function handle_(r) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PW_HASH')) throw err_('setup', 'ยังไม่ได้ตั้งค่าหลังบ้าน (รัน setup ใน Apps Script)');
  if (r.action === 'login') return login_(r, props);
  if (!r.token || r.token !== token_()) throw err_('auth', 'เซสชันหมดอายุ กรอกรหัสผ่านอีกครั้ง');

  switch (r.action) {
    case 'list':           return list_();
    case 'tripSave':       return withLock_(function () { return tripSave_(r.trip || {}); });
    case 'tripDelete':     return withLock_(function () { return tripDelete_(String(r.id || '')); });
    case 'personSave':     return withLock_(function () { return personSave_(r.person || {}); });
    case 'personDelete':   return withLock_(function () { return personDelete_(String(r.id || '')); });
    case 'checkin':        return withLock_(function () { return checkin_(String(r.id || ''), !!r.value); });
    case 'changePassword': return withLock_(function () { return changePassword_(String(r.newPassword || '')); });
    default: throw err_('bad_request', 'ไม่รู้จักคำสั่ง');
  }
}

/* ---------- รหัสผ่าน / โทเคน ---------- */
function toHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function hashPw_(pw, salt) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8));
}
function savePassword_(pw) {
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    SALT: salt, PW_HASH: hashPw_(pw, salt), FAILS: '0', LOCK_UNTIL: '0'
  });
}
function token_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return toHex_(Utilities.computeHmacSha256Signature('token:' + p.PW_HASH, p.SALT));
}
function login_(r, props) {
  const now = Date.now();
  const lock = Number(props.getProperty('LOCK_UNTIL') || 0);
  if (now < lock) throw err_('locked', 'ใส่รหัสผิดหลายครั้ง รออีก ' + Math.ceil((lock - now) / 60000) + ' นาทีแล้วลองใหม่');
  const ok = hashPw_(String(r.password || ''), props.getProperty('SALT')) === props.getProperty('PW_HASH');
  if (!ok) {
    const f = Number(props.getProperty('FAILS') || 0) + 1;
    if (f >= MAX_FAILS) {
      props.setProperties({ FAILS: '0', LOCK_UNTIL: String(now + LOCK_MIN * 60000) });
      throw err_('locked', 'ใส่รหัสผิดหลายครั้ง ระบบล็อก ' + LOCK_MIN + ' นาที');
    }
    props.setProperty('FAILS', String(f));
    throw err_('password', 'รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง');
  }
  props.setProperties({ FAILS: '0', LOCK_UNTIL: '0' });
  return { ok: true, token: token_() };
}
function changePassword_(pw) {
  if (pw.length < 4) throw err_('invalid', 'รหัสผ่านต้องมีอย่างน้อย 4 ตัว');
  savePassword_(pw);
  return { ok: true, token: token_() };
}

/* ---------- อ่าน/เขียนชีต ---------- */
function list_() {
  return { ok: true, trips: readAll_('Trips'), people: readAll_('People'), serverTime: Date.now() };
}

function tripSave_(t) {
  const name = String(t.name || '').trim();
  const cap = parseInt(t.capacity, 10);
  const dt = String(t.datetime || '').trim();
  if (!name) throw err_('invalid', 'กรอกชื่อรอบ');
  if (!dt) throw err_('invalid', 'เลือกวันที่และเวลาเดินทาง');
  if (!(cap >= 1 && cap <= 9999)) throw err_('invalid', 'จำนวนที่นั่งต้องเป็นตัวเลข 1 ขึ้นไป');
  const sh = sheet_('Trips');
  const row = t.id ? findRow_(sh, String(t.id)) : 0;
  let obj;
  if (row) {
    const old = parse_('Trips', sh.getRange(row, 1, 1, SHEETS.Trips.length).getValues()[0]);
    obj = Object.assign({}, old, { name: name, datetime: dt, place: str_(t.place), details: str_(t.details), capacity: cap });
    writeRow_(sh, 'Trips', row, obj);
  } else {
    obj = { id: newId_('t'), name: name, datetime: dt, place: str_(t.place), details: str_(t.details), capacity: cap, createdAt: Date.now() };
    writeRow_(sh, 'Trips', Math.max(sh.getLastRow(), 1) + 1, obj);
  }
  return { ok: true, trip: obj };
}

function tripDelete_(id) {
  const trips = sheet_('Trips');
  const row = findRow_(trips, id);
  if (row) trips.deleteRow(row);
  const ps = sheet_('People');
  const last = ps.getLastRow();
  if (last >= 2) {
    const vals = ps.getRange(2, 1, last - 1, 2).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][1]) === id) ps.deleteRow(i + 2);
    }
  }
  return { ok: true };
}

function personSave_(p) {
  const name = String(p.name || '').trim();
  const address = String(p.address || '').trim();
  const phone = String(p.phone || '').replace(/\D/g, '');
  if (!name) throw err_('invalid', 'กรอกชื่อ-นามสกุล');
  if (!address) throw err_('invalid', 'กรอกที่อยู่');
  if (!/^0\d{9}$/.test(phone)) throw err_('invalid', 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก');
  if (!findRow_(sheet_('Trips'), String(p.tripId || ''))) throw err_('invalid', 'ไม่พบรอบนี้ อาจถูกลบไปแล้ว');
  const sh = sheet_('People');
  const row = p.id ? findRow_(sh, String(p.id)) : 0;
  let obj;
  if (row) {
    const old = parse_('People', sh.getRange(row, 1, 1, SHEETS.People.length).getValues()[0]);
    obj = Object.assign({}, old, { name: name, address: address, phone: phone, note: str_(p.note) });
    writeRow_(sh, 'People', row, obj);
  } else {
    obj = { id: newId_('p'), tripId: String(p.tripId), name: name, address: address, phone: phone, note: str_(p.note), checkedIn: false, checkedAt: 0, createdAt: Date.now() };
    writeRow_(sh, 'People', Math.max(sh.getLastRow(), 1) + 1, obj);
  }
  return { ok: true, person: obj };
}

function personDelete_(id) {
  const sh = sheet_('People');
  const row = findRow_(sh, id);
  if (row) sh.deleteRow(row);
  return { ok: true };
}

function checkin_(id, value) {
  const sh = sheet_('People');
  const row = findRow_(sh, id);
  if (!row) throw err_('invalid', 'ไม่พบรายชื่อนี้ อาจถูกลบไปแล้ว');
  const obj = parse_('People', sh.getRange(row, 1, 1, SHEETS.People.length).getValues()[0]);
  obj.checkedIn = value;
  obj.checkedAt = value ? Date.now() : 0;
  writeRow_(sh, 'People', row, obj);
  return { ok: true, person: obj };
}

/* ---------- ตัวช่วย ---------- */
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw err_('setup', 'ไม่พบชีต ' + name + ' (รัน setup ใน Apps Script)');
  return sh;
}
function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEETS[name].length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) { return parse_(name, r); });
}
function parse_(name, r) {
  const cols = SHEETS[name], o = {};
  cols.forEach(function (c, i) { o[c] = r[i]; });
  o.id = String(o.id);
  if (name === 'Trips') {
    o.capacity = Number(o.capacity) || 0;
    o.createdAt = Number(o.createdAt) || 0;
    if (o.datetime instanceof Date) o.datetime = Utilities.formatDate(o.datetime, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
    o.datetime = String(o.datetime);
    o.name = String(o.name); o.place = String(o.place); o.details = String(o.details);
  } else {
    o.tripId = String(o.tripId);
    o.name = String(o.name); o.address = String(o.address); o.note = String(o.note);
    let ph = String(o.phone).replace(/\D/g, '');
    if (ph.length === 9) ph = '0' + ph;
    o.phone = ph;
    const ci = o.checkedIn;
    o.checkedIn = ci === true || String(ci) === '1' || String(ci).toUpperCase() === 'TRUE';
    o.checkedAt = Number(o.checkedAt) || 0;
    o.createdAt = Number(o.createdAt) || 0;
  }
  return o;
}
function writeRow_(sh, name, row, obj) {
  const vals = SHEETS[name].map(function (c) {
    const v = obj[c];
    if (c === 'checkedIn') return v ? '1' : '0';
    return v === null || v === undefined ? '' : String(v);
  });
  const rng = sh.getRange(row, 1, 1, vals.length);
  rng.setNumberFormat('@');          // เก็บเป็นข้อความ กันเบอร์โทรเสียเลข 0 และวันที่ถูกแปลง
  rng.setValues([vals]);
}
function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function newId_(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function str_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function err_(code, message) { return { code: code, message: message }; }
function fail_(code, message) { return { ok: false, error: code, message: message }; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
