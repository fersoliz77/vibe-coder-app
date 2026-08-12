const test = require('node:test');
const assert = require('node:assert/strict');
const { getReleaseHistory } = require('../electron/services/releaseHistory');

test('release history is bounded, ordered, and exposes only local display fields', () => {
  const history = getReleaseHistory();
  assert.ok(history.length > 0 && history.length <= 20);
  assert.deepEqual(Object.keys(history[0]).sort(), ['date', 'highlights', 'version']);
  assert.equal(history.every((release) => /^\d+\.\d+\.\d+$/.test(release.version)), true);
  assert.equal(history.every((release) => /^\d{4}-\d{2}-\d{2}$/.test(release.date)), true);
  assert.equal(history.every((release) => release.highlights.every((highlight) => typeof highlight.en === 'string' && typeof highlight.es === 'string')), true);
});

test('release history callers cannot mutate the shared catalog', () => {
  const first = getReleaseHistory();
  first[0].highlights[0].en = 'modified';
  assert.notEqual(getReleaseHistory()[0].highlights[0].en, 'modified');
});
