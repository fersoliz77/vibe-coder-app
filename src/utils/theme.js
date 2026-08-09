export function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

/* La misma clave que lee public/theme-boot.js antes del primer pintado. */
const BOOT_THEME_KEY = 'vibe-theme';

export function applyDocumentTheme(documentRef, theme) {
  const normalized = normalizeTheme(theme);
  const isLight = normalized === 'light';
  const root = documentRef.documentElement;

  root.dataset.theme = normalized;
  root.style.colorScheme = normalized;
  root.classList.toggle('light-theme', isLight);
  root.classList.toggle('light-mode', isLight);
  documentRef.body?.classList.toggle('light-theme', isLight);

  /*
   * La fuente de verdad es la configuracion local, pero solo se lee por IPC y
   * eso es asincrono: en el arranque el tema llegaria despues del primer
   * pintado. Se refleja aca para que theme-boot lo tenga disponible de forma
   * sincrona la proxima vez. Si el reflejo falla, el unico costo es volver a
   * ver el parpadeo.
   */
  try {
    documentRef.defaultView?.localStorage?.setItem(BOOT_THEME_KEY, normalized);
  } catch {
    /* almacenamiento bloqueado */
  }
}
