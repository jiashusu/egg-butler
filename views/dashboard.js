import { formatTime, formatDateCN, intervalText, formatDate, formatRelative, formatDateTime, toLocalISO } from '../utils/time.js';
import { createElement, $id, showToast, showModal, hideModal } from '../utils/dom.js';
import { DEFAULT_PET_PHOTO, getAllRecords, clearAllData, getRecordCount, getSettings, saveSettings, updateRecord, deleteRecord, addRecords } from '../db.js';
import { getCloudBackupId, getCloudSyncMeta, setCloudBackupId } from '../utils/cloudBackup.js';
import { POOP_OPTIONS, poopLabel, normalizePoopStatus } from '../utils/poopStatus.js';

const TYPE_INFO = {
  drink: { icon: '💧', label: '喝水', unit: 'ml', color: '#4A90D9' },
  eat: { icon: '🍚', label: '吃饭', unit: 'g', color: '#FF9800' },
  poop: { icon: '💩', label: '排便', unit: '', color: '#4CAF50' },
  pee: { icon: '💦', label: '尿尿', unit: '', color: '#9C27B0' }
};

let currentPredictions = null;
let currentStats = null;
let onRecordCallback = null;
let onCardClickCallback = null;
let onAnalyticsCallback = null;

export function setCallbacks({ onRecord, onCardClick, onAnalytics }) {
  onRecordCallback = onRecord;
  onCardClickCallback = onCardClick;
  onAnalyticsCallback = onAnalytics;
}

export function render(container, predictions, stats, records = [], settings = {}) {
  currentPredictions = predictions;
  currentStats = stats;

  container.innerHTML = '';

  const today = new Date();
  const hour = today.getHours();
  let greeting = '早上好';
  if (hour >= 12 && hour < 18) greeting = '下午好';
  else if (hour >= 18) greeting = '晚上好';

  const header = createElement('div', { className: 'dash-header' }, [
    createElement('div', { className: 'dash-header-top' }, [
      createElement('h1', { className: 'dash-title' }, `${settings.petName || '宠物'}管家`),
      createElement('div', { className: 'dash-header-actions' }, [
        createElement('button', {
          className: 'btn-icon',
          title: '刷新并同步云端',
          'aria-label': '刷新并同步云端',
          onclick: handleHeaderSync
        }, '↻'),
        createElement('button', {
          className: 'btn-icon',
          title: '数据管理',
          'aria-label': '数据管理',
          onclick: showSettingsModal
        }, '⚙️')
      ])
    ]),
    createElement('p', { className: 'dash-greeting' }, `${greeting}，${settings.petName || '宠物'} 🐾`)
  ]);
  container.appendChild(header);
  container.appendChild(createDogProfileCard(stats, settings, predictions));
  const alerts = createAlertPanel(records, stats, predictions, settings);
  if (alerts) container.appendChild(alerts);

  const grid = createElement('div', { className: 'prediction-grid' });
  const types = ['drink', 'eat', 'poop', 'pee'];

  for (const type of types) {
    const pred = predictions[type];
    const stat = stats[type];
    const info = TYPE_INFO[type];
    const card = createPredictionCard(type, pred, stat, info);
    grid.appendChild(card);
  }

  container.appendChild(grid);
  container.appendChild(createAnalyticsEntry());
  container.appendChild(createMasterSyncPanel(records));

  const fab = createElement('button', {
    className: 'fab',
    onclick: () => {
      if (onRecordCallback) onRecordCallback();
    }
  }, '✨ 记录');
  container.appendChild(fab);
}

async function handleHeaderSync(event) {
  const button = event?.currentTarget;
  if (!window.syncCloudNow || button?.disabled) return;

  if (button) {
    button.disabled = true;
    button.classList.add('syncing');
    button.setAttribute('aria-busy', 'true');
  }

  const result = await window.syncCloudNow({ render: true, showSuccess: false });
  if (result === null) {
    showToast('正在同步，请稍等');
  } else if (result?.ok === false) {
    showToast(result.error?.message || '云端同步失败');
  } else {
    showToast('已同步最新数据');
  }

  if (button) {
    button.disabled = false;
    button.classList.remove('syncing');
    button.removeAttribute('aria-busy');
  }
}

