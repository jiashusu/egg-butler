import { initDB, getAllRecords, addRecord, importRecords } from './db.js';
import { predictAll, getStats } from './prediction.js';
import { showLoading, showToast, showModal, hideModal, $id, $q } from './utils/dom.js';
import { toLocalISO } from './utils/time.js';
import { downloadCloudBackup, getCloudBackupId, uploadCloudBackup } from './utils/cloudBackup.js';

import './views/dashboard.js';
import './views/record.js';
import './views/history.js';
import './views/analytics.js';

let records = [];
let predictions = {};
let stats = {};
let currentRoute = 'dashboard';
let initPromise = null;
let cloudSyncTimer = null;
let cloudSyncInFlight = false;

async function init() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    showLoading($id('app-content'));

    await initDB();
    await refreshData();
    await syncCloudRecords({ render: false, showSuccess: false });
    await refreshData();

    window.navigateTo = navigateTo;
    window.onRecordSaved = onRecordSaved;
    window.syncCloudNow = syncCloudRecords;

    setupRouter();
    await handleRoute(getInitialRoute());

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      });
    }

    startAutoRefresh();

    return true;
  })();

  return initPromise;
}

function getInitialRoute() {
  const hash = location.hash.replace('#', '');
  return hash || 'dashboard';
}

function setupRouter() {
  window.addEventListener('hashchange', () => {
    const route = location.hash.replace('#', '') || 'dashboard';
    handleRoute(route);
  });
}

function navigateTo(route) {
  location.hash = route;
}

async function handleRoute(route) {
  const parts = route.split('?');
  const page = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  currentRoute = page;

  const container = $id('app-content');

  if (page === 'dashboard') {
    const dashboard = await import('./views/dashboard.js');
    dashboard.setCallbacks({
      onRecord: (type) => {
        showQuickRecordModal(type || '');
      },
      onCardClick: (type) => {
        navigateTo(`history?type=${type}`);
      },
      onAnalytics: () => {
        navigateTo('analytics');
      }
    });
    dashboard.render(container, predictions, stats, records);
  } else if (page === 'record') {
    const record = await import('./views/record.js');
    record.render(container, params.get('type'), false);
  } else if (page === 'history') {
    const history = await import('./views/history.js');
    history.render(container, params.get('type') || 'drink', records);
  } else if (page === 'analytics') {
    const analytics = await import('./views/analytics.js');
    analytics.render(container, records, stats);
  }
}

async function onRecordSaved() {
  await refreshData();

  const route = location.hash.replace('#', '') || 'dashboard';
  await handleRoute(route);
  scheduleCloudUpload();
}

async function refreshData() {
  records = await getAllRecords();
  predictions = predictAll(records);
  stats = {};
  for (const type of ['drink', 'eat', 'poop', 'pee']) {
    stats[type] = getStats(type, records);
  }
}

function scheduleCloudUpload() {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    syncCloudRecords({ render: false, showSuccess: false }).catch(() => {});
  }, 1200);
}

async function syncCloudRecords({ render = true, showSuccess = true } = {}) {
  if (cloudSyncInFlight) return null;

  cloudSyncInFlight = true;
  try {
    const backupId = getCloudBackupId();
    const remote = await downloadCloudBackup(backupId);

    if (remote.exists) {
      const summary = await importRecords(remote.records);
      if (summary.imported > 0) {
        await refreshData();
      }
    }

    await uploadCloudBackup(records, backupId);

    if (render) {
      await refreshData();
      const route = location.hash.replace('#', '') || 'dashboard';
      await handleRoute(route);
    }
    if (showSuccess) showToast('云端同步完成');

    return { ok: true, backupId };
  } catch (error) {
    if (showSuccess) showToast(error?.message || '云端同步失败');
    return { ok: false, error };
  } finally {
    cloudSyncInFlight = false;
  }
}

function startAutoRefresh() {
  setInterval(async () => {
    const route = location.hash.replace('#', '') || 'dashboard';
    if (route === 'dashboard') {
      predictions = predictAll(records);
      const dashboard = await import('./views/dashboard.js');
      dashboard.render($id('app-content'), predictions, stats, records);
    }
  }, 60000);
}

