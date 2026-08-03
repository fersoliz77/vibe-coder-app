const path = require('path');
const { ProvisioningError, clientEnvPath, envPrefix, findValue, parseJsonOutput, runRemoteCreation, writeJson, writeText } = require('./core');

async function configureFirebase({ job, request, state, invoke, fsImpl }) {
  const projectId = request.firebase.projectId;
  state.remoteCreationAttempted = true;
  const firebase = { projectId, plan: 'spark', status: 'attempting', created: null, resources: {} };
  state.remotes.firebase = firebase;
  await runRemoteCreation(firebase, () => invoke(job, 'firebase', ['projects:create', projectId, '--display-name', request.slug, '--json', '--non-interactive'], state.projectPath, 'remote'));

  const webApp = { type: 'web-app', name: `${request.slug}-web`, status: 'attempting', created: null };
  firebase.resources.webApp = webApp;
  const webAppResult = await runRemoteCreation(webApp, () => invoke(job, 'firebase', ['apps:create', 'WEB', webApp.name, '--project', projectId, '--json', '--non-interactive'], state.projectPath, 'remote'));
  const webAppId = findValue(parseJsonOutput(webAppResult.stdout), ['appId', 'app_id']);
  if (!webAppId) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return the web app identifier.');
  const sdkResult = await invoke(job, 'firebase', ['apps:sdkconfig', 'WEB', webAppId, '--project', projectId, '--json', '--non-interactive'], state.projectPath, 'remote');
  const sdkConfig = parseJsonOutput(sdkResult.stdout);
  const apiKey = findValue(sdkConfig, ['apiKey', 'api_key']);
  const authDomain = findValue(sdkConfig, ['authDomain', 'auth_domain']) || `${projectId}.firebaseapp.com`;
  const messagingSenderId = findValue(sdkConfig, ['messagingSenderId', 'messaging_sender_id']) || '';
  if (!apiKey) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return the client SDK configuration.');

  const firestore = { type: 'firestore', database: '(default)', status: 'attempting', created: null };
  firebase.resources.firestore = firestore;
  await runRemoteCreation(firestore, () => invoke(job, 'firebase', [
    'firestore:databases:create', '(default)', '--location', request.firebase.location,
    '--project', projectId, '--non-interactive',
  ], state.projectPath, 'remote'));

  writeJson(path.join(state.projectPath, 'firebase.json'), {
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
  }, fsImpl);
  writeText(path.join(state.projectPath, 'firestore.rules'), "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if request.auth != null;\n    }\n  }\n}\n", fsImpl);
  writeJson(path.join(state.projectPath, 'firestore.indexes.json'), { indexes: [], fieldOverrides: [] }, fsImpl);
  writeJson(path.join(state.projectPath, '.firebaserc'), { projects: { default: projectId } }, fsImpl);
  await invoke(job, 'firebase', ['deploy', '--only', 'firestore', '--project', projectId, '--force', '--non-interactive'], state.projectPath, 'remote');

  const prefix = envPrefix(request.type);
  const publicEnv = {
    [`${prefix}FIREBASE_API_KEY`]: apiKey,
    [`${prefix}FIREBASE_AUTH_DOMAIN`]: authDomain,
    [`${prefix}FIREBASE_PROJECT_ID`]: projectId,
    [`${prefix}FIREBASE_MESSAGING_SENDER_ID`]: messagingSenderId,
    [`${prefix}FIREBASE_APP_ID`]: webAppId,
  };
  writeText(clientEnvPath(state.projectPath, request.type), `${Object.entries(publicEnv).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, fsImpl);
  state.publicEnv = publicEnv;
  firebase.webAppCreated = true;
  firebase.authConfigured = false;
  // Firebase CLI cannot enable sign-in providers; this remains an explicit external step.
  firebase.manualSteps = [{
    code: 'ENABLE_EMAIL_PASSWORD_AUTH',
    message: 'Enable Email/Password sign-in in the Firebase console before using authentication.',
  }];
  firebase.firestoreConfigured = true;

  if (request.type === 'mobile-suite') {
    const packageName = `com.vibecoder.${request.slug.replace(/-/g, '_').slice(0, 40)}`;
    const androidApp = { type: 'android-app', name: `${request.slug}-android`, packageName, status: 'attempting', created: null };
    firebase.resources.androidApp = androidApp;
    const androidResult = await runRemoteCreation(androidApp, () => invoke(job, 'firebase', [
      'apps:create', 'ANDROID', androidApp.name, '--package-name', packageName,
      '--project', projectId, '--json', '--non-interactive',
    ], state.projectPath, 'remote'));
    const androidAppId = findValue(parseJsonOutput(androidResult.stdout), ['appId', 'app_id']);
    if (!androidAppId) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return the Android app identifier.');
    const androidConfig = await invoke(job, 'firebase', [
      'apps:sdkconfig', 'ANDROID', androidAppId, '--project', projectId, '--non-interactive',
    ], state.projectPath, 'remote');
    const androidPayload = parseJsonOutput(androidConfig.stdout);
    const fileContents = findValue(androidPayload, ['fileContents', 'file_contents']);
    const googleServices = fileContents ? parseJsonOutput(fileContents) : androidPayload;
    if (!googleServices) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return google-services.json.');
    writeJson(path.join(state.projectPath, 'mobile', 'android', 'app', 'google-services.json'), googleServices, fsImpl);
    firebase.androidAppCreated = true;
  }
}

module.exports = { configureFirebase };