function createDogProfileCard(stats, settings, predictions = {}) {
  const petName = settings.petName || '宠物';
  const species = settings.species || '宠物';
  const breed = settings.breed || '';
  const age = settings.age ? ` · ${settings.age}岁` : '';
  const photoUrl = settings.photoUrl || DEFAULT_PET_PHOTO;
  const dueActivities = getDueActivities(predictions);

  return createElement('section', { className: 'dog-profile-card' }, [
    createElement('div', { className: 'dog-profile-copy' }, [
      createElement('span', { className: 'dog-profile-kicker' }, '今日陪伴对象'),
      createElement('h2', { className: 'dog-profile-name' }, petName),
      createElement('p', { className: 'dog-profile-note' }, `${breed || species}${age} · 吃喝拉撒观察中`),
      dueActivities.length > 0
        ? createElement('div', { className: 'dog-profile-due-list' }, dueActivities.map(item =>
          createElement('span', { className: `dog-profile-due dog-profile-due-${item.type}` }, `${item.icon} ${item.text}`)
        ))
        : createElement('span', { className: 'dog-profile-steady' }, '本轮继续观察节奏')
    ]),
    createElement('div', { className: 'dog-photo-frame' }, [
      createElement('img', {
        className: 'dog-photo-blur',
        src: photoUrl,
        alt: ''
      }),
      createElement('img', {
        className: 'dog-photo',
        src: photoUrl,
        alt: `${petName}的照片`
      })
    ])
  ]);
}

function getDueActivities(predictions = {}) {
  return ['drink', 'eat', 'poop', 'pee']
    .map(type => {
      const pred = predictions[type];
      const info = TYPE_INFO[type];
      if (!pred?.nextTime || !info) return null;
      const nextTime = new Date(pred.nextTime).getTime();
      if (Number.isNaN(nextTime) || Date.now() < nextTime) return null;
      return {
        type,
        icon: info.icon,
        text: getDueMessage(type, info)
      };
    })
    .filter(Boolean);
}

function getDueMessage(type, info) {
  return type === 'poop' || type === 'pee'
    ? `该${info.label}了`
    : `该${info.label}啦`;
}

function createAlertPanel(records, stats, predictions, settings) {
  const alerts = getActiveAlerts(records, stats, predictions, settings);
  if (alerts.length === 0) return null;

  return createElement('section', { className: 'smart-alert-panel' }, [
    createElement('div', { className: 'smart-alert-head' }, [
      createElement('span', {}, '提醒'),
      createElement('strong', {}, `${alerts.length}条`)
    ]),
    ...alerts.map(alert => createElement('div', { className: `smart-alert smart-alert-${alert.level}` }, [
      createElement('span', { className: 'smart-alert-icon' }, alert.icon),
      createElement('span', { className: 'smart-alert-text' }, alert.text)
    ]))
  ]);
}

function getActiveAlerts(records, stats, predictions, settings) {
  const alerts = [];
  const sorted = records.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentPoops = sorted.filter(record => record.type === 'poop').slice(0, 3);
  const diarrheaStreak = recentPoops.filter(record => record.value === 'diarrhea').length;
  const drinkGoalCount = settings.drinkGoalCount || 3;
  const mealGoalCount = settings.mealGoalCount || 1;
  const drinkCount = stats.drink?.todayCount || 0;
  const mealCount = stats.eat?.todayCount || 0;
  const peePred = predictions.pee;

  if (recentPoops.length >= 2 && recentPoops.slice(0, 2).every(record => record.value === 'diarrhea')) {
    alerts.push({ level: 'danger', icon: '💩', text: '最近连续拉稀 2 次，先观察精神和饮食，必要时联系医生。' });
  } else if (diarrheaStreak > 0 || (stats.poop?.poopAbnormalToday || 0) > 0) {
    alerts.push({ level: 'warn', icon: '💩', text: '今天有排便异常，建议继续记录下一次状态。' });
  }

  if (drinkCount > drinkGoalCount && drinkGoalCount > 0) {
    alerts.push({ level: 'warn', icon: '💧', text: `本轮喝水 ${drinkCount}次，高于目标 ${drinkGoalCount}次。` });
  }

  if (mealCount > mealGoalCount && mealGoalCount > 0) {
    alerts.push({ level: 'warn', icon: '🍚', text: `本轮吃饭 ${mealCount}次，高于目标 ${mealGoalCount}次。` });
  }

  const lastPee = sorted.find(record => record.type === 'pee');
  if (lastPee && peePred?.avgInterval) {
    const minutesSincePee = (Date.now() - new Date(lastPee.timestamp).getTime()) / 60000;
    if (minutesSincePee > peePred.avgInterval * 1.8 && minutesSincePee > 360) {
      alerts.push({ level: 'info', icon: '💦', text: `距离上次尿尿已经 ${intervalText(minutesSincePee)}，可以留意一下。` });
    }
  }

  return alerts.slice(0, 3);
}

