/* Yala City Fan Trip — หน้าแอป (PWA) เรียก Google Apps Script เป็นหลังบ้าน */
'use strict';
const CFG = window.APP_CONFIG || {};
const LOGO = 'assets/logo.png';
const $app = document.getElementById('app');

/* ---------- ตัวช่วยสร้าง DOM ---------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('aria-') && v != null) { e.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

/* ---------- ไอคอน + ธีม ---------- */
const ICONS = {
  sun: '<circle class="f" cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path class="f" d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
function icon(n) {
  const s = document.createElement('span');
  s.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>';
  return s.firstChild;
}
function getTheme() { try { return localStorage.getItem('yc_theme') || 'dark'; } catch (e) { return 'dark'; } }
function applyTheme(m) {
  document.documentElement.setAttribute('data-theme', m);
  try { localStorage.setItem('yc_theme', m); } catch (e) {}
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', m === 'light' ? '#f5f3f3' : '#000000');
}
const themeIcon = () => icon(getTheme() === 'light' ? 'moon' : 'sun');
function toggleTheme() {
  applyTheme(getTheme() === 'light' ? 'dark' : 'light');
  const b = document.getElementById('themeBtn');
  if (b) b.replaceChildren(themeIcon());
}
applyTheme(getTheme());

/* ---------- สถานะ ---------- */
const state = { trips: [], people: [], tripId: null, tab: 'add', filter: 'all', q: '', shown: false, lastSync: 0 };
const ui = {};
let pending = 0;          // จำนวนคำขอบันทึกที่ยังค้างอยู่ (ระหว่างนี้ไม่ซิงก์ทับ)
let pollTimer = null;

/* ---------- ตัวช่วยทั่วไป ---------- */
const fmtDT = iso => { try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) + ' น.'; } catch (e) { return iso || ''; } };
const fmtT = ms => ms ? new Date(ms).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const digits = s => (s || '').replace(/\D/g, '');
const fmtPhone = p => { const d = digits(p); return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : p; };
const validPhone = p => /^0\d{9}$/.test(digits(p));
function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}
const thaiErr = e => (e && e.message) || 'เกิดข้อผิดพลาด ลองอีกครั้ง';
const getTok = () => { try { return localStorage.getItem('yc_tok'); } catch (e) { return null; } };
const setTok = v => { try { v ? localStorage.setItem('yc_tok', v) : localStorage.removeItem('yc_tok'); } catch (e) {} };
function upsert(arr, o) { const i = arr.findIndex(x => x.id === o.id); if (i >= 0) arr[i] = o; else arr.push(o); }

function modal(title, body, actions, opts = {}) {
  const veil = h('div', { class: 'veil', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { veil.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') { close(); opts.onCancel && opts.onCancel(); } };
  document.addEventListener('keydown', esc);
  veil.addEventListener('click', e => { if (e.target === veil) { close(); opts.onCancel && opts.onCancel(); } });
  veil.append(h('div', { class: 'sheet' }, h('h2', null, title), body, actions ? h('div', { class: 'acts' }, actions(close)) : null));
  document.body.append(veil);
  const f = veil.querySelector('input,textarea');
  if (f && opts.focus !== false) setTimeout(() => f.focus(), 50);
  return close;
}
function confirmBox(title, msg, okText, danger) {
  return new Promise(res => {
    modal(title, h('p', { class: 'hint', style: 'font-size:16px;margin-top:8px' }, msg), close => [
      h('button', { class: 'btn ghost', onclick: () => { close(); res(false); } }, 'ยกเลิก'),
      h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: () => { close(); res(true); } }, okText)
    ], { onCancel: () => res(false) });
  });
}
function tripStatus(t) {
  const n = state.people.filter(p => p.tripId === t.id).length;
  if (t.datetime && new Date(t.datetime).getTime() < Date.now()) return { k: 'past', label: 'ผ่านไปแล้ว', n };
  if (n >= t.capacity) return { k: 'full', label: 'เต็ม', n };
  return { k: 'open', label: 'เปิด', n };
}

/* ---------- เรียกหลังบ้าน (Google Apps Script) ---------- */
async function api(action, data = {}) {
  let res;
  try {
    // ไม่ตั้ง header เองเพื่อให้เป็น "simple request" (ไม่ติด CORS preflight ของ Apps Script)
    res = await fetch(CFG.API_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify(Object.assign({ action, token: getTok() }, data)) });
  } catch (e) {
    throw { code: 'network', message: 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสัญญาณแล้วลองอีกครั้ง' };
  }
  let j;
  try { j = await res.json(); } catch (e) {
    throw { code: 'server', message: 'หลังบ้านตอบกลับไม่ถูกต้อง ตรวจว่า Deploy เป็น Web App และให้สิทธิ์ "ทุกคน" แล้ว' };
  }
  if (!j.ok) {
    if (j.error === 'auth') { setTok(null); stopPoll(); showLogin('เซสชันหมดอายุ กรอกรหัสผ่านอีกครั้ง'); }
    throw j;
  }
  return j;
}
async function mutate(fn) { pending++; try { return await fn(); } finally { pending--; } }
async function refresh() {
  const j = await api('list');
  state.trips = j.trips; state.people = j.people; state.lastSync = Date.now();
  if (state.shown) updateUI();
}
function updateUI() {
  if (state.tripId) {
    if (!currentTrip()) { goHome(); return; }
    ui.updateMeter && ui.updateMeter();
    ui.updateList && ui.updateList();
  } else ui.updateHome && ui.updateHome();
}
function startPoll() {
  stopPoll();
  pollTimer = setInterval(async () => { if (pending || document.hidden) return; try { await refresh(); } catch (e) {} }, 20000);
}
function stopPoll() { clearInterval(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && state.shown && !pending) { try { await refresh(); } catch (e) {} }
});

