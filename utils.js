// Helper umum. Semua data API dimasukkan lewat textContent/setAttribute, bukan innerHTML.

export const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false || v === '') continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
};

export const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

// Hanya menerima http/https agar link dari API tidak bisa berisi javascript:
export const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

export const formatDate = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? 'Tidak tersedia'
    : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Placeholder milik kita sendiri (bukan data API), dipakai saat gambar gagal dimuat.
const BLANK = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='365' height='206'><rect width='100%25' height='100%25' fill='%231b1736'/><text x='50%25' y='52%25' fill='%234b4478' font-size='44' text-anchor='middle'>&#127918;</text></svg>`;

export const image = (src, alt, props = {}) => {
  const el = h('img', { src: safeUrl(src) || BLANK, alt, loading: 'lazy', ...props });
  el.addEventListener('error', () => { el.src = BLANK; }, { once: true });
  return el;
};

export const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* penyimpanan penuh atau diblokir */
    }
  },
};

export const KEY_THEME = 'gamelist:theme';

// Ikon bergaya Lucide. Markup di bawah statis (bukan dari API), jadi aman untuk innerHTML.
const PATHS = {
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  pad: '<path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/><rect x="2" y="6" width="20" height="12" rx="4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M14 21V9h4a2 2 0 0 1 2 2v10M3 21h18"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  inbox: '<path d="M3 12h5l2 3h4l2-3h5M5 5h14l2 7v7H3v-7z"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  camera: '<path d="M14.5 4h-5L7.5 6H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  thumbUp: '<path d="M7 22V11l5-9a2.5 2.5 0 0 1 2.4 3.2L13.5 9H19a2 2 0 0 1 2 2.4l-1.6 8A2 2 0 0 1 17.4 21H7zM7 11H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
  thumbDown: '<path d="M17 2v11l-5 9a2.5 2.5 0 0 1-2.4-3.2L10.5 15H5a2 2 0 0 1-2-2.4l1.6-8A2 2 0 0 1 6.6 3H17zM17 13h3a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1h-3"/>',
};

export const icon = (name) => {
  const el = h('span', { class: 'icon', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return el;
};