function createPredictionCard(type, pred, stat, info) {
  const card = createElement('div', {
    className: 'prediction-card',
    style: { borderTopColor: info.color },
    onclick: () => {
      if (onCardClickCallback) onCardClickCallback(type);
    }
  });

  const nameTime = createElement('div', { className: 'card-header' }, [
    createElement('span', { className: 'card-icon' }, info.icon),
    createElement('span', { className: 'card-type' }, info.label)
  ]);

  const predSection = createElement('div', { className: 'card-prediction' });

  if (!pred || !pred.nextTime) {
    const lastDate = stat?.lastTimestamp ? new Date(stat.lastTimestamp) : null;
    const sinceLastText = lastDate
      ? `距上次：${intervalText((Date.now() - lastDate.getTime()) / 60000)}`
      : '距上次：暂无记录';
    const lastTimeText = lastDate ? `上次时间：${formatDateTime(lastDate)}` : '上次时间：暂无';

    predSection.innerHTML = `
      <div class="pred-time">--:--</div>
      <div class="pred-last">${sinceLastText}</div>
      <div class="pred-last">${lastTimeText}</div>
      <div class="pred-message">${pred?.message || '暂无数据'}</div>
    `;
  } else {
    const nextDate = new Date(pred.nextTime);
    const today = formatDateCN(new Date());
    const predDate = formatDateCN(nextDate);
    const timeStr = formatTime(nextDate);

    const timePrefix = predDate === today ? '预计今天' : `预计${predDate}`;

    const confidencePercent = Math.round((pred.confidence || 0) * 100);
    const lastDate = stat?.lastTimestamp ? new Date(stat.lastTimestamp) : null;
    const sinceLastText = stat?.lastTimestamp
      ? `距上次：${intervalText((Date.now() - lastDate.getTime()) / 60000)}`
      : '距上次：暂无记录';
    const lastTimeText = lastDate ? `上次时间：${formatDateTime(lastDate)}` : '上次时间：暂无';
    const dueMessage = Date.now() >= nextDate.getTime() ? getDueMessage(type, info) : pred.message || '';

    predSection.innerHTML = `
      <div class="pred-time-row">
        <span class="pred-time-prefix">${timePrefix}</span>
        <span class="pred-time">${timeStr}</span>
      </div>
      <div class="pred-last">${sinceLastText}</div>
      <div class="pred-last">${lastTimeText}</div>
      <div class="confidence-bar-wrap">
        <div class="confidence-bar" style="width:${confidencePercent}%"></div>
      </div>
      <div class="pred-message">${dueMessage}</div>
    `;
  }

  const todayInfo = createElement('div', { className: 'card-today' });
  if (stat) {
    const todayText = stat.todayCount > 0
      ? `本轮已${info.label} ${stat.todayCount}次`
      : '本轮暂无记录';

    const poopText = type === 'poop' && stat.poopAbnormalToday > 0
      ? `，异常 ${stat.poopAbnormalToday}次`
      : '';

    todayInfo.textContent = todayText + poopText;
  }

  const recordBtn = createElement('button', {
    className: 'card-record-btn',
    onclick: (e) => {
      e.stopPropagation();
      if (onRecordCallback) onRecordCallback(type);
    }
  }, `+ ${info.label}`);

  card.appendChild(nameTime);
  card.appendChild(predSection);
  card.appendChild(todayInfo);
  card.appendChild(recordBtn);

  return card;
}

