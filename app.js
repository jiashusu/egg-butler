import {
  initDB,
  getAllRecords,
  addRecord,
  importRecords,
  getSettings,
  importSettings,
  getDeletedRecordKeys,
  applyDeletedRecordKeys
} from './db.js';
import { predictAll, getStats } from './prediction.js';
import { showLoading, showToast, showModal, hideModal, $id, $q } from './utils/dom.js';
import { toLocalISO } from './utils/time.js';
import { downloadCloudBackup, getCloudBackupId, setCloudSyncMeta, uploadCloudBackup } from './utils/cloudBackup.js';

import { refreshSyncStatus } from './views/dashboard.js';
import './views/record.js';
import './views/history.js';
import './views/analytics.js';

let records = [];
let predictions = {};
let stats = {};
let settings = {};
let currentRoute = 'dashboard';
let initPromise = null;
let cloudSyncTimer = null;
let cloudSyncPromise = null;
let cloudRenderPending = false;
const CLOUD_PENDING_KEY = 'eggButlerCloudPendingRevision';
const CLOUD_POLL_INTERVAL = 15000;

async function init() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    showLoading($id('app-content'));

    await initDB();
    await refreshData();
    await refreshSettings();
    window.navigateTo = navigateTo;
    window.onRecordSaved = onRecordSaved;
    window.onSettingsSaved = onSettingsSaved;
    window.syncCloudNow = syncCloudRecords;

    setupRouter();
    await handleRoute(getInitialRoute());

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    startAutoRefresh();
    syncCloudRecords({ render: false, showSuccess: false });

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
  if (page !== 'record') cloudRenderPending = false;

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
    dashboard.render(container, predictions, stats, records, settings);
  } else if (page === 'record') {
    const record = await import('./views/record.js');
    record.render(container, params.get('type'), false, settings);
  } else if (page === 'history') {
    const history = await import('./views/history.js');
    history.render(container, params.get('type') || 'drink', records);
  } else if (page === 'analytics') {
    const analytics = await import('./views/analytics.js');
    analytics.render(container, records, stats, settings);
  }
}

async function onRecordSaved(options = {}) {
  const { syncNow = false } = options || {};
  markLocalCloudChange();
  await refreshData();
  await refreshSettings();
  let syncResult = null;
  if (syncNow) {
    syncResult = await pushLocalCloudSnapshot({ render: false, showSuccess: false });
  } else {
    scheduleCloudUpload();
  }

  const route = location.hash.replace('#', '') || 'dashboard';
  await handleRoute(route);
  return syncResult;
}

async function onSettingsSaved() {
  markLocalCloudChange();
  await refreshSettings();
  scheduleCloudUpload();
  const route = location.hash.replace('#', '') || 'dashboard';
  await handleRoute(route);
}

async function refreshData() {
  records = await getAllRecords();
  predictions = predictAll(records);
  stats = {};
  for (const type of ['drink', 'eat', 'poop', 'pee']) {
    stats[type] = getStats(type, records);
  }
}

async function refreshSettings() {
  settings = await getSettings();
}

function scheduleCloudUpload() {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  setCloudSyncMeta({ status: 'pending', message: '本机有新数据，等待上传...' });
  cloudSyncTimer = setTimeout(() => {
    pushLocalCloudSnapshot({ render: false, showSuccess: false }).catch(() => {});
    cloudSyncTimer = null;
  }, 250);
}

async function syncCloudRecords({ render = true, showSuccess = true } = {}) {
  return runCloudTask(async () => {
    setCloudSyncMeta({ status: 'syncing', message: '正在同步...' });
    const backupId = getCloudBackupId();
    const remote = await downloadCloudBackup(backupId);

    if (remote.exists) {
      await applyRemoteBackup(remote);
    }

    await uploadCurrentCloudSnapshot(backupId);

    if (render) {
      await refreshData();
      const route = location.hash.replace('#', '') || 'dashboard';
      await handleRoute(route);
    } else if ((location.hash.replace('#', '') || 'dashboard') === 'dashboard') {
      await handleRoute('dashboard');
    }
    if (showSuccess) showToast('云端同步完成');

    return { ok: true, backupId };
  }, { showSuccess, waitForCurrent: true });
}

async function pushLocalCloudSnapshot({ render = true, showSuccess = true } = {}) {
  return runCloudTask(async () => {
    setCloudSyncMeta({ status: 'syncing', message: '正在上传本机数据...' });
    const backupId = getCloudBackupId();
    await uploadCurrentCloudSnapshot(backupId);

    if (render) {
      const route = location.hash.replace('#', '') || 'dashboard';
      await handleRoute(route);
    } else if ((location.hash.replace('#', '') || 'dashboard') === 'dashboard') {
      await handleRoute('dashboard');
    }
    if (showSuccess) showToast('云端同步完成');

    return { ok: true, backupId };
  }, { showSuccess, waitForCurrent: true });
}

