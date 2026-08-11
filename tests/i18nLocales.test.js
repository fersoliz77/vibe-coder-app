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
    assert.equal(typeof dictionaries[locale].requirements, 'object');
    assert.equal(typeof dictionaries[locale].sidebar.requirements, 'string');
    assert.equal(typeof dictionaries[locale].requirements.actions.INSTALL_NPM_DEPENDENCIES.title, 'string');
    assert.equal(typeof dictionaries[locale].auth.platformAccess, 'string');
    assert.equal(typeof dictionaries[locale].auth.checkingAccountAccess, 'string');
    assert.equal(typeof dictionaries[locale].auth.continueWithGoogle, 'string');
    assert.equal(typeof dictionaries[locale].auth.openingGoogle, 'string');
    assert.equal(typeof dictionaries[locale].dashboard.accountAccess, 'string');
    assert.equal(typeof dictionaries[locale].dashboard.platformAccount, 'string');
    assert.equal(typeof dictionaries[locale].dashboard.role, 'string');
    assert.equal(typeof dictionaries[locale].settings.accountAccess, 'string');
    assert.equal(typeof dictionaries[locale].settings.role, 'string');
    assert.equal(typeof dictionaries[locale].settings.accountStatus, 'string');
    assert.match(dictionaries[locale].createProject.firebaseCopy, /manual|consola/i);
    assert.match(dictionaries[locale].createProject.authManualStep, /manual/i);
    assert.equal(typeof dictionaries[locale].createProject.remoteCleanupTitle, 'string');
    assert.equal(typeof dictionaries[locale].createProject.remoteCleanupCopy, 'string');
  }
});

test('locale dictionaries contain no legacy organization terminology', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { dictionaries } = await import(moduleUrl);

  assert.doesNotMatch(JSON.stringify(dictionaries), /school|membership|escuela|escolar|membres[ií]a/i);
});