function createAnalyticsEntry() {
  return createElement('button', {
    className: 'insight-entry',
    onclick: () => {
      if (onAnalyticsCallback) onAnalyticsCallback();
    }
  }, [
    createElement('span', { className: 'insight-entry-icon' }, '📊'),
    createElement('span', { className: 'insight-entry-copy' }, [
      createElement('span', { className: 'insight-entry-title' }, '详细数据'),
      createElement('span', { className: 'insight-entry-subtitle' }, '吃饭、喝水、上厕所趋势和记录表')
    ]),
    createElement('span', { className: 'insight-entry-arrow' }, '›')
  ]);
}

function createMasterSyncPanel(records) {
  const syncCode = getCloudBackupId();
  const syncMeta = getCloudSyncMeta();
  window._copyMasterSyncCode = async () => {
    try {
      await navigator.clipboard.writeText(getCloudBackupId());
      showToast('同步码已复制');
    } catch (error) {
      showToast(getCloudBackupId());
    }
  };

  window._bindMasterSyncCode = async () => {
    try {
      setCloudBackupId(getCloudBackupId());
      showToast('同步码已绑定');
      await window.syncCloudNow?.({ render: true, showSuccess: true });
    } catch (error) {
      showToast(error?.message || '绑定失败');
    }
  };

  return createElement('div', { className: 'master-sync-panel' }, [
    createElement('p', { className: 'master-sync-label' }, '当前同步码：'),
    createElement('p', { className: 'master-sync-code' }, syncCode),
    createElement('div', { className: 'master-sync-actions' }, [
      createElement('button', {
        className: 'master-sync-btn',
        onclick: window._bindMasterSyncCode
      }, '一键同步'),
      createElement('button', {
        className: 'master-sync-btn secondary',
        onclick: window._copyMasterSyncCode
      }, '复制同步码')
    ]),
    createElement('p', { className: `sync-status-line sync-status-${syncMeta.status}` }, getSyncStatusText(syncMeta)),
    createElement('p', { className: 'last-update-line' }, getLastUpdateText(records)),
    createElement('a', {
      className: 'author-link',
      href: 'https://github.com/jiashusu',
      target: '_blank',
      rel: 'noopener noreferrer'
    }, '原作者：shu')
  ]);
}

function getSyncStatusText(meta) {
  if (meta.status === 'synced' && meta.lastSyncAt) {
    return `云端同步：${formatRelative(new Date(meta.lastSyncAt))} · ${meta.recordCount || 0}条 · 已一致`;
  }
  if (meta.status === 'pending') return '云端同步：本机有新数据，等待上传';
  if (meta.status === 'syncing') return '云端同步：正在同步...';
  if (meta.status === 'error') return `云端同步：${meta.message || '同步失败'}`;
  return '云端同步：等待第一次同步';
}

export function refreshSyncStatus() {
  const line = document.querySelector('.sync-status-line');
  if (!line) return;
  const meta = getCloudSyncMeta();
  line.className = `sync-status-line sync-status-${meta.status}`;
  line.textContent = getSyncStatusText(meta);
}

function getLastUpdateText(records) {
  if (!records || records.length === 0) {
    return '最后一次更新：暂无记录';
  }

  const latest = records
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const date = new Date(latest.timestamp);
  const diff = Date.now() - date.getTime();
  const text = diff < 2 * 24 * 60 * 60 * 1000
    ? formatRelative(date)
    : formatDateTime(date);

  return `最后一次更新：${text}`;
}

