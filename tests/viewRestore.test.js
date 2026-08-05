const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'viewRestore.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

test('restores the saved view when a project is open', async () => {
  const { restoreView, VIEWS } = await load();
  for (const view of [VIEWS.FILES, VIEWS.TERMINAL, VIEWS.CLAUDE, VIEWS.OPENAI, VIEWS.PREVIEW, VIEWS.DASHBOARD]) {
    assert.equal(restoreView(view, true), view);
  }
});

test('settings and projects do not need an open project', async () => {
  const { restoreView, VIEWS } = await load();
  assert.equal(restoreView(VIEWS.SETTINGS, false), VIEWS.SETTINGS);
  assert.equal(restoreView(VIEWS.PROJECTS, false), VIEWS.PROJECTS);
});

test('a project view without a project falls back to the project list', async () => {
  const { restoreView, PROJECT_VIEWS, VIEWS } = await load();
  for (const view of PROJECT_VIEWS) {
    assert.equal(restoreView(view, false), VIEWS.PROJECTS);
  }
});

test('opencode is never restored, so no agent installs itself on launch', async () => {
  const { restoreView, VIEWS } = await load();
  assert.equal(restoreView(VIEWS.OPENCODE, true), VIEWS.DASHBOARD);
  assert.equal(restoreView(VIEWS.OPENCODE, false), VIEWS.PROJECTS);
});

test('an unknown, missing or malformed value never breaks the launch', async () => {
  const { restoreView, VIEWS } = await load();
  for (const value of [null, undefined, '', 'deleted-view', 42, {}, [], true]) {
    assert.equal(restoreView(value, true), VIEWS.DASHBOARD);
    assert.equal(restoreView(value, false), VIEWS.PROJECTS);
  }
});

test('every returned view is a real one', async () => {
  const { restoreView, VIEWS } = await load();
  const valid = Object.values(VIEWS);
  for (const saved of [...valid, null, 'x']) {
    for (const hasProject of [true, false]) {
      assert.ok(valid.includes(restoreView(saved, hasProject)));
    }
  }
});
