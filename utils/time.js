export function formatTime(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateCN(date) {
  const d = new Date(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateTime(date) {
  return `${formatDateCN(date)} ${formatTime(date)}`;
}

export function formatRelative(date) {
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

  if (isYesterday(d)) return `昨天 ${formatTime(d)}`;
  if (diff < 172800000) return `前天 ${formatTime(d)}`;

  return formatDateTime(d);
}

export function isToday(date) {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

export function isYesterday(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
}

export function getDateStr(date) {
  return formatDate(date);
}

export function toLocalISO(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function intervalText(minutes) {
  if (minutes < 60) return `${Math.round(minutes)}分钟`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

export function daysSince(date) {
  const now = new Date();
  const diff = now - new Date(date);
  return Math.floor(diff / 86400000);
}

export function getDayBoundaries(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}