async function runCloudTask(task, { showSuccess = true, waitForCurrent = false } = {}) {
  while (cloudSyncPromise) {
    if (!waitForCurrent) return null;
    await cloudSyncPromise.catch(() => {});
  }

  cloudSyncPromise = (async () => {
    try {
      return await task();
    } catch (error) {
      setCloudSyncMeta({
        status: 'error',
        message: error?.message || '同步失败'
      });
      refreshSyncStatus();
      if (showSuccess) showToast(error?.message || '云端同步失败');
      return { ok: false, error };
    } finally {
      cloudSyncPromise = null;
    }
  })();

  return cloudSyncPromise;
}

function markLocalCloudChange() {
  localStorage.setItem(CLOUD_PENDING_KEY, crypto.randomUUID());
}

async function uploadCurrentCloudSnapshot(backupId) {
  const revision = localStorage.getItem(CLOUD_PENDING_KEY);
  await refreshData();
  await refreshSettings();
  const uploaded = await uploadCloudBackup(records, backupId, settings, getDeletedRecordKeys());
  await applyRemoteBackup(uploaded);
  if (localStorage.getItem(CLOUD_PENDING_KEY) === revision) {
    localStorage.removeItem(CLOUD_PENDING_KEY);
  }
  const pending = Boolean(localStorage.getItem(CLOUD_PENDING_KEY));
  setCloudSyncMeta({
    status: pending ? 'pending' : 'synced',
    lastSyncAt: new Date().toISOString(),
    lastUploadedAt: uploaded.uploadedAt || new Date().toISOString(),
    recordCount: uploaded.recordCount ?? records.length,
    message: pending ? '本机有新数据，等待上传...' : '本机和云端已同步'
  });
  if (pending) scheduleCloudUpload();
}

async function pullCloudUpdates() {
  if (document.visibilityState === 'hidden' || !navigator.onLine || cloudSyncPromise || cloudSyncTimer) return;
  if (localStorage.getItem(CLOUD_PENDING_KEY)) {
    return pushLocalCloudSnapshot({ render: false, showSuccess: false });
  }

  return runCloudTask(async () => {
    const remote = await downloadCloudBackup();
    if (!remote.exists) return;
    const changes = await applyRemoteBackup(remote);
    // A local edit may have happened while this download was in progress.
    if (!localStorage.getItem(CLOUD_PENDING_KEY)) {
      setCloudSyncMeta({
        status: 'synced',
        lastSyncAt: new Date().toISOString(),
        lastUploadedAt: remote.uploadedAt,
        recordCount: remote.recordCount,
        message: '本机和云端已同步'
      });
    }
    const route = location.hash.replace('#', '') || 'dashboard';
    cloudRenderPending ||= Boolean(changes.imported || changes.deleted || changes.settingsChanged);
    if (cloudRenderPending && currentRoute !== 'record' && !$id('modal-overlay')?.classList.contains('active')) {
      await handleRoute(route);
    }
    refreshSyncStatus();
    return { ok: true };
  }, { showSuccess: false });
}

async function applyRemoteBackup(remote = {}) {
  const deleteSummary = await applyDeletedRecordKeys(remote.deletedRecordKeys || []);
  const importSummary = await importRecords(remote.records || []);
  const previousSettings = JSON.stringify(settings);
  if (remote.settings) {
    await importSettings(remote.settings);
    await refreshSettings();
  }
  if (importSummary.imported > 0 || deleteSummary.deleted > 0) {
    await refreshData();
  }
  return {
    imported: importSummary.imported || 0,
    deleted: deleteSummary.deleted || 0,
    settingsChanged: previousSettings !== JSON.stringify(settings)
  };
}

function startAutoRefresh() {
  setInterval(pullCloudUpdates, CLOUD_POLL_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullCloudUpdates();
  });
  window.addEventListener('focus', pullCloudUpdates);
  window.addEventListener('pageshow', pullCloudUpdates);
  window.addEventListener('online', pullCloudUpdates);
  document.addEventListener('eggButlerModalClosed', () => {
    if (cloudRenderPending && currentRoute !== 'record') {
      handleRoute(location.hash.replace('#', '') || 'dashboard');
    }
  });
  setInterval(async () => {
    const route = location.hash.replace('#', '') || 'dashboard';
    if (route === 'dashboard') {
      predictions = predictAll(records);
      const dashboard = await import('./views/dashboard.js');
      dashboard.render($id('app-content'), predictions, stats, records, settings);
    }
  }, 60000);
}

function showQuickRecordModal(preSelectedType) {
  const typeIcons = { drink: '💧', eat: '🍚', poop: '💩', pee: '💦' };
  const typeLabels = { drink: '喝水', eat: '吃饭', poop: '排便', pee: '尿尿' };
  const petName = settings.petName || '宠物';
  const defaultAmounts = {
    drink: settings.drinkDefaultAmount || settings.drinkGoal || 607,
    eat: settings.mealDefaultAmount || settings.mealDefault || 465
  };
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
      <h3 class="settings-title">✨ 快速记录 ${petName}</h3>
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
