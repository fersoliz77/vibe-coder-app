const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wizard = fs.readFileSync(path.join(root, 'src', 'features', 'projects', 'CreateProjectWizard.jsx'), 'utf8');
const locales = fs.readFileSync(path.join(root, 'src', 'i18n', 'locales.js'), 'utf8');

test('project requirements distinguish ready connections from missing accounts', () => {
  assert.match(wizard, /missingProviders\.length \? 'createProject\.requirementsTitle' : 'createProject\.requirementsReadyTitle'/);
  assert.match(wizard, /createProject\.connectedAs/);
  assert.match(locales, /requirementsReadyTitle: 'Connections ready'/);
  assert.match(locales, /requirementsReadyTitle: 'Conexiones listas'/);
  assert.match(locales, /Configuración > Conexiones/);
  assert.doesNotMatch(locales, /Qué hace falta/);
});
