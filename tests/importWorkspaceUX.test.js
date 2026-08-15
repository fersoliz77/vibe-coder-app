const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dialog = fs.readFileSync(path.join(root, 'src', 'features', 'projects', 'ImportWorkspaceDialog.jsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src', 'layouts', 'sidebar', 'Sidebar.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const learningStatus = fs.readFileSync(path.join(root, 'src', 'features', 'learning', 'LearningStatus.jsx'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'electron', 'services', 'projectContracts.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'electron', 'services', 'projectManager.js'), 'utf8');
const requirementsManager = fs.readFileSync(path.join(root, 'electron', 'services', 'requirementsManager.js'), 'utf8');
const requirementsCenter = fs.readFileSync(path.join(root, 'src', 'features', 'requirements', 'RequirementsCenter.jsx'), 'utf8');

test('external workspace import requires analysis, planning, and target confirmation', () => {
  assert.match(preload, /projects:choose-import/);
  assert.match(preload, /projects:analyze-import/);
  assert.match(preload, /projects:confirm-import/);
  assert.match(preload, /projects:plan-import/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /type="radio"/);
  assert.match(dialog, /useFocusTrap/);
  assert.match(dialog, /root\.inert = true/);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /tabIndex=\{section === item \? 0 : -1\}/);
  assert.match(dialog, /ArrowRight/);
  assert.match(dialog, /aria-labelledby="import-workspace-tab-audit"/);
  assert.match(dialog, /acknowledgeLowConfidence/);
  assert.match(dialog, /plan\.planId/);
  assert.match(dialog, /noSourceChanges/);
  assert.match(dialog, /setTimeout\(\(\) => window\.electronAPI\.projects\.cancelImport/);
  assert.match(dialog, /canReturnToReview/);
});

/*
 * La revision abria con un puntaje sobre 100 y una lista plana de manifiestos.
 * Quien elige una carpeta pregunta otra cosa: que hay adentro. El resumen de
 * productos va primero y el puntaje queda despues.
 */
test('the review leads with what the folder contains, not with a score', () => {
  const products = dialog.indexOf('import-workspace__products');
  const score = dialog.indexOf('import-workspace__score');
  assert.ok(products > -1 && score > products);
  assert.match(dialog, /importWorkspace\.productsNone/);
  assert.match(dialog, /importWorkspace\.productsOne/);
  assert.match(dialog, /importWorkspace\.productsMany/);
  assert.match(dialog, /importWorkspace\.productHas/);
  assert.match(dialog, /importWorkspace\.platforms\.\$\{platform\}/);
  assert.match(dialog, /analysis\?\.products/);
  assert.match(contracts, /products: \(analysis\.products \|\| \[\]\)/);
});

/*
 * El analisis dejo de tener tope de latencia: puede tardar. La contrapartida
 * es que tiene que decir en que va, y que cerrar el dialogo tiene que cortarlo.
 */
test('the analysis reports live progress and cancelling it stops the scan', () => {
  assert.match(preload, /onImportProgress: \(callback\) => subscribe\('projects:import-progress'/);
  assert.match(dialog, /onImportProgress\(\(event\) =>/);
  assert.match(dialog, /event\?\.grantId === selection\.id/);
  assert.match(dialog, /importWorkspace\.progressFolders/);
  assert.match(dialog, /importWorkspace\.progressManifests/);
  assert.match(dialog, /importWorkspace\.progressFound/);
  /* Los contadores cambian varias veces por segundo y no pueden dictarse uno por uno. */
  assert.match(dialog, /import-workspace__progress" aria-live="off"/);
  assert.match(manager, /shouldAbort: \(\) => !importGrants\.has\(id\)/);
  assert.match(manager, /projects:import-progress/);
  assert.match(contracts, /function toPublicImportProgress/);
});

/*
 * El plan no pedia ninguna decision nueva y ocupaba una pantalla entera. Dejo
 * de ser un paso: se prepara solo y se muestra junto al resultado. Lo que no
 * puede perderse es el contrato -- analizar, planificar, confirmar ese plan --
 * ni la posibilidad de leer el analisis completo.
 */
test('opening a folder is one action, with the plan prepared instead of stepped through', () => {
  assert.doesNotMatch(dialog, /phase === 'plan'/);
  assert.doesNotMatch(dialog, /setPhase\('planning'\)/);
  assert.match(dialog, /planImport\(selection\.id, \{ primaryTargetId: selectedTargetId, acknowledgeLowConfidence: acknowledged \}\)/);
  /* Cambiar de aplicacion vuelve a planificar: el plan que se confirma es siempre el de lo elegido. */
  assert.match(dialog, /planRequestRef\.current === request/);
  assert.match(dialog, /\[phase, selectedTargetId, acknowledged, selection\.id\]/);
  assert.match(dialog, /const canImport = phase === 'review' && Boolean\(plan\?\.planId\) && !planning/);
  assert.match(dialog, /onClick=\{confirm\} disabled=\{!canImport\}/);
});

test('the full analysis stays reachable behind a labelled disclosure', () => {
  assert.match(dialog, /aria-expanded=\{detailsOpen\} aria-controls="import-workspace-details"/);
  assert.match(dialog, /id="import-workspace-details"[^>]*hidden=\{!detailsOpen\}/);
  /* El tablist y su navegacion por teclado siguen existiendo, solo que ya no son lo primero que hay que leer. */
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /importWorkspace\.showDetails/);
});

test('reanalyzing a project reports progress and can be stopped', () => {
  assert.match(preload, /cancelAnalysis: \(projectId\) => invokeRequirement\('requirements:cancel-analysis', projectId\)/);
  assert.match(requirementsManager, /handle\('requirements:cancel-analysis'/);
  assert.match(requirementsManager, /const refresh = \(projectId, onProgress = \(\) => \{\}\) =>/);
  /* Cancelar ya descartaba el resultado; ahora ademas corta el escaneo. */
  assert.match(requirementsManager, /shouldAbort: isCancelled/);
  assert.match(requirementsCenter, /requirements\.cancelAnalysis\(project\.id\)/);
  assert.match(requirementsCenter, /progress\.stage === 'analyzing' && !progress\.requirementId/);
});

test('import setup never accepts a path, command, or file body from the renderer', () => {
  assert.match(preload, /planImport: \(grantId, choices\)/);
  assert.match(preload, /confirmImport: \(grantId, planId\)/);
  assert.doesNotMatch(preload, /planImport: \([^)]*(?:path|command|content)/i);
});

test('learning opens through the constrained main-process bridge', () => {
  assert.match(preload, /auth:open-learning/);
  assert.match(sidebar, /onNavigate\('learning'\)/);
  assert.match(app, /features\/learning\/LearningStatus/);
  assert.match(learningStatus, /closeLearning/);
  assert.match(learningStatus, /openLearning/);
  assert.match(sidebar, /sidebar\.learning/);
});
