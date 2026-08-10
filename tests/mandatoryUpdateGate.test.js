const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'updates', 'MandatoryUpdateGate.jsx'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

test('mandatory update gate has no dismiss path and keeps blocked workspace inert', () => {
  assert.match(source, /state\?\.blocking/);
  assert.match(source, /state\?\.status !== 'disabled'/);
  assert.match(source, /inert=\{showUpdate \? '' : undefined\}/);
  assert.match(source, /window\.electronAPI\.updates\[action\]\(\)/);
  assert.match(source, /revision < latestRevision\.current/);
  assert.match(source, /latestRevision\.current < 0/);
  assert.doesNotMatch(source, /dismiss|skip|later|onClose|Ahora no/i);
});

test('update install asks the workspace to protect unsaved work first', () => {
  assert.match(source, /await prepareToRestart\(\) === false/);
  assert.match(app, /closeCheckRef\.current/);
  assert.match(app, /MandatoryUpdateGate prepareToRestart=\{prepareToRestart\}/);
});