async function showSettingsModal() {
  const count = await getRecordCount();
  const settings = await getSettings();

  window._exportEggButlerData = async () => {
    const records = await getAllRecords();
    const data = JSON.stringify(records, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `egg-butler-backup-${formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出');
  };

  window._clearEggButlerData = async () => {
    if (!confirm('确定清空所有数据？此操作不可撤销！')) return;

    await clearAllData();
    let syncResult = null;
    if (typeof window.onRecordSaved === 'function') {
      syncResult = await window.onRecordSaved({ syncNow: true });
    }
    hideModal();
    showToast(syncResult?.ok === false ? '本机已清空，云端同步失败' : '已清空所有数据并同步');
  };

  window._savePetProfile = async () => {
    const next = {
      ...(await getSettings()),
      petName: document.getElementById('pet-name')?.value?.trim() || '宠物',
      species: document.getElementById('pet-species')?.value?.trim() || '宠物',
      breed: document.getElementById('pet-breed')?.value?.trim() || '',
      age: parseFloat(document.getElementById('pet-age')?.value) || '',
      drinkGoalCount: parseInt(document.getElementById('pet-drink-goal-count')?.value, 10) || 3,
      mealGoalCount: parseInt(document.getElementById('pet-meal-goal-count')?.value, 10) || 1
    };

    const file = document.getElementById('pet-photo')?.files?.[0];
    if (file) {
      next.photoUrl = await fileToDataUrl(file);
    }

    await saveSettings(next);
    showToast('资料已保存');
    hideModal();
    if (typeof window.onSettingsSaved === 'function') {
      await window.onSettingsSaved();
    }
  };

  window._showRecordManager = async () => {
    const records = (await getAllRecords()).slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    showModal(`
      <div class="settings-modal data-manager-modal">
        <h3 class="settings-title">📋 历史数据</h3>
        <div class="data-manager-list">
          ${records.length === 0 ? '<p class="settings-hint">还没有记录</p>' : records.slice(0, 80).map(record => renderManagedRecord(record)).join('')}
        </div>
        <button class="settings-btn" onclick="window._showBatchAdd()">批量添加数据</button>
        <button class="settings-btn settings-btn-close" onclick="window._closeEggButlerSettings()">关闭</button>
      </div>
    `);
  };

  window._editManagedRecord = async (id) => {
    const records = await getAllRecords();
    const record = records.find(item => item.id === id);
    if (!record) return;

    showModal(renderRecordEditForm(record));
    window._toggleManagedRecordFields(record.type);
  };

  window._toggleManagedRecordFields = (type) => {
    const amountGroup = document.getElementById('managed-amount-group');
    const poopGroup = document.getElementById('managed-poop-group');
    if (amountGroup) amountGroup.style.display = type === 'drink' || type === 'eat' ? 'block' : 'none';
    if (poopGroup) poopGroup.style.display = type === 'poop' ? 'block' : 'none';
  };

  window._saveManagedRecord = async (id) => {
    const type = document.getElementById('managed-type')?.value;
    const timeValue = document.getElementById('managed-time')?.value;
    if (!['drink', 'eat', 'poop', 'pee'].includes(type)) return showToast('类型无效');
    if (!timeValue || Number.isNaN(new Date(timeValue).getTime())) return showToast('时间无效');

    let amount = null;
    let value = null;
    if (type === 'drink' || type === 'eat') {
      amount = parseFloat(document.getElementById('managed-amount')?.value);
      if (!amount || amount <= 0) return showToast('数量无效');
    }
    if (type === 'poop') {
      value = document.getElementById('managed-poop-value')?.value || 'normal';
    }

    await updateRecord(id, { type, timestamp: new Date(timeValue).toISOString(), amount, value });
    hideModal();
    const syncResult = typeof window.onRecordSaved === 'function'
      ? await window.onRecordSaved({ syncNow: true })
      : null;
    showToast(syncResult?.ok === false ? '本机已更新，云端同步失败' : '记录已更新并同步');
  };

  window._deleteManagedRecord = async (id) => {
    if (!confirm('删除这条记录？')) return;
    await deleteRecord(id);
    const syncResult = typeof window.onRecordSaved === 'function'
      ? await window.onRecordSaved({ syncNow: true })
      : null;
    showToast(syncResult?.ok === false ? '本机已删除，云端同步失败' : '记录已删除并同步');
    await window._showRecordManager();
  };

  window._showBatchAdd = () => {
    showModal(`
      <div class="settings-modal">
        <h3 class="settings-title">➕ 批量添加数据</h3>
        <p class="settings-hint">每行一条：类型, 数量或状态, 时间。例：drink,607,2026-05-08 08:30</p>
        <textarea id="batch-records" class="form-input batch-textarea" placeholder="drink,607,2026-05-08 08:30&#10;eat,465,2026-05-08 18:00&#10;poop,normal,2026-05-08 19:10&#10;pee,,2026-05-08 20:00"></textarea>
        <button class="settings-btn settings-btn-close" onclick="window._saveBatchRecords()">保存批量数据</button>
        <button class="settings-btn" onclick="window._showRecordManager()">返回历史数据</button>
      </div>
    `);
  };

  window._saveBatchRecords = async () => {
    const text = document.getElementById('batch-records')?.value || '';
    const records = text.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseBatchLine)
      .filter(Boolean);

    const added = await addRecords(records);
    showToast(`已添加 ${added} 条`);
    if (typeof window.onRecordSaved === 'function') await window.onRecordSaved();
  };

  window._closeEggButlerSettings = () => {
    hideModal();
  };

  window._copyEggButlerSyncCode = async () => {
    const code = getCloudBackupId();
    const input = document.getElementById('cloud-sync-code');
    try {
      await navigator.clipboard.writeText(code);
      showToast('同步码已复制');
    } catch (error) {
      input?.select();
      showToast('已选中同步码');
    }
  };

  window._bindEggButlerSyncCode = async () => {
    const input = document.getElementById('cloud-sync-code');
    const statusEl = document.getElementById('cloud-backup-status');
    try {
      setCloudBackupId(input?.value || '');
      statusEl.textContent = '同步码已绑定，正在同步...';
      const result = await window.syncCloudNow?.({ render: true, showSuccess: false });
      if (result?.ok === false) throw result.error;
      statusEl.textContent = getSyncStatusText(getCloudSyncMeta());
      showToast('同步码已绑定');
    } catch (error) {
      const message = error?.message || '同步码无效';
      statusEl.textContent = message;
      showToast(message);
    }
  };

  window._syncEggButlerNow = async () => {
    const statusEl = document.getElementById('cloud-backup-status');
    statusEl.textContent = '正在同步...';
    const result = await window.syncCloudNow?.({ render: true, showSuccess: false });
    if (result?.ok === false) {
      statusEl.textContent = result.error?.message || '同步失败';
      showToast('云端同步失败');
      return;
    }
    statusEl.textContent = getSyncStatusText(getCloudSyncMeta());
    showToast('云端同步完成');
  };

  const syncCode = getCloudBackupId();
  const petName = escapeHTML(settings.petName || '宠物');
  const species = escapeHTML(settings.species || '宠物');
  const breed = escapeHTML(settings.breed || '');
  const age = settings.age ?? '';
  const drinkGoalCount = settings.drinkGoalCount || 3;
  const mealGoalCount = settings.mealGoalCount || 1;
  const syncMeta = getCloudSyncMeta();

  showModal(`
    <div class="settings-modal">
      <h3 class="settings-title">⚙️ 数据管理</h3>
      <div class="settings-info">
        <p>🐾 ${petName} · ${breed || species}${age ? ` · ${age}岁` : ''}</p>
        <p>📊 共 ${count} 条记录</p>
      </div>
      <div class="settings-profile">
        <p class="settings-section-title">宠物资料</p>
        <input id="pet-name" class="form-input" value="${petName}" placeholder="名字">
        <input id="pet-species" class="form-input" value="${species}" placeholder="物种，例如 狗狗 / 猫咪">
        <input id="pet-breed" class="form-input" value="${breed}" placeholder="品种">
        <input id="pet-age" class="form-input" type="number" min="0" step="0.1" value="${age}" placeholder="年龄">
        <input id="pet-photo" class="form-input" type="file" accept="image/*">
        <div class="settings-target-grid">
          <label>
            <span>本轮喝水目标次数</span>
            <input id="pet-drink-goal-count" class="form-input" type="number" min="1" step="1" value="${drinkGoalCount}">
          </label>
          <label>
            <span>本轮吃饭目标次数</span>
            <input id="pet-meal-goal-count" class="form-input" type="number" min="1" step="1" value="${mealGoalCount}">
          </label>
        </div>
        <button class="settings-btn settings-btn-close" onclick="window._savePetProfile()">保存资料</button>
      </div>
      <div class="settings-actions">
        <button class="settings-btn" onclick="window._showRecordManager()">
          ✏️ 管理历史数据
        </button>
        <button class="settings-btn" onclick="window._exportEggButlerData()">
          📤 导出数据
        </button>
        <button class="settings-btn settings-btn-danger" onclick="window._clearEggButlerData()">
          🗑️ 清空数据
        </button>
      </div>
      <div class="settings-cloud">
        <p class="settings-section-title">云端自动同步</p>
        <input
          id="cloud-sync-code"
          class="form-input"
          type="text"
          autocomplete="off"
          value="${syncCode}"
          spellcheck="false"
        >
        <div class="settings-actions settings-actions-row">
          <button class="settings-btn" onclick="window._copyEggButlerSyncCode()">复制同步码</button>
          <button class="settings-btn" onclick="window._bindEggButlerSyncCode()">绑定同步码</button>
        </div>
        <button class="settings-btn settings-btn-wide" onclick="window._syncEggButlerNow()">立即同步</button>
        <p id="cloud-backup-status" class="settings-hint">${getSyncStatusText(syncMeta)}。新设备输入同一个同步码后，会自动合并加载云端记录。</p>
      </div>
      <button class="settings-btn settings-btn-close" onclick="window._closeEggButlerSettings()">关闭</button>
    </div>
  `);
}

function renderManagedRecord(record) {
  const info = TYPE_INFO[record.type] || { label: record.type, icon: '' };
  const value = record.amount != null
    ? `${record.amount}${info.unit || ''}`
    : record.type === 'poop'
      ? poopLabel(record.value)
      : '1次';

  return `
    <div class="managed-record-row">
      <div>
        <strong>${info.icon} ${info.label}</strong>
        <span>${formatDateTime(new Date(record.timestamp))} · ${value}</span>
      </div>
      <button onclick="window._editManagedRecord(${record.id})">编辑</button>
      <button onclick="window._deleteManagedRecord(${record.id})">删除</button>
    </div>
  `;
}

function renderRecordEditForm(record) {
  const info = TYPE_INFO[record.type] || TYPE_INFO.drink;
  const amountValue = record.amount ?? '';
  const poopValue = record.value || 'normal';
  const options = Object.entries(TYPE_INFO).map(([key, typeInfo]) =>
    `<option value="${key}"${record.type === key ? ' selected' : ''}>${typeInfo.icon} ${typeInfo.label}</option>`
  ).join('');
  const poopOptions = POOP_OPTIONS.map(({ key: value }) =>
    `<option value="${value}"${poopValue === value ? ' selected' : ''}>${poopLabel(value)}</option>`
  ).join('');

  return `
    <div class="settings-modal record-edit-modal">
      <h3 class="settings-title">✏️ 编辑记录</h3>
      <div class="record-edit-form">
        <label>
          <span>类型</span>
          <select id="managed-type" class="form-input" onchange="window._toggleManagedRecordFields(this.value)">
            ${options}
          </select>
        </label>
        <label>
          <span>时间</span>
          <input id="managed-time" class="form-input" type="datetime-local" value="${toLocalISO(new Date(record.timestamp))}">
        </label>
        <label id="managed-amount-group">
          <span>${info.label}量</span>
          <input id="managed-amount" class="form-input" type="number" min="1" step="1" value="${amountValue}">
        </label>
        <label id="managed-poop-group">
          <span>排便状态</span>
          <select id="managed-poop-value" class="form-input">
            ${poopOptions}
          </select>
        </label>
      </div>
      <button class="settings-btn settings-btn-close" onclick="window._saveManagedRecord(${record.id})">保存修改</button>
      <button class="settings-btn" onclick="window._showRecordManager()">返回历史数据</button>
    </div>
  `;
}

function parseBatchLine(line) {
  const [rawType, rawValue, ...timeParts] = line.split(',').map(part => part.trim());
  const type = rawType;
  if (!['drink', 'eat', 'poop', 'pee'].includes(type)) return null;

  const timestamp = new Date(timeParts.join(',').replace(' ', 'T'));
  if (Number.isNaN(timestamp.getTime())) return null;

  const record = { type, timestamp: timestamp.toISOString() };
  if (type === 'drink' || type === 'eat') {
    const amount = parseFloat(rawValue);
    if (!amount || amount <= 0) return null;
    record.amount = amount;
  } else if (type === 'poop') {
    record.value = normalizePoopStatus(rawValue);
  }
  return record;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
