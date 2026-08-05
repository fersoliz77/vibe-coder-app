const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'explorer', 'gitStatusMeaning.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

test('an untracked file reads as new, not as modified', async () => {
  const { describeGitCode } = await load();
  const meaning = describeGitCode('??');
  assert.equal(meaning.key, 'untracked');
  assert.equal(meaning.staged, false);
});

test('the staged and unstaged halves of the code are told apart', async () => {
  const { describeGitCode } = await load();
  assert.deepEqual(
    { ...describeGitCode('M ') },
    { key: 'modified', staged: true, unstaged: false, tone: 'staged' },
  );
  const unstaged = describeGitCode(' M');
  assert.equal(unstaged.staged, false);
  assert.equal(unstaged.unstaged, true);
});

test('a file changed again after being staged counts as both', async () => {
  const { describeGitCode, gitStageKey } = await load();
  const meaning = describeGitCode('MM');
  assert.equal(meaning.staged, true);
  assert.equal(meaning.unstaged, true);
  assert.equal(gitStageKey(meaning), 'partiallyStagedHelp');
});

test('a conflict outranks any other reading of the code', async () => {
  const { describeGitCode, gitStageKey } = await load();
  for (const code of ['UU', 'AU', 'UD', 'DU']) {
    const meaning = describeGitCode(code);
    assert.equal(meaning.key, 'conflicted', code);
    assert.equal(meaning.tone, 'danger', code);
    assert.equal(gitStageKey(meaning), 'conflictedHelp', code);
  }
});

test('added, deleted and renamed each get their own name', async () => {
  const { describeGitCode } = await load();
  assert.equal(describeGitCode('A ').key, 'added');
  assert.equal(describeGitCode(' D').key, 'deleted');
  assert.equal(describeGitCode('R ').key, 'renamed');
  assert.equal(describeGitCode('C ').key, 'copied');
});

test('deleting is flagged as the risky one', async () => {
  const { describeGitCode } = await load();
  assert.equal(describeGitCode(' D').tone, 'danger');
  assert.equal(describeGitCode('D ').tone, 'danger');
});

test('a malformed or empty code never breaks the panel', async () => {
  const { describeGitCode, gitStageKey } = await load();
  for (const code of ['', ' ', null, undefined, 'ZZ', 'x']) {
    const meaning = describeGitCode(code);
    assert.equal(typeof meaning.key, 'string');
    assert.ok(meaning.key.length > 0, `sin nombre para ${JSON.stringify(code)}`);
    assert.equal(typeof gitStageKey(meaning), 'string');
  }
});

test('the staged flag matches what the stage button decides', async () => {
  const { describeGitCode } = await load();
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'explorer', 'explorerUtils.js'), 'utf8');
  const isStagedCode = (code) => {
    const value = String(code || '');
    return Boolean(value[0] && value[0] !== ' ' && value[0] !== '?');
  };
  assert.ok(source.includes('isStagedCode'), 'la funcion de referencia sigue existiendo');
  for (const code of ['M ', ' M', 'MM', 'A ', '??', ' D', 'D ', 'R ']) {
    assert.equal(describeGitCode(code).staged, isStagedCode(code), `desacuerdo en "${code}"`);
  }
});
