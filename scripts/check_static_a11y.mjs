import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('src/', root);
const rootPath = fileURLToPath(root);
const sourcePath = fileURLToPath(sourceRoot);
const failures = [];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : /\.jsx?$/.test(path) ? [path] : [];
  });
}

function maskJsxExpressions(source) {
  let result = '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (const character of source) {
    if (depth === 0) {
      if (character === '{') {
        depth = 1;
        result += ' ';
      } else {
        result += character;
      }
      continue;
    }
    result += character === '\n' ? '\n' : ' ';
    if (escaped) {
      escaped = false;
    } else if (quote) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
  }
  return result;
}

const html = readFileSync(new URL('index.html', root), 'utf8');
if (!/<html\s[^>]*\blang=["'][^"']+["']/i.test(html)) failures.push('index.html: <html> needs a non-empty lang attribute');

for (const path of filesUnder(sourcePath)) {
  const source = readFileSync(path, 'utf8');
  const checkable = maskJsxExpressions(source);
  const name = relative(rootPath, path).replaceAll('\\', '/');
  const labels = new Set([...checkable.matchAll(/htmlFor=["']([^"']+)["']/g)].map((match) => match[1]));

  for (const match of checkable.matchAll(/<(input|select|textarea)\b([^>]*)>/gs)) {
    const [, tag, attributes] = match;
    if (/type=["']hidden["']/.test(attributes)) continue;
    const id = /\bid=["']([^"']+)["']/.exec(attributes)?.[1];
    const before = checkable.slice(0, match.index);
    const insideLabel = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    const named = insideLabel || /\baria-(?:label|labelledby)=/.test(attributes) || (id && labels.has(id));
    if (!named) failures.push(`${name}: <${tag}> needs a matching label or aria-label`);
  }

  for (const match of checkable.matchAll(/<(?:dialog|\w+)\b([^>]*\brole=["']dialog["'][^>]*)>/gs)) {
    const attributes = match[1];
    if (!/\baria-modal=["']true["']/.test(attributes)) failures.push(`${name}: dialog needs aria-modal="true"`);
    if (!/\baria-(?:label|labelledby)=/.test(attributes)) failures.push(`${name}: dialog needs aria-label or aria-labelledby`);
  }

  for (const match of checkable.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attributes, body] = match;
    const iconOnly = /^\s*<[A-Z][\w.]*\b[^>]*\/>\s*$/.test(body);
    if (iconOnly && !/\baria-(?:label|labelledby)=/.test(attributes)) failures.push(`${name}: icon-only button needs aria-label or aria-labelledby`);
  }
}

if (failures.length) {
  console.error('Basic static accessibility checks failed (regex-based JSX coverage only; no computed DOM, keyboard, contrast, ARIA semantics, or axe):');
  [...new Set(failures)].forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log('Basic static accessibility checks passed (regex-based lang, critical labels, dialogs, icon buttons; not axe or a runtime audit).');
