// Komponen UI. Semua teks dari API dirender lewat textContent (lihat h() di utils.js).
import { h, icon, image, formatDate, safeUrl } from './utils.js';
import * as comment from './comment.js';
import * as vote from './vote.js';

const tag = (text, alt) => text ? h('span', { class: `tag${alt ? ' alt' : ''}`, text }) : null;

export const favButton = (g, on) =>
  h('button', {
    class: `fav${on ? ' on' : ''}`,
    type: 'button',
    'data-fav': Number(g.id),
    'aria-pressed': String(on),
    'aria-label': `Favorit: ${g.title}`,
  }, icon('heart'));

export const setFavState = (btn, on) => {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
};

const meta = (ico, text, cls) =>
  text ? h('p', { class: `sub ${cls || ''}` }, icon(ico), h('span', { text })) : null;

export const gameCard = (g, fav, voteOpts) =>
  h('article', { class: 'card' },
    h('div', { class: 'card-img' }, image(g.thumbnail, `Thumbnail ${g.title}`, { width: 365, height: 206 }), favButton(g, fav)),
    h('div', { class: 'card-body' },
      h('h3', {}, h('a', { class: 'card-link', href: `#/game/${Number(g.id)}`, text: g.title })),
      h('div', { class: 'tags' }, tag(g.genre), tag(g.platform, true)),
      meta('building', g.publisher),
      meta('clock', formatDate(g.release_date)),
      voteBar(Number(g.id), voteOpts)));

// Jeda berurutan per kolom supaya kartu yang masuk viewport tampil berundain.
export const grid = (games, isFav, voteOpts) =>
  h('div', { class: 'grid' }, games.map((g, i) => {
    const card = gameCard(g, isFav(g.id), voteOpts);
    card.style.setProperty('--cd', `${(i % 4) * 60}ms`);
    return card;
  }));

export const skeletonGrid = (n = 8) =>
  h('div', { class: 'grid', 'aria-busy': 'true', 'aria-label': 'Memuat data' },
    Array.from({ length: n }, () =>
      h('div', { class: 'card skel' },
        h('div', { class: 'card-img' }, h('div', { class: 'sk sk-img' })),
        h('div', { class: 'card-body' },
          h('div', { class: 'sk' }),
          h('div', { class: 'sk', style: 'width:70%' }),
          h('div', { class: 'sk', style: 'width:45%' })))));

export const skeletonHome = () => h('div', {}, h('div', { class: 'sk sk-hero' }), skeletonGrid(4));

export const stateBox = (title, text, ico = 'inbox', ...actions) =>
  h('div', { class: 'state', role: 'status' }, icon(ico), h('h2', { text: title }), h('p', { text }), ...actions);

export const errorState = (err, retry) => {
  const box = stateBox('Data gagal dimuat', err?.message || 'Terjadi kesalahan tak terduga.', 'refresh',
    h('button', { class: 'btn primary', type: 'button', onclick: retry }, icon('refresh'), 'Coba lagi'));
  box.setAttribute('role', 'alert');
  return box;
};

export const section = (title, linkText, href, ...content) =>
  h('section', { class: 'sec' },
    h('div', { class: 'sec-h' }, h('h2', { text: title }), linkText && h('a', { href, text: linkText })),
    ...content);

export const hero = (g, imageUrl) =>
  h('section', { class: 'hero' },
    safeUrl(imageUrl) && h('div', { class: 'hero-media' },
      image(imageUrl, `Gambar ${g.title}`, { loading: 'eager', fetchpriority: 'high' })),
    h('div', { class: 'hero-in' },
      h('span', { class: 'eyebrow' }, h('i', { class: 'dot' }), 'Gratis untuk dimainkan'),
      h('h1', { text: 'Discover Your Next Game' }),
      h('p', { text: 'Jelajahi katalog game free-to-play dari FreeToGame. Cari, filter, dan simpan game favoritmu.' }),
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: '#/games', text: 'Explore Games' }),
        h('a', { class: 'btn', href: `#/favorites`, text: 'Favorit saya' })),
      h('div', { class: 'pick' },
        h('span', { class: 'sub' }, h('span', { text: `Pilihan acak: ${g.title}` })),
        h('a', { class: 'btn', href: `#/game/${Number(g.id)}`, text: 'Lihat detail' }))));

