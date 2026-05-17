import { createElement } from '../utils/dom.js';
import { formatDateTime, formatTime, intervalText } from '../utils/time.js';
import {
  formatActivityDayLabel,
  getActivityDayKeyForRecord,
  getActivityDayRecords,
  getCurrentActivityDayKey,
  getRecentActivityDayBuckets
} from '../utils/activityDay.js';
import { analyzeRhythmRelations } from '../prediction.js';

const TYPE_INFO = {
  drink: { icon: '💧', label: '喝水', unit: 'ml', color: '#4A90D9' },
  eat: { icon: '🍚', label: '吃饭', unit: 'g', color: '#FF9800' },
  poop: { icon: '💩', label: '排便', unit: '次', color: '#4CAF50' },
  pee: { icon: '💦', label: '尿尿', unit: '次', color: '#9C27B0' }
};

const POOP_STATUS = {
  normal: '正常',
  small: '少量',
  diarrhea: '拉稀',
  soft: '偏软',
  dry: '偏干'
};

let charts = [];

export function render(container, records, stats, settings = {}) {
  charts.forEach(chart => chart.destroy());
  charts = [];
  container.innerHTML = '';

  const page = createElement('div', { className: 'analytics-page' });
  page.appendChild(createHeader(settings));
  page.appendChild(createTodayPanel(stats));
  page.appendChild(createScorePanel(records, settings));
  page.appendChild(createRhythmPanel(records));
  page.appendChild(createChartBlock('7天次数趋势', 'analytics-count-chart'));
  page.appendChild(createChartBlock('记录占比', 'analytics-mix-chart'));
  page.appendChild(createRecentTable(records));

  container.appendChild(page);

  setTimeout(() => {
    renderCountChart(records);
    renderMixChart(records);
  }, 50);
}

function createHeader(settings) {
  return createElement('div', { className: 'page-header' }, [
    createElement('button', {
      className: 'btn-back',
      onclick: () => {
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
      }
    }, '← 返回'),
    createElement('h2', { className: 'page-title' }, `${settings.petName || '宠物'}详细数据`)
  ]);
}

function createTodayPanel(stats) {
  const wrap = createElement('div', { className: 'analytics-section' }, [
    createElement('div', { className: 'analytics-section-head' }, [
      createElement('h3', { className: 'analytics-title' }, '本轮概览'),
      createElement('span', { className: 'analytics-date' }, formatActivityDayLabel(stats.drink?.activityDayKey))
    ])
  ]);

  const grid = createElement('div', { className: 'analytics-metric-grid' });
  for (const type of ['drink', 'eat', 'poop', 'pee']) {
    const info = TYPE_INFO[type];
    const stat = stats[type] || {};
    const amountHint = type === 'drink' || type === 'eat'
      ? `${Math.round(stat.totalToday || 0)}${info.unit}`
      : '';

    grid.appendChild(createElement('div', {
      className: 'analytics-metric',
      style: { borderColor: `${info.color}55` }
    }, [
      createElement('span', { className: 'analytics-metric-icon' }, info.icon),
      createElement('span', { className: 'analytics-metric-value' }, `${stat.todayCount || 0}次`),
      createElement('span', { className: 'analytics-metric-label' }, info.label),
      amountHint ? createElement('span', { className: 'analytics-metric-hint' }, amountHint) : null
    ]));
  }

  wrap.appendChild(grid);
  return wrap;
}

function createScorePanel(records, settings = {}) {
  const todayKey = getCurrentActivityDayKey(records);
  const todayRecords = getActivityDayRecords(records, todayKey);
  const drinkTotal = todayRecords
    .filter(record => record.type === 'drink')
    .reduce((sum, record) => sum + (record.amount || 0), 0);
  const drinkCount = todayRecords.filter(record => record.type === 'drink').length;
  const eatTotal = todayRecords
    .filter(record => record.type === 'eat')
    .reduce((sum, record) => sum + (record.amount || 0), 0);
  const eatCount = todayRecords.filter(record => record.type === 'eat').length;
  const toiletCount = todayRecords
    .filter(record => record.type === 'poop' || record.type === 'pee')
    .length;
  const latest = records.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  const drinkGoalCount = settings.drinkGoalCount || 3;
  const mealGoalCount = settings.mealGoalCount || 1;
  const rows = [
    ['喝水次数完成度', `${Math.min(100, Math.round(drinkCount / drinkGoalCount * 100))}%`, `本轮 ${drinkCount}/${drinkGoalCount} 次 · 共 ${drinkTotal}ml`],
    ['吃饭次数完成度', `${Math.min(100, Math.round(eatCount / mealGoalCount * 100))}%`, `本轮 ${eatCount}/${mealGoalCount} 次 · 共 ${eatTotal}g`],
    ['本轮上厕所', `${toiletCount}次`, '排便和尿尿合计'],
    ['最近记录', latest ? `${TYPE_INFO[latest.type]?.label || '记录'} · ${formatDateTime(new Date(latest.timestamp))}` : '暂无', '']
  ];

  const panel = createElement('div', { className: 'analytics-health-panel' });
  rows.forEach(([label, value, hint]) => {
    panel.appendChild(createElement('div', { className: 'analytics-health-row' }, [
      createElement('span', { className: 'analytics-health-label' }, label),
      createElement('span', { className: 'analytics-health-value' }, value),
      createElement('span', { className: 'analytics-health-hint' }, hint)
    ]));
  });
  return panel;
}

