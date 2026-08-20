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

/*
 * Un proyecto importado del disco nunca se aprovisiono: no tiene repositorio ni
 * despliegue porque nadie se los creo. Mostrarlos igual, con "pendiente" al
 * lado, le hacia creer al alumno que debia algo.
 */
test('repository and delivery only appear for projects Vibe actually provisioned', () => {
  assert.match(dashboard, /currentProject\.origin !== 'imported'/);
  assert.match(dashboard, /showRepository = provisionedByVibe \|\| Boolean\(github\?\.project\)/);
  assert.match(dashboard, /showDelivery = provisionedByVibe \|\| Boolean\(vercel\?\.project\)/);
  assert.match(dashboard, /\{showRepository && <article><span>\{t\('dashboard\.projectRepository'\)\}/);
  assert.match(dashboard, /\{showDelivery && <article><span>\{t\('dashboard\.projectDelivery'\)\}/);
  /* La proxima accion tampoco puede pedir configurar un despliegue que no aplica. */
  assert.match(dashboard, /deliveryNeedsSetup = showDelivery && deliveryState === 'attention'/);
});

/* Lo que si aplica a cualquier proyecto, propio o importado: con que se levanta. */
test('project details say how the project is started', () => {
  assert.match(dashboard, /describeLaunch/);
  assert.match(dashboard, /dashboard\.projectLaunch/);
  assert.match(dashboard, /dashboard\.launchCommandLabel/);
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