const REQ = { os: 'Sistem operasi', processor: 'Prosesor', memory: 'Memori', graphics: 'Grafis', storage: 'Penyimpanan' };

export const detailView = (g, fav, voteOpts) => {
  const play = safeUrl(g.game_url);
  const profile = safeUrl(g.freetogame_profile_url);
  const shots = (g.screenshots || []).map((s) => safeUrl(s.image)).filter(Boolean);
  const row = (k, v) => (v ? [h('dt', { text: k }), h('dd', { text: v })] : []);
  const req = Object.entries(REQ).flatMap(([k, label]) => row(label, g.minimum_system_requirements?.[k]));
  const ext = (href, text, cls) =>
    h('a', { class: `btn ${cls}`, href, target: '_blank', rel: 'noopener noreferrer' }, text, icon('ext'));

  return h('div', { class: 'detail' },
    h('div', {},
      image(shots[0] || g.thumbnail, `Cover ${g.title}`, { class: 'cover', loading: 'eager', fetchpriority: 'high' }),
      h('h1', { text: g.title }),
      h('div', { class: 'tags' }, tag(g.genre), tag(g.platform, true)),
      h('div', { class: 'actions' },
        play && ext(play, 'Play Now', 'primary'),
        profile && ext(profile, 'Halaman FreeToGame', ''),
        favButton(g, fav)),
      voteBar(Number(g.id), { ...voteOpts, size: 'lg' }),
      (g.description || g.short_description || '').split(/\n+/).filter(Boolean).map((t) => h('p', { class: 'desc', text: t })),
      shots.length
        ? h('section', { class: 'sec' },
            h('div', { class: 'sec-h' }, h('h2', { text: 'Screenshot' })),
            h('div', { class: 'shots' }, shots.map((u, i) =>
              h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' },
                image(u, `Screenshot ${i + 1} ${g.title}`, { loading: 'lazy' })))))
        : null),
    h('aside', {},
      h('div', { class: 'panel' },
        h('h2', { text: 'Informasi' }),
        h('dl', {}, row('Developer', g.developer), row('Publisher', g.publisher), row('Genre', g.genre),
          row('Platform', g.platform), row('Rilis', g.release_date && formatDate(g.release_date)), row('Status', g.status))),
      req.length ? h('div', { class: 'panel' }, h('h2', { text: 'Spesifikasi minimum' }), h('dl', {}, req)) : null));
};

export const toast = (msg, ico = 'pad') => {
  const t = h('div', { class: 'toast' }, icon(ico), h('span', { text: msg }));
  document.getElementById('toasts').append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 260);
  }, 2600);
};

/* ============================== Akun ============================== */

const field = (label, input) => h('label', { class: 'field' }, label, input);

