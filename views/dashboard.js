import { formatTime, formatDateCN, intervalText, formatDate, formatRelative, formatDateTime } from '../utils/time.js';
import { createElement, $id, showToast, showModal, hideModal } from '../utils/dom.js';
import { getAllRecords, clearAllData, getRecordCount } from '../db.js';
import { getCloudBackupId, setCloudBackupId } from '../utils/cloudBackup.js';

const MASTER_SYNC_CODE = 'egg_0vXBeqdhlu2APFr6BPPWaDBM00hh4Xva';

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

export function render(container, predictions, stats, records = []) {
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
      createElement('h1', { className: 'dash-title' }, '蛋蛋管家'),
      createElement('button', {
        className: 'btn-icon',
        onclick: showSettingsModal
      }, '⚙️')
    ]),
    createElement('p', { className: 'dash-greeting' }, `${greeting}，蛋蛋 🐾`)
  ]);
  container.appendChild(header);
  container.appendChild(createDogProfileCard(stats));

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

function createDogProfileCard(stats) {
  const drinkText = stats.drink?.todayCount > 0
    ? `${Math.round(stats.drink.totalToday || 0)}ml`
    : '待记录';
  const eatText = stats.eat?.todayCount > 0
    ? `${Math.round(stats.eat.totalToday || 0)}g`
    : '待记录';

  return createElement('section', { className: 'dog-profile-card' }, [
    createElement('div', { className: 'dog-profile-copy' }, [
      createElement('span', { className: 'dog-profile-kicker' }, '今日陪伴对象'),
      createElement('h2', { className: 'dog-profile-name' }, '蛋蛋'),
      createElement('p', { className: 'dog-profile-note' }, '边牧 · 吃喝拉撒观察中'),
      createElement('div', { className: 'dog-profile-pills' }, [
        createElement('span', {}, `喝水 ${drinkText}`),
        createElement('span', {}, `吃饭 ${eatText}`)
      ])
    ]),
    createElement('div', { className: 'dog-photo-frame' }, [
      createElement('img', {
        className: 'dog-photo-blur',
        src: '/assets/dandan-portrait.jpeg',
        alt: ''
      }),
      createElement('img', {
        className: 'dog-photo',
        src: '/assets/dandan-portrait.jpeg',
        alt: '蛋蛋的照片'
      })
    ])
  ]);
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
    predSection.innerHTML = `
      <div class="pred-time">--:--</div>
      <div class="pred-message">暂无数据</div>
    `;
  } else {
    const nextDate = new Date(pred.nextTime);
    const today = formatDateCN(new Date());
    const predDate = formatDateCN(nextDate);
    const timeStr = formatTime(nextDate);

    const timeLabel = predDate === today ? `预计今天 ${timeStr}` : `预计 ${predDate} ${timeStr}`;

    const confidencePercent = Math.round((pred.confidence || 0) * 100);

    predSection.innerHTML = `
      <div class="pred-time">${timeStr}</div>
      <div class="pred-label">${timeLabel}</div>
      <div class="confidence-bar-wrap">
        <div class="confidence-bar" style="width:${confidencePercent}%"></div>
      </div>
      <div class="pred-message">${pred.message || ''}</div>
    `;
  }

  const todayInfo = createElement('div', { className: 'card-today' });
  if (stat) {
    const todayText = stat.todayCount > 0
      ? `今日已${info.label} ${stat.todayCount}次`
      : '今日暂无记录';

    const amountText = stat.totalToday > 0
      ? ` (${Math.round(stat.totalToday)}${info.unit})`
      : '';

    const poopText = type === 'poop' && stat.poopAbnormalToday > 0
      ? `，异常 ${stat.poopAbnormalToday}次`
      : '';

    todayInfo.textContent = todayText + amountText + poopText;
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
  window._copyMasterSyncCode = async () => {
    try {
      await navigator.clipboard.writeText(MASTER_SYNC_CODE);
      showToast('主设备同步码已复制');
    } catch (error) {
      showToast(MASTER_SYNC_CODE);
    }
  };

  window._bindMasterSyncCode = async () => {
    try {
      setCloudBackupId(MASTER_SYNC_CODE);
      showToast('已绑定主设备同步码');
      await window.syncCloudNow?.({ render: true, showSuccess: true });
    } catch (error) {
      showToast(error?.message || '绑定失败');
    }
  };

  return createElement('div', { className: 'master-sync-panel' }, [
    createElement('p', { className: 'master-sync-label' }, '主设备的同步码：'),
    createElement('p', { className: 'master-sync-code' }, MASTER_SYNC_CODE),
    createElement('div', { className: 'master-sync-actions' }, [
      createElement('button', {
        className: 'master-sync-btn',
        onclick: window._bindMasterSyncCode
      }, '一键绑定同步码'),
      createElement('button', {
        className: 'master-sync-btn secondary',
        onclick: window._copyMasterSyncCode
      }, '复制同步码')
    ]),
    createElement('p', { className: 'last-update-line' }, getLastUpdateText(records))
  ]);
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
    hideModal();
    showToast('已清空所有数据');
    if (typeof window.onRecordSaved === 'function') {
      await window.onRecordSaved();
    }
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
      statusEl.textContent = '已绑定并同步完成';
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
    statusEl.textContent = '同步完成';
    showToast('云端同步完成');
  };

  const syncCode = getCloudBackupId();

  showModal(`
    <div class="settings-modal">
      <h3 class="settings-title">⚙️ 数据管理</h3>
      <div class="settings-info">
        <p>🐾 蛋蛋 · 边牧 · 2岁</p>
        <p>📊 共 ${count} 条记录</p>
      </div>
      <div class="settings-actions">
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
        <p id="cloud-backup-status" class="settings-hint">新设备输入同一个同步码后，会自动合并加载云端记录。</p>
      </div>
      <button class="settings-btn settings-btn-close" onclick="window._closeEggButlerSettings()">关闭</button>
    </div>
  `);
}
