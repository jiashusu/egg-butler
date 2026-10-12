let toastTimer = null;

export function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on')) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else {
      el.setAttribute(key, value);
    }
  }
  if (typeof children === 'string') {
    el.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach(child => {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    });
  }
  return el;
}

export function $id(id) {
  return document.getElementById(id);
}

export function $q(selector, parent = document) {
  return parent.querySelector(selector);
}

export function $qa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

export function showModal(html) {
  const overlay = $id('modal-overlay');
  const content = $id('modal-content');
  if (!overlay || !content) return;
  content.innerHTML = html;
  overlay.classList.add('active');
  content.classList.add('active');
}

export function hideModal() {
  const overlay = $id('modal-overlay');
  const content = $id('modal-content');
  if (!overlay || !content) return;
  overlay.classList.remove('active');
  content.classList.remove('active');
  document.dispatchEvent(new Event('eggButlerModalClosed'));
}

export function showToast(message, duration = 2500) {
  const toast = $id('toast');
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('active');
  toastTimer = setTimeout(() => {
    toast.classList.remove('active');
  }, duration);
}

export function showLoading(container) {
  container.innerHTML = `
    <div class="loading-skeleton">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  `;
}

export function showEmpty(container, message, actionHTML = '') {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🐾</div>
      <p class="empty-text">${message}</p>
      ${actionHTML}
    </div>
  `;
}