export const authForm = ({ mode, onSubmit, busy }) => {
  const isRegister = mode === 'register';
  const err = h('p', { class: 'form-err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, busy ? 'Memproses…' : (isRegister ? 'Buat akun' : 'Masuk'));

  const username = h('input', {
    type: 'text', name: 'username', required: true, autocomplete: 'username',
    placeholder: 'namakamu', pattern: '[A-Za-z0-9_]{3,20}', maxlength: 20,
    autocapitalize: 'none', spellcheck: 'false',
  });
  const password = h('input', {
    type: 'password', name: 'password', required: true,
    autocomplete: isRegister ? 'new-password' : 'current-password',
    placeholder: isRegister ? 'minimal 8 karakter' : '••••••••', minlength: 8, maxlength: 200,
  });
  const displayName = h('input', {
    type: 'text', name: 'display_name', placeholder: 'opsional', maxlength: 40, autocomplete: 'nickname',
  });

  const showError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
  };

  // Sengaja TANPA novalidate: atribut pattern/minlength bawaan browser memberi
  // umpan balik instan tanpa bolak-balik ke server. Handler di bawah hanya
  // menangani kasus yang tidak tertangkap validasi native.
  const form = h('form', { class: 'auth-form' },
    h('h1', { class: 'page-title', text: isRegister ? 'Buat akun' : 'Masuk' }),
    h('p', { class: 'page-sub', text: isRegister
      ? 'Akun menyimpan favoritmu di server, jadi ikut ke mana saja.'
      : 'Selamat datang kembali.' }),
    isRegister && field('Nama tampilan', displayName),
    field('Username', username),
    field('Kata sandi', password),
    err,
    btn,
    h('p', { class: 'auth-alt' },
      isRegister ? 'Sudah punya akun? ' : 'Belum punya akun? ',
      h('a', { href: isRegister ? '#/masuk' : '#/daftar', text: isRegister ? 'Masuk di sini' : 'Daftar gratis' })),
    isRegister && h('p', { class: 'auth-note', text: 'Username 3-20 karakter: huruf, angka, dan garis bawah.' }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showError('');
    if (!username.value.trim() || !password.value) return showError('Username dan kata sandi wajib diisi.');
    btn.disabled = true;
    btn.textContent = 'Memproses…';
    onSubmit(
      { username: username.value.trim(), password: password.value, display_name: displayName.value.trim() },
      (msg) => { btn.disabled = false; btn.textContent = isRegister ? 'Buat akun' : 'Masuk'; showError(msg); },
    );
  });

  // Buka dengan fokus di field pertama.
  queueMicrotask(() => username.focus());
  return form;
};

export const profileView = ({ user, onSave, onAvatar, onRemoveAvatar, onLogout, saving }) => {
  const err = h('p', { class: 'form-err', role: 'alert' });
  const okMsg = h('p', { class: 'form-ok', role: 'status' });
  const preview = h('img', { class: 'avatar-img', alt: `Foto profil ${user.display_name || user.username}` });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'visually-hidden' });

  const paint = (u) => {
    const src = u.avatar_url ? `${u.avatar_url}?v=${u.created_at || 0}` : null;
    preview.replaceChildren();
    if (src) {
      const img = h('img', { class: 'avatar-img', src, alt: `Foto profil ${u.display_name || u.username}` });
      img.addEventListener('error', () => preview.replaceChildren(h('span', { class: 'avatar-fallback' }, (u.display_name || u.username)[0].toUpperCase())), { once: true });
      preview.append(img);
    } else {
      preview.append(h('span', { class: 'avatar-fallback' }, (u.display_name || u.username)[0].toUpperCase()));
    }
  };
  paint(user);

  const displayName = h('input', { type: 'text', value: user.display_name || '', maxlength: 40, placeholder: user.username });
  const bio = h('textarea', { maxlength: 280, rows: 4, placeholder: 'Ceritakan sedikit tentang dirimu…' }, user.bio || '');
  const counter = h('span', { class: 'counter', text: `${(user.bio || '').length}/280` });
  bio.addEventListener('input', () => { counter.textContent = `${bio.value.length}/280`; });

  const saveBtn = h('button', { class: 'btn primary', type: 'submit', disabled: !!saving }, saving ? 'Menyimpan…' : 'Simpan perubahan');

  const form = h('form', { class: 'profile-form', novalidate: true },
    field('Nama tampilan', displayName),
    field('Bio', bio),
    h('div', { class: 'field-foot' }, counter),
    err, okMsg,
    h('div', { class: 'actions' }, saveBtn));

  const showError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    okMsg.hidden = !!msg;
  };
  const showOk = (msg) => {
    okMsg.textContent = msg;
    okMsg.hidden = false;
    err.hidden = true;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showError('');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan…';
    onSave({ display_name: displayName.value.trim(), bio: bio.value.trim() }, (msg) => {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Simpan perubahan';
      if (msg) showError(msg); else showOk('Profil tersimpan.');
    });
  });

  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = ''; // izinkan memilih berkas yang sama lagi
    if (!f) return;
    const problem = checkAvatarFile(f);
    if (problem) return showError(problem);
    onAvatar(f, (msg, updated) => {
      if (msg) showError(msg);
      else { paint(updated); showOk('Foto profil diperbarui.'); }
    });
  });

  return h('div', { class: 'profile' },
    h('div', { class: 'profile-head' },
      h('div', { class: 'avatar', onclick: () => file.click(), role: 'button', tabindex: '0', 'aria-label': 'Ubah foto profil' },
        preview,
        h('span', { class: 'avatar-edit' }, icon('camera'))),
      h('div', {},
        h('h1', { class: 'page-title', text: user.display_name || user.username }),
        h('p', { class: 'profile-user', text: `@${user.username}` }),
        h('p', { class: 'profile-meta', text: `Bergabung ${new Date(user.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · ${Object.keys(user.favorites || {}).length} game tersimpan` }))),
    h('div', { class: 'avatar-actions' },
      file,
      h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('camera'), 'Ubah foto'),
      user.avatar_url && h('button', {
        class: 'btn', type: 'button',
        onclick: () => onRemoveAvatar((msg, updated) => {
          if (msg) showError(msg);
          else { paint(updated); showOk('Foto profil dihapus.'); }
        }),
      }, icon('trash'), 'Hapus foto')),
    form,
    h('div', { class: 'profile-logout' },
      h('button', { class: 'btn', type: 'button', onclick: onLogout }, 'Keluar dari akun')));
}

