const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dialog = fs.readFileSync(path.join(root, 'src', 'features', 'projects', 'ImportWorkspaceDialog.jsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src', 'layouts', 'sidebar', 'Sidebar.jsx'), 'utf8');

test('external workspace import requires analysis and target confirmation', () => {
  assert.match(preload, /projects:choose-import/);
  assert.match(preload, /projects:analyze-import/);
  assert.match(preload, /projects:confirm-import/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /type="radio"/);
  assert.match(dialog, /useFocusTrap/);
  assert.match(dialog, /root\.inert = true/);
});

test('learning opens through the constrained main-process bridge', () => {
  assert.match(preload, /auth:open-learning/);
  assert.match(sidebar, /auth\?\.openLearning/);
  assert.match(sidebar, /sidebar\.learning/);
});
