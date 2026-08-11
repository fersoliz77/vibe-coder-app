const test = require('node:test');
const assert = require('node:assert/strict');
const { createImportPlan } = require('../electron/services/projectManager');

function analysis(classification = 'project') {
  return {
    fingerprint: 'a'.repeat(64),
    projectAssessment: { requiresAcknowledgement: classification !== 'project' },
    readiness: { recommendations: ['INSTALL_DEPENDENCIES'] },
    targets: [{ id: 'target-web', capabilities: { webPreview: true, androidPreview: false } }],
  };
}

test('import plan is bound to analysis and changes only app-owned metadata', () => {
  const plan = createImportPlan(analysis(), { primaryTargetId: 'target-web', acknowledgeLowConfidence: false }, {
    randomUUID: () => 'plan-id',
    now: () => 123,
  });
  assert.equal(plan.planId, 'plan-id');
  assert.equal(plan.analysisFingerprint, 'a'.repeat(64));
  assert.equal(plan.operations.every((operation) => operation.required && operation.selected), true);
  assert.deepEqual(plan.guarantees, { sourceFilesChanged: false, commandsExecuted: false, networkAccess: false, secretsStored: false });
  assert.doesNotMatch(JSON.stringify(plan), /projectPath|commandText|fileContent/);
});

test('weak folders require acknowledgement and unknown renderer fields are rejected', () => {
  assert.throws(() => createImportPlan(analysis('folder'), { primaryTargetId: 'target-web', acknowledgeLowConfidence: false }), /Confirm/);
  assert.throws(() => createImportPlan(analysis(), { primaryTargetId: 'target-web', acknowledgeLowConfidence: true, command: 'npm install' }), /invalid/);
  assert.throws(() => createImportPlan(analysis(), { primaryTargetId: 'missing', acknowledgeLowConfidence: true }), /Choose/);
});
