const AUDIT_SCRIPT = `(() => {
  const text = (value) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 160);
  const describe = (element) => ({ tag: element.tagName.toLowerCase(), id: text(element.id), name: text(element.getAttribute('name')), text: text(element.innerText || element.getAttribute('aria-label')) });
  const issues = [];
  const add = (kind, severity, message, element) => issues.push({ kind, severity, message, metadata: element ? describe(element) : {} });
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) add('responsive', 'warning', 'Page content overflows horizontally.');
  document.querySelectorAll('img:not([alt])').forEach((el) => add('accessibility', 'warning', 'Image is missing alt text.', el));
  document.querySelectorAll('input,select,textarea').forEach((el) => {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
    if (!labelled) add('accessibility', 'warning', 'Form control has no accessible label.', el);
  });
  document.querySelectorAll('button,[role="button"]').forEach((el) => {
    if (!text(el.innerText || el.getAttribute('aria-label')) && !el.getAttribute('aria-labelledby')) add('accessibility', 'warning', 'Button has no accessible name.', el);
  });
  document.querySelectorAll('a[href],button,input,select,textarea,[role="button"]').forEach((el) => {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24)) add('responsive', 'info', 'Interactive control is smaller than 24 by 24 pixels.', el);
  });
  return issues.slice(0, 100);
})()`;

/*
 * Los fallos propios de la vista previa viajan como codigo, no como frase, para
 * que la pantalla los traduzca. Se clasifican por ese codigo; el resto sigue
 * cayendo en las heuristicas de texto de siempre.
 */
const CODE_CATEGORIES = new Map([
  ['PREVIEW_TIMEOUT', 'timeout'],
  ['PREVIEW_NPM_MISSING', 'tooling'],
  ['PREVIEW_DEPENDENCIES_MISSING', 'tooling'],
  ['PREVIEW_NO_WEB_TARGET', 'validation'],
  ['PREVIEW_NO_MANIFEST', 'validation'],
  ['PREVIEW_NO_START_SCRIPT', 'validation'],
  ['PREVIEW_SCRIPT_NOT_RECOGNIZED', 'validation'],
  ['PREVIEW_SCRIPT_NOT_SINGLE_COMMAND', 'validation'],
  ['PREVIEW_BUSY_OTHER_PROJECT', 'validation'],
  ['PREVIEW_NOT_READY', 'validation'],
  ['PREVIEW_PORT_BUSY', 'network'],
  ['PREVIEW_STATIC_UNAVAILABLE', 'network'],
  ['PREVIEW_CODE_ERROR', 'process'],
  ['PREVIEW_EXITED', 'process'],
]);

function classifyPreviewError(error) {
  const message = String(error?.message || error || '');
  if (CODE_CATEGORIES.has(message)) return CODE_CATEGORIES.get(message);
  if (/timed? out|in time|within \d+ seconds/i.test(message)) return 'timeout';
  if (/not found|not installed|could not be resolved|no package|no mobile/i.test(message)) return 'tooling';
  if (/invalid|unsafe|outside|unsupported|registered/i.test(message)) return 'validation';
  if (/network|request|http|respond/i.test(message)) return 'network';
  if (/exited|process|spawn|compile|build/i.test(message)) return 'process';
  return 'runtime';
}

function formatDiagnosis(issues) {
  const lines = issues.map((issue) => `[${issue.severity.toUpperCase()}] ${issue.category}: ${issue.message}`);
  return lines.length ? lines.join('\n') : 'Preview diagnostics: no issues detected.';
}

module.exports = { AUDIT_SCRIPT, CODE_CATEGORIES, classifyPreviewError, formatDiagnosis };