function createRhythmPanel(records) {
  const latest = records.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const activeKey = latest ? getCurrentActivityDayKey(records) : null;

  const section = createElement('div', { className: 'analytics-section rhythm-section' }, [
    createElement('div', { className: 'analytics-section-head' }, [
      createElement('h3', { className: 'analytics-title' }, '日节奏分析'),
      createElement('span', { className: 'analytics-date' }, activeKey ? formatActivityDayLabel(activeKey) : '暂无')
    ])
  ]);

  if (!activeKey) {
    section.appendChild(createElement('p', { className: 'list-empty' }, '记录几次后，会自动分析吃喝和上厕所之间的节奏'));
    return section;
  }

  const dayRecords = records
    .filter(record => getActivityDayKeyForRecord(record, records) === activeKey)
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const summary = summarizeDay(dayRecords);
  const rhythmRelations = analyzeRhythmRelations(records);
  const relations = [
    rhythmRelations.feedPair,
    rhythmRelations.drinkToPee,
    rhythmRelations.peeToPoop,
    rhythmRelations.eatToPoop
  ];

  const cards = createElement('div', { className: 'rhythm-card-grid' });
  cards.appendChild(createRhythmCard('主要时间段', summary.busyLabel, `${summary.busyCount} 条记录集中在这里`));
  cards.appendChild(createRhythmCard('饮水节奏', `${summary.drinkCount}次`, `共 ${summary.drinkTotal}ml`));
  cards.appendChild(createRhythmCard('进食节奏', `${summary.eatCount}次`, `共 ${summary.eatTotal}g`));
  cards.appendChild(createRhythmCard('厕所节奏', `${summary.toiletCount}次`, summary.poopAlert));
  section.appendChild(cards);

  const relationList = createElement('div', { className: 'rhythm-relations' });
  relations.forEach(item => {
    relationList.appendChild(createElement('div', { className: 'rhythm-relation-row' }, [
      createElement('span', { className: 'rhythm-relation-name' }, item.label),
      createElement('strong', {}, item.samples > 0 ? intervalText(Math.abs(item.median ?? item.avg)) : '待观察'),
      createElement('span', { className: 'rhythm-relation-hint' }, item.samples > 0 ? `${item.samples} 组数据` : '需要更多连续记录')
    ]));
  });
  section.appendChild(relationList);

  const dayLine = createElement('div', { className: 'day-timeline' });
  dayRecords.forEach(record => {
    const info = TYPE_INFO[record.type] || {};
    dayLine.appendChild(createElement('div', {
      className: `day-timeline-item day-timeline-${record.type}`
    }, [
      createElement('span', { className: 'day-timeline-time' }, formatTime(new Date(record.timestamp))),
      createElement('span', { className: 'day-timeline-dot' }, info.icon || ''),
      createElement('span', { className: 'day-timeline-text' }, getRecordValue(record))
    ]));
  });
  section.appendChild(dayLine);

  return section;
}

function createRhythmCard(label, value, hint) {
  return createElement('div', { className: 'rhythm-card' }, [
    createElement('span', { className: 'rhythm-card-label' }, label),
    createElement('strong', { className: 'rhythm-card-value' }, value),
    createElement('span', { className: 'rhythm-card-hint' }, hint)
  ]);
}

function createChartBlock(title, canvasId) {
  return createElement('div', { className: 'analytics-section' }, [
    createElement('div', { className: 'analytics-section-head' }, [
      createElement('h3', { className: 'analytics-title' }, title)
    ]),
    createElement('div', { className: 'chart-wrap analytics-chart-wrap' }, [
      createElement('canvas', { id: canvasId })
    ])
  ]);
}