function showQuickRecordModal(preSelectedType) {
  const typeIcons = { drink: '💧', eat: '🍚', poop: '💩', pee: '💦' };
  const typeLabels = { drink: '喝水', eat: '吃饭', poop: '排便', pee: '尿尿' };
  const defaultAmounts = { drink: 607, eat: 465 };
  const poopOptions = [
    { key: 'normal', label: '正常' },
    { key: 'small', label: '少量' },
    { key: 'diarrhea', label: '拉稀' },
    { key: 'soft', label: '偏软' },
    { key: 'dry', label: '偏干' }
  ];
  window._selectedQuickType = '';
  window._selectedPoopValue = 'normal';

  const typeBtns = Object.entries(typeIcons).map(([key, icon]) =>
    `<button class="quick-type-btn" data-type="${key}" onclick="window._quickSelectType('${key}')">${icon} ${typeLabels[key]}</button>`
  ).join('');

  showModal(`
    <div class="quick-record-modal">
      <h3 class="settings-title">✨ 快速记录</h3>
      <div class="quick-type-grid">
        ${typeBtns}
      </div>
      <div id="quick-amount-group" style="display:none;margin-top:12px;">
        <input type="number" id="quick-amount" class="form-input" placeholder="数量" min="1" style="text-align:center;">
      </div>
      <div id="quick-poop-group" style="display:none;margin-top:12px;">
        <div class="subtype-grid">
          ${poopOptions.map(option => `
            <button type="button" class="subtype-btn${option.key === 'normal' ? ' active' : ''}" data-value="${option.key}" onclick="window._quickSelectPoopValue('${option.key}')">
              ${option.label}
            </button>
          `).join('')}
        </div>
      </div>
      <div style="margin-top:12px;">
        <input type="datetime-local" id="quick-time" class="form-input" value="${toLocalISO(new Date())}" style="text-align:center;">
      </div>
      <button class="btn-submit" onclick="window._quickSubmit()" style="margin-top:16px;">✓ 确认</button>
    </div>
  `);

  window._quickSelectType = (type) => {
    document.querySelectorAll('.quick-type-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.quick-type-btn[data-type="${type}"]`)?.classList.add('active');
    window._selectedQuickType = type;

    const amountGroup = document.getElementById('quick-amount-group');
    const poopGroup = document.getElementById('quick-poop-group');
    if (type === 'drink' || type === 'eat') {
      const amountInput = document.getElementById('quick-amount');
      amountGroup.style.display = 'block';
      amountInput.placeholder = type === 'drink' ? '喝水量 (ml)' : '食量 (g)';
      amountInput.value = defaultAmounts[type];
    } else {
      amountGroup.style.display = 'none';
    }

    if (type === 'poop') {
      poopGroup.style.display = 'block';
      window._quickSelectPoopValue('normal');
    } else {
      poopGroup.style.display = 'none';
    }
  };

  window._quickSelectPoopValue = (value) => {
    document.querySelectorAll('#quick-poop-group .subtype-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
    window._selectedPoopValue = value;
  };

  window._quickSubmit = async () => {
    const type = window._selectedQuickType;
    if (!type) { showToast('请选择类型'); return; }

    const timeInput = document.getElementById('quick-time');
    const timestamp = timeInput ? new Date(timeInput.value).toISOString() : new Date().toISOString();

    let amount = null;
    let value = null;
    if (type === 'drink' || type === 'eat') {
      amount = parseFloat(document.getElementById('quick-amount')?.value);
      if (!amount || amount <= 0) { showToast('请输入数量'); return; }
    }
    if (type === 'poop') {
      value = window._selectedPoopValue || 'normal';
    }

    await addRecord(type, amount, value, timestamp);
    showToast('已记录！');
    hideModal();
    await onRecordSaved();
  };

  if (preSelectedType) {
    window._quickSelectType(preSelectedType);
  }
}

function boot() {
  const modalOverlay = $id('modal-overlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) hideModal();
    });
  }

  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
