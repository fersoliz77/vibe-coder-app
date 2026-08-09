export function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

export function applyDocumentTheme(documentRef, theme) {
  const normalized = normalizeTheme(theme);
  const isLight = normalized === 'light';
  const root = documentRef.documentElement;

  root.dataset.theme = normalized;
  root.style.colorScheme = normalized;
  root.classList.toggle('light-theme', isLight);
  documentRef.body?.classList.toggle('light-theme', isLight);
}
