// Hash routing: #/ , #/games?genre=Shooter , #/game/452 , #/favorites

export const parseHash = () => {
  const [path, qs = ''] = (location.hash.slice(1) || '/').split('?');
  return {
    path,
    segments: path.split('/').filter(Boolean),
    params: Object.fromEntries(new URLSearchParams(qs)),
  };
};

export const buildHash = (path, params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
};

export const navigate = (path, params) => {
  location.hash = buildHash(path, params);
};

// Memperbarui URL tanpa memicu render ulang halaman (dipakai saat filter berubah).
export const setParams = (path, params) => history.replaceState(null, '', buildHash(path, params));

export const initRouter = (handler) => {
  const run = () => handler(parseHash());
  addEventListener('hashchange', run);
  run();
};
