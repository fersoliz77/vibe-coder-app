import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyDocumentTheme, normalizeTheme } from '../src/utils/theme.js';

function element() {
  const classes = new Set();
  return {
    dataset: {},
    style: {},
    classes,
    classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
  };
}

test('theme values are normalized to the supported pair', () => {
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('unknown'), 'dark');
});

test('document theme updates root tokens and legacy selectors', () => {
  const documentRef = { documentElement: element(), body: element() };

  applyDocumentTheme(documentRef, 'light');
  assert.equal(documentRef.documentElement.dataset.theme, 'light');
  assert.equal(documentRef.documentElement.style.colorScheme, 'light');
  assert.equal(documentRef.documentElement.classes.has('light-theme'), true);
  assert.equal(documentRef.body.classes.has('light-theme'), true);

  applyDocumentTheme(documentRef, 'dark');
  assert.equal(documentRef.documentElement.dataset.theme, 'dark');
  assert.equal(documentRef.documentElement.classes.has('light-theme'), false);
  assert.equal(documentRef.body.classes.has('light-theme'), false);
});

test('desktop sidebar places real logout directly after the theme control', () => {
  const sidebar = fs.readFileSync(new URL('../src/layouts/sidebar/Sidebar.jsx', import.meta.url), 'utf8');
  const themeControl = sidebar.indexOf('onClick={onToggleTheme}');
  const logoutControl = sidebar.indexOf('onClick={onLogout}');

  assert.ok(themeControl >= 0);
  assert.ok(logoutControl > themeControl);
  assert.match(sidebar.slice(themeControl, logoutControl), /sidebar\.toggleTheme/);
  assert.match(sidebar.slice(logoutControl), /auth\.logout/);
});