function createRecentTable(records) {
  const section = createElement('div', { className: 'analytics-section analytics-table-section' }, [
    createElement('div', { className: 'analytics-section-head' }, [
      createElement('h3', { className: 'analytics-title' }, '最近记录表')
    ])
  ]);

  const rows = records
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 30);

  if (rows.length === 0) {
    section.appendChild(createElement('p', { className: 'list-empty' }, '还没有记录'));
    return section;
  }

  const table = createElement('div', { className: 'analytics-table analytics-table-grouped' });
  let currentDate = '';
  let currentPeriod = '';

  rows.forEach(record => {
    const info = TYPE_INFO[record.type] || {};
    const value = getRecordValue(record);
    const dateLabel = formatActivityDayLabel(getActivityDayKeyForRecord(record, records));
    const period = getPeriodLabel(new Date(record.timestamp));

    if (dateLabel !== currentDate) {
      currentDate = dateLabel;
      currentPeriod = '';
      table.appendChild(createElement('div', { className: 'analytics-table-date' }, dateLabel));
    }

    if (period !== currentPeriod) {
      currentPeriod = period;
      table.appendChild(createElement('div', { className: 'analytics-table-period' }, period));
    }

    table.appendChild(createElement('div', { className: 'analytics-table-row' }, [
      createElement('span', {}, formatTime(new Date(record.timestamp))),
      createElement('span', {}, `${info.icon || ''} ${info.label || record.type}`),
      createElement('span', {}, value)
    ]));
  });

  section.appendChild(table);
  return section;
}

function renderCountChart(records) {
  const canvas = document.getElementById('analytics-count-chart');
  if (!canvas) return;

  const buckets = getRecentActivityDayBuckets(records);

  charts.push(new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: buckets.map(item => item.label),
      datasets: [
        { label: '喝水 次', data: buckets.map(item => item.drinkCount), backgroundColor: '#4A90D966', borderColor: '#4A90D9', borderWidth: 1, borderRadius: 4 },
        { label: '吃饭 次', data: buckets.map(item => item.eatCount), backgroundColor: '#FF980066', borderColor: '#FF9800', borderWidth: 1, borderRadius: 4 },
        { label: '排便 次', data: buckets.map(item => item.poop), backgroundColor: '#4CAF5066', borderColor: '#4CAF50', borderWidth: 1, borderRadius: 4 },
        { label: '尿尿 次', data: buckets.map(item => item.pee), backgroundColor: '#9C27B066', borderColor: '#9C27B0', borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: getChartOptions({ stepSize: 1 })
  }));
}

function renderMixChart(records) {
  const canvas = document.getElementById('analytics-mix-chart');
  if (!canvas) return;

  const counts = ['drink', 'eat', 'poop', 'pee'].map(type =>
    records.filter(record => record.type === type).length
  );

  charts.push(new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['喝水', '吃饭', '排便', '尿尿'],
      datasets: [{
        data: counts,
        backgroundColor: ['#4A90D9', '#FF9800', '#4CAF50', '#9C27B0'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } }
        }
      }
    }
  }));
}

function getChartOptions({ stepSize = null } = {}) {
  const yTicks = { font: { size: 10 }, maxTicksLimit: 5 };
  if (stepSize !== null) yTicks.stepSize = stepSize;

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } }
      }
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: yTicks,
        grid: { color: 'rgba(0,0,0,0.05)' }
      }
    }
  };
}

function getRecordValue(record) {
  const info = TYPE_INFO[record.type] || {};
  if (record.amount != null) return `${record.amount}${info.unit || ''}`;
  if (record.type === 'poop') return POOP_STATUS[record.value] || '正常';
  return '1次';
}

function summarizeDay(dayRecords) {
  const drinkRecords = dayRecords.filter(record => record.type === 'drink');
  const eatRecords = dayRecords.filter(record => record.type === 'eat');
  const poopRecords = dayRecords.filter(record => record.type === 'poop');
  const toiletRecords = dayRecords.filter(record => record.type === 'poop' || record.type === 'pee');
  const periods = { morning: 0, afternoon: 0, evening: 0, night: 0 };

  dayRecords.forEach(record => {
    periods[getPeriodKey(new Date(record.timestamp))]++;
  });

  const busy = Object.entries(periods).sort((a, b) => b[1] - a[1])[0] || ['morning', 0];
  const abnormal = poopRecords.filter(record => record.value && record.value !== 'normal').length;

  return {
    drinkTotal: Math.round(drinkRecords.reduce((sum, record) => sum + (record.amount || 0), 0)),
    drinkCount: drinkRecords.length,
    eatTotal: Math.round(eatRecords.reduce((sum, record) => sum + (record.amount || 0), 0)),
    eatCount: eatRecords.length,
    toiletCount: toiletRecords.length,
    busyLabel: PERIOD_LABELS[busy[0]],
    busyCount: busy[1],
    poopAlert: abnormal > 0 ? `排便异常 ${abnormal} 次` : `${poopRecords.length} 次排便`
  };
}

const PERIOD_LABELS = {
  morning: '早上',
  afternoon: '下午',
  evening: '晚上',
  night: '深夜'
};

function getPeriodKey(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

function getPeriodLabel(date) {
  return PERIOD_LABELS[getPeriodKey(date)];
}
