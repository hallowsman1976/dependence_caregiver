<script>
/* =====================================================
   GLOBAL STATE
   ===================================================== */
let session = null;            // { token, user }
let currentPage = 'dashboard';
let cacheCaregivers = [];
let cachePatients = [];
let cacheAssigned = [];

// Multi-step state
let currentCareStep = 1;
const totalCareSteps = 8;
let careRecordDraft = {};
let selectedPatient = null;
let signaturePad = null;
let isSubmittingCare = false;

// Image uploads (base64 cache)
let olderImageBase64 = null;
let serviceImagesBase64 = [];   // [{base64, name}]
let patientPhotoBase64 = null;

const STEP_NAMES = [
  'ประเมินสุขภาพแรกรับ',
  'สัญญาณชีพ',
  'การประเมินสุขภาพจิต',
  'กิจกรรมช่วยเหลือประจำวัน',
  'กิจกรรมสุขภาพพื้นฐาน',
  'กิจกรรมการดูแลด้านอื่น ๆ',
  'อัปโหลดภาพและลายเซ็น',
  'ตรวจสอบข้อมูลก่อนบันทึก'
];

const ACTIVITY_LIST = {
  step4: [
    'การเปลี่ยนผ้าอ้อม/แผ่นรองซับ',
    'การพลิกตะแคงตัว',
    'การจัดท่านอนป้องกันแผลกดทับ/ป้องกันเท้าตก',
    'การเคลื่อนย้ายผู้สูงอายุบนเตียง/ที่นอน รวมถึงการช่วยเคลื่อนย้ายจากจุดหนึ่งไปยังอีกจุดหนึ่ง',
    'ไม่ได้ดำเนินกิจกรรมในหมวดนี้'
  ],
  step5: [
    'การประเมินภาวะซึมเศร้า',
    'การประเมินสัญญาณชีพ วัดความดันโลหิต อุณหภูมิ หายใจ ชีพจร',
    'การทำแผล',
    'การดูแลสายสวนต่างๆ ให้สะอาดและอยู่ในตำแหน่งที่เหมาะสม',
    'การนวดผ่อนคลายกล้ามเนื้อและกระตุ้นระบบไหลเวียน',
    'การบริหารข้อและกล้ามเนื้อ',
    'การฝึกทรงตัว/การฝึกเดิน',
    'สมาธิบำบัด',
    'การฝึกหายใจ',
    'ไม่ได้ดำเนินกิจกรรมในหมวดนี้'
  ],
  step6: [
    'ดูแลสถานที่อยู่อาศัยของผู้สูงอายุให้สะอาด ปลอดภัย และมีอากาศถ่ายเทได้สะดวก',
    'การให้คำปรึกษาด้านสุขภาพแก่ผู้สูงอายุ',
    'การให้คำปรึกษาด้านสุขภาพแก่ครอบครัว/ผู้ดูแลผู้สูงอายุ',
    'การอ่านหนังสือ/บทสวดมนต์ หรือเอกสารอื่นๆ ที่เป็นประโยชน์ให้ผู้สูงอายุฟัง',
    'การช่วยพาไปพบแพทย์/บุคลากรสาธารณสุข ตามนัดหรือตามความจำเป็น',
    'ช่วยบุคลากรสาธารณสุขในการทำหัตถการต่างๆ ในผู้สูงอายุ',
    'ประสานการเบิกจ่ายวัสดุอุปกรณ์การแพทย์ จาก รพ./รพ.สต. ให้ผู้สูงอายุ',
    'ประสานบุคลากรสาธารณสุขเพื่อให้การช่วยเหลือกรณีฉุกเฉินเร่งด่วนต่างๆ',
    'ไม่ได้ดำเนินกิจกรรมในหมวดนี้'
  ]
};

const NO_ACTIVITY_TEXT = 'ไม่ได้ดำเนินกิจกรรมในหมวดนี้';


/* =====================================================
   1. APP INIT & UI HELPERS
   ===================================================== */
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  bindLoginEvents();
  bindUIEvents();
  renderActivityCards();
  setupReportControls();

  // ตรวจ session ใน sessionStorage
  const saved = sessionStorage.getItem('care_session');
  if (saved) {
    try {
      session = JSON.parse(saved);
      enterApp();
      return;
    } catch (e) { sessionStorage.removeItem('care_session'); }
  }
  $('#loginPage').classList.remove('hidden');
}

function $(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

function showLoading(text) {
  $('#loadingText').textContent = text || 'กำลังโหลด...';
  $('#loadingOverlay').classList.remove('hidden');
}
function hideLoading() { $('#loadingOverlay').classList.add('hidden'); }

function showToast(icon, title) {
  Swal.fire({
    toast: true, position: 'top', icon: icon, title: title,
    showConfirmButton: false, timer: 2200, timerProgressBar: true
  });
}
function showAlert(icon, title, text) {
  return Swal.fire({ icon: icon, title: title, text: text, confirmButtonText: 'ตกลง' });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function debounce(fn, ms) {
  let t;
  return function() {
    const ctx = this, args = arguments;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), ms);
  };
}

/* =====================================================
    2.SERVER CALL — ผ่าน fetch ไป Apps Script
   ===================================================== */

