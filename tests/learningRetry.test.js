const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
const statusSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'learning', 'LearningStatus.jsx'), 'utf8');

test('learning failure offers an in-place retry with accessible status changes', () => {
  assert.match(source, /lazy\(\(\) => import\('\.\/features\/learning\/LearningStatus'\)\)/);
  assert.match(statusSource, /const \[attempt, setAttempt\] = useState\(0\)/);
  assert.match(statusSource, /learning\?\.openLearning\?\.\(\)/);
  assert.match(statusSource, /learning\?\.closeLearning\?\.\(\)/);
  assert.match(statusSource, /unsubscribe\?\.\(\)/);
  assert.match(statusSource, /setAttempt\(\(current\) => current \+ 1\)/);
  assert.match(statusSource, /role=\{failed \? 'alert' : 'status'\}/);
  assert.match(statusSource, /copy\.retry/);
});

test('learning retry copy is available in both languages', () => {
  for (const key of ['loadingTitle', 'loadingCopy', 'errorTitle', 'errorCopy', 'retry']) {
    assert.equal((statusSource.match(new RegExp(`${key}:`, 'g')) || []).length, 2, key);
  }
});
