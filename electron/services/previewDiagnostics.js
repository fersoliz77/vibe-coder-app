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

function classifyPreviewError(error) {
  const message = String(error?.message || error || '');
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

module.exports = { AUDIT_SCRIPT, classifyPreviewError, formatDiagnosis };
