const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('English and Spanish dictionaries initialize with required sections', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { dictionaries, SUPPORTED_LOCALES } = await import(moduleUrl);

  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'es']);
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(typeof dictionaries[locale].common, 'object');
    assert.equal(typeof dictionaries[locale].ai, 'object');
    assert.equal(typeof dictionaries[locale].preview, 'object');
    assert.equal(typeof dictionaries[locale].dashboard, 'object');
  }
});