/* ---------- เริ่มต้น / ล็อกอิน ---------- */
function centerBox(...kids) { return h('div', { class: 'center' }, h('div', { class: 'login' }, ...kids)); }
async function boot() {
  if (!CFG.API_URL) {
    $app.replaceChildren(centerBox(h('img', { src: LOGO, alt: 'Yala City FC' }), h('h1', null, 'ยังไม่ได้ตั้งค่า'),
      h('p', null, 'ใส่ Web App URL ของ Google Apps Script ในไฟล์ config.js ตามขั้นตอนใน README.md')));
    return;
  }
  if (getTok()) await startApp(); else showLogin();
}
function showLogin(msg) {
  const pw = h('input', { type: 'password', placeholder: 'รหัสผ่าน', autocomplete: 'current-password', 'aria-label': 'รหัสผ่าน' });
  const err = h('div', { class: 'err', role: 'alert' }, msg || '');
  const go = h('button', { class: 'btn block', type: 'submit' }, 'เข้าสู่ระบบ');
  const form = h('form', {
    class: 'login', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (!pw.value) { err.textContent = 'กรอกรหัสผ่าน'; pw.focus(); return; }
      go.disabled = true; go.textContent = 'กำลังตรวจสอบ…';
      try {
        const j = await api('login', { password: pw.value });
        setTok(j.token); await startApp();
      } catch (x) { err.textContent = thaiErr(x); pw.select(); go.disabled = false; go.textContent = 'เข้าสู่ระบบ'; }
    }
  }, h('img', { src: LOGO, alt: 'Yala City FC' }), h('h1', null, 'Yala City Fan Trip'),
    h('p', null, 'เฉพาะผู้จัดการทริป กรอกรหัสผ่านเพื่อเข้าใช้งาน'), pw, err, go);
  $app.replaceChildren(h('div', { class: 'center' }, form));
  pw.focus();
}
function logout() {
  setTok(null); stopPoll();
  Object.assign(state, { trips: [], people: [], tripId: null, shown: false });
  showLogin();
}
async function startApp() {
  $app.replaceChildren(h('div', { class: 'center' }, h('div', { style: 'text-align:center' }, h('div', { class: 'spin' }), h('p', { class: 'hint' }, 'กำลังโหลดข้อมูล…'))));
  try { await refresh(); } catch (e) {
    if (e.code === 'auth') return;   // api() แสดงหน้าล็อกอินให้แล้ว
    $app.replaceChildren(centerBox(h('img', { src: LOGO, alt: 'Yala City FC' }), h('h1', null, 'โหลดข้อมูลไม่ได้'), h('p', null, thaiErr(e)),
      h('button', { class: 'btn block', onclick: startApp }, 'ลองอีกครั้ง'),
      h('button', { class: 'btn ghost block', style: 'margin-top:10px', onclick: logout }, 'ออกจากระบบ')));
    return;
  }
  state.shown = true;
  route(); startPoll();
}
window.addEventListener('hashchange', () => { if (state.shown) route(); });
const currentTrip = () => state.trips.find(t => t.id === state.tripId);
function route() {
  const m = /^#trip-([A-Za-z0-9]+)$/.exec(location.hash);
  if (m && state.trips.some(t => t.id === m[1])) {
    if (state.tripId !== m[1] || !ui.updateMeter) { state.tripId = m[1]; state.tab = 'add'; state.filter = 'all'; state.q = ''; renderTrip(); }
  } else { state.tripId = null; renderHome(); }
}
function goHome() { if (location.hash === '#home') route(); else location.hash = '#home'; }
function goTrip(id) { location.hash = '#trip-' + id; }

