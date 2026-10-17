export const POOP_STATUS = {
  normal: { label: '正常', healthScore: 1, className: 'poop-normal' },
  small: { label: '少量', healthScore: 0.65, className: 'poop-small' },
  large: { label: '大量', healthScore: 1, className: 'poop-normal' },
  diarrhea: { label: '拉稀', healthScore: 0.2, className: 'poop-diarrhea' },
  soft: { label: '偏软', healthScore: 0.55, className: 'poop-soft' },
  dry: { label: '偏干', healthScore: 0.45, className: 'poop-dry' }
};

export const POOP_OPTIONS = Object.entries(POOP_STATUS).map(([key, status]) => ({ key, label: status.label }));

export function normalizePoopStatus(value) {
  if (Object.hasOwn(POOP_STATUS, value)) return value;
  return POOP_OPTIONS.find(option => option.label === value)?.key || 'normal';
}

export function poopLabel(value) {
  return POOP_STATUS[normalizePoopStatus(value)].label;
}

export function isAbnormalPoop(value) {
  return !['normal', 'large'].includes(normalizePoopStatus(value));
}
