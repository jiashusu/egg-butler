import { createElement } from '../utils/dom.js';
import { formatDate, formatDateCN, formatDateTime } from '../utils/time.js';

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

export function render(container, records, stats) {
  charts.forEach(chart => chart.destroy());
  charts = [];
  container.innerHTML = '';

  const page = createElement('div', { className: 'analytics-page' });
  page.appendChild(createHeader());
  page.appendChild(createTodayPanel(stats));
  page.appendChild(createScorePanel(records));
  page.appendChild(createChartBlock('7天趋势', 'analytics-week-chart'));
  page.appendChild(createChartBlock('记录占比', 'analytics-mix-chart'));
  page.appendChild(createRecentTable(records));

  container.appendChild(page);

  setTimeout(() => {
    renderWeekChart(records);
    renderMixChart(records);
  }, 50);
}

function createHeader() {
  return createElement('div', { className: 'page-header' }, [
    createElement('button', {
      className: 'btn-back',
      onclick: () => {
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
      }
    }, '← 返回'),
    createElement('h2', { className: 'page-title' }, '蛋蛋详细数据')
  ]);
}

function createTodayPanel(stats) {
  const wrap = createElement('div', { className: 'analytics-section' }, [
    createElement('div', { className: 'analytics-section-head' }, [
      createElement('h3', { className: 'analytics-title' }, '今日概览'),
      createElement('span', { className: 'analytics-date' }, formatDateCN(new Date()))
    ])
  ]);

  const grid = createElement('div', { className: 'analytics-metric-grid' });
  for (const type of ['drink', 'eat', 'poop', 'pee']) {
    const info = TYPE_INFO[type];
    const stat = stats[type] || {};
    const value = type === 'drink' || type === 'eat'
      ? Math.round(stat.totalToday || 0)
      : stat.todayCount || 0;
    const suffix = type === 'drink' || type === 'eat' ? info.unit : '次';

    grid.appendChild(createElement('div', {
      className: 'analytics-metric',
      style: { borderColor: `${info.color}55` }
    }, [
      createElement('span', { className: 'analytics-metric-icon' }, info.icon),
      createElement('span', { className: 'analytics-metric-value' }, `${value}${suffix}`),
      createElement('span', { className: 'analytics-metric-label' }, info.label)
    ]));
  }

  wrap.appendChild(grid);
  return wrap;
}

function createScorePanel(records) {
  const todayKey = formatDate(new Date());
  const todayRecords = records.filter(record => record.dateStr === todayKey);
  const drinkTotal = todayRecords
    .filter(record => record.type === 'drink')
    .reduce((sum, record) => sum + (record.amount || 0), 0);
  const eatTotal = todayRecords
    .filter(record => record.type === 'eat')
    .reduce((sum, record) => sum + (record.amount || 0), 0);
  const toiletCount = todayRecords
    .filter(record => record.type === 'poop' || record.type === 'pee')
    .length;
  const latest = records.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  const rows = [
    ['饮水完成度', `${Math.min(100, Math.round(drinkTotal / 607 * 100))}%`, '按 607ml 默认量估算'],
    ['进食完成度', `${Math.min(100, Math.round(eatTotal / 465 * 100))}%`, '按 465g 默认量估算'],
    ['今日上厕所', `${toiletCount}次`, '排便和尿尿合计'],
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
    .slice(0, 12);

  if (rows.length === 0) {
    section.appendChild(createElement('p', { className: 'list-empty' }, '还没有记录'));
    return section;
  }

  const table = createElement('div', { className: 'analytics-table' });
  table.appendChild(createElement('div', { className: 'analytics-table-row analytics-table-head' }, [
    createElement('span', {}, '时间'),
    createElement('span', {}, '类型'),
    createElement('span', {}, '数值')
  ]));

  rows.forEach(record => {
    const info = TYPE_INFO[record.type] || {};
    const value = getRecordValue(record);
    table.appendChild(createElement('div', { className: 'analytics-table-row' }, [
      createElement('span', {}, formatDateTime(new Date(record.timestamp))),
      createElement('span', {}, `${info.icon || ''} ${info.label || record.type}`),
      createElement('span', {}, value)
    ]));
  });

  section.appendChild(table);
  return section;
}

function renderWeekChart(records) {
  const canvas = document.getElementById('analytics-week-chart');
  if (!canvas) return;

  const buckets = getLastSevenDayBuckets();
  records.forEach(record => {
    const bucket = buckets.find(item => item.key === record.dateStr);
    if (!bucket) return;
    if (record.type === 'drink') bucket.drink += record.amount || 0;
    else if (record.type === 'eat') bucket.eat += record.amount || 0;
    else if (record.type === 'poop') bucket.poop += 1;
    else if (record.type === 'pee') bucket.pee += 1;
  });

  charts.push(new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: buckets.map(item => item.label),
      datasets: [
        { label: '喝水 ml', data: buckets.map(item => item.drink), backgroundColor: '#4A90D966', borderColor: '#4A90D9', borderWidth: 1, borderRadius: 4 },
        { label: '吃饭 g', data: buckets.map(item => item.eat), backgroundColor: '#FF980066', borderColor: '#FF9800', borderWidth: 1, borderRadius: 4 },
        { label: '排便 次', data: buckets.map(item => item.poop), backgroundColor: '#4CAF5066', borderColor: '#4CAF50', borderWidth: 1, borderRadius: 4 },
        { label: '尿尿 次', data: buckets.map(item => item.pee), backgroundColor: '#9C27B066', borderColor: '#9C27B0', borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: getChartOptions()
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

function getLastSevenDayBuckets() {
  const buckets = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    buckets.push({
      key: formatDate(date),
      label: formatDateCN(date),
      drink: 0,
      eat: 0,
      poop: 0,
      pee: 0
    });
  }
  return buckets;
}

function getChartOptions() {
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
      y: { beginAtZero: true, ticks: { font: { size: 10 }, maxTicksLimit: 5 }, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  };
}

function getRecordValue(record) {
  const info = TYPE_INFO[record.type] || {};
  if (record.amount != null) return `${record.amount}${info.unit || ''}`;
  if (record.type === 'poop') return POOP_STATUS[record.value] || '正常';
  return '1次';
}