/* ---------- ตั้งค่า ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
function openSettings() {
  const items = [];
  if (!isStandalone()) {
    if (deferredInstall) items.push(h('button', { class: 'btn block', style: 'margin-bottom:10px', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; } }, 'ติดตั้งแอปลงหน้าจอ'));
    else items.push(h('p', { class: 'hint', style: 'margin:8px 0 12px' }, 'ติดตั้งเป็นแอป — iPhone: กดปุ่มแชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" · Android: กดเมนู ⋮ แล้วเลือก "ติดตั้งแอป"'));
  }
  items.push(
    h('button', { class: 'btn ghost block', style: 'margin-bottom:10px', onclick: async e => { e.currentTarget.disabled = true; try { await refresh(); toast('โหลดข้อมูลใหม่แล้ว'); } catch (x) { toast(thaiErr(x), true); } e.currentTarget.disabled = false; } }, 'โหลดข้อมูลใหม่'),
    h('button', { class: 'btn ghost block', style: 'margin-bottom:10px', onclick: () => { document.querySelector('.veil').remove(); changePw(); } }, 'เปลี่ยนรหัสผ่าน'),
    h('button', { class: 'btn ghost block', onclick: () => { document.querySelector('.veil').remove(); logout(); } }, 'ออกจากระบบเครื่องนี้'),
    h('p', { class: 'hint', style: 'margin-top:12px' }, state.lastSync ? 'อัปเดตข้อมูลล่าสุด ' + new Date(state.lastSync).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : ''));
  modal('ตั้งค่า', h('div', { style: 'margin-top:8px' }, items), close => [h('button', { class: 'btn ghost', onclick: close }, 'ปิด')]);
}
function changePw() {
  const a = h('input', { type: 'password', placeholder: 'รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)', autocomplete: 'new-password' });
  const b = h('input', { type: 'password', placeholder: 'ยืนยันรหัสผ่านใหม่', autocomplete: 'new-password' });
  const err = h('div', { class: 'err', role: 'alert' });
  modal('เปลี่ยนรหัสผ่าน', h('div', null, h('div', { style: 'margin-top:12px' }, a), h('div', { style: 'margin-top:10px' }, b), err), close => [
    h('button', { class: 'btn ghost', onclick: close }, 'ยกเลิก'),
    h('button', {
      class: 'btn', onclick: async e => {
        if (a.value.length < 4) { err.textContent = 'รหัสผ่านต้องมีอย่างน้อย 4 ตัว'; return; }
        if (a.value !== b.value) { err.textContent = 'รหัสผ่านสองช่องไม่ตรงกัน'; return; }
        e.currentTarget.disabled = true;
        try { const j = await mutate(() => api('changePassword', { newPassword: a.value })); setTok(j.token); close(); toast('เปลี่ยนรหัสผ่านแล้ว อีกเครื่องต้องเข้าสู่ระบบใหม่'); }
        catch (x) { err.textContent = thaiErr(x); e.target.disabled = false; }
      }
    }, 'บันทึกรหัสใหม่')]);
}

/* ---------- หน้าแรก: รายการรอบ ---------- */
function topBar(sub, backFn) {
  return h('div', { class: 'top' },
    backFn ? h('button', { class: 'icon', 'aria-label': 'กลับหน้ารอบทั้งหมด', onclick: backFn }, icon('back')) : null,
    h('img', { src: LOGO, alt: 'Yala City FC' }),
    h('div', { class: 't' }, h('b', null, sub || 'Yala City Fan Trip'), h('small', null, backFn ? 'Yala City Fan Trip' : 'ระบบจัดการรายชื่อไปเชียร์')),
    h('button', { class: 'icon', id: 'themeBtn', 'aria-label': 'สลับโหมดสว่าง/มืด', onclick: toggleTheme }, themeIcon()),
    h('button', { class: 'icon', 'aria-label': 'ตั้งค่า', onclick: openSettings }, icon('gear')));
}
function renderHome() {
  ui.updateMeter = ui.updateList = null;
  const list = h('div');
  ui.updateHome = () => {
    const ts = [...state.trips].sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));
    const upcoming = ts.filter(t => tripStatus(t).k !== 'past'), past = ts.filter(t => tripStatus(t).k === 'past').reverse();
    const card = t => {
      const s = tripStatus(t), pct = Math.min(100, Math.round(s.n / t.capacity * 100));
      return h('button', { class: 'card trip', onclick: () => goTrip(t.id) },
        h('h3', null, t.name), h('span', { class: 'badge ' + s.k }, s.label),
        h('p', null, fmtDT(t.datetime)), t.place ? h('p', null, 'จุดนัดพบ: ' + t.place) : null,
        h('div', { class: 'num' }, s.n + ' / ' + t.capacity, h('span', null, ' คน')),
        h('div', { class: 'bar' + (s.n >= t.capacity ? ' full' : '') }, h('div', { style: 'width:' + pct + '%' })));
    };
    list.replaceChildren(
      !ts.length ? h('div', { class: 'empty' }, h('b', null, 'ยังไม่มีรอบ'), 'กด "เพิ่มรอบใหม่" เพื่อสร้างรอบแรก') : null,
      ...upcoming.map(card),
      past.length ? h('h3', { style: 'margin:22px 0 10px;color:var(--mute);font-size:17px' }, 'รอบที่ผ่านไปแล้ว') : null,
      ...past.map(card));
  };
  $app.replaceChildren(h('div', { class: 'wrap' }, topBar(),
    h('button', { class: 'btn block fab', onclick: () => tripForm() }, icon('plus'), 'เพิ่มรอบใหม่'), list));
  ui.updateHome();
}
function tripForm(t) {
  const f = {
    name: h('input', { value: t ? t.name : '', placeholder: 'เช่น ไปเชียร์นัดเยือน…' }),
    dt: h('input', { type: 'datetime-local', value: t ? t.datetime : '' }),
    place: h('input', { value: t ? t.place || '' : '', placeholder: 'เช่น หน้าสนามกีฬากลางจังหวัดยะลา' }),
    cap: h('input', { type: 'number', inputmode: 'numeric', min: '1', value: t ? t.capacity : '40' }),
    note: h('textarea', { placeholder: 'เช่น ค่ารถ เวลาออกเดินทาง ของที่ต้องเตรียม' })
  };
  f.note.value = t ? t.details || '' : '';
  const err = h('div', { class: 'err', role: 'alert' });
  const body = h('div', null,
    h('label', null, 'ชื่อรอบ'), f.name, h('label', null, 'วันที่และเวลาเดินทาง'), f.dt,
    h('label', null, 'สถานที่ / จุดนัดพบ ', h('small', null, '(ไม่บังคับ)')), f.place,
    h('label', null, 'จำนวนที่นั่งสูงสุด'), f.cap, h('label', null, 'รายละเอียดเพิ่มเติม ', h('small', null, '(ไม่บังคับ)')), f.note, err);
  modal(t ? 'แก้ไขรอบ' : 'เพิ่มรอบใหม่', body, close => [
    h('button', { class: 'btn ghost', onclick: close }, 'ยกเลิก'),
    h('button', {
      class: 'btn', onclick: async e => {
        const btn = e.currentTarget, name = f.name.value.trim(), cap = parseInt(f.cap.value, 10);
        if (!name) { err.textContent = 'กรอกชื่อรอบ'; f.name.focus(); return; }
        if (!f.dt.value) { err.textContent = 'เลือกวันที่และเวลาเดินทาง'; f.dt.focus(); return; }
        if (!(cap >= 1)) { err.textContent = 'จำนวนที่นั่งต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป'; f.cap.focus(); return; }
        btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
        try {
          const j = await mutate(() => api('tripSave', { trip: Object.assign(t ? { id: t.id } : {}, { name, datetime: f.dt.value, place: f.place.value.trim(), details: f.note.value.trim(), capacity: cap }) }));
          upsert(state.trips, j.trip); close(); updateUI(); toast(t ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มรอบแล้ว');
        } catch (x) { err.textContent = thaiErr(x); btn.disabled = false; btn.textContent = t ? 'บันทึกการแก้ไข' : 'เพิ่มรอบ'; }
      }
    }, t ? 'บันทึกการแก้ไข' : 'เพิ่มรอบ')]);
}

/* ---------- หน้ารอบ: เพิ่มรายชื่อ + รายชื่อ/เช็คอิน ---------- */
function renderTrip() {
  const t0 = currentTrip();
  const meterBox = h('div', { class: 'meter' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const addPane = h('div'), listPane = h('div');
  ui.updateHome = null;

  ui.updateMeter = () => {
    const t = currentTrip(); if (!t) return;
    const n = state.people.filter(p => p.tripId === t.id).length, left = t.capacity - n, pct = Math.min(100, Math.round(n / t.capacity * 100));
    meterBox.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'big' }, n, h('i', null, ' / ' + t.capacity)),
        h('span', { class: 'txt' }, 'บันทึกแล้ว ', h('b', null, n), ' / ทั้งหมด ', h('b', null, t.capacity), ' คน ',
          left > 0 ? ['เหลืออีก ', h('b', null, left), ' ที่นั่ง'] : (left === 0 ? h('b', null, 'เต็มแล้ว') : h('b', { style: 'color:var(--warn)' }, 'เกินมา ' + (-left) + ' คน')))),
      h('div', { class: 'bar' + (n >= t.capacity ? ' full' : ''), role: 'progressbar', 'aria-valuenow': n, 'aria-valuemax': t.capacity }, h('div', { style: 'width:' + pct + '%' })));
  };
  const setTab = k => {
    state.tab = k; addPane.hidden = k !== 'add'; listPane.hidden = k !== 'list';
    tabs.replaceChildren(
      h('button', { role: 'tab', 'aria-selected': k === 'add', onclick: () => setTab('add') }, 'เพิ่มรายชื่อ'),
      h('button', { role: 'tab', 'aria-selected': k === 'list', onclick: () => setTab('list') }, 'รายชื่อ / เช็คอิน'));
    if (k === 'add') setTimeout(() => ui.focusName && ui.focusName(), 0); else ui.updateList();
  };
  buildAddPane(addPane);
  buildListPane(listPane);

  $app.replaceChildren(h('div', { class: 'wrap' }, topBar(t0.name, goHome), meterBox,
    h('div', { style: 'margin:12px 0 0;color:var(--mute);font-size:15px' }, fmtDT(t0.datetime), t0.place ? ' · ' + t0.place : '', ' ',
      h('button', { style: 'color:var(--white);text-decoration:underline;min-height:36px', onclick: () => tripForm(currentTrip()) }, 'แก้ไขรอบ')),
    t0.details ? h('p', { class: 'hint', style: 'margin-top:4px;white-space:pre-wrap' }, t0.details) : null,
    tabs, addPane, listPane));
  ui.updateMeter(); setTab(state.tab);
}

