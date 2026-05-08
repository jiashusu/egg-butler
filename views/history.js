import { createElement, showToast, showLoading, showEmpty } from '../utils/dom.js';
import { formatDateTime, formatRelative, intervalText, formatDateCN } from '../utils/time.js';
import { getRecordsByType, deleteRecord } from '../db.js';
import { getStats } from '../prediction.js';
import { createTimelineChart, createFrequencyChart, createWeekChart } from '../charts.js';

const TYPE_INFO = {
  drink: { icon: '💧', label: '喝水', unit: 'ml', color: '#4A90D9' },
  eat: { icon: '🍚', label: '吃饭', unit: 'g', color: '#FF9800' },
  poop: { icon: '💩', label: '排便', unit: '', color: '#4CAF50' },
  pee: { icon: '💦', label: '尿尿', unit: '', color: '#9C27B0' }
};

const POOP_STATUS = {
  normal: { label: '正常', className: 'poop-normal' },
  small: { label: '少量', className: 'poop-small' },
  diarrhea: { label: '拉稀', className: 'poop-diarrhea' },
  soft: { label: '偏软', className: 'poop-soft' },
  dry: { label: '偏干', className: 'poop-dry' }
};

let currentType = null;
let allRecords = [];

export async function render(container, type, allRecordsData) {
  currentType = type;
  allRecords = allRecordsData || [];
  container.innerHTML = '';

  const info = TYPE_INFO[type];
  if (!info) return;

  const page = createElement('div', { className: 'history-page' });

  const header = createElement('div', { className: 'page-header' }, [
    createElement('button', {
      className: 'btn-back',
      onclick: () => {
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
      }
    }, '← 返回'),
    createElement('h2', { className: 'page-title' }, `${info.icon} ${info.label}记录`)
  ]);
  page.appendChild(header);

  const stat = getStats(type, allRecords);

  const statsBar = createElement('div', { className: 'stats-bar' });
  if (stat.totalRecords > 0) {
    statsBar.innerHTML = `
      <div class="stat-item">
        <span class="stat-value">${stat.totalRecords}</span>
        <span class="stat-label">总次数</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${stat.avgInterval ? intervalText(stat.avgInterval) : '--'}</span>
        <span class="stat-label">平均间隔</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${stat.todayCount}</span>
        <span class="stat-label">今日</span>
      </div>
      ${stat.totalToday > 0 ? `
        <div class="stat-item">
          <span class="stat-value">${Math.round(stat.totalToday)}</span>
          <span class="stat-label">${info.unit}/日</span>
        </div>
      ` : ''}
      ${type === 'poop' ? `
        <div class="stat-item">
          <span class="stat-value">${Math.round((stat.poopNormalRate || 0) * 100)}%</span>
          <span class="stat-label">正常率</span>
        </div>
      ` : ''}
    `;
  }
  page.appendChild(statsBar);

  if (type === 'poop' && stat.totalRecords > 0) {
    const statusBar = createPoopStatusBar(stat.poopBreakdown || {});
    page.appendChild(statusBar);
  }

  const chartSection = createElement('div', { className: 'chart-section' }, [
    createElement('div', { className: 'chart-tabs' })
  ]);

  const tabBar = chartSection.querySelector('.chart-tabs');
  const tabs = [
    { key: 'timeline', label: '时间线' },
    { key: 'week', label: '趋势' },
    { key: 'frequency', label: '时段' }
  ];

  const tabBtns = createElement('div', { className: 'tab-buttons' });
  for (const tab of tabs) {
    const btn = createElement('button', {
      className: `tab-btn${tab.key === 'timeline' ? ' active' : ''}`,
      dataset: { tab: tab.key },
      onclick: () => switchChart(tab.key, page, type)
    }, tab.label);
    tabBtns.appendChild(btn);
  }
  tabBar.appendChild(tabBtns);

  const chartWrap = createElement('div', { className: 'chart-wrap' }, [
    createElement('canvas', { id: 'history-chart' })
  ]);
  chartSection.appendChild(chartWrap);
  page.appendChild(chartSection);

  const typedRecords = allRecords.filter(r => r.type === type)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const listSection = createElement('div', { className: 'record-list-section' }, [
    createElement('h3', { className: 'list-title' }, '最近记录')
  ]);

  if (typedRecords.length === 0) {
    const emptyMsg = createElement('p', { className: 'list-empty' }, '还没有记录，快去记录吧！');
    listSection.appendChild(emptyMsg);
  } else {
    const list = createElement('div', { className: 'record-list' });
    typedRecords.slice(0, 50).forEach(r => {
      const row = createRecordRow(r, type);
      list.appendChild(row);
    });
    listSection.appendChild(list);

    if (typedRecords.length > 50) {
      const more = createElement('p', { className: 'list-more' }, `还有 ${typedRecords.length - 50} 条记录`);
      listSection.appendChild(more);
    }
  }

  page.appendChild(listSection);
  container.appendChild(page);

  setTimeout(() => {
    const canvas = document.getElementById('history-chart');
    if (canvas) {
      createTimelineChart(canvas, typedRecords, type);
    }
  }, 50);
}

function switchChart(tabKey, page, type) {
  page.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });

  const typedRecords = allRecords.filter(r => r.type === type);
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;

  if (tabKey === 'timeline') {
    createTimelineChart(canvas, typedRecords, type);
  } else if (tabKey === 'week') {
    createWeekChart(canvas, typedRecords, type, 7);
  } else if (tabKey === 'frequency') {
    createFrequencyChart(canvas, typedRecords, type);
  }
}

function createRecordRow(record, type) {
  const info = TYPE_INFO[type];
  const row = createElement('div', { className: 'record-row' });

  const time = createElement('div', { className: 'record-time' }, formatDateTime(new Date(record.timestamp)));
  let amount;
  if (record.amount != null) {
    amount = createElement('div', { className: 'record-amount' }, `${record.amount}${info.unit}`);
  } else if (type === 'poop') {
    const status = getPoopStatus(record.value);
    amount = createElement('div', { className: `record-amount record-status ${status.className}` }, status.label);
  } else {
    amount = createElement('div', { className: 'record-amount record-bool' }, '✓');
  }

  const deleteBtn = createElement('button', {
    className: 'record-delete',
    onclick: async () => {
      if (confirm('确定删除这条记录？')) {
        await deleteRecord(record.id);
        showToast('已删除');
        if (typeof window.onRecordSaved === 'function') {
          window.onRecordSaved();
        }
      }
    }
  }, '✕');

  row.appendChild(time);
  row.appendChild(amount);
  row.appendChild(deleteBtn);

  return row;
}

function createPoopStatusBar(breakdown) {
  const wrap = createElement('div', { className: 'poop-status-bar' });

  for (const [key, status] of Object.entries(POOP_STATUS)) {
    const count = breakdown[key] || 0;
    const item = createElement('div', { className: `poop-status-item ${status.className}` }, [
      createElement('span', { className: 'poop-status-label' }, status.label),
      createElement('span', { className: 'poop-status-count' }, String(count))
    ]);
    wrap.appendChild(item);
  }

  return wrap;
}

function getPoopStatus(value) {
  return POOP_STATUS[value] || POOP_STATUS.normal;
}
