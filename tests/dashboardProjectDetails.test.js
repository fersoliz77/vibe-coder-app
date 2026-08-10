const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'src', 'features', 'dashboard', 'Dashboard.jsx'), 'utf8');
const wizard = fs.readFileSync(path.join(root, 'src', 'features', 'projects', 'CreateProjectWizard.jsx'), 'utf8');
const provisioner = fs.readFileSync(path.join(root, 'electron', 'services', 'projectProvisioner.js'), 'utf8');

test('project detail mode describes the project without repeating learning progress', () => {
  assert.match(dashboard, /className="project-details glass-card"/);
  assert.match(dashboard, /dashboard\.projectRepository/);
  assert.match(dashboard, /dashboard\.projectDelivery/);
  assert.match(dashboard, /dashboard\.projectLocation/);
  assert.doesNotMatch(dashboard, /<AccountCard compact/);
});

test('new projects retain the metadata shown by project details', () => {
  assert.match(provisioner, /stack: request\.stack/);
  assert.match(provisioner, /repositoryVisibility: request\.repository\?\.visibility/);
  assert.match(provisioner, /deploymentProvider: request\.deployment\?\.provider/);
  assert.match(provisioner, /workspaceAnalyzer\(projectPath\)/);
  assert.match(provisioner, /primaryTargetId: workspace\.recommendedTargetId/);
});

test('the wizard explains what private GitHub access means', () => {
  assert.match(wizard, /createProject\.githubRepository/);
  assert.match(wizard, /createProject\.privateRepositoryCopy/);
});