//.components.js tidak tahu aturan berkas; app.js menyuntikkan validator-nya.
let checkAvatarFile = () => null;
export const setAvatarValidator = (fn) => { checkAvatarFile = fn; };
/* ============================ Penilaian ============================ */

/**
 * Bar like/dislike untuk satu game.
 * `onVote(gameId, value, done)` wajib ditangani pemanggil (optimistik di app.js).
 * `size`: 'sm' untuk kartu, 'lg' untuk halaman detail.
 */
export const voteBar = (gameId, { size = 'sm', onVote, hint } = {}) => {
  const likeN = h('span', { class: 'v-n', text: String(vote.getCounts()[gameId]?.likes || 0) });
  const dislikeN = h('span', { class: 'v-n', text: String(vote.getCounts()[gameId]?.dislikes || 0) });

  const mk = (value, ico, countNode, label) => {
    const btn = h('button', {
      class: `v-btn v-${value}`, type: 'button',
      'aria-pressed': String(vote.reactionOf(gameId) === value),
      'aria-label': `${label} game ini`,
      title: hint || label,
      'data-vote': value,
    }, icon(ico), countNode);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = vote.toggle(gameId, value);
      // Terapkan seketika supaya terasa responsif, lalu benahi setelah server jawab.
      vote.applyLocal(gameId, next);
      paint();
      onVote?.(gameId, next, () => paint());
    });
    return btn;
  };

  const likeBtn = mk('like', 'thumbUp', likeN, 'Suka');
  const dislikeBtn = mk('dislike', 'thumbDown', dislikeN, 'Tidak suka');

  const root = h('div', {
    class: `v-bar v-${size}`,
    'data-game': String(gameId),
    onmouseenter: () => root.classList.add('ready'),
  }, likeBtn, dislikeBtn);

  function paint() {
    const c = vote.getCounts();
    const slot = c[gameId] || { likes: 0, dislikes: 0 };
    likeN.textContent = String(slot.likes);
    dislikeN.textContent = String(slot.dislikes);
    likeBtn.setAttribute('aria-pressed', String(vote.reactionOf(gameId) === 'like'));
    dislikeBtn.setAttribute('aria-pressed', String(vote.reactionOf(gameId) === 'dislike'));
  }

  paint();
  // Sinkron bila state berubah dari tempat lain (mis. setelah vote di kartu lain).
  root.sync = paint;
  return root;
};

/* ============================= Komentar ============================= */

const initials = (name) => [...String(name || '?').trim()][0]?.toUpperCase() || '?';

