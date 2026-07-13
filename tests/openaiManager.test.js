const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCodexExecArgs, normalizeModelCatalog, resolveCodexPath } = require('../electron/services/openaiManager');

test('Codex chat uses an ephemeral workspace sandbox without bypass flags', () => {
  const args = buildCodexExecArgs('gpt-5.6-sol', 'ultra');
  assert.deepEqual(args, [
    'exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never',
    '--sandbox', 'workspace-write', '--model', 'gpt-5.6-sol',
    '--config', 'model_reasoning_effort="ultra"', '-',
  ]);
  assert.equal(args.some((value) => value.includes('dangerously')), false);
});

test('Codex chat permits the account default model', () => {
  assert.equal(buildCodexExecArgs('', 'medium').includes('--model'), false);
});

test('model catalog starts with GPT-5.4 and includes supported variants only', () => {
  const models = normalizeModelCatalog({ models: [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }] },
    { slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }] },
    { slug: 'gpt-4.1', display_name: 'GPT-4.1', visibility: 'list', supported_reasoning_levels: [] },
  ] });
  assert.deepEqual(models.map((model) => model.id), ['gpt-5.4', 'gpt-5.6-sol']);
  assert.deepEqual(models[1].reasoningLevels, ['low', 'ultra']);
});

test('the bundled official Codex executable is available on Windows', () => {
  if (process.platform !== 'win32') return;
  assert.match(resolveCodexPath(), /codex\.exe$/i);
});