function personForm(p, onDone) {
  const f = {
    name: h('input', { value: p ? p.name : '', autocomplete: 'off', placeholder: 'ชื่อ-นามสกุล', 'aria-label': 'ชื่อ-นามสกุล', enterkeyhint: 'next' }),
    addr: h('textarea', { placeholder: 'ที่อยู่', 'aria-label': 'ที่อยู่' }),
    phone: h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', value: p ? p.phone : '', placeholder: '0812345678', 'aria-label': 'เบอร์โทร' }),
    note: h('input', { value: p ? p.note || '' : '', placeholder: 'เช่น แพ้อาหาร ขอนั่งหน้า', 'aria-label': 'หมายเหตุ' })
  };
  f.addr.value = p ? p.address || '' : '';
  const errs = { name: h('div', { class: 'err' }), addr: h('div', { class: 'err' }), phone: h('div', { class: 'err' }) };
  const saveBtn = h('button', { class: 'btn block', style: 'margin-top:20px', type: 'submit' }, p ? 'บันทึกการแก้ไข' : 'บันทึก');
  const root = h('form', {
    novalidate: true, onsubmit: async e => {
      e.preventDefault();
      Object.values(errs).forEach(x => x.textContent = '');
      const v = { name: f.name.value.trim(), address: f.addr.value.trim(), phone: digits(f.phone.value), note: f.note.value.trim() };
      let bad = false;
      if (!v.name) { errs.name.textContent = 'กรอกชื่อ-นามสกุล'; bad = bad || f.name; }
      if (!v.address) { errs.addr.textContent = 'กรอกที่อยู่'; bad = bad || f.addr; }
      if (!validPhone(v.phone)) { errs.phone.textContent = 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก เช่น 0812345678'; bad = bad || f.phone; }
      if (bad) { bad.focus(); return; }
      const t = currentTrip();
      const others = state.people.filter(x => x.tripId === t.id && (!p || x.id !== p.id));
      const dup = others.find(x => digits(x.phone) === v.phone);
      if (dup && !(await confirmBox('เบอร์นี้มีในรอบนี้แล้ว', 'เบอร์ ' + fmtPhone(v.phone) + ' ถูกบันทึกไว้แล้วในชื่อ "' + dup.name + '" บันทึกซ้ำต่อไหม?', 'บันทึกซ้ำ'))) return;
      if (!p && others.length >= t.capacity && !(await confirmBox('ที่นั่งเต็มแล้ว', 'รอบนี้มีคนครบ ' + t.capacity + ' คนแล้ว ถ้าบันทึกต่อจะเกินจำนวนที่นั่ง', 'บันทึกต่อ'))) return;

      if (p) {                         // แก้ไข: รอผลจากหลังบ้าน
        saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก…';
        try {
          const j = await mutate(() => api('personSave', { person: Object.assign({ id: p.id, tripId: p.tripId }, v) }));
          upsert(state.people, j.person); updateUI(); toast('แก้ไขข้อมูลแล้ว'); onDone && onDone();
        } catch (x) { toast(thaiErr(x), true); saveBtn.disabled = false; saveBtn.textContent = 'บันทึกการแก้ไข'; }
        return;
      }
      // เพิ่มใหม่: แสดงในรายการทันที ล้างฟอร์มให้กรอกคนถัดไป แล้วส่งหลังบ้านเบื้องหลัง
      const tmp = Object.assign({ id: 'tmp' + Date.now() + Math.random().toString(36).slice(2, 5), tripId: t.id, checkedIn: false, checkedAt: 0, createdAt: Date.now(), _tmp: true }, v);
      state.people.push(tmp); updateUI();
      onDone && onDone();
      toast('บันทึก: ' + v.name);
      pending++;
      api('personSave', { person: Object.assign({ tripId: t.id }, v) })
        .then(j => { const i = state.people.indexOf(tmp); if (i >= 0) state.people[i] = j.person; else upsert(state.people, j.person); })
        .catch(x => { const i = state.people.indexOf(tmp); if (i >= 0) state.people.splice(i, 1); toast('บันทึก "' + v.name + '" ไม่สำเร็จ: ' + thaiErr(x) + ' กรุณากรอกใหม่', true); })
        .finally(() => { pending--; updateUI(); });
    }
  },
    h('label', null, 'ชื่อ-นามสกุล'), f.name, errs.name,
    h('label', null, 'ที่อยู่'), f.addr, errs.addr,
    h('label', null, 'เบอร์โทร'), f.phone, errs.phone,
    h('label', null, 'หมายเหตุ ', h('small', null, '(ไม่บังคับ)')), f.note, saveBtn);
  root.reset2 = () => { f.name.value = f.addr.value = f.phone.value = f.note.value = ''; Object.values(errs).forEach(x => x.textContent = ''); };
  root.focusName = () => f.name.focus();
  return root;
}
function buildAddPane(pane) {
  const form = personForm(null, () => { form.reset2(); form.focusName(); });
  ui.focusName = () => form.focusName();
  pane.append(h('div', { class: 'card' }, form));
}
function matchesPerson(p) {
  const q = state.q.trim().toLowerCase();
  if (state.filter === 'in' && !p.checkedIn) return false;
  if (state.filter === 'out' && p.checkedIn) return false;
  if (!q) return true;
  const dq = digits(q);
  return (p.name || '').toLowerCase().includes(q) || (dq && digits(p.phone).includes(dq));
}
function tripRows() {
  return state.people.filter(p => p.tripId === state.tripId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
async function delPerson(p) {
  if (!(await confirmBox('ลบรายชื่อนี้?', 'ลบ "' + p.name + '" ออกจากรอบนี้ การลบกู้คืนไม่ได้', 'ลบ', true))) return;
  try {
    await mutate(() => api('personDelete', { id: p.id }));
    state.people = state.people.filter(x => x.id !== p.id); updateUI(); toast('ลบแล้ว');
  } catch (x) { toast(thaiErr(x), true); }
}
function buildListPane(pane) {
  const stats = h('div', { class: 'stats' });
  const search = h('input', { type: 'search', placeholder: 'ค้นหาชื่อหรือเบอร์โทร', 'aria-label': 'ค้นหาชื่อหรือเบอร์โทร', value: state.q, oninput: e => { state.q = e.target.value; renderRows(); } });
  const seg = h('div', { class: 'seg' });
  const rows = h('tbody');
  const emptyBox = h('div');
  const table = h('table', null, h('thead', null, h('tr', null, ['ลำดับ', 'ชื่อ-นามสกุล', 'ที่อยู่', 'เบอร์โทร', 'เวลาที่บันทึก', '', 'เช็คอิน'].map(x => h('th', null, x)))), rows);

  function edit(p) {
    if (p._tmp) return;
    const c = modal('แก้ไขข้อมูล', h('div', null, personForm(p, () => c()),
      h('button', { class: 'btn danger block', style: 'margin-top:12px', onclick: () => { c(); delPerson(p); } }, 'ลบรายชื่อนี้')), null);
  }
  function renderRows() {
    const all = tripRows();
    const shown = all.map((p, i) => ({ p, i: i + 1 })).filter(x => matchesPerson(x.p));
    rows.replaceChildren(...shown.map(({ p, i }) => h('tr', { class: 'p' + (p.checkedIn ? ' in' : '') + (p._tmp ? ' tmp' : '') },
      h('td', { class: 'no' }, i),
      h('td', { class: 'nm' }, h('button', { class: 'namebtn', 'aria-label': 'แก้ไข ' + p.name, onclick: () => edit(p) }, p.name)),
      h('td', { class: 'ad', onclick: () => edit(p) }, p.address),
      h('td', { class: 'ph' }, h('a', { href: 'tel:' + digits(p.phone), 'aria-label': 'โทรหา ' + p.name }, fmtPhone(p.phone))),
      h('td', { class: 'tm' }, fmtT(p.createdAt), p.note ? ' · ' + p.note : ''),
      h('td', { class: 'ac' },
        h('button', { class: 'btn ghost sm', onclick: () => edit(p) }, 'แก้ไข'),
        h('button', { class: 'btn danger sm', onclick: () => !p._tmp && delPerson(p) }, 'ลบ')),
      h('td', { class: 'st' }, h('button', {
        class: 'chk' + (p.checkedIn ? ' on' : ''), 'aria-pressed': !!p.checkedIn, disabled: !!p._tmp, onclick: async () => {
          const nv = !p.checkedIn; p.checkedIn = nv; p.checkedAt = nv ? Date.now() : 0; updateUI();
          try { await mutate(() => api('checkin', { id: p.id, value: nv })); }
          catch (x) { p.checkedIn = !nv; updateUI(); toast(thaiErr(x), true); }
        }
      }, p.checkedIn ? [icon('check'), 'มา'] : 'ไม่มา')))));
    table.hidden = !shown.length;
    emptyBox.replaceChildren(...(!shown.length ? [h('div', { class: 'empty' }, all.length ? [h('b', null, 'ไม่พบรายชื่อที่ค้นหา'), 'ลองเปลี่ยนคำค้นหรือตัวกรอง'] : [h('b', null, 'ยังไม่มีรายชื่อในรอบนี้'), 'ไปที่แท็บ "เพิ่มรายชื่อ" เพื่อบันทึกคนแรก'])] : []));
  }
  ui.updateList = () => {
    const t = currentTrip(); if (!t) return;
    const all = tripRows(), inn = all.filter(p => p.checkedIn).length;
    stats.replaceChildren(...[['ทั้งหมด', all.length], ['มาแล้ว', inn], ['ยังไม่มา', all.length - inn], ['ที่นั่งเหลือ', Math.max(0, t.capacity - all.length)]].map(([l, n]) => h('div', null, h('b', null, n), h('span', null, l))));
    seg.replaceChildren(...[['all', 'ทั้งหมด'], ['out', 'ยังไม่มา'], ['in', 'มาแล้ว']].map(([k, l]) => h('button', { 'aria-pressed': state.filter === k, onclick: () => { state.filter = k; ui.updateList(); } }, l)));
    renderRows();
  };
  const tools = h('div', { class: 'tools' },
    h('button', { class: 'btn ghost sm', onclick: exportCsv }, 'ส่งออก CSV (เปิดใน Excel ได้)'),
    h('button', { class: 'btn ghost sm', onclick: copyList }, 'คัดลอกรายชื่อ'),
    h('button', { class: 'btn ghost sm', onclick: () => window.print() }, 'พิมพ์'),
    h('button', { class: 'btn danger sm', onclick: deleteTrip }, 'ลบรอบนี้'));
  pane.append(stats, h('div', { class: 'listbar' }, search), seg, emptyBox, table, tools);
}

/* ---------- ส่งออก / คัดลอก / ลบรอบ ---------- */
function exportCsv() {
  const t = currentTrip();
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const head = ['ลำดับ', 'ชื่อ-นามสกุล', 'ที่อยู่', 'เบอร์โทร', 'หมายเหตุ', 'สถานะ', 'เวลาที่บันทึก'];
  const lines = [head.map(q).join(',')].concat(tripRows().filter(p => !p._tmp).map((p, i) =>
    [q(i + 1), q(p.name), q(p.address), '="' + digits(p.phone) + '"', q(p.note || ''), q(p.checkedIn ? 'มาแล้ว' : 'ยังไม่มา'), q(p.createdAt ? new Date(p.createdAt).toLocaleString('th-TH') : '')].join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'รายชื่อ-' + t.name.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) + '.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('ส่งออกไฟล์ CSV แล้ว');
}
async function copyList() {
  const txt = tripRows().map((p, i) => (i + 1) + '. ' + p.name + '\t' + fmtPhone(p.phone) + '\t' + p.address + (p.checkedIn ? '\t(มาแล้ว)' : '')).join('\n');
  try { await navigator.clipboard.writeText(txt); toast('คัดลอกรายชื่อแล้ว'); } catch (e) {
    const ta = h('textarea', { readonly: true, style: 'min-height:200px' }); ta.value = txt;
    modal('คัดลอกรายชื่อ', h('div', { style: 'margin-top:10px' }, h('p', { class: 'hint' }, 'เลือกข้อความทั้งหมดแล้วคัดลอกเอง'), ta), close => [h('button', { class: 'btn ghost', onclick: close }, 'ปิด')], { focus: false });
    ta.select();
  }
}
async function deleteTrip() {
  const t = currentTrip(), ps = tripRows();
  if (!(await confirmBox('ลบรอบ "' + t.name + '"?', 'จะลบรอบนี้พร้อมรายชื่อ ' + ps.length + ' คน การลบกู้คืนไม่ได้', 'ลบรอบนี้', true))) return;
  try {
    await mutate(() => api('tripDelete', { id: t.id }));
    state.trips = state.trips.filter(x => x.id !== t.id); state.people = state.people.filter(x => x.tripId !== t.id);
    toast('ลบรอบแล้ว'); goHome();
  } catch (e) { toast(thaiErr(e), true); }
}

/* ---------- เริ่มทำงาน + PWA ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
boot();