async function callServer(functionName, ...args) {
  if (!APP_CONFIG.API_URL || APP_CONFIG.API_URL.includes('YOUR-DEPLOYMENT-ID')) {
    throw new Error('ยังไม่ได้ตั้ง API_URL ใน config.js');
  }

  // ⭐ แยก token ออกจาก args (function ส่วนใหญ่รับ token เป็น arg ตัวแรก)
  const noTokenActions = ['login', 'getSystemSettings'];
  let token = null;
  let params = args;

  if (!noTokenActions.includes(functionName)) {
    token = args[0] || (session && session.token);
    params = args.slice(1);
  }

  const body = {
    action: functionName,
    token: token,
    params: params
  };

  if (APP_CONFIG.DEBUG) {
    console.log('[API] →', functionName, body);
  }

  try {
    const res = await fetch(APP_CONFIG.API_URL, {
      method: 'POST',
      // ⭐ ใช้ text/plain เพื่อหลบ CORS preflight (Apps Script ไม่ support OPTIONS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }

    const result = await res.json();

    if (APP_CONFIG.DEBUG) {
      console.log('[API] ←', functionName, result);
    }

    // ตรวจ session หมดอายุ
    if (result && result.success === false) {
      const msg = result.message || '';
      if (msg.indexOf('Session หมดอายุ') >= 0 || msg.indexOf('ไม่พบ session') >= 0) {
        handleSessionExpired(msg);
      }
      throw new Error(msg || 'เกิดข้อผิดพลาด');
    }

    return result;

  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
      throw new Error('เชื่อมต่อ API ไม่ได้ - ตรวจสอบ URL หรือเครือข่ายอินเทอร์เน็ต');
    }
    throw err;
  }
}

function handleSessionExpired(message) {
  if (handleSessionExpired._handling) return;
  handleSessionExpired._handling = true;

  sessionStorage.removeItem('care_session');
  session = null;

  Swal.fire({
    icon: 'warning',
    title: 'Session หมดอายุ',
    text: 'กรุณาเข้าสู่ระบบใหม่',
    confirmButtonText: 'เข้าสู่ระบบใหม่',
    confirmButtonColor: '#2563EB',
    allowOutsideClick: false
  }).then(() => {
    resetToLoginPage();
    handleSessionExpired._handling = false;
  });
}
/* =====================================================
   3. AUTHENTICATION
   ===================================================== */
function bindLoginEvents() {
  const form = $('#loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await login();
  });
  $('#togglePwd').addEventListener('click', () => {
    const inp = $('#loginPassword');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
}

async function login() {
  const u = $('#loginUsername').value.trim();
  const p = $('#loginPassword').value;
  if (!u || !p) return showAlert('warning', 'กรุณากรอกข้อมูล', 'ใส่ชื่อผู้ใช้และรหัสผ่านให้ครบ');

  showLoading('กำลังเข้าสู่ระบบ...');
  try {
    const res = await callServer('login', u, p);
    session = res.data;
    sessionStorage.setItem('care_session', JSON.stringify(session));

    // ⭐ ตรวจ Bootstrap Mode
    if (session.bootstrap) {
      hideLoading();
      await Swal.fire({
        icon: 'warning',
        title: '⚠️ โหมดติดตั้งครั้งแรก',
        html: `<div class="text-left text-sm">
          <p class="mb-2">ระบบยังไม่ได้เชื่อมต่อ Supabase</p>
          <p class="font-medium text-amber-700">กรุณาทำตามขั้นตอน:</p>
          <ol class="list-decimal ml-5 mt-2 space-y-1 text-slate-700">
            <li>ไปเมนู "ตั้งค่าระบบ" → แท็บ "Config ระบบ"</li>
            <li>กรอก Supabase URL + Service Role Key</li>
            <li>ทดสอบการเชื่อมต่อ → บันทึก</li>
            <li>ออกจากระบบ → Login ใหม่</li>
          </ol>
        </div>`,
        confirmButtonText: 'ไปตั้งค่าเลย',
        confirmButtonColor: '#F59E0B'
      });
      enterApp();
      showPage('settings');
      // เปิดแท็บ Config อัตโนมัติ
      setTimeout(() => switchSettingsTab('config'), 300);
    } else {
      showToast('success', 'เข้าสู่ระบบสำเร็จ');
      enterApp();
    }
  } catch (err) {
    showAlert('error', 'เข้าสู่ระบบไม่สำเร็จ', err.message);
  } finally { hideLoading(); }
}

async function logout() {
  const c = await Swal.fire({
    icon: 'question',
    title: 'ออกจากระบบ?',
    text: 'คุณต้องการออกจากระบบใช่หรือไม่',
    showCancelButton: true,
    confirmButtonText: 'ออกจากระบบ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#EF4444'
  });
  if (!c.isConfirmed) return;

  showLoading('กำลังออกจากระบบ...');
  try {
    if (session && session.token) {
      await callServer('logout', session.token);
    }
  } catch (e) {
    console.warn('Logout API error (ignored):', e);
  }

  // เคลียร์ session storage
  sessionStorage.removeItem('care_session');
  session = null;

  // เคลียร์ cache ทั้งหมด
  cacheCaregivers = [];
  cachePatients = [];
  cacheAssigned = [];
  selectedPatient = null;
  careRecordDraft = {};

  // ⭐ Reset UI กลับไปหน้า Login (ไม่ใช้ reload เพื่อหลบปัญหา iframe)
  resetToLoginPage();

  hideLoading();
  showToast('success', 'ออกจากระบบแล้ว');
}

/**
 * Reset UI กลับไปหน้า Login โดยไม่ reload หน้า
 */
function resetToLoginPage() {
  // ซ่อน app shell
  $('#appShell').classList.add('hidden');

  // เคลียร์ form login
  $('#loginUsername').value = '';
  $('#loginPassword').value = '';
  $('#loginPassword').type = 'password';

  // ปิด modal ทั้งหมด
  ['caregiverModal','patientModal','assignmentModal','historyModal','careRecordModal','imageViewer'].forEach(id => {
    const el = $('#' + id);
    if (el) el.classList.add('hidden');
  });
  document.body.style.overflow = '';

  // ปิด sidebar mobile
  $('#sidebar').classList.add('-translate-x-full');
  $('#sidebarBackdrop').classList.add('hidden');

  // เคลียร์ menu/dashboard
  $('#menuList').innerHTML = '';
  $('#bottomNavList').innerHTML = '';
  $('#dashboardCards').innerHTML = '';

  // เคลียร์ list ต่างๆ
  ['caregiverList','patientList','assignmentList','myPatientList','reportTbody'].forEach(id => {
    const el = $('#' + id);
    if (el) el.innerHTML = '';
  });

  // Reset header
  $('#topUserName').textContent = '-';
  $('#sideUserName').textContent = '-';
  $('#sideUserRole').textContent = '-';
  $('#pageTitle').textContent = 'หน้าหลัก';

  // แสดงหน้า Login
  $('#loginPage').classList.remove('hidden');

  // Scroll กลับขึ้นบน
  window.scrollTo(0, 0);

  // Re-render icons
  if (window.lucide) lucide.createIcons();

  // Focus ที่ช่อง username
  setTimeout(() => $('#loginUsername').focus(), 100);
}

function enterApp() {
  $('#loginPage').classList.add('hidden');
  $('#appShell').classList.remove('hidden');

  const u = session.user;
  $('#topUserName').textContent = u.displayName;
  $('#sideUserName').textContent = u.displayName;
  $('#sideUserRole').textContent = u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ดูแล (Care Giver)';

  buildMenuByRole(u.role);
  if (u.role === 'admin') showPage('dashboard');
  else showPage('myPatients');

  if (window.lucide) lucide.createIcons();
}


/* =====================================================
   4. NAVIGATION & MENU
   ===================================================== */
const ADMIN_MENU = [
  { key: 'dashboard',   icon: 'layout-dashboard', label: 'แดชบอร์ด' },
  { key: 'caregivers',  icon: 'users',            label: 'ผู้ดูแล' },
  { key: 'patients',    icon: 'user-round',       label: 'ผู้ป่วย' },
  { key: 'assignments', icon: 'user-plus',        label: 'มอบหมายการดูแล' },
  { key: 'reports',     icon: 'file-bar-chart',   label: 'รายงาน' },
  { key: 'settings',    icon: 'settings',         label: 'ตั้งค่าระบบ' }
];
const MEMBER_MENU = [
  { key: 'myPatients', icon: 'heart-handshake', label: 'ผู้ที่ฉันดูแล' },
  { key: 'reports',    icon: 'file-bar-chart',  label: 'รายงานของฉัน' }
];
const ADMIN_BOTTOM = ['dashboard','patients','assignments','reports'];
const MEMBER_BOTTOM = ['myPatients','reports'];

function buildMenuByRole(role) {
  const menu = role === 'admin' ? ADMIN_MENU : MEMBER_MENU;
  const ul = $('#menuList'); ul.innerHTML = '';
  menu.forEach(m => {
    const li = document.createElement('li');
    li.innerHTML = `<a class="menu-item" data-page="${m.key}">
      <i data-lucide="${m.icon}"></i><span>${m.label}</span></a>`;
    li.querySelector('a').addEventListener('click', () => showPage(m.key));
    ul.appendChild(li);
  });
  // Logout เพิ่มท้ายเมนู
  const logoutLi = document.createElement('li');
  logoutLi.className = 'mt-4 pt-3 border-t border-slate-100';
  logoutLi.innerHTML = `<a class="menu-item text-red-600 hover:!bg-red-50">
    <i data-lucide="log-out"></i><span>ออกจากระบบ</span></a>`;
  logoutLi.querySelector('a').addEventListener('click', logout);
  ul.appendChild(logoutLi);

  // Bottom Nav
  const bn = $('#bottomNavList'); bn.innerHTML = '';
  const bottomKeys = role === 'admin' ? ADMIN_BOTTOM : MEMBER_BOTTOM;
  const map = {};
  menu.forEach(m => map[m.key] = m);
  bottomKeys.forEach(k => {
    const m = map[k];
    if (!m) return;
    const li = document.createElement('li');
    li.innerHTML = `<a class="bottom-nav-item" data-page="${m.key}">
      <i data-lucide="${m.icon}"></i><span>${m.label.replace('การ','').replace('ของฉัน','')}</span></a>`;
    li.querySelector('a').addEventListener('click', () => showPage(m.key));
    bn.appendChild(li);
  });
  // เพิ่ม "เพิ่มเติม" สำหรับ admin (เปิด sidebar)
  if (role === 'admin') {
    const li = document.createElement('li');
    li.innerHTML = `<a class="bottom-nav-item">
      <i data-lucide="more-horizontal"></i><span>เพิ่มเติม</span></a>`;
    li.querySelector('a').addEventListener('click', () => toggleSidebar(true));
    bn.appendChild(li);
  }
}

function showPage(key) {
  currentPage = key;
  $$('.page').forEach(el => el.classList.add('hidden'));
  const page = $(`[data-page="${key}"].page`);
  if (page) page.classList.remove('hidden');

  // Active state
  $$('.menu-item[data-page]').forEach(el =>
    el.classList.toggle('menu-active', el.dataset.page === key));
  $$('.bottom-nav-item[data-page]').forEach(el =>
    el.classList.toggle('bn-active', el.dataset.page === key));

  // Page Title
  const titleMap = {
    dashboard:'แดชบอร์ด', caregivers:'ผู้ดูแล (Care Giver)', patients:'ผู้มีภาวะพึ่งพิง',
    assignments:'มอบหมายการดูแล', reports:'รายงาน', settings:'ตั้งค่าระบบ',
    myPatients:'ผู้ที่ฉันดูแล'
  };
  $('#pageTitle').textContent = titleMap[key] || '-';

  // ปิด sidebar mobile
  toggleSidebar(false);

  // โหลดข้อมูลตามหน้า
  if (key === 'dashboard') loadDashboardSummary();
  else if (key === 'caregivers') loadCaregivers();
  else if (key === 'patients') loadPatients();
  else if (key === 'assignments') loadAssignments();
  else if (key === 'myPatients') loadAssignedPatients();
  else if (key === 'reports') initReportPage();
  else if (key === 'settings') loadSettings();

  if (window.lucide) lucide.createIcons();
}

function toggleSidebar(force) {
  const sb = $('#sidebar'), bd = $('#sidebarBackdrop');
  const open = (force === true) ? true : (force === false ? false : sb.classList.contains('-translate-x-full'));
  if (open) { sb.classList.remove('-translate-x-full'); bd.classList.remove('hidden'); }
  else      { sb.classList.add('-translate-x-full');    bd.classList.add('hidden'); }
}


/* =====================================================
   5. UI EVENT BINDING
   ===================================================== */
function bindUIEvents() {
  // Sidebar toggle
  $('#sidebarToggle').addEventListener('click', () => toggleSidebar());
  $('#sidebarClose').addEventListener('click', () => toggleSidebar(false));
  $('#sidebarBackdrop').addEventListener('click', () => toggleSidebar(false));
  $('#topLogoutBtn').addEventListener('click', logout);

  // Modal close buttons
  $$('[data-close]').forEach(b => {
    b.addEventListener('click', () => closeModal(b.dataset.close));
  });
  $$('.modal-backdrop').forEach(b => {
    b.addEventListener('click', () => {
      const root = b.closest('.modal-root');
      // ห้ามปิด care record modal ด้วยการคลิก backdrop
      if (root && root.id !== 'careRecordModal') closeModal(root.id);
    });
  });

  // Caregiver
  $('#btnAddCaregiver').addEventListener('click', () => openCaregiverModal());
  $('#btnSaveCaregiver').addEventListener('click', saveCaregiver);
  $('#searchCaregiver').addEventListener('input', debounce(renderCaregiverList, 250));

  // Patient
  $('#btnAddPatient').addEventListener('click', () => openPatientModal());
  $('#btnSavePatient').addEventListener('click', savePatient);
  $('#searchPatient').addEventListener('input', debounce(renderPatientList, 250));
  $('#pPhotoInput').addEventListener('change', handlePatientPhotoChange);

  // Assignment
  $('#btnAddAssignment').addEventListener('click', openAssignModal);
  $('#btnSaveAssignment').addEventListener('click', saveAssignment);

  // My Patient search (member)
  $('#searchMyPatient').addEventListener('input', debounce(renderAssignedPatientCards, 250));

  // Settings
  $('#btnSaveSettings').addEventListener('click', saveSettings);

  // Multi-step
  $('#nextStepBtn').addEventListener('click', nextCareStep);
  $('#prevStepBtn').addEventListener('click', prevCareStep);
  $('#submitCareRecordBtn').addEventListener('click', submitCareRecord);

  // Step 1 BMI
  $('#crWeight').addEventListener('input', calculateBMI);
  $('#crHeight').addEventListener('input', calculateBMI);

  // Step 2 BP toggle
  $('#crBpEnabled').addEventListener('change', (e) => {
    $('#bpFields').classList.toggle('hidden', !e.target.checked);
  });

  // Step 3 mental
  $$('input[name="cr2q"]').forEach(r => r.addEventListener('change', handleTwoQChange));
  $('#cr9qScore').addEventListener('input', () => { interpret9Q(); toggle8QBy9Q(); });
  $('#cr8qScore').addEventListener('input', interpret8Q);

  // Step 7 images
  $('#olderFile').addEventListener('change', handleOlderImagePreview);
  $('#serviceFiles').addEventListener('change', handleServiceImagesPreview);
  $('#btnClearSig').addEventListener('click', clearSignature);

  // Image viewer
  $('#closeViewer').addEventListener('click', () => $('#imageViewer').classList.add('hidden'));

  // Report tabs
  $$('.report-tab').forEach(b => b.addEventListener('click', () => switchReportTab(b.dataset.rtab)));
  $('#btnLoadDaily').addEventListener('click', loadDailyReport);
  $('#btnLoadMonthly').addEventListener('click', loadMonthlyReport);
  $('#btnExportCsv').addEventListener('click', exportCSV);
  $('#btnPrintReport').addEventListener('click', printReport);
}

function openModal(id)  { $('#'+id).classList.remove('hidden'); document.body.style.overflow='hidden'; if(window.lucide)lucide.createIcons(); }
function closeModal(id) { $('#'+id).classList.add('hidden');    document.body.style.overflow=''; }


/* =====================================================
   6. DASHBOARD
   ===================================================== */
async function loadDashboardSummary() {
  const role = session.user.role;
  showLoading();
  try {
    const res = await callServer('getDashboardSummary', session.token);
    const d = res.data;
    const cards = $('#dashboardCards');
    if (role === 'admin') {
      cards.innerHTML = renderDashCard('users','color-blue', d.totalCaregivers, 'ผู้ดูแลทั้งหมด')
                     + renderDashCard('user-round','color-sky', d.totalPatients, 'ผู้มีภาวะพึ่งพิง')
                     + renderDashCard('clipboard-check','color-green', d.todayRecords, 'บันทึกวันนี้')
                     + renderDashCard('calendar','color-amber', d.monthRecords, 'บันทึกเดือนนี้');
      $('#dashboardHint').textContent = 'จัดการ Care Giver, Patient, มอบหมายงาน และดูรายงานได้จากเมนูด้านข้าง';
    } else {
      cards.innerHTML = renderDashCard('heart-handshake','color-blue', d.assignedPatients, 'ผู้ที่ฉันดูแล')
                     + renderDashCard('clipboard-check','color-green', d.todayRecords, 'บันทึกวันนี้')
                     + renderDashCard('calendar','color-amber', d.monthRecords, 'บันทึกเดือนนี้');
      $('#dashboardHint').textContent = 'แตะที่การ์ดผู้ป่วยในเมนู "ผู้ที่ฉันดูแล" เพื่อบันทึกการดูแลหรือดูประวัติ';
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) { showAlert('error', 'โหลดข้อมูลล้มเหลว', err.message); }
  finally { hideLoading(); }
}

function renderDashCard(icon, color, value, label) {
  return `<div class="dash-card ${color}">
    <div class="dash-icon"><i data-lucide="${icon}"></i></div>
    <div class="dash-value">${Number(value||0).toLocaleString('th-TH')}</div>
    <div class="dash-label">${label}</div>
  </div>`;
}


/* =====================================================
   7. CAREGIVER CRUD
   ===================================================== */
async function loadCaregivers() {
  showLoading();
  try {
    const res = await callServer('getCaregivers', session.token);
    cacheCaregivers = res.data || [];
    renderCaregiverList();
  } catch (err) { showAlert('error', 'ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

function renderCaregiverList() {
  const q = ($('#searchCaregiver').value || '').toLowerCase();
  const list = cacheCaregivers.filter(c => {
    if (!q) return true;
    return (c.cg_code||'').toLowerCase().includes(q) ||
           (c.fullname||'').toLowerCase().includes(q) ||
           (c.phone||'').toLowerCase().includes(q);
  });
  const wrap = $('#caregiverList');
  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p>ยังไม่มีข้อมูลผู้ดูแล</p></div>`;
  } else {
    wrap.innerHTML = list.map(c => `
      <div class="caregiver-card flex items-start gap-3">
        <div class="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
          <i data-lucide="user"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="cg-code-badge">${escapeHtml(c.cg_code)}</span>
            ${c.active ? '<span class="status-pill active">ใช้งาน</span>' : '<span class="status-pill inactive">ปิด</span>'}
          </div>
          <p class="font-medium text-slate-800 mt-1">${escapeHtml(c.fullname)}</p>
          <p class="text-xs text-slate-500">${escapeHtml(c.phone||'-')} · บ้านเลขที่ ${escapeHtml(c.house_no||'-')} หมู่ ${escapeHtml(c.moo||'-')}</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <button class="btn-icon btn-icon-primary" title="แก้ไข" onclick="editCaregiver('${c.id}')"><i data-lucide="pencil"></i></button>
          <button class="btn-icon" title="รีเซ็ตรหัสผ่าน" onclick="resetCaregiverPassword('${c.id}')"><i data-lucide="key-round"></i></button>
          <button class="btn-icon btn-icon-danger" title="ลบ" onclick="deleteCaregiver('${c.id}')"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`).join('');
  }
  if (window.lucide) lucide.createIcons();
}

function openCaregiverModal(cg) {
  $('#caregiverModalTitle').textContent = cg ? 'แก้ไขผู้ดูแล' : 'เพิ่มผู้ดูแล';
  $('#cgId').value       = cg ? cg.id : '';
  $('#cgCode').value     = cg ? cg.cg_code : '(สร้างอัตโนมัติเมื่อบันทึก)';
  $('#cgFullname').value = cg ? cg.fullname : '';
  $('#cgCid').value      = cg ? cg.cid : '';
  $('#cgHouseNo').value  = cg ? (cg.house_no||'') : '';
  $('#cgMoo').value      = cg ? (cg.moo||'') : '';
  $('#cgPhone').value    = cg ? (cg.phone||'') : '';
  openModal('caregiverModal');
}

function editCaregiver(id) {
  const cg = cacheCaregivers.find(c => c.id === id);
  if (cg) openCaregiverModal(cg);
}

async function saveCaregiver() {
  const id = $('#cgId').value;
  const data = {
    fullname: $('#cgFullname').value.trim(),
    cid: $('#cgCid').value.trim(),
    house_no: $('#cgHouseNo').value.trim(),
    moo: $('#cgMoo').value.trim(),
    phone: $('#cgPhone').value.trim()
  };
  if (!data.fullname) return showAlert('warning', 'ข้อมูลไม่ครบ', 'กรุณากรอกชื่อ-สกุล');
  if (!validateCID(data.cid)) return showAlert('warning', 'เลขบัตรไม่ถูกต้อง', 'กรุณาตรวจสอบเลขบัตรประชาชน 13 หลัก');
  if (data.phone && !validatePhone(data.phone)) return showAlert('warning', 'เบอร์โทรไม่ถูกต้อง', 'ต้องเป็นตัวเลข 9-10 หลัก');

  showLoading('กำลังบันทึก...');
  try {
    if (id) {
      await callServer('updateCaregiver', session.token, id, data);
      showToast('success', 'แก้ไขข้อมูลสำเร็จ');
    } else {
      const res = await callServer('createCaregiver', session.token, data);
      const d = res.data;
      Swal.fire({
        icon: 'success', title: 'เพิ่มผู้ดูแลสำเร็จ',
        html: `<div class="text-left text-sm leading-relaxed">
          รหัส CG: <b>${d.defaultUsername}</b><br>
          Username: <b>${d.defaultUsername}</b><br>
          รหัสผ่านเริ่มต้น: <b>${d.defaultPassword}</b><br>
          <small class="text-slate-500">โปรดบันทึกข้อมูลนี้และแจ้งผู้ดูแลเพื่อเข้าสู่ระบบ</small>
        </div>`
      });
    }
    closeModal('caregiverModal');
    loadCaregivers();
  } catch (err) { showAlert('error', 'บันทึกไม่สำเร็จ', err.message); }
  finally { hideLoading(); }
}

async function deleteCaregiver(id) {
  const c = await Swal.fire({
    icon: 'warning', title: 'ลบผู้ดูแลรายนี้?', text: 'การมอบหมายและบัญชีผู้ใช้จะถูกระงับ',
    showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#EF4444'
  });
  if (!c.isConfirmed) return;
  showLoading();
  try {
    await callServer('deleteCaregiver', session.token, id);
    showToast('success', 'ลบสำเร็จ'); loadCaregivers();
  } catch (err) { showAlert('error', 'ลบไม่สำเร็จ', err.message); }
  finally { hideLoading(); }
}

async function resetCaregiverPassword(id) {
  const c = await Swal.fire({
    icon: 'question', title: 'รีเซ็ตรหัสผ่าน?',
    text: 'รหัสผ่านใหม่จะเป็น 4 ตัวท้ายของเลขบัตรประชาชน',
    showCancelButton: true, confirmButtonText: 'รีเซ็ต', cancelButtonText: 'ยกเลิก'
  });
  if (!c.isConfirmed) return;
  showLoading();
  try {
    const res = await callServer('resetMemberPassword', session.token, id);
    Swal.fire({ icon:'success', title:'รีเซ็ตสำเร็จ', html:`รหัสผ่านใหม่: <b>${res.data.newPassword}</b>` });
  } catch (err) { showAlert('error', 'รีเซ็ตไม่สำเร็จ', err.message); }
  finally { hideLoading(); }
}


/* =====================================================
   8. PATIENT CRUD
   ===================================================== */
async function loadPatients() {
  showLoading();
  try {
    const [pRes, cRes] = await Promise.all([
      callServer('getPatients', session.token),
      callServer('getCaregivers', session.token)
    ]);
    cachePatients = pRes.data || [];
    cacheCaregivers = cRes.data || [];
    renderPatientList();
  } catch (err) { showAlert('error', 'ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

function renderPatientList() {
  const q = ($('#searchPatient').value || '').toLowerCase();
  const list = cachePatients.filter(p => {
    if (!q) return true;
    return (p.cid||'').toLowerCase().includes(q) ||
           (p.fullname||'').toLowerCase().includes(q) ||
           (String(p.moo||'')).toLowerCase().includes(q);
  });
  const wrap = $('#patientList');
  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state col-span-full"><i data-lucide="inbox"></i><p>ยังไม่มีข้อมูลผู้ป่วย</p></div>`;
  } else {
    wrap.innerHTML = list.map(p => `
      <div class="patient-card">
        <div class="flex items-start gap-3">
          ${p.photo_url
            ? `<img src="${escapeHtml(p.photo_url)}" class="pc-photo" onclick="viewImage('${escapeHtml(p.photo_url)}')">`
            : `<div class="pc-avatar">${escapeHtml((p.fullname||'?').charAt(0))}</div>`}
          <div class="flex-1 min-w-0">
            <p class="pc-name">#${p.running_no||'-'} ${escapeHtml(p.fullname)}</p>
            <p class="pc-meta">${escapeHtml(p.gender||'-')} · อายุ ${calculateAge(p.birthdate)||'-'} ปี</p>
            <p class="pc-meta truncate">บ้านเลขที่ ${escapeHtml(p.house_no||'-')} หมู่ ${escapeHtml(p.moo||'-')}</p>
            <p class="pc-meta truncate text-brand-600 mt-1">
              <i data-lucide="user-round" class="w-3 h-3 inline"></i>
              ${p.caregiver ? escapeHtml(p.caregiver.fullname) : 'ยังไม่มอบหมาย'}
            </p>
          </div>
        </div>
        <div class="flex gap-2 mt-3 pt-3 border-t border-slate-100">
          <button class="btn-secondary flex-1 !py-1.5 !px-2 text-xs" onclick="viewPatientHistory('${p.id}','${escapeHtml(p.fullname)}')">
            <i data-lucide="history" class="w-4 h-4"></i> ประวัติ
          </button>
          <button class="btn-secondary !py-1.5 !px-2 text-xs" onclick="editPatient('${p.id}')">
            <i data-lucide="pencil" class="w-4 h-4"></i>
          </button>
          <button class="btn-secondary !py-1.5 !px-2 text-xs !text-red-600" onclick="deletePatient('${p.id}')">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>`).join('');
  }
  if (window.lucide) lucide.createIcons();
}

function openPatientModal(p) {
  $('#patientModalTitle').textContent = p ? 'แก้ไขผู้ป่วย' : 'เพิ่มผู้มีภาวะพึ่งพิง';
  $('#pId').value         = p ? p.id : '';
  $('#pRunningNo').value  = p ? (p.running_no||'') : '(สร้างอัตโนมัติ)';
  $('#pCid').value        = p ? p.cid : '';
  $('#pFullname').value   = p ? p.fullname : '';
  $('#pBirthdate').value  = p ? (p.birthdate||'') : '';
  $('#pGender').value     = p ? (p.gender||'') : '';
  $('#pHouseNo').value    = p ? (p.house_no||'') : '';
  $('#pMoo').value        = p ? (p.moo||'') : '';
  $('#pUd').value         = p ? (p.ud||'') : '';
  $('#pPhone').value      = p ? (p.phone||'') : '';

  // Caregiver dropdown
  const sel = $('#pCaregiverId');
  sel.innerHTML = '<option value="">- ไม่ระบุ -</option>' +
    cacheCaregivers.filter(c=>c.active).map(c =>
      `<option value="${c.id}" ${p && p.caregiver_id===c.id?'selected':''}>${escapeHtml(c.cg_code)} - ${escapeHtml(c.fullname)}</option>`
    ).join('');

  // Photo preview
  patientPhotoBase64 = null;
  $('#pPhotoInput').value = '';
  const img = $('#pPhotoPreview'), ph = $('#pPhotoPlaceholder');
  if (p && p.photo_url) {
    img.src = p.photo_url; img.classList.remove('hidden'); ph.classList.add('hidden');
  } else {
    img.src = ''; img.classList.add('hidden'); ph.classList.remove('hidden');
  }
  openModal('patientModal');
}

function editPatient(id) {
  const p = cachePatients.find(x => x.id === id);
  if (p) openPatientModal(p);
}

async function handlePatientPhotoChange(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 5*1024*1024) return showAlert('warning','ไฟล์ใหญ่เกินไป','ขนาดไฟล์ต้องไม่เกิน 5MB');
  const b64 = await convertFileToBase64(f, 1200, 0.8);
  patientPhotoBase64 = b64;
  $('#pPhotoPreview').src = b64;
  $('#pPhotoPreview').classList.remove('hidden');
  $('#pPhotoPlaceholder').classList.add('hidden');
}

async function savePatient() {
  const id = $('#pId').value;
  const data = {
    cid: $('#pCid').value.trim(),
    fullname: $('#pFullname').value.trim(),
    birthdate: $('#pBirthdate').value || null,
    gender: $('#pGender').value || null,
    house_no: $('#pHouseNo').value.trim(),
    moo: $('#pMoo').value.trim(),
    ud: $('#pUd').value.trim(),
    caregiver_id: $('#pCaregiverId').value || null,
    phone: $('#pPhone').value.trim()
  };
  if (!data.fullname) return showAlert('warning','ข้อมูลไม่ครบ','กรุณากรอกชื่อ-สกุล');
  if (!validateCID(data.cid)) return showAlert('warning','เลขบัตรไม่ถูกต้อง','ตรวจสอบเลขบัตรประชาชน 13 หลัก');
  if (data.phone && !validatePhone(data.phone)) return showAlert('warning','เบอร์โทรไม่ถูกต้อง','ต้องเป็นตัวเลข 9-10 หลัก');
  if (patientPhotoBase64) data.photo_base64 = patientPhotoBase64;

  showLoading('กำลังบันทึก...');
  try {
    if (id) await callServer('updatePatient', session.token, id, data);
    else    await callServer('createPatient', session.token, data);
    showToast('success', id?'แก้ไขสำเร็จ':'เพิ่มผู้ป่วยสำเร็จ');
    closeModal('patientModal'); loadPatients();
  } catch (err) { showAlert('error','บันทึกไม่สำเร็จ', err.message); }
  finally { hideLoading(); }
}

async function deletePatient(id) {
  const c = await Swal.fire({
    icon:'warning', title:'ลบผู้ป่วยรายนี้?', text:'การมอบหมายจะถูกยกเลิกด้วย',
    showCancelButton:true, confirmButtonText:'ลบ', cancelButtonText:'ยกเลิก', confirmButtonColor:'#EF4444'
  });
  if (!c.isConfirmed) return;
  showLoading();
  try {
    await callServer('deletePatient', session.token, id);
    showToast('success','ลบสำเร็จ'); loadPatients();
  } catch (err) { showAlert('error','ลบไม่สำเร็จ', err.message); }
  finally { hideLoading(); }
}

function viewImage(url) {
  $('#viewerImg').src = url;
  $('#imageViewer').classList.remove('hidden');
}


/* =====================================================
   9. ASSIGNMENT
   ===================================================== */
async function loadAssignments() {
  showLoading();
  try {
    const [aRes, cRes, pRes] = await Promise.all([
      callServer('getAssignments', session.token),
      callServer('getCaregivers',  session.token),
      callServer('getPatients',    session.token)
    ]);
    cacheCaregivers = cRes.data || [];
    cachePatients = pRes.data || [];

    const list = aRes.data || [];
    const wrap = $('#assignmentList');
    if (list.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p>ยังไม่มีการมอบหมาย</p></div>`;
    } else {
      wrap.innerHTML = list.map(a => `
        <div class="caregiver-card flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
            <i data-lucide="link"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-800 truncate">
              ${escapeHtml(a.caregiver?.fullname||'-')}
              <i data-lucide="arrow-right" class="w-4 h-4 inline mx-1 text-slate-400"></i>
              ${escapeHtml(a.patient?.fullname||'-')}
            </p>
            <p class="text-xs text-slate-500">CG: ${escapeHtml(a.caregiver?.cg_code||'-')} · ลำดับ #${a.patient?.running_no||'-'} · ${formatThaiDate(a.assigned_date)}</p>
          </div>
          <button class="btn-icon btn-icon-danger" onclick="cancelAssignment('${a.id}')" title="ยกเลิก">
            <i data-lucide="x"></i>
          </button>
        </div>`).join('');
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

function openAssignModal() {
  $('#asCaregiverId').innerHTML = '<option value="">- เลือกผู้ดูแล -</option>' +
    cacheCaregivers.filter(c=>c.active).map(c =>
      `<option value="${c.id}">${escapeHtml(c.cg_code)} - ${escapeHtml(c.fullname)}</option>`).join('');
  $('#asPatientId').innerHTML = '<option value="">- เลือกผู้ป่วย -</option>' +
    cachePatients.filter(p=>p.active!==false).map(p =>
      `<option value="${p.id}">#${p.running_no||'-'} ${escapeHtml(p.fullname)}</option>`).join('');
  openModal('assignmentModal');
}

async function saveAssignment() {
  const cg = $('#asCaregiverId').value, pt = $('#asPatientId').value;
  if (!cg || !pt) return showAlert('warning','ข้อมูลไม่ครบ','เลือกผู้ดูแลและผู้ป่วย');
  showLoading('กำลังมอบหมาย...');
  try {
    await callServer('assignPatient', session.token, cg, pt);
    showToast('success','มอบหมายสำเร็จ');
    closeModal('assignmentModal'); loadAssignments();
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

async function cancelAssignment(id) {
  const c = await Swal.fire({
    icon:'warning', title:'ยกเลิกการมอบหมาย?', showCancelButton:true,
    confirmButtonText:'ยกเลิกการมอบหมาย', cancelButtonText:'ปิด', confirmButtonColor:'#EF4444'
  });
  if (!c.isConfirmed) return;
  showLoading();
  try {
    await callServer('cancelAssignment', session.token, id);
    showToast('success','ยกเลิกสำเร็จ'); loadAssignments();
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}


/* =====================================================
   10. MEMBER: ASSIGNED PATIENTS
   ===================================================== */
async function loadAssignedPatients() {
  showLoading();
  try {
    const res = await callServer('getAssignedPatients', session.token);
    cacheAssigned = res.data || [];
    renderAssignedPatientCards();
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

function renderAssignedPatientCards() {
  const q = ($('#searchMyPatient').value || '').toLowerCase();
  const list = cacheAssigned.filter(p => {
    if (!q) return true;
    return (p.fullname||'').toLowerCase().includes(q) ||
           (p.cid||'').toLowerCase().includes(q);
  });
  const wrap = $('#myPatientList');
  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state col-span-full"><i data-lucide="user-x"></i><p>ยังไม่มีผู้ป่วยที่ได้รับมอบหมาย</p></div>`;
  } else {
    wrap.innerHTML = list.map(p => `
      <div class="patient-card">
        <div class="flex items-start gap-3">
          ${p.photo_url
            ? `<img src="${escapeHtml(p.photo_url)}" class="pc-photo">`
            : `<div class="pc-avatar">${escapeHtml((p.fullname||'?').charAt(0))}</div>`}
          <div class="flex-1 min-w-0">
            <p class="pc-name">${escapeHtml(p.fullname)}</p>
            <p class="pc-meta">${escapeHtml(p.gender||'-')} · อายุ ${calculateAge(p.birthdate)||'-'} ปี</p>
            <p class="pc-meta truncate">บ้านเลขที่ ${escapeHtml(p.house_no||'-')} หมู่ ${escapeHtml(p.moo||'-')}</p>
            ${p.ud ? `<p class="pc-meta truncate text-amber-600">โรค: ${escapeHtml(p.ud)}</p>` : ''}
          </div>
        </div>
        <div class="flex gap-2 mt-3 pt-3 border-t border-slate-100">
          <button class="btn-primary flex-1 !py-2 text-sm" onclick="openCareRecordForm('${p.id}')">
            <i data-lucide="clipboard-plus" class="w-4 h-4"></i> บันทึกการดูแล
          </button>
          <button class="btn-secondary !py-2 !px-3 text-sm" onclick="viewPatientHistory('${p.id}','${escapeHtml(p.fullname)}')">
            <i data-lucide="history" class="w-4 h-4"></i>
          </button>
        </div>
      </div>`).join('');
  }
  if (window.lucide) lucide.createIcons();
}


/* =====================================================
   11. PATIENT HISTORY
   ===================================================== */
async function viewPatientHistory(patientId, name) {
  $('#historyTitle').textContent = 'ประวัติการดูแล: ' + name;
  $('#historyList').innerHTML = '<div class="empty-state"><div class="skeleton h-20 mb-2"></div><div class="skeleton h-20"></div></div>';
  openModal('historyModal');
  try {
    const res = await callServer('getCareRecordByPatient', session.token, patientId);
    const list = res.data || [];
    if (list.length === 0) {
      $('#historyList').innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p>ยังไม่มีประวัติการดูแล</p></div>`;
    } else {
      $('#historyList').innerHTML = list.map(r => `
        <div class="history-card">
          <div class="flex items-center justify-between mb-2">
            <p class="font-semibold text-slate-800">${formatThaiDate(r.service_date)} ${(r.service_time||'').slice(0,5)}</p>
            <span class="text-xs text-brand-600">${escapeHtml(r.caregiver?.fullname||'-')}</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5 text-xs text-slate-600">
            <div>BMI: <b>${r.bmi||'-'}</b> (${escapeHtml(r.bmi_result||'-')})</div>
            <div>อุณหภูมิ: <b>${r.temperature||'-'}</b>°C</div>
            <div>ชีพจร: <b>${r.pulse||'-'}</b></div>
            <div>หายใจ: <b>${r.respiration||'-'}</b></div>
            ${r.bp_enabled ? `<div class="col-span-2">BP: <b>${r.bp_systolic}/${r.bp_diastolic}</b> mmHg</div>` : ''}
            <div>2Q: <b>${escapeHtml(r.twoq_result||'-')}</b></div>
            <div>9Q/8Q: <b>${r.nineq_score||'-'}/${r.eightq_score||'-'}</b></div>
          </div>
          ${r.note ? `<p class="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">${escapeHtml(r.note)}</p>` : ''}
        </div>`).join('');
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
}


/* =====================================================
   12. CARE RECORD MULTI-STEP — ENGINE
   ===================================================== */

/* 12.1 Render Activity Cards (Step 4-6) */
function renderActivityCards() {
  ['step4','step5','step6'].forEach(key => {
    const wrap = $('#'+key+'List');
    if (!wrap) return;
    wrap.innerHTML = ACTIVITY_LIST[key].map((txt, i) => `
      <label class="activity-card" data-group="${key}">
        <input type="checkbox" value="${escapeHtml(txt)}">
        <span class="ac-check"></span>
        <span class="ac-text">${escapeHtml(txt)}</span>
      </label>`).join('');
    // bind change
    $$('label.activity-card', wrap).forEach(el => {
      el.addEventListener('click', (e) => {
        // ถ้าเลือก "ไม่ได้ดำเนินกิจกรรม" ให้เคลียร์อย่างอื่น (และกลับกัน)
        const cb = el.querySelector('input[type="checkbox"]');
        const isNoAct = cb.value === NO_ACTIVITY_TEXT;
        // ใช้ setTimeout ให้ checkbox toggle เสร็จก่อน
        setTimeout(() => {
          el.classList.toggle('is-checked', cb.checked);
          if (cb.checked) {
            $$('label.activity-card', wrap).forEach(other => {
              const ocb = other.querySelector('input');
              if (other === el) return;
              if (isNoAct) { ocb.checked = false; other.classList.remove('is-checked'); }
              else if (ocb.value === NO_ACTIVITY_TEXT) { ocb.checked = false; other.classList.remove('is-checked'); }
            });
          }
        }, 0);
      });
    });
  });
}

/* 12.2 openCareRecordForm */
async function openCareRecordForm(patientId) {
  // หา patient จาก cache
  selectedPatient = cacheAssigned.find(p => p.id === patientId)
                  || cachePatients.find(p => p.id === patientId);
  if (!selectedPatient) {
    showLoading('กำลังโหลดข้อมูล...');
    try {
      const res = await callServer('getAssignedPatients', session.token);
      cacheAssigned = res.data || [];
      selectedPatient = cacheAssigned.find(p => p.id === patientId);
    } catch (err) { hideLoading(); return showAlert('error','ผิดพลาด', err.message); }
    hideLoading();
  }
  if (!selectedPatient) return showAlert('warning','ไม่พบข้อมูล','ไม่พบข้อมูลผู้ป่วยรายนี้');

  // Reset state
  currentCareStep = 1;
  careRecordDraft = {};
  olderImageBase64 = null;
  serviceImagesBase64 = [];
  isSubmittingCare = false;

  // Reset form
  resetCareForm();

  // Header
  $('#careHeaderPatient').textContent = selectedPatient.fullname;
  $('#selectedPatientId').value = selectedPatient.id;
  $('#selectedCaregiverId').value = session.user.caregiverId || '';

  // Step 1 patient info
  $('#step1Photo').src = selectedPatient.photo_url || generateAvatarDataURI(selectedPatient.fullname);
  $('#step1Fullname').textContent = selectedPatient.fullname || '-';
  $('#step1Age').textContent = (calculateAge(selectedPatient.birthdate) || '-') + ' ปี';
  $('#step1Gender').textContent = selectedPatient.gender || '-';
  $('#step1HouseNo').textContent = selectedPatient.house_no || '-';
  $('#step1Moo').textContent = selectedPatient.moo || '-';
  $('#step1Caregiver').textContent = (selectedPatient.caregiver && selectedPatient.caregiver.fullname)
    || session.user.displayName || '-';

  openModal('careRecordModal');
  showCareStep(1);

  // Init signature pad after modal visible
  setTimeout(initSignaturePad, 200);
}

function resetCareForm() {
  ['crWeight','crHeight','crBmi','crBmiResult','crTemp','crPulse','crResp',
   'crBpSys','crBpDia','cr9qScore','cr9qResult','cr8qScore','cr8qResult','crNote'
  ].forEach(id => { const el = $('#'+id); if (el) el.value = ''; });
  $('#crBpEnabled').checked = false;
  $('#bpFields').classList.add('hidden');
  $$('input[name="cr2q"]').forEach(r => r.checked = false);
  $('#block9Q').classList.add('hidden');
  $('#block8Q').classList.add('hidden');
  $('#cr8qBadge').classList.add('hidden');
  $$('label.activity-card input').forEach(cb => { cb.checked = false; cb.closest('label').classList.remove('is-checked'); });

  // Reset images
  $('#olderFile').value = '';
  $('#olderPreview').src = ''; $('#olderPreview').classList.add('hidden');
  $('#olderPlaceholder').classList.remove('hidden');
  $('#serviceFiles').value = '';
  $('#serviceGrid').innerHTML = '';
  $('#serviceCount').textContent = '(0)';

  if (signaturePad) signaturePad.clear();
}

/* 12.3 showCareStep */
function showCareStep(step) {
  currentCareStep = step;
  $('#currentStep').value = step;
  $$('.care-step').forEach((el, i) => {
    el.classList.toggle('hidden', (i+1) !== step);
  });
  updateCareProgress();

  // Update buttons
  $('#prevStepBtn').classList.toggle('hidden', step === 1);
  $('#nextStepBtn').classList.toggle('hidden', step === totalCareSteps);
  $('#submitCareRecordBtn').classList.toggle('hidden', step !== totalCareSteps);

  // ถ้าเข้า Step 8 → render review
  if (step === totalCareSteps) renderCareReview();

  // Scroll modal body to top
  const body = $('#careRecordModal .modal-body');
  if (body) body.scrollTop = 0;

  if (window.lucide) lucide.createIcons();
}

/* 12.4 nextCareStep */
function nextCareStep() {
  if (!validateCareStep(currentCareStep)) return;
  saveStepData(currentCareStep);
  if (currentCareStep < totalCareSteps) showCareStep(currentCareStep + 1);
}

/* 12.5 prevCareStep */
function prevCareStep() {
  // เก็บข้อมูลปัจจุบันก่อนถอยกลับ (ไม่ validate)
  saveStepData(currentCareStep);
  if (currentCareStep > 1) showCareStep(currentCareStep - 1);
}

/* 12.6 validateCareStep */
function validateCareStep(step) {
  if (step === 1) {
    const w = parseFloat($('#crWeight').value), h = parseFloat($('#crHeight').value);
    if (!(w > 0)) { focusField('#crWeight','กรุณากรอกน้ำหนักให้ถูกต้อง'); return false; }
    if (!(h > 0)) { focusField('#crHeight','กรุณากรอกส่วนสูงให้ถูกต้อง'); return false; }
    if (!$('#crBmi').value) { showAlert('warning','BMI ยังไม่ถูกคำนวณ','ตรวจสอบน้ำหนักและส่วนสูง'); return false; }
    return true;
  }
  if (step === 2) {
    const t = parseFloat($('#crTemp').value), p = parseFloat($('#crPulse').value), r = parseFloat($('#crResp').value);
    if (!(t >= 30 && t <= 45)) { focusField('#crTemp','กรอกอุณหภูมิ (30-45 °C)'); return false; }
    if (!(p > 0))  { focusField('#crPulse','กรอกชีพจรเป็นตัวเลข'); return false; }
    if (!(r > 0))  { focusField('#crResp','กรอกอัตราหายใจเป็นตัวเลข'); return false; }
    if ($('#crBpEnabled').checked) {
      const sys = parseFloat($('#crBpSys').value), dia = parseFloat($('#crBpDia').value);
      if (!(sys > 0)) { focusField('#crBpSys','กรอก Systolic'); return false; }
      if (!(dia > 0)) { focusField('#crBpDia','กรอก Diastolic'); return false; }
      if (sys <= dia) { showAlert('warning','ค่าผิดปกติ','Systolic ควรมากกว่า Diastolic'); return false; }
    }
    return true;
  }
  if (step === 3) {
    const v = ($$('input[name="cr2q"]').find(r=>r.checked)||{}).value;
    if (!v) { showAlert('warning','ยังไม่เลือก 2Q','กรุณาเลือกผลคัดกรอง 2Q'); return false; }
    if (v === 'เสี่ยง') {
      const s9 = parseInt($('#cr9qScore').value, 10);
      if (isNaN(s9) || s9 < 0 || s9 > 27) { focusField('#cr9qScore','กรอกคะแนน 9Q (0-27)'); return false; }
      if (s9 >= 7) {
        const s8 = parseInt($('#cr8qScore').value, 10);
        if (isNaN(s8) || s8 < 0 || s8 > 20) { focusField('#cr8qScore','กรอกคะแนน 8Q (0-20)'); return false; }
      }
    }
    return true;
  }
  if (step === 4 || step === 5 || step === 6) {
    const key = 'step' + step;
    const checked = $$('#'+key+'List input[type="checkbox"]:checked');
    if (checked.length === 0) {
      showAlert('warning','ยังไม่เลือกกิจกรรม','เลือกอย่างน้อย 1 รายการ หรือเลือก "ไม่ได้ดำเนินกิจกรรมในหมวดนี้"');
      return false;
    }
    return true;
  }
  if (step === 7) {
    if (serviceImagesBase64.length < 3) {
      showAlert('warning','ภาพกิจกรรมไม่ครบ','ต้องอัปโหลดภาพกิจกรรมอย่างน้อย 3 ภาพ (ปัจจุบัน '+serviceImagesBase64.length+' ภาพ)');
      return false;
    }
    if (!signaturePad || signaturePad.isEmpty()) {
      showAlert('warning','ยังไม่ลงลายเซ็น','กรุณาลงลายเซ็นดิจิทัล');
      return false;
    }
    return true;
  }
  if (step === 8) {
    // ตรวจสอบ step 1-7 อีกครั้ง
    for (let i = 1; i <= 7; i++) {
      const ok = validateCareStep(i);
      if (!ok) { showCareStep(i); return false; }
    }
    return true;
  }
  return true;
}

function focusField(sel, msg) {
  showToast('warning', msg);
  const el = $(sel); if (el) { el.focus(); el.classList.add('!border-red-400'); setTimeout(()=>el.classList.remove('!border-red-400'), 2000); }
}

/* 12.7 saveStepData */
function saveStepData(step) {
  if (step === 1) {
    careRecordDraft.weight = parseFloat($('#crWeight').value) || null;
    careRecordDraft.height = parseFloat($('#crHeight').value) || null;
    careRecordDraft.bmi = parseFloat($('#crBmi').value) || null;
    careRecordDraft.bmi_result = $('#crBmiResult').value || null;
  } else if (step === 2) {
    careRecordDraft.temperature = parseFloat($('#crTemp').value) || null;
    careRecordDraft.pulse = parseInt($('#crPulse').value,10) || null;
    careRecordDraft.respiration = parseInt($('#crResp').value,10) || null;
    careRecordDraft.bp_enabled = !!$('#crBpEnabled').checked;
    careRecordDraft.bp_systolic = careRecordDraft.bp_enabled ? (parseInt($('#crBpSys').value,10)||null) : null;
    careRecordDraft.bp_diastolic = careRecordDraft.bp_enabled ? (parseInt($('#crBpDia').value,10)||null) : null;
  } else if (step === 3) {
    careRecordDraft.twoq_result = (($$('input[name="cr2q"]').find(r=>r.checked))||{}).value || null;
    careRecordDraft.nineq_score = parseInt($('#cr9qScore').value,10);
    if (isNaN(careRecordDraft.nineq_score)) careRecordDraft.nineq_score = null;
    careRecordDraft.nineq_result = $('#cr9qResult').value || null;
    careRecordDraft.eightq_score = parseInt($('#cr8qScore').value,10);
    if (isNaN(careRecordDraft.eightq_score)) careRecordDraft.eightq_score = null;
    careRecordDraft.eightq_result = $('#cr8qResult').value || null;
  } else if (step === 4) {
    careRecordDraft.daily_living_activities = collectActivities('step4');
  } else if (step === 5) {
    careRecordDraft.basic_health_activities = collectActivities('step5');
  } else if (step === 6) {
    careRecordDraft.other_activities = collectActivities('step6');
  } else if (step === 8) {
    careRecordDraft.note = $('#crNote').value.trim();
  }
}

function collectActivities(key) {
  const list = $$('#'+key+'List input[type="checkbox"]:checked').map(c => c.value);
  return { items: list };
}

/* 12.8 restoreStepData (สำหรับ form fields ที่ DOM ยังเก็บค่าเดิมได้) */
// ข้อมูลใน input/checkbox ยังอยู่เพราะ DOM ไม่ถูก reset ระหว่าง step
// ฟังก์ชันนี้สำรองไว้สำหรับ logic พิเศษเช่น re-render review

/* 12.9 updateCareProgress */
function updateCareProgress() {
  const pct = (currentCareStep / totalCareSteps) * 100;
  $('#progressBar').style.width = pct + '%';
  $('#currentStepText').textContent = currentCareStep;
  $('#currentStepName').textContent = STEP_NAMES[currentCareStep - 1];

  $$('.step-dot').forEach(d => {
    const n = parseInt(d.dataset.dot, 10);
    d.classList.remove('dot-active','dot-done');
    if (n === currentCareStep) d.classList.add('dot-active');
    else if (n < currentCareStep) d.classList.add('dot-done');
  });
}

/* 12.10 renderCareReview */
function renderCareReview() {
  // เก็บ Step 1-7 ก่อน
  for (let i = 1; i <= 7; i++) saveStepData(i);

  $('#rvPatient').textContent = selectedPatient.fullname;
  $('#rvDate').textContent = formatThaiDate(new Date()) + ' ' + new Date().toTimeString().slice(0,5);
  $('#rvWeight').textContent = careRecordDraft.weight ?? '-';
  $('#rvHeight').textContent = careRecordDraft.height ?? '-';
  $('#rvBmi').textContent = careRecordDraft.bmi ?? '-';
  $('#rvBmiResult').textContent = careRecordDraft.bmi_result ?? '-';

  $('#rvTemp').textContent = careRecordDraft.temperature ?? '-';
  $('#rvPulse').textContent = careRecordDraft.pulse ?? '-';
  $('#rvResp').textContent = careRecordDraft.respiration ?? '-';
  $('#rvBp').textContent = careRecordDraft.bp_enabled
    ? `${careRecordDraft.bp_systolic||'-'}/${careRecordDraft.bp_diastolic||'-'} mmHg`
    : 'ไม่ได้บันทึก';

  $('#rv2q').textContent = careRecordDraft.twoq_result || '-';
  $('#rv9q').textContent = careRecordDraft.nineq_score != null
    ? `${careRecordDraft.nineq_score} (${careRecordDraft.nineq_result||'-'})` : '-';
  $('#rv8q').textContent = careRecordDraft.eightq_score != null
    ? `${careRecordDraft.eightq_score} (${careRecordDraft.eightq_result||'-'})` : '-';

  // Activities
  const actHtml = [];
  const a4 = (careRecordDraft.daily_living_activities||{}).items||[];
  const a5 = (careRecordDraft.basic_health_activities||{}).items||[];
  const a6 = (careRecordDraft.other_activities||{}).items||[];
  if (a4.length) actHtml.push(`<div><b>ช่วยเหลือประจำวัน:</b><ul class="list-disc ml-5 mt-1">${a4.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`);
  if (a5.length) actHtml.push(`<div><b>สุขภาพพื้นฐาน:</b><ul class="list-disc ml-5 mt-1">${a5.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`);
  if (a6.length) actHtml.push(`<div><b>ดูแลด้านอื่น:</b><ul class="list-disc ml-5 mt-1">${a6.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`);
  $('#rvActivities').innerHTML = actHtml.join('') || '<span class="text-slate-400">ไม่มีข้อมูล</span>';

  // Photos
  $('#rvServiceCount').textContent = serviceImagesBase64.length;
  $('#rvServicePreview').innerHTML = serviceImagesBase64.slice(0,9).map(im =>
    `<img src="${im.base64}" onclick="viewImage(this.src)">`).join('');

  // Signature
  if (signaturePad && !signaturePad.isEmpty()) {
    $('#rvSig').src = signaturePad.toDataURL('image/png');
  }
}

/* 12.11 submitCareRecord */
async function submitCareRecord() {
  if (isSubmittingCare) return;
  if (!validateCareStep(8)) return;

  // เก็บ note
  saveStepData(8);

  const c = await Swal.fire({
    icon: 'question', title: 'ยืนยันการบันทึก?',
    text: 'ระบบจะบันทึกข้อมูลการดูแลทั้งหมด',
    showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ตรวจสอบอีกครั้ง',
    confirmButtonColor: '#22C55E'
  });
  if (!c.isConfirmed) return;

  isSubmittingCare = true;
  $('#submitCareRecordBtn').disabled = true;
  showLoading('กำลังบันทึก...');
  try {
    const payload = Object.assign({}, careRecordDraft, {
      patient_id: selectedPatient.id,
      service_date: new Date().toISOString().slice(0,10),
      service_time: new Date().toTimeString().slice(0,8),

      older_image_base64: olderImageBase64 || null,
      service_image_base64_list: serviceImagesBase64.map(x => x.base64),
      sig_image_base64: signaturePad.toDataURL('image/png')
    });

    await callServer('saveCareRecord', session.token, payload);
    await Swal.fire({ icon:'success', title:'บันทึกสำเร็จ', timer:1500, showConfirmButton:false });
    closeModal('careRecordModal');

    // Reset
    careRecordDraft = {};
    selectedPatient = null;
    olderImageBase64 = null;
    serviceImagesBase64 = [];

    // Reload
    if (currentPage === 'myPatients') loadAssignedPatients();
    else if (currentPage === 'dashboard') loadDashboardSummary();
  } catch (err) {
    showAlert('error','บันทึกไม่สำเร็จ', err.message);
  } finally {
    isSubmittingCare = false;
    $('#submitCareRecordBtn').disabled = false;
    hideLoading();
  }
}


/* =====================================================
   13. BMI
   ===================================================== */
function calculateBMI() {
  const w = parseFloat($('#crWeight').value);
  const h = parseFloat($('#crHeight').value);
  if (!(w > 0) || !(h > 0)) { $('#crBmi').value = ''; $('#crBmiResult').value = ''; return; }
  const m = h / 100;
  const bmi = w / (m*m);
  $('#crBmi').value = bmi.toFixed(2);
  $('#crBmiResult').value = interpretBMI(bmi);
}

function interpretBMI(bmi) {
  if (bmi < 18.5) return 'น้ำหนักน้อย/ผอม';
  if (bmi < 23)   return 'ปกติ';
  if (bmi < 25)   return 'น้ำหนักเกิน';
  if (bmi < 30)   return 'อ้วนระดับ 1';
  return 'อ้วนระดับ 2';
}


/* =====================================================
   14. MENTAL HEALTH 2Q / 9Q / 8Q
   ===================================================== */
function handleTwoQChange() {
  const v = (($$('input[name="cr2q"]').find(r=>r.checked))||{}).value;
  // Visual selected radio cards
  $$('label.radio-card').forEach(l => {
    const inp = l.querySelector('input[name="cr2q"]');
    l.classList.toggle('is-checked', inp.checked);
  });

  if (v === 'ปกติ') {
    $('#block9Q').classList.add('hidden');
    $('#block8Q').classList.add('hidden');
    $('#cr9qScore').value = ''; $('#cr9qResult').value = '';
    $('#cr8qScore').value = ''; $('#cr8qResult').value = '';
    $('#cr8qBadge').classList.add('hidden');
  } else if (v === 'เสี่ยง') {
    $('#block9Q').classList.remove('hidden');
    toggle8QBy9Q();
  }
}

function interpret9Q() {
  const s = parseInt($('#cr9qScore').value, 10);
  if (isNaN(s)) { $('#cr9qResult').value = ''; return; }
  let r = '';
  if (s <= 6)       r = 'ไม่มีอาการซึมเศร้า';
  else if (s <= 12) r = 'ซึมเศร้าระดับน้อย';
  else if (s <= 18) r = 'ซึมเศร้าระดับปานกลาง';
  else              r = 'ซึมเศร้าระดับรุนแรง';
  $('#cr9qResult').value = r;
}

function toggle8QBy9Q() {
  const s = parseInt($('#cr9qScore').value, 10);
  if (!isNaN(s) && s >= 7) {
    $('#block8Q').classList.remove('hidden');
  } else {
    $('#block8Q').classList.add('hidden');
    $('#cr8qScore').value = ''; $('#cr8qResult').value = '';
    $('#cr8qBadge').classList.add('hidden');
  }
}

function interpret8Q() {
  const s = parseInt($('#cr8qScore').value, 10);
  if (isNaN(s)) { $('#cr8qResult').value = ''; $('#cr8qBadge').classList.add('hidden'); return; }
  let r = '';
  if (s <= 0)       r = 'ไม่มีความเสี่ยงฆ่าตัวตาย';
  else if (s < 9)   r = 'เสี่ยงระดับน้อย';
  else if (s < 17)  r = 'เสี่ยงระดับปานกลาง';
  else              r = 'เสี่ยงระดับสูง';
  $('#cr8qResult').value = r;

  const badge = $('#cr8qBadge');
  if (s >= 17) {
    badge.classList.remove('hidden');
    Swal.fire({
      icon:'warning', title:'⚠ ความเสี่ยงสูง',
      text:'คะแนน 8Q ≥ 17 — กรุณาประสานบุคลากรสาธารณสุขทันที',
      confirmButtonColor:'#EF4444'
    });
  } else {
    badge.classList.add('hidden');
  }
}


/* =====================================================
   15. IMAGE UPLOAD & SIGNATURE PAD
   ===================================================== */
async function handleOlderImagePreview(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 5*1024*1024) return showAlert('warning','ไฟล์ใหญ่เกินไป','ไม่เกิน 5MB');
  try {
    const b64 = await convertFileToBase64(f, 1200, 0.8);
    olderImageBase64 = b64;
    $('#olderPreview').src = b64;
    $('#olderPreview').classList.remove('hidden');
    $('#olderPlaceholder').classList.add('hidden');
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
}

async function handleServiceImagesPreview(e) {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (f.size > 5*1024*1024) { showToast('warning', f.name + ' เกิน 5MB ข้ามไฟล์นี้'); continue; }
    try {
      const b64 = await convertFileToBase64(f, 1200, 0.78);
      serviceImagesBase64.push({ base64: b64, name: f.name });
    } catch (err) { console.warn(err); }
  }
  e.target.value = ''; // reset เพื่อเลือกซ้ำได้
  renderServiceGrid();
}

function renderServiceGrid() {
  const wrap = $('#serviceGrid');
  wrap.innerHTML = serviceImagesBase64.map((im, i) => `
    <div class="img-preview-item">
      <img src="${im.base64}" onclick="viewImage('${im.base64}')">
      <button type="button" class="img-remove" onclick="removeServiceImage(${i})">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
      <span class="img-index">${i+1}</span>
    </div>`).join('');
  $('#serviceCount').textContent = `(${serviceImagesBase64.length})`;
  if (serviceImagesBase64.length >= 3) {
    $('#serviceCount').classList.remove('text-red-500');
    $('#serviceCount').classList.add('text-emerald-600');
  } else {
    $('#serviceCount').classList.remove('text-emerald-600');
    $('#serviceCount').classList.add('text-brand-600');
  }
  if (window.lucide) lucide.createIcons();
}

function removeServiceImage(idx) {
  serviceImagesBase64.splice(idx, 1);
  renderServiceGrid();
}

function convertFileToBase64(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const max = maxSize || 1200;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else       { w = Math.round(w * max / h); h = max; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.8));
      };
      img.onerror = () => reject(new Error('โหลดรูปไม่สำเร็จ'));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Signature Pad */
function initSignaturePad() {
  const canvas = $('#sigCanvas');
  if (!canvas) return;
  // Resize canvas to actual width
  resizeSigCanvas(canvas);
  if (signaturePad) { signaturePad.off(); }
  signaturePad = new SignaturePad(canvas, {
    backgroundColor: 'rgba(255,255,255,0)',
    penColor: '#0F172A',
    minWidth: 0.8, maxWidth: 2.4
  });
  // re-handle resize on rotation
  window.addEventListener('resize', debounce(() => resizeSigCanvas(canvas), 200), { once: false });
}

function resizeSigCanvas(canvas) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  canvas.getContext('2d').scale(ratio, ratio);
  if (signaturePad) signaturePad.clear();
}

function clearSignature() {
  if (signaturePad) signaturePad.clear();
}


/* =====================================================
   16. REPORT
   ===================================================== */
let currentReportTab = 'daily';
let currentReportRows = [];

function setupReportControls() {
  // เดือน-ปี
  const monthSel = $('#reportMonth');
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  monthSel.innerHTML = months.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  monthSel.value = new Date().getMonth() + 1;
  const yearSel = $('#reportYear');
  const yNow = new Date().getFullYear();
  let yo = '';
  for (let y = yNow + 1; y >= yNow - 5; y--) yo += `<option value="${y}">${y + 543}</option>`;
  yearSel.innerHTML = yo;
  yearSel.value = yNow;
  $('#reportDate').value = new Date().toISOString().slice(0,10);
}

function initReportPage() {
  if (session.user.role === 'admin') {
    // โหลด caregiver dropdown
    callServer('getCaregivers', session.token).then(res => {
      const cgs = res.data || [];
      const opts = '<option value="">ทั้งหมด</option>' +
        cgs.map(c => `<option value="${c.id}">${escapeHtml(c.cg_code)} - ${escapeHtml(c.fullname)}</option>`).join('');
      $('#reportCgFilterDaily').innerHTML = opts;
      $('#reportCgFilterMonthly').innerHTML = opts;
    }).catch(()=>{});
  } else {
    // member: ซ่อน filter caregiver
    $('#reportCgFilterDaily').closest('div').style.display = 'none';
    $('#reportCgFilterMonthly').closest('div').style.display = 'none';
  }
  switchReportTab('daily');
}

function switchReportTab(tab) {
  currentReportTab = tab;
  $$('.report-tab').forEach(b => b.classList.toggle('tab-active', b.dataset.rtab === tab));
  $('#dailyFilter').classList.toggle('hidden', tab !== 'daily');
  $('#monthlyFilter').classList.toggle('hidden', tab !== 'monthly');
  $('#reportTbody').innerHTML = '';
  $('#reportSummary').innerHTML = '';
  $('#reportEmpty').classList.add('hidden');
}

async function loadDailyReport() {
  const date = $('#reportDate').value;
  const filters = {};
  const cg = $('#reportCgFilterDaily').value;
  if (cg) filters.caregiver_id = cg;
  showLoading();
  try {
    const res = await callServer('getDailyReport', session.token, date, filters);
    currentReportRows = res.data.records || [];
    renderReportSummary({ title:'วันที่', value: formatThaiDate(date), total: res.data.total });
    renderReportTable(currentReportRows);
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

async function loadMonthlyReport() {
  const m = $('#reportMonth').value, y = $('#reportYear').value;
  const filters = {};
  const cg = $('#reportCgFilterMonthly').value;
  if (cg) filters.caregiver_id = cg;
  showLoading();
  try {
    const res = await callServer('getMonthlyReport', session.token, m, y, filters);
    currentReportRows = res.data.records || [];
    const monthName = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][m-1];
    renderReportSummary({ title:'เดือน', value: monthName + ' ' + (parseInt(y,10)+543), total: res.data.total });
    renderReportTable(currentReportRows);
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

function renderReportSummary(meta) {
  $('#reportSummary').innerHTML =
      renderDashCard('calendar','color-blue', meta.value, meta.title)
    + renderDashCard('list','color-green', meta.total, 'จำนวนการบันทึก');
  if (window.lucide) lucide.createIcons();
}

function renderReportTable(rows) {
  const tb = $('#reportTbody');
  if (!rows || rows.length === 0) {
    tb.innerHTML = '';
    $('#reportEmpty').classList.remove('hidden');
    return;
  }
  $('#reportEmpty').classList.add('hidden');
  tb.innerHTML = rows.map(r => `
    <tr>
      <td class="px-3 py-2 whitespace-nowrap">${formatThaiDate(r.service_date)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${(r.service_time||'').slice(0,5)}</td>
      <td class="px-3 py-2">${escapeHtml(r.patient?.fullname||'-')}</td>
      <td class="px-3 py-2">${escapeHtml(r.caregiver?.fullname||'-')}</td>
      <td class="px-3 py-2 whitespace-nowrap">
        ${escapeHtml(r.twoq_result||'-')} / ${r.nineq_score??'-'} / ${r.eightq_score??'-'}
      </td>
      <td class="px-3 py-2 text-slate-500">${escapeHtml(r.note||'-')}</td>
    </tr>`).join('');
}

async function exportCSV() {
  const filters = {};
  if (currentReportTab === 'daily') {
    const d = $('#reportDate').value;
    filters.start_date = d; filters.end_date = d;
    const cg = $('#reportCgFilterDaily').value; if (cg) filters.caregiver_id = cg;
  } else {
    const m = parseInt($('#reportMonth').value,10), y = parseInt($('#reportYear').value,10);
    const last = new Date(y, m, 0).getDate();
    filters.start_date = `${y}-${('0'+m).slice(-2)}-01`;
    filters.end_date   = `${y}-${('0'+m).slice(-2)}-${('0'+last).slice(-2)}`;
    const cg = $('#reportCgFilterMonthly').value; if (cg) filters.caregiver_id = cg;
  }
  showLoading('กำลังเตรียมไฟล์...');
  try {
    const res = await callServer('exportReportCsv', session.token, filters);
    const blob = new Blob([res.data.csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast('success','ดาวน์โหลด CSV แล้ว');
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

function printReport() {
  if (!currentReportRows || currentReportRows.length === 0) {
    return showAlert('info','ไม่มีข้อมูล','กรุณาค้นหาข้อมูลก่อนสั่งพิมพ์');
  }
  window.print();
}


/* =====================================================
   17. SETTINGS - ขยายเป็น 3 แท็บ
   ===================================================== */
let configSchemaCache = null;
let editedSensitiveKeys = new Set();

async function loadSettings() {
  // bind tabs (ครั้งแรก)
  if (!loadSettings._bound) {
    $$('.settings-tab').forEach(b =>
      b.addEventListener('click', () => switchSettingsTab(b.dataset.stab)));
    $('#btnSaveConfig').addEventListener('click', saveAppConfig);
    $('#btnTestConnection').addEventListener('click', testConnection);
    $('#btnRefreshConfig').addEventListener('click', refreshConfig);
    loadSettings._bound = true;
  }

  // โหลดเฉพาะแท็บที่กำลังเปิด
  const active = $('.settings-tab.tab-active')?.dataset.stab || 'org';
  switchSettingsTab(active);
}

function switchSettingsTab(tab) {
  $$('.settings-tab').forEach(b => b.classList.toggle('tab-active', b.dataset.stab === tab));
  $$('.settings-panel').forEach(p => p.classList.add('hidden'));
  $('#settingsTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.remove('hidden');

  if (tab === 'org')    loadOrgSettings();
  if (tab === 'config') loadConfigSettings();
  if (tab === 'status') loadStatusInfo();
}

/* ----- Tab 1: ข้อมูลหน่วยงาน (เดิม) ----- */
async function loadOrgSettings() {
  showLoading();
  try {
    const res = await callServer('getSystemSettings');
    const s = res.data || {};
    $('#setOrgName').value    = s.org_name || '';
    $('#setOrgSubname').value = s.org_subname || '';
    $('#setOrgAddress').value = s.org_address || '';
    $('#setOrgPhone').value   = s.org_phone || '';
    $('#setOrgLogo').value    = s.org_logo_url || '';
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}
async function saveSettings() {
  const data = {
    org_name:    $('#setOrgName').value.trim(),
    org_subname: $('#setOrgSubname').value.trim(),
    org_address: $('#setOrgAddress').value.trim(),
    org_phone:   $('#setOrgPhone').value.trim(),
    org_logo_url:$('#setOrgLogo').value.trim()
  };
  showLoading('กำลังบันทึก...');
  try {
    await callServer('updateSystemSettings', session.token, data);
    showToast('success','บันทึกสำเร็จ');
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

/* ----- Tab 2: Config Form (ใหม่) ----- */
async function loadConfigSettings() {
  showLoading('กำลังโหลด Config...');
  try {
    const res = await callServer('getAppConfig', session.token);
    configSchemaCache = res.data;
    editedSensitiveKeys.clear();
    renderConfigForm(res.data);
  } catch (err) {
    $('#configForm').innerHTML =
      `<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
        <p class="font-medium">ไม่สามารถโหลด Config ได้</p>
        <p class="mt-1">${escapeHtml(err.message)}</p>
        <p class="mt-2 text-xs">โปรดตรวจสอบว่าตั้ง CONFIG_SHEET_ID ใน Script Properties แล้ว</p>
      </div>`;
  } finally { hideLoading(); }
}

function renderConfigForm(data) {
  const groups = data.groups;
  const schema = data.schema;

  // จัดกลุ่ม fields ตาม group
  const grouped = {};
  Object.keys(groups).forEach(g => grouped[g] = []);
  schema.forEach(f => {
    if (grouped[f.group]) grouped[f.group].push(f);
  });

  let html = '';
  Object.keys(groups).forEach(gKey => {
    const g = groups[gKey];
    const fields = grouped[gKey];
    if (!fields.length) return;

    html += `
      <div class="config-group">
        <div class="config-group-header color-${g.color}">
          <div class="cg-icon"><i data-lucide="${g.icon}" class="w-5 h-5"></i></div>
          <div>
            <h4 class="font-semibold text-slate-800 text-base">${escapeHtml(g.title)}</h4>
            <p class="text-xs text-slate-500">${fields.length} ค่าที่ตั้งได้</p>
          </div>
        </div>
        <div class="config-group-body">
          ${fields.map(renderConfigField).join('')}
        </div>
      </div>`;
  });
  $('#configForm').innerHTML = html;

  // Bind sensitive toggles
  $$('.config-sensitive-toggle').forEach(btn =>
    btn.addEventListener('click', () => toggleSensitiveEdit(btn.dataset.key)));

  // Track changes on sensitive inputs
  $$('input[data-sensitive="true"]').forEach(inp => {
    inp.addEventListener('input', () => {
      editedSensitiveKeys.add(inp.dataset.key);
      inp.classList.add('config-sensitive-edited');
    });
  });

  if (window.lucide) lucide.createIcons();
}

function renderConfigField(f) {
  const id = 'cfg_' + f.key;
  const required = f.required ? '<span class="required-badge">*</span>' : '';
  const placeholder = f.placeholder || '';
  const help = f.default ? `ค่าเริ่มต้น: ${escapeHtml(f.default)}` : '';
  const inputType = f.type === 'password' ? 'password' :
                    f.type === 'number'   ? 'number'   :
                    f.type === 'url'      ? 'url'      : 'text';
  const numberAttrs = f.type === 'number'
    ? `min="${f.min||0}" max="${f.max||9999}"` : '';

  let inputHtml;
  if (f.sensitive) {
    inputHtml = `
      <div class="config-field-input-wrap">
        <input
          type="password"
          id="${id}"
          data-key="${f.key}"
          data-sensitive="true"
          class="input-field pr-12"
          value="${escapeHtml(f.value || '')}"
          placeholder="${placeholder}"
          autocomplete="new-password"
          readonly
        >
        <button type="button" class="config-sensitive-toggle" data-key="${f.key}" title="แก้ไขค่า">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
      </div>
      <p class="config-field-help">
        ${f.hasValue ? '🔒 มีค่าตั้งไว้แล้ว — กดปุ่มแก้ไขเพื่อเปลี่ยน' : '⚠️ ยังไม่ได้ตั้งค่า'}
      </p>`;
  } else {
    inputHtml = `
      <input
        type="${inputType}"
        id="${id}"
        data-key="${f.key}"
        ${numberAttrs}
        class="input-field"
        value="${escapeHtml(f.value || '')}"
        placeholder="${placeholder}"
      >
      ${help ? `<p class="config-field-help">${help}</p>` : ''}`;
  }

  return `
    <div class="config-field">
      <div class="config-field-label">
        <span>${escapeHtml(f.label)} ${required}</span>
        <span class="config-field-key">${escapeHtml(f.key)}</span>
      </div>
      ${inputHtml}
    </div>`;
}

/** กดปุ่มดินสอ → ปลดล็อก input + เคลียร์ค่า mask */
function toggleSensitiveEdit(key) {
  const inp = $('#cfg_' + key);
  if (!inp) return;

  if (inp.readOnly) {
    inp.readOnly = false;
    inp.value = '';
    inp.placeholder = 'พิมพ์ค่าใหม่...';
    inp.focus();
    editedSensitiveKeys.add(key);
    inp.classList.add('config-sensitive-edited');
    showToast('info', 'พิมพ์ค่าใหม่เพื่อแทนที่ค่าเดิม');
  }
}

async function saveAppConfig() {
  // เก็บค่าจากทุก field
  const updates = {};
  $$('input[data-key]').forEach(inp => {
    const key = inp.dataset.key;
    const isSensitive = inp.dataset.sensitive === 'true';

    // sensitive: ส่งเฉพาะที่ user แก้
    if (isSensitive) {
      if (editedSensitiveKeys.has(key) && inp.value.trim()) {
        updates[key] = inp.value.trim();
      }
      return;
    }
    // non-sensitive: ส่งทุกค่า (รวมที่ว่าง)
    updates[key] = inp.value.trim();
  });

  // Validate ฝั่ง client เบื้องต้น
  const required = configSchemaCache.schema.filter(s => s.required && !s.sensitive);
  for (const r of required) {
    if (!updates[r.key]) {
      showAlert('warning','ข้อมูลไม่ครบ', `กรุณากรอก: ${r.label}`);
      return;
    }
  }

  const c = await Swal.fire({
    icon: 'question',
    title: 'บันทึก Config?',
    html: `<div class="text-left text-sm">
      <p>ระบบจะ:</p>
      <ul class="list-disc ml-5 mt-2 space-y-1">
        <li>บันทึกข้อมูลทั้งหมดลง Google Sheet</li>
        <li>เคลียร์ Cache เพื่อให้มีผลทันที</li>
        <li>${editedSensitiveKeys.size > 0 ? `อัปเดต ${editedSensitiveKeys.size} ค่าที่เป็นความลับ` : 'ไม่อัปเดตค่าความลับ (ใช้ค่าเดิม)'}</li>
      </ul>
    </div>`,
    showCancelButton: true,
    confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#22C55E'
  });
  if (!c.isConfirmed) return;

  showLoading('กำลังบันทึก...');
  try {
    const res = await callServer('saveAppConfig', session.token, updates);
    showToast('success', `บันทึก ${res.data.count} รายการสำเร็จ`);
    editedSensitiveKeys.clear();
    await loadConfigSettings(); // reload เพื่อแสดงค่า mask ใหม่
  } catch (err) {
    showAlert('error', 'บันทึกไม่สำเร็จ', err.message);
  } finally { hideLoading(); }
}

/* ----- ทดสอบการเชื่อมต่อ ----- */
async function testConnection() {
  showLoading('กำลังทดสอบการเชื่อมต่อ...');
  try {
    const res = await callServer('testSupabaseConnection', session.token);
    const d = res.data;
    let bucketHtml = '';
    if (d.buckets) {
      bucketHtml = '<p class="font-medium mt-3 mb-1">Storage Buckets:</p><ul class="list-none space-y-1">';
      Object.keys(d.buckets).forEach(b => {
        bucketHtml += `<li class="flex items-center gap-2">
          <span class="status-dot ${d.buckets[b]?'green':'red'}"></span>
          <span class="font-mono text-xs">${escapeHtml(b)}</span>
          <span class="text-xs ${d.buckets[b]?'text-emerald-600':'text-red-600'}">${d.buckets[b]?'OK':'ไม่พบ'}</span>
        </li>`;
      });
      bucketHtml += '</ul>';
    }
    Swal.fire({
      icon: 'success',
      title: '✅ เชื่อมต่อสำเร็จ',
      html: `<div class="text-left text-sm">
        <p><b>Database:</b> ${escapeHtml(d.database)}</p>
        <p><b>Response Time:</b> ${escapeHtml(d.responseTime)}</p>
        ${bucketHtml}
      </div>`,
      confirmButtonColor: '#22C55E'
    });
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: '❌ เชื่อมต่อไม่สำเร็จ',
      html: `<div class="text-left text-sm text-red-700">${escapeHtml(err.message)}</div>
        <p class="mt-3 text-xs text-slate-500">โปรดตรวจสอบ SUPABASE_URL และ SERVICE_ROLE_KEY</p>`,
      confirmButtonColor: '#EF4444'
    });
  } finally { hideLoading(); }
}

/* ----- รีเฟรช Cache ----- */
async function refreshConfig() {
  showLoading('กำลังรีเฟรช...');
  try {
    await callServer('refreshAppConfig', session.token);
    showToast('success','รีเฟรช Config สำเร็จ');
    loadStatusInfo();
  } catch (err) { showAlert('error','ผิดพลาด', err.message); }
  finally { hideLoading(); }
}

/* ----- Tab 3: สถานะระบบ ----- */
async function loadStatusInfo() {
  $('#statusInfo').innerHTML = '<div class="skeleton h-32"></div>';
  try {
    const res = await callServer('getAppConfig', session.token);
    const d = res.data;
    const sheetUrl = d.sheetUrl || '#';
    $('#btnOpenConfigSheet').href = sheetUrl;
    if (!d.sheetId) $('#btnOpenConfigSheet').classList.add('opacity-50','pointer-events-none');

    $('#statusInfo').innerHTML = `
      <div class="status-info-row">
        <span class="text-slate-600">Config Sheet</span>
        <span class="${d.sheetId?'text-emerald-600':'text-red-600'} font-mono text-xs">
          <span class="status-dot ${d.sheetId?'green':'red'}"></span>
          ${d.sheetId ? d.sheetId.slice(0,12)+'...' : 'ยังไม่ตั้งค่า'}
        </span>
      </div>
      <div class="status-info-row">
        <span class="text-slate-600">สถานะ Cache</span>
        <span class="${d.cacheStatus==='cached'?'text-emerald-600':'text-amber-600'} text-xs">
          <span class="status-dot ${d.cacheStatus==='cached'?'green':'gray'}"></span>
          ${d.cacheStatus==='cached'?'มี Cache (5 นาที)':'ยังไม่ Cache'}
        </span>
      </div>
      <div class="status-info-row">
        <span class="text-slate-600">อัปเดตล่าสุด</span>
        <span class="text-slate-700 text-xs">${escapeHtml(d.lastUpdated || '-')}</span>
      </div>
      <div class="status-info-row">
        <span class="text-slate-600">จำนวน Config</span>
        <span class="text-slate-700 text-xs">${d.schema.length} รายการ</span>
      </div>`;
  } catch (err) {
    $('#statusInfo').innerHTML = `<p class="text-sm text-red-600">${escapeHtml(err.message)}</p>`;
  }
}


/* =====================================================
   18. UTILITIES
   ===================================================== */
function formatThaiDate(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()+543}`;
}

function calculateAge(birthdate) {
  if (!birthdate) return null;
  const b = (birthdate instanceof Date) ? birthdate : new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

function validateCID(cid) {
  if (!cid) return false;
  const s = String(cid).replace(/\D/g, '');
  if (s.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(s.charAt(i), 10) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(s.charAt(12), 10);
}

function validatePhone(phone) {
  return /^[0-9]{9,10}$/.test(String(phone).trim());
}

function generateAvatarDataURI(name) {
  const ch = (name || '?').charAt(0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#DBEAFE"/><stop offset="1" stop-color="#BAE6FD"/></linearGradient></defs>
    <rect width="160" height="160" rx="20" fill="url(#g)"/>
    <text x="50%" y="50%" font-family="Mitr, sans-serif" font-size="72" font-weight="600"
      fill="#2563EB" text-anchor="middle" dominant-baseline="central">${escapeHtml(ch)}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// Expose ฟังก์ชันที่ HTML เรียก inline (onclick)
window.editCaregiver = editCaregiver;
window.deleteCaregiver = deleteCaregiver;
window.resetCaregiverPassword = resetCaregiverPassword;
window.editPatient = editPatient;
window.deletePatient = deletePatient;
window.viewPatientHistory = viewPatientHistory;
window.viewImage = viewImage;
window.openCareRecordForm = openCareRecordForm;
window.removeServiceImage = removeServiceImage;
window.cancelAssignment = cancelAssignment;
</script>
