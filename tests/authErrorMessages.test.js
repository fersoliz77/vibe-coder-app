import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedAuthError } from '../src/features/auth/authErrorMessages.js';
import { dictionaries } from '../src/i18n/locales.js';

const translations = {
  'auth.errors.invalidCredentials': 'Credenciales inválidas',
  'auth.errors.remoteRejected': 'Solicitud rechazada',
  'auth.errors.accessRevoked': 'Sesión vencida',
  'auth.errors.unexpected': 'Error inesperado',
};
const t = (key) => translations[key] || key;

test('authentication errors never expose backend codes or raw credential messages', () => {
  assert.equal(localizedAuthError({ code: 'AUTH_REMOTE_REJECTED', message: 'Invalid login credentials' }, t), 'Credenciales inválidas');
  assert.equal(localizedAuthError({ code: 'AUTH_REMOTE_REJECTED', message: 'opaque backend detail' }, t), 'Solicitud rechazada');
  assert.equal(localizedAuthError({ code: 'AUTH_ACCESS_REVOKED', message: 'raw' }, t), 'Sesión vencida');
});

test('unknown authentication errors use a professional generic message', () => {
  assert.equal(localizedAuthError({ code: 'SOMETHING_NEW', message: 'internal detail' }, t), 'Error inesperado');
});

test('credential and role guidance is available in both supported languages', () => {
  assert.match(dictionaries.es.auth.errors.invalidCredentials, /correo.*contraseña.*incorrectos/i);
  assert.match(dictionaries.en.auth.errors.invalidCredentials, /email.*password.*incorrect/i);
  assert.match(dictionaries.es.auth.adminDesktopWebOnly, /administrador.*web.*estudiante/i);
  assert.match(dictionaries.en.auth.adminDesktopWebOnly, /administrator.*web.*student/i);
  assert.match(dictionaries.es.auth.highContrastHelp, /texto.*bordes/i);
  assert.match(dictionaries.en.auth.reduceMotionHelp, /animations.*transitions/i);
});