// Avatar bulat: inisial. Komentar anonim diberi gaya berbeda lewat `anon`.
const commenterFace = (c) => h('span', { class: `cm-face${c.author ? '' : ' anon'}` }, initials(c.displayName));

function emojiPicker(anchor) {
  const search = h('input', { type: 'search', placeholder: 'Cari emoji...', 'aria-label': 'Cari emoji' });
  const grid = h('div', { class: 'emoji-grid' });
  const tabs = h('div', { class: 'emoji-tabs', role: 'tablist', 'aria-label': 'Kategori emoji' });
  const panel = h('div', { class: 'emoji-panel', hidden: true });

  const close = () => {
    panel.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
  };

  const paint = (list) => {
    // Catatan: jangan `replaceChildren(...el)` — spreading elemen melempar
    // TypeError di browser juga, bukan hanya di test. Sebarkan selalu array.
    grid.replaceChildren(...list.map(({ key, ch }) => h('button', {
      class: 'emoji', type: 'button', title: key, 'aria-label': key,
      'data-emoji': ch,
    }, ch)));
    if (!list.length) grid.append(h('p', { class: 'emoji-empty', text: 'Emoji tidak ditemukan.' }));
  };

  const showCat = (cat) => {
    const list = cat === 'recent'
      ? comment.recentEmoji.read()
      : comment.EMOJI[cat].map(([key, ch]) => ({ key, ch }));
    paint(list.length ? list : comment.EMOJI_ALL.slice(0, 60));
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cat === cat)));
  };

  tabs.replaceChildren(
    h('button', { class: 'emoji-tab', type: 'button', role: 'tab', 'data-cat': 'recent', 'aria-selected': 'true', title: 'Baru dipakai', onclick: () => showCat('recent') }, '\u{1F550}'),
    ...comment.EMOJI_CATS.map(([cat, label]) =>
      h('button', { class: 'emoji-tab', type: 'button', role: 'tab', 'data-cat': cat, 'aria-selected': 'false', title: label, onclick: () => showCat(cat) }, [...label][0])),
  );

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    paint(q ? comment.EMOJI_ALL.filter((e) => e.key.includes(q)).slice(0, 90) : comment.EMOJI_ALL.slice(0, 90));
  });

  const onAway = (e) => {
    // Panel sudah lepas dari DOM (pindah halaman) -> lepaskan listener-nya
    // supaya tidak menumpuk setiap kali section komentar dibuat.
    if (!panel.isConnected) {
      document.removeEventListener('pointerdown', onAway, { capture: true });
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (!panel.hidden && !panel.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !panel.hidden) { close(); anchor.focus(); } };
  document.addEventListener('pointerdown', onAway, { capture: true });
  document.addEventListener('keydown', onKey);

  showCat('recent');
  // Delegasi sekali di panel: tombol emoji dibuat ulang setiap render, jadi
  // mengaitkan per tombol akan menumpuk.
  panel.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('.emoji');
    if (!btn) return;
    anchor.dispatchEvent(new CustomEvent('pick-emoji', { detail: btn.dataset.emoji }));
    close();
  });
  panel.append(search, tabs, grid);
  return { panel, close };
}

