import { createElement, $id, showToast, hideModal } from '../utils/dom.js';
import { toLocalISO, formatDateTime } from '../utils/time.js';
import { addRecord } from '../db.js';

const TYPES = [
  { key: 'drink', icon: '💧', label: '喝水', hasAmount: true, unit: 'ml', defaultAmount: 607 },
  { key: 'eat', icon: '🍚', label: '吃饭', hasAmount: true, unit: 'g', defaultAmount: 465 },
  { key: 'poop', icon: '💩', label: '排便', hasAmount: false, hasValue: true, defaultValue: 'normal' },
  { key: 'pee', icon: '💦', label: '尿尿', hasAmount: false }
];

const POOP_OPTIONS = [
  { key: 'normal', label: '正常' },
  { key: 'small', label: '少量' },
  { key: 'diarrhea', label: '拉稀' },
  { key: 'soft', label: '偏软' },
  { key: 'dry', label: '偏干' }
];

let selectedType = null;
let isQuickMode = false;
let currentSettings = {};

export function render(container, preSelectedType = null, quickMode = false, settings = {}) {
  selectedType = preSelectedType;
  isQuickMode = quickMode;
  currentSettings = settings || {};
  container.innerHTML = '';

  const page = createElement('div', { className: 'record-page' });

  const header = createElement('div', { className: 'page-header' }, [
    createElement('button', {
      className: 'btn-back',
      onclick: () => {
        if (isQuickMode) {
          hideModal();
          return;
        }
        if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
      }
    }, '← 返回'),
    createElement('h2', { className: 'page-title' }, isQuickMode ? '快速记录' : `记录${settings.petName || '宠物'}的活动`)
  ]);
  page.appendChild(header);

  const typeSelector = createElement('div', { className: 'type-selector' }, [
    createElement('p', { className: 'form-label' }, '选择类型')
  ]);
  const typeBtns = createElement('div', { className: 'type-btns' });

  for (const t of TYPES) {
    const btn = createElement('button', {
      className: `type-btn${selectedType === t.key ? ' active' : ''}`,
      dataset: { type: t.key },
      onclick: () => selectType(t.key)
    }, `${t.icon} ${t.label}`);
    typeBtns.appendChild(btn);
  }
  typeSelector.appendChild(typeBtns);
  page.appendChild(typeSelector);

  const amountGroup = createElement('div', {
    className: 'form-group',
    id: 'amount-group',
    style: { display: 'none' }
  });
  page.appendChild(amountGroup);

  const valueGroup = createElement('div', {
    className: 'form-group',
    id: 'value-group',
    style: { display: 'none' }
  });
  page.appendChild(valueGroup);

  const timeGroup = createElement('div', { className: 'form-group' }, [
    createElement('p', { className: 'form-label' }, '时间')
  ]);
  const timeInput = createElement('input', {
    type: 'datetime-local',
    className: 'form-input',
    id: 'record-time',
    value: toLocalISO(new Date())
  });
  timeGroup.appendChild(timeInput);

  const nowToggle = createElement('label', { className: 'toggle-label' }, [
    createElement('input', {
      type: 'checkbox',
      checked: true,
      onchange: (e) => {
        if (e.target.checked) {
          timeInput.value = toLocalISO(new Date());
          timeInput.disabled = true;
        } else {
          timeInput.disabled = false;
        }
      }
    }),
    ' 使用当前时间'
  ]);
  timeGroup.appendChild(nowToggle);
  timeInput.disabled = true;
  page.appendChild(timeGroup);

  const note = createElement('p', { className: 'form-note' });
  page.appendChild(note);

  const submitBtn = createElement('button', {
    className: 'btn-submit',
    onclick: handleSubmit
  }, `${isQuickMode ? '✓ 确认记录' : '✓ 记录'}`);
  page.appendChild(submitBtn);

  container.appendChild(page);

  if (selectedType) {
    selectType(selectedType);
  }
}

function selectType(type) {
  selectedType = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  const typeInfo = TYPES.find(t => t.key === type);
  const amountGroup = document.getElementById('amount-group');
  const valueGroup = document.getElementById('value-group');

  if (typeInfo && typeInfo.hasAmount) {
    const defaultAmount = type === 'drink'
      ? currentSettings.drinkDefaultAmount || currentSettings.drinkGoal || typeInfo.defaultAmount
      : currentSettings.mealDefaultAmount || currentSettings.mealDefault || typeInfo.defaultAmount;
    amountGroup.innerHTML = `
      <p class="form-label">${typeInfo.label}量 (${typeInfo.unit})</p>
      <input type="number" class="form-input" id="record-amount"
        placeholder="请输入${typeInfo.label}量" min="1" step="1" value="${defaultAmount}">
    `;
    amountGroup.style.display = 'block';
  } else {
    amountGroup.style.display = 'none';
  }

  if (typeInfo && typeInfo.hasValue) {
    valueGroup.innerHTML = `
      <p class="form-label">排便状态</p>
      <div class="subtype-grid">
        ${POOP_OPTIONS.map(option => `
          <button type="button" class="subtype-btn${option.key === typeInfo.defaultValue ? ' active' : ''}" data-value="${option.key}">
            ${option.label}
          </button>
        `).join('')}
      </div>
    `;
    valueGroup.style.display = 'block';
    valueGroup.querySelectorAll('.subtype-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        valueGroup.querySelectorAll('.subtype-btn').forEach(item => item.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  } else {
    valueGroup.style.display = 'none';
  }

  const note = document.querySelector('.form-note');
  if (note) {
    if (type === 'poop') note.textContent = '💩 排便状态会用于消化健康统计和提醒';
    else if (type === 'pee') note.textContent = '💦 尿尿频率反映水分摄入情况';
    else note.textContent = '';
  }

  if (isQuickMode) {
    setTimeout(handleSubmit, 100);
  }
}

async function handleSubmit() {
  if (!selectedType) {
    showToast('请选择记录类型');
    return;
  }

  const timeInput = document.getElementById('record-time');
  const timestamp = timeInput ? new Date(timeInput.value).toISOString() : new Date().toISOString();
  const typeInfo = TYPES.find(t => t.key === selectedType);

  let amount = null;
  let value = null;
  if (typeInfo && typeInfo.hasAmount) {
    const amountInput = document.getElementById('record-amount');
    amount = amountInput ? parseFloat(amountInput.value) : null;

    if (!amount || amount <= 0) {
      showToast(`请输入${typeInfo.label}量`);
      return;
    }
  }

  if (typeInfo && typeInfo.hasValue) {
    value = document.querySelector('#value-group .subtype-btn.active')?.dataset.value || typeInfo.defaultValue || null;
  }

  try {
    await addRecord(selectedType, amount, value, timestamp);
    showToast(`已记录${typeInfo ? typeInfo.label : ''}！`);

    if (typeof window.onRecordSaved === 'function') {
      window.onRecordSaved();
    }

    if (!isQuickMode) {
      if (typeof window.navigateTo === 'function') window.navigateTo('dashboard');
    } else {
      hideModal();
    }
  } catch (err) {
    showToast('保存失败，请重试');
    console.error('Save failed:', err);
  }
}
