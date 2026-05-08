import { formatDateCN, formatTime } from './utils/time.js';

const CHART_COLORS = {
  drink: { border: '#4A90D9', bg: 'rgba(74,144,217,0.1)', point: '#4A90D9' },
  eat: { border: '#FF9800', bg: 'rgba(255,152,0,0.1)', point: '#FF9800' },
  poop: { border: '#4CAF50', bg: 'rgba(76,175,80,0.1)', point: '#4CAF50' },
  pee: { border: '#9C27B0', bg: 'rgba(156,39,176,0.1)', point: '#9C27B0' }
};

let chartInstances = {};

export function createTimelineChart(canvas, records, type) {
  destroyChart(canvas);

  if (!canvas || !records || records.length < 1) {
    showNoChartData(canvas);
    return;
  }

  const hasAmount = type === 'drink' || type === 'eat';
  const filtered = records.filter(r => hasAmount ? r.amount != null : true).slice(-50);

  if (filtered.length === 0) {
    showNoChartData(canvas);
    return;
  }

  const labels = filtered.map(r => formatDateCN(new Date(r.timestamp)) + ' ' + formatTime(new Date(r.timestamp)));
  const data = hasAmount
    ? filtered.map(r => r.amount)
    : filtered.map((_, i) => i + 1);

  const colors = CHART_COLORS[type];

  const ctx = canvas.getContext('2d');
  chartInstances[canvas.id || 'timeline'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: hasAmount ? (type === 'drink' ? '喝水量 (ml)' : '食量 (g)') : '次数',
        data,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        pointBackgroundColor: colors.point,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.3,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          bodyFont: { size: 12 },
          callbacks: {
            label: function(ctx) {
              const val = ctx.raw;
              return hasAmount ? `${val} ${type === 'drink' ? 'ml' : 'g'}` : `第${val}次`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 6,
            font: { size: 10 },
            maxRotation: 45
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 5
          },
          grid: { color: 'rgba(0,0,0,0.05)' }
        }
      }
    }
  });
}

export function createFrequencyChart(canvas, records, type) {
  destroyChart(canvas);

  if (!canvas || !records || records.length < 1) {
    showNoChartData(canvas);
    return;
  }

  const hourBuckets = new Array(24).fill(0);
  for (const r of records) {
    const h = new Date(r.timestamp).getHours();
    hourBuckets[h]++;
  }

  const colors = CHART_COLORS[type];
  const ctx = canvas.getContext('2d');
  chartInstances[canvas.id || 'frequency'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: hourBuckets.map((_, i) => `${String(i).padStart(2, '0')}:00`),
      datasets: [{
        label: '次数',
        data: hourBuckets,
        backgroundColor: colors.border + '33',
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.raw}次`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            font: { size: 9 }
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            stepSize: 1
          },
          grid: { color: 'rgba(0,0,0,0.05)' }
        }
      }
    }
  });
}

export function createWeekChart(canvas, records, type, days = 7) {
  destroyChart(canvas);

  if (!canvas || !records || records.length < 1) {
    showNoChartData(canvas);
    return;
  }

  const hasAmount = type === 'drink' || type === 'eat';
  const dayBuckets = {};
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = formatDateCN(d);
    dayBuckets[key] = { count: 0, total: 0, date: d };
  }

  for (const r of records) {
    const d = new Date(r.timestamp);
    const diff = Math.round((now - d) / (24 * 60 * 60 * 1000));
    if (diff >= 0 && diff < days) {
      const key = formatDateCN(d);
      if (dayBuckets[key]) {
        dayBuckets[key].count++;
        if (hasAmount && r.amount != null) {
          dayBuckets[key].total += r.amount;
        }
      }
    }
  }

  const labels = Object.keys(dayBuckets);
  const data = Object.values(dayBuckets).map(b => hasAmount ? b.total : b.count);

  const colors = CHART_COLORS[type];
  const ctx = canvas.getContext('2d');
  chartInstances[canvas.id || 'week'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: hasAmount ? (type === 'drink' ? '总喝水量 (ml)' : '总食量 (g)') : '总次数',
        data,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 2,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => hasAmount ? `${ctx.raw} ${type === 'drink' ? 'ml' : 'g'}` : `${ctx.raw}次`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 7,
            font: { size: 10 }
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 5
          },
          grid: { color: 'rgba(0,0,0,0.05)' }
        }
      }
    }
  });
}

function destroyChart(canvas) {
  const id = canvas?.id || 'chart';
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function showNoChartData(canvas) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (parent) {
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.textContent = '暂无足够数据生成图表';
    if (!parent.querySelector('.chart-empty')) {
      parent.appendChild(msg);
    }
  }
}