export const commentSection = (gameId, { user, handlers }) => {
  const list = h('div', { class: 'cm-list' });
  const counter = h('span', { class: 'cm-count' });
  const err = h('p', { class: 'form-err', role: 'alert' });

  const sortSel = h('select', { 'aria-label': 'Urutkan komentar' },
    h('option', { value: 'new', text: 'Terbaru' }),
    h('option', { value: 'old', text: 'Terlama' }),
    h('option', { value: 'top', text: 'Paling disukai' }));

  let items = [];
  let pending = false;

  const showError = (msg) => { err.textContent = msg || ''; err.hidden = !msg; };

  /* ---------------------------- composer ---------------------------- */
  const textarea = h('textarea', {
    rows: 3, maxlength: comment.MAX_TEXT, placeholder: 'Tulis komentar...',
    'aria-label': 'Tulis komentar',
  });
  const nameInput = h('input', {
    type: 'text', maxlength: comment.MAX_NAME, placeholder: 'Nama kamu',
    'aria-label': 'Nama untuk komentar anonim', autocomplete: 'nickname',
  });

  const count = h('span', { class: 'field-foot counter', text: `0/${comment.MAX_TEXT}` });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Kirim');

  const emojiBtn = h('button', {
    class: 'icon-btn', type: 'button', 'aria-label': 'Sisipkan emoji',
    'aria-expanded': 'false', title: 'Emoji',
  }, icon('smile'));
  const picker = emojiPicker(emojiBtn);

  const insert = (ch) => {
    if (!ch) return;
    const at = textarea.selectionStart ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, at) + ch + textarea.value.slice(at);
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
  };
  emojiBtn.addEventListener('pick-emoji', (e) => insert(e.detail));
  emojiBtn.addEventListener('click', () => {
    const open = picker.panel.hidden;
    picker.panel.hidden = !open;
    emojiBtn.setAttribute('aria-expanded', String(open));
    if (open) picker.panel.querySelector('input').focus();
  });

  textarea.addEventListener('input', () => {
    count.textContent = `${textarea.value.length}/${comment.MAX_TEXT}`;
    showError('');
  });

  const form = h('form', { class: 'cm-form' },
    user ? null : h('label', { class: 'field' }, 'Nama (komentar anonim)', nameInput),
    h('div', { class: 'cm-input-wrap' }, textarea, emojiBtn, picker.panel),
    user ? null : h('p', { class: 'cm-note', text: 'Masuk untuk mengedit atau menghapus komentarmu.' }),
    count, err,
    h('div', { class: 'actions' }, submit));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pending) return;
    const text = textarea.value.trim();
    if (!text) return showError('Komentar tidak boleh kosong.');
    if (text.length > comment.MAX_TEXT) return showError(`Maksimal ${comment.MAX_TEXT} karakter.`);
    if (!user && nameInput.value.trim().length < comment.LIMITS.nameMin) {
      return showError(`Nama minimal ${comment.LIMITS.nameMin} karakter.`);
    }
    pending = true;
    submit.disabled = true;
    submit.textContent = 'Mengirim...';
    handlers.onCreate({ gameId, text, display_name: nameInput.value.trim() }, (error, created) => {
      pending = false;
      submit.disabled = false;
      submit.textContent = 'Kirim';
      if (error) return showError(error);
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));
      if (!user) nameInput.value = '';
      comment.recentEmoji.push(created.text.match(/\p{Extended_Pictographic}/u)?.[0] || '');
      items = [created, ...items];
      paint();
      list.children[0]?.classList.add('flash');
    });
  });

  /* ----------------------------- daftar ----------------------------- */
  const timeNodes = [];

  function node(c) {
    const meta = h('span', {
      class: 'cm-time', title: new Date(c.createdAt).toLocaleString('id-ID'), 'data-ts': String(c.createdAt),
    }, comment.timeAgo(c.createdAt));
    timeNodes.length = 0;
    timeNodes.push(meta);

    const likeN = h('span', { class: 'cm-like-n', text: String(c.likes) });
    const likeBtn = h('button', {
      class: `cm-like${c.liked ? ' on' : ''}`, type: 'button',
      'aria-pressed': String(c.liked), disabled: !user,
      title: user ? 'Suka' : 'Masuk untuk memberi suka',
      'aria-label': `Suka komentar ini, ${c.likes} suka`,
    }, icon('heart'), likeN);

    likeBtn.addEventListener('click', () => {
      if (!user) return showError('Masuk dulu untuk memberi suka.');
      likeBtn.disabled = true;
      handlers.onLike(c, (error, data) => {
        likeBtn.disabled = false;
        if (error) return showError(error);
        c.liked = data.liked;
        c.likes = data.likes;
        likeBtn.classList.toggle('on', c.liked);
        likeBtn.setAttribute('aria-pressed', String(c.liked));
        likeN.textContent = String(c.likes);
        if (sortSel.value === 'top') paint();
      });
    });

    const body = h('p', { class: 'cm-text' }, c.text);
    const actions = h('div', { class: 'cm-actions' }, likeBtn);

    if (c.mine) {
      const editBtn = h('button', { class: 'cm-link', type: 'button' }, 'Ubah');
      const delBtn = h('button', { class: 'cm-link danger', type: 'button' }, 'Hapus');

      editBtn.addEventListener('click', () => {
        if (body.firstElementChild?.tagName === 'TEXTAREA') return;
        const ta = h('textarea', { rows: 3, maxlength: comment.MAX_TEXT, 'aria-label': 'Ubah komentar' }, c.text);
        const save = h('button', { class: 'btn primary', type: 'submit' }, 'Simpan');
        const box = h('div', { class: 'cm-edit' }, ta, h('div', { class: 'actions' }, save, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Batal')));
        const close = () => { body.replaceChildren(c.text); };
        body.replaceChildren(box);
        ta.focus();
        box.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const next = ta.value.trim();
          if (!next) return showError('Komentar tidak boleh kosong.');
          save.disabled = true;
          handlers.onEdit(c, next, (error, updated) => {
            save.disabled = false;
            if (error) return showError(error);
            c.text = updated.text;
            c.editedAt = updated.editedAt;
            // paint() (bukan hanya close()) supaya label "diubah" ikut muncul.
            paint();
          });
        });
      });

      delBtn.addEventListener('click', () => {
        delBtn.disabled = true;
        delBtn.textContent = 'Menghapus...';
        handlers.onDelete(c, (error) => {
          if (error) {
            delBtn.disabled = false;
            delBtn.textContent = 'Hapus';
            return showError(error);
          }
          items = items.filter((x) => x.id !== c.id);
          paint();
        });
      });

      actions.append(editBtn, delBtn);
    }

    return h('article', { class: 'cm', 'data-id': String(c.id) },
      commenterFace(c),
      h('div', { class: 'cm-main' },
        h('div', { class: 'cm-head' },
          h('span', { class: 'cm-name', text: c.displayName }),
          c.author ? null : h('span', { class: 'cm-badge', text: 'anonim' }),
          meta,
          c.editedAt ? h('span', { class: 'cm-edited', text: 'diubah' }) : null),
        body, actions));
  }

  const sortFn = () => (sortSel.value === 'old'
    ? (a, b) => a.createdAt - b.createdAt
    : sortSel.value === 'top'
      ? (a, b) => b.likes - a.likes || b.createdAt - a.createdAt
      : (a, b) => b.createdAt - a.createdAt);

  function paint() {
    const sorted = [...items].sort(sortFn());
    counter.textContent = `${items.length} komentar`;
    // Sama seperti paint() di picker: sebarkan array, bukan elemen tunggal.
    list.replaceChildren(...sorted.map(node));
    if (!sorted.length) {
      list.append(h('div', { class: 'cm-empty' },
        icon('inbox'),
        h('p', { text: 'Belum ada komentar.' }),
        h('p', { class: 'cm-note', text: 'Jadilah yang pertama bicara soal game ini.' })));
    }
  }

  sortSel.addEventListener('change', paint);

  // "2 menit lalu" harus tetap benar tanpa render ulang. Interval berhenti
  // sendiri begitu section dilepas dari DOM (pindah halaman).
  const ticker = setInterval(() => {
    if (!root.isConnected) return clearInterval(ticker);
    for (const n of timeNodes) n.textContent = comment.timeAgo(Number(n.dataset.ts));
  }, 30_000);

  const root = h('section', { class: 'sec cm-section', id: 'comments' },
    h('div', { class: 'sec-h' },
      h('h2', {}, 'Komentar ', counter),
      h('div', { class: 'cm-sort' }, sortSel)),
    form,
    list);

  return {
    root,
    load: async () => {
      try {
        const data = await handlers.load(gameId);
        items = data.comments;
        paint();
      } catch (error) {
        list.replaceChildren(h('div', { class: 'cm-empty' }, icon('refresh'), h('p', { text: error.message })));
      }
    },
  };
};
