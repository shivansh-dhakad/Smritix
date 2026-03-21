/**
 * ui.js — Reusable UI helpers: toasts, modals, confirm dialogs, drag-drop.
 */

// ── Toasts ────────────────────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');

export function toast(message, type = 'info', duration = 3200) {
  const el = document.createElement('div');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  toastContainer.appendChild(el);

  const remove = () => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  el.onclick = () => { clearTimeout(timer); remove(); };
}

// ── Generic modal ─────────────────────────────────────────────────────────────
const modalOverlay = document.getElementById('modal-overlay');
const modalBox     = document.getElementById('modal-box');
let _resolveModal  = null;

export function openModal({ title, fields = [], confirmText = 'Save', confirmClass = 'confirm', initialData = {} }) {
  return new Promise((resolve) => {
    _resolveModal = resolve;

    let html = `<h3 class="modal-title">${title}</h3>`;
    fields.forEach(f => {
      html += `<div class="modal-field">`;
      if (f.label) html += `<label for="mf-${f.name}">${f.label}</label>`;

      if (f.type === 'textarea') {
        html += `<textarea id="mf-${f.name}" name="${f.name}" placeholder="${f.placeholder || ''}">${initialData[f.name] ?? f.default ?? ''}</textarea>`;
      } else if (f.type === 'color') {
        html += `<input type="color" id="mf-${f.name}" name="${f.name}" value="${initialData[f.name] ?? f.default ?? '#7c5cbf'}">`;
      } else if (f.type === 'select') {
        html += `<select id="mf-${f.name}" name="${f.name}">`;
        (f.options || []).forEach(opt => {
          const sel = (initialData[f.name] ?? f.default) === opt.value ? 'selected' : '';
          html += `<option value="${opt.value}" ${sel}>${opt.label}</option>`;
        });
        html += `</select>`;
      } else {
        html += `<input type="${f.type || 'text'}" id="mf-${f.name}" name="${f.name}"
                  placeholder="${f.placeholder || ''}"
                  value="${initialData[f.name] ?? f.default ?? ''}">`;
      }
      html += `</div>`;
    });

    html += `<div class="modal-actions">
      <button class="modal-btn cancel" id="modal-cancel">Cancel</button>
      <button class="modal-btn ${confirmClass}" id="modal-confirm">${confirmText}</button>
    </div>`;

    modalBox.innerHTML = html;
    modalOverlay.classList.add('show');

    document.getElementById('modal-cancel').onclick = () => closeModal(null);
    document.getElementById('modal-confirm').onclick = () => {
      const data = {};
      fields.forEach(f => {
        const el = document.getElementById(`mf-${f.name}`);
        if (el) data[f.name] = el.value;
      });
      closeModal(data);
    };

    // Focus first input
    const firstInput = modalBox.querySelector('input, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);

    // Enter to confirm
    modalBox.onkeydown = (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        document.getElementById('modal-confirm')?.click();
      }
      if (e.key === 'Escape') closeModal(null);
    };
  });
}

export function closeModal(data) {
  modalOverlay.classList.remove('show');
  if (_resolveModal) { _resolveModal(data); _resolveModal = null; }
}

// Click outside modal to close
modalOverlay?.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal(null);
});

// ── Confirm dialog ────────────────────────────────────────────────────────────
export function confirm(message, title = 'Are you sure?') {
  return openModal({
    title,
    fields: [{ type: 'hidden', name: '_dummy' }],
    confirmText: 'Confirm',
    confirmClass: 'danger',
    initialData: {},
  }).then(data => {
    // Reuse the same modal but replace content
    return new Promise((resolve) => {
      _resolveModal = null;
      const overlay = document.getElementById('modal-overlay');
      const box = document.getElementById('modal-box');
      box.innerHTML = `
        <h3 class="modal-title">${title}</h3>
        <p style="color:var(--text2);font-size:.9rem;margin-bottom:24px;line-height:1.6">${message}</p>
        <div class="modal-actions">
          <button class="modal-btn cancel" id="conf-cancel">Cancel</button>
          <button class="modal-btn danger" id="conf-ok">Delete</button>
        </div>`;
      overlay.classList.add('show');
      document.getElementById('conf-cancel').onclick = () => { overlay.classList.remove('show'); resolve(false); };
      document.getElementById('conf-ok').onclick     = () => { overlay.classList.remove('show'); resolve(true); };
    });
  });
}

// Standalone confirm (not chained)
export function showConfirm(message, title = 'Are you sure?') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const box     = document.getElementById('modal-box');
    _resolveModal = null;
    box.innerHTML = `
      <h3 class="modal-title">${title}</h3>
      <p style="color:var(--text2);font-size:.9rem;margin-bottom:24px;line-height:1.6">${message}</p>
      <div class="modal-actions">
        <button class="modal-btn cancel" id="conf-cancel">Cancel</button>
        <button class="modal-btn danger" id="conf-ok">Delete</button>
      </div>`;
    overlay.classList.add('show');
    document.getElementById('conf-cancel').onclick = () => { overlay.classList.remove('show'); resolve(false); };
    document.getElementById('conf-ok').onclick     = () => { overlay.classList.remove('show'); resolve(true); };
  });
}

// ── Breadcrumb helper ─────────────────────────────────────────────────────────
export function setBreadcrumb(items) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  bc.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast) {
      return `<span class="breadcrumb-item active">${item.label}</span>`;
    }
    return `<span class="breadcrumb-item" data-action="${item.action || ''}">${item.label}</span>
            <span class="breadcrumb-sep">›</span>`;
  }).join('');
  // Attach click handlers
  bc.querySelectorAll('.breadcrumb-item[data-action]').forEach(el => {
    if (el.dataset.action) {
      el.onclick = () => window[el.dataset.action]?.();
    }
  });
}

// ── Loading spinner in content area ──────────────────────────────────────────
export function showLoading(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div style="font-size:2rem;animation:spin .8s linear infinite">⟳</div>
      <div class="empty-state-title">Loading…</div>
    </div>`;
}

// ── Format helpers ────────────────────────────────────────────────────────────
export function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── File icon by extension ────────────────────────────────────────────────────
export function fileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    py:'🐍', js:'🟨', ts:'🔷', jsx:'⚛️', tsx:'⚛️',
    html:'🌐', css:'🎨', json:'📋', md:'📝', txt:'📄',
    png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', svg:'🎭',
    pdf:'📕', zip:'📦', tar:'📦', gz:'📦',
    sh:'⚙️', bat:'⚙️', exe:'▶️', rb:'💎', go:'🐹',
    java:'☕', c:'©️', cpp:'©️', cs:'💠', rs:'🦀',
    sql:'🗄️', db:'🗄️', csv:'📊', xlsx:'📊',
    mp4:'🎬', mp3:'🎵', wav:'🎵',
  };
  return icons[ext] || '📄';
}
