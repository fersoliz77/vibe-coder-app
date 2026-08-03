const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACCOUNT_ROLES, ACCOUNT_STATUSES } = require('../electron/auth/policy');
const { loadContractSnapshot, validateContract } = require('../scripts/validate_contracts');

const fixturePath = path.join(__dirname, 'contracts', 'fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const snapshot = loadContractSnapshot();

test('versioned contract fixtures are accepted and rejected without dependencies', () => {
  for (const [name, value] of Object.entries(fixtures.valid)) {
    assert.deepEqual(validateContract(snapshot.contracts[name], value), [], name);
  }
  for (const fixture of fixtures.invalid) {
    assert.notEqual(validateContract(snapshot.contracts[fixture.contract], fixture.value).length, 0, fixture.contract);
  }
});

test('desktop role and status constants match the ecosystem snapshot', () => {
  const accountSchema = snapshot.contracts['account-role-status.schema.json'];
  assert.deepEqual(ACCOUNT_ROLES, accountSchema.properties.role.enum);
  assert.deepEqual(ACCOUNT_STATUSES, accountSchema.properties.status.enum);
});

test('desktop access normalization recognizes every canonical RPC field', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'auth', 'authService.js'), 'utf8');
  const fields = snapshot.contracts['desktop-access.schema.json'].required;
  for (const field of fields) assert.match(source, new RegExp(`\\b${field}\\b`), field);
  assert.deepEqual(Object.keys(fixtures.valid['desktop-access.schema.json']), fields);
});
