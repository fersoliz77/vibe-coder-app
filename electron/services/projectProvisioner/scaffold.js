const path = require('path');
const { envPrefix, writeText } = require('./core');

async function scaffoldProject({ job, request, projectPath, state, invoke, fsImpl }) {
  fsImpl.mkdirSync(projectPath);
  state.localCreated = true;
  if (request.type === 'next-ts') {
    await invoke(job, 'npm', [
      'exec', '--yes', '--package=create-next-app@latest', '--', 'create-next-app', '.',
      '--ts', '--eslint', '--app', '--src-dir', '--use-npm', '--import-alias=@/*', '--yes', '--disable-git',
    ], projectPath);
    return;
  }
  if (request.type === 'vite-react-ts') {
    await invoke(job, 'npm', ['create', 'vite@latest', '.', '--', '--template', 'react-ts'], projectPath);
    await invoke(job, 'npm', ['install'], projectPath);
    return;
  }
  const webPath = path.join(projectPath, 'web');
  const mobilePath = path.join(projectPath, 'mobile');
  fsImpl.mkdirSync(webPath);
  fsImpl.mkdirSync(mobilePath);
  await invoke(job, 'npm', [
    'exec', '--yes', '--package=create-next-app@latest', '--', 'create-next-app', '.',
    '--ts', '--eslint', '--app', '--src-dir', '--use-npm', '--import-alias=@/*', '--yes', '--disable-git',
  ], webPath);
  await invoke(job, 'flutter', [
    'create', '--platforms=android', '--android-language=kotlin', '--org', 'com.vibecoder',
    '--project-name', request.slug.replace(/-/g, '_'), '.',
  ], mobilePath);
}

async function installBackendClients({ job, request, state, invoke, fsImpl }) {
  if (request.backend === 'none') return;
  const webPath = request.type === 'mobile-suite' ? path.join(state.projectPath, 'web') : state.projectPath;
  const prefix = envPrefix(request.type);
  await invoke(job, 'npm', ['install', request.backend === 'firebase' ? 'firebase' : '@supabase/supabase-js'], webPath);
  const sourceRoot = path.join(webPath, 'src', 'lib');
  fsImpl.mkdirSync(sourceRoot, { recursive: true });
  if (request.backend === 'firebase') {
    const envSource = request.type === 'vite-react-ts' ? 'import.meta.env' : 'process.env';
    writeText(path.join(sourceRoot, 'firebase.ts'), `import { getApps, initializeApp } from 'firebase/app';\nimport { getAuth } from 'firebase/auth';\nimport { getFirestore } from 'firebase/firestore';\n\nconst config = {\n  apiKey: ${envSource}.${prefix}FIREBASE_API_KEY,\n  authDomain: ${envSource}.${prefix}FIREBASE_AUTH_DOMAIN,\n  projectId: ${envSource}.${prefix}FIREBASE_PROJECT_ID,\n};\n\nexport const firebaseApp = getApps()[0] ?? initializeApp(config);\nexport const firebaseAuth = getAuth(firebaseApp);\nexport const firestore = getFirestore(firebaseApp);\n`, fsImpl);
  } else {
    const keyName = Object.keys(state.publicEnv).find((key) => key.endsWith('SUPABASE_PUBLISHABLE_KEY') || key.endsWith('SUPABASE_ANON_KEY'));
    const keyExpression = keyName?.startsWith('VITE_') ? `import.meta.env.${keyName}` : `process.env.${keyName}`;
    const urlExpression = prefix === 'VITE_' ? 'import.meta.env.VITE_SUPABASE_URL' : 'process.env.NEXT_PUBLIC_SUPABASE_URL';
    writeText(path.join(sourceRoot, 'supabase.ts'), `import { createClient } from '@supabase/supabase-js';\n\nexport const supabase = createClient(${urlExpression}!, ${keyExpression}!);\n`, fsImpl);
  }
  if (request.type !== 'mobile-suite') return;
  const mobilePath = path.join(state.projectPath, 'mobile');
  if (request.backend === 'firebase') {
    await invoke(job, 'flutter', ['pub', 'add', 'firebase_core', 'firebase_auth', 'cloud_firestore'], mobilePath);
    const settingsGradle = path.join(mobilePath, 'android', 'settings.gradle.kts');
    const appGradle = path.join(mobilePath, 'android', 'app', 'build.gradle.kts');
    if (fsImpl.existsSync(settingsGradle) && fsImpl.existsSync(appGradle)) {
      const settings = fsImpl.readFileSync(settingsGradle, 'utf8');
      const appBuild = fsImpl.readFileSync(appGradle, 'utf8');
      if (!settings.includes('com.google.gms.google-services')) {
        fsImpl.writeFileSync(settingsGradle, settings.replace(/(plugins\s*\{)/, '$1\n    id("com.google.gms.google-services") version "4.4.4" apply false'));
      }
      if (!appBuild.includes('com.google.gms.google-services')) {
        fsImpl.writeFileSync(appGradle, appBuild.replace(/(plugins\s*\{)/, '$1\n    id("com.google.gms.google-services")'));
      }
    }
    writeText(path.join(mobilePath, 'lib', 'backend_config.dart'), "import 'package:firebase_core/firebase_core.dart';\n\nFuture<FirebaseApp> initializeBackend() => Firebase.initializeApp();\n", fsImpl);
  } else {
    await invoke(job, 'flutter', ['pub', 'add', 'supabase_flutter'], mobilePath);
    const url = state.remotes.supabase.projectUrl;
    const key = Object.values(state.publicEnv).find((value) => value !== url);
    writeText(path.join(mobilePath, 'lib', 'backend_config.dart'), `import 'package:supabase_flutter/supabase_flutter.dart';\n\nconst supabaseUrl = '${url}';\nconst supabasePublishableKey = '${key}';\n\nFuture<void> initializeBackend() => Supabase.initialize(url: supabaseUrl, anonKey: supabasePublishableKey);\n`, fsImpl);
  }
}

module.exports = { installBackendClients, scaffoldProject };
