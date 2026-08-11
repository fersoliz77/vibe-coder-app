const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dialog = fs.readFileSync(path.join(root, 'src', 'features', 'projects', 'ImportWorkspaceDialog.jsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src', 'layouts', 'sidebar', 'Sidebar.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

test('external workspace import requires analysis, planning, and target confirmation', () => {
  assert.match(preload, /projects:choose-import/);
  assert.match(preload, /projects:analyze-import/);
  assert.match(preload, /projects:confirm-import/);
  assert.match(preload, /projects:plan-import/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /type="radio"/);
  assert.match(dialog, /useFocusTrap/);
  assert.match(dialog, /root\.inert = true/);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /tabIndex=\{section === item \? 0 : -1\}/);
  assert.match(dialog, /ArrowRight/);
  assert.match(dialog, /aria-labelledby="import-workspace-tab-audit"/);
  assert.match(dialog, /acknowledgeLowConfidence/);
  assert.match(dialog, /plan\.planId/);
  assert.match(dialog, /noSourceChanges/);
  assert.match(dialog, /setTimeout\(\(\) => window\.electronAPI\.projects\.cancelImport/);
  assert.match(dialog, /canReturnToReview/);
});

test('import setup never accepts a path, command, or file body from the renderer', () => {
  assert.match(preload, /planImport: \(grantId, choices\)/);
  assert.match(preload, /confirmImport: \(grantId, planId\)/);
  assert.doesNotMatch(preload, /planImport: \([^)]*(?:path|command|content)/i);
});

test('learning opens through the constrained main-process bridge', () => {
  assert.match(preload, /auth:open-learning/);
  assert.match(sidebar, /onNavigate\('learning'\)/);
  assert.match(app, /auth:close-learning|closeLearning/);
  assert.match(app, /openLearning/);
  assert.match(sidebar, /sidebar\.learning/);
});
