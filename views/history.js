import { createElement, showToast, showLoading, showEmpty } from '../utils/dom.js';
import { formatDate, formatDateTime, formatTime, intervalText, formatDateCN } from '../utils/time.js';
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
let calendarMonth = null;
let selectedDateKey = null;

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
        <span class="stat-label">本轮</span>
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

  if (!calendarMonth) {
    const latest = typedRecords[0]?.timestamp ? new Date(typedRecords[0].timestamp) : new Date();
    calendarMonth = new Date(latest.getFullYear(), latest.getMonth(), 1);
  }

  page.appendChild(createCalendarSection(typedRecords, type));

  const visibleRecords = selectedDateKey
    ? typedRecords.filter(record => record.dateStr === selectedDateKey)
    : typedRecords;

  const listSection = createElement('div', { className: 'record-list-section' }, [
    createElement('div', { className: 'list-head-row' }, [
      createElement('h3', { className: 'list-title' }, selectedDateKey ? `${formatDateCN(new Date(`${selectedDateKey}T00:00:00`))}记录` : '最近记录'),
      selectedDateKey ? createElement('button', {
        className: 'calendar-clear-btn',
        onclick: () => {
          selectedDateKey = null;
          rerenderHistory();
        }
      }, '看全部') : createElement('span', { className: 'list-count' }, `${typedRecords.length}条`)
    ])
  ]);

  if (visibleRecords.length === 0) {
    const emptyMsg = createElement('p', { className: 'list-empty' }, '还没有记录，快去记录吧！');
    listSection.appendChild(emptyMsg);
  } else {
    const list = createElement('div', { className: 'record-list' });
    visibleRecords.slice(0, 50).forEach(r => {
      const row = createRecordRow(r, type);
      list.appendChild(row);
    });
    listSection.appendChild(list);

    if (visibleRecords.length > 50) {
      const more = createElement('p', { className: 'list-more' }, `还有 ${visibleRecords.length - 50} 条记录`);
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

function createCalendarSection(typedRecords, type) {
  const monthDate = calendarMonth || new Date();
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const todayKey = formatDate(new Date());
  const monthTitle = `${year}年${month + 1}月`;
  const daySummary = summarizeByDate(typedRecords, type);
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();

  const section = createElement('section', { className: 'history-calendar-section' }, [
    createElement('div', { className: 'history-calendar-head' }, [
      createElement('button', {
        className: 'calendar-nav-btn',
        onclick: () => {
          calendarMonth = new Date(year, month - 1, 1);
          rerenderHistory();
        }
      }, '‹'),
      createElement('div', { className: 'history-calendar-title' }, [
        createElement('strong', {}, monthTitle),
        createElement('span', {}, selectedDateKey ? `正在看 ${formatDateCN(new Date(`${selectedDateKey}T00:00:00`))}` : '点日期查看当天日志')
      ]),
      createElement('button', {
        className: 'calendar-nav-btn',
        onclick: () => {
          calendarMonth = new Date(year, month + 1, 1);
          rerenderHistory();
        }
      }, '›')
    ])
  ]);

  const week = createElement('div', { className: 'history-calendar-week' });
  ['日', '一', '二', '三', '四', '五', '六'].forEach(label => {
    week.appendChild(createElement('span', {}, label));
  });
  section.appendChild(week);

  const grid = createElement('div', { className: 'history-calendar-grid' });
  for (let i = 0; i < startOffset; i++) {
    grid.appendChild(createElement('span', { className: 'calendar-day-cell empty' }));
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const key = formatDate(date);
    const summary = daySummary[key];
    const cell = createElement('button', {
      className: [
        'calendar-day-cell',
        summary ? 'has-records' : '',
        key === selectedDateKey ? 'selected' : '',
        key === todayKey ? 'today' : ''
      ].filter(Boolean).join(' '),
      onclick: () => {
        selectedDateKey = key === selectedDateKey ? null : key;
        rerenderHistory();
      }
    }, [
      createElement('span', { className: 'calendar-day-num' }, String(day)),
      createElement('span', { className: 'calendar-day-meta' }, summary ? formatCalendarMeta(summary, type) : '')
    ]);
    grid.appendChild(cell);
  }

  section.appendChild(grid);
  section.appendChild(createElement('div', { className: 'history-calendar-foot' }, [
    createElement('button', {
      className: 'calendar-mini-btn',
      onclick: () => {
        const today = new Date();
        calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        selectedDateKey = todayKey;
        rerenderHistory();
      }
    }, '今天'),
    createElement('button', {
      className: 'calendar-mini-btn',
      onclick: () => {
        selectedDateKey = null;
        rerenderHistory();
      }
    }, '全部日志')
  ]));

  return section;
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

  const time = createElement('div', { className: 'record-time' }, selectedDateKey ? formatTime(new Date(record.timestamp)) : formatDateTime(new Date(record.timestamp)));
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
        const syncResult = typeof window.onRecordSaved === 'function'
          ? await window.onRecordSaved({ syncNow: true })
          : null;
        showToast(syncResult?.ok === false ? '本机已删除，云端同步失败' : '已删除并同步');
      }
    }
  }, '✕');

  row.appendChild(time);
  row.appendChild(amount);
  row.appendChild(deleteBtn);

  return row;
}

function summarizeByDate(records, type) {
  return records.reduce((map, record) => {
    const key = record.dateStr;
    if (!map[key]) map[key] = { count: 0, total: 0, abnormal: 0 };
    map[key].count++;
    if (record.amount) map[key].total += Number(record.amount) || 0;
    if (type === 'poop' && record.value && record.value !== 'normal') map[key].abnormal++;
    return map;
  }, {});
}

function formatCalendarMeta(summary, type) {
  if (type === 'drink') return `${Math.round(summary.total)}ml`;
  if (type === 'eat') return `${Math.round(summary.total)}g`;
  if (type === 'poop' && summary.abnormal > 0) return `${summary.count}次/${summary.abnormal}异`;
  return `${summary.count}次`;
}

function rerenderHistory() {
  const container = document.getElementById('app-content');
  if (container && currentType) render(container, currentType, allRecords);
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
