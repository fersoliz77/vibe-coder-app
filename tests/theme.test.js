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

test('critical desktop chrome resolves colors through theme tokens', () => {
  const files = [
    '../src/features/auth/AuthGate.css',
    '../src/features/explorer/FileExplorer.css',
    '../src/features/opencode/OpenCodePanel.css',
    '../src/features/setup/OnboardingWizard.css',
  ];
  const css = files.map((path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

  assert.doesNotMatch(css, /background:\s*rgba\((?:11|15|16|18),\s*(?:14|18|20|23),\s*(?:22|28|30|36)/);
  assert.doesNotMatch(css, /color:\s*#e6edf3/);
  assert.match(css, /background:\s*var\(--vc-surface-2\)/);
});

test('CodeMirror receives the active application theme', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const explorer = fs.readFileSync(new URL('../src/features/explorer/FileExplorer.jsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/features/explorer/ExplorerWorkspace.jsx', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/features/explorer/CodeEditor.jsx', import.meta.url), 'utf8');

  assert.match(app, /<FileExplorer[^>]*isDark=\{isDarkMode\}/);
  assert.match(explorer, /<ExplorerWorkspace[\s\S]*isDark=\{isDark\}/);
  assert.match(workspace, /<CodeEditor[\s\S]*isDark=\{isDark\}/);
  assert.match(editor, /theme=\{isDark \? oneDark : 'light'\}/);
});
