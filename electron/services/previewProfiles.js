/*
 * Que puede levantar Vibe por su cuenta, y que no.
 *
 * Antes esto era una sola comparacion exacta: el script `dev` tenia que decir
 * literalmente `vite` o `next dev`. Un `--host` de mas, o el `--turbopack` que
 * hoy genera `create-next-app`, y el proyecto pasaba a "sin vista previa".
 * Para un alumno eso es la diferencia entre ver su pagina o no verla nunca.
 *
 * Aca el script se lee de verdad: se separa en tokens, se descartan los
 * envoltorios habituales (`cross-env`, `npx`, `dotenv --`), y se mira que
 * binario y que subcomando corre. Los argumentos de host y puerto los agrega
 * Vibe al final, donde ganan sobre los que el script traiga.
 *
 * Lo que si se sigue rechazando es cualquier script encadenado (`&&`, `|`, `;`,
 * sustitucion o redireccion): ahi no se puede saber a que comando le caerian
 * los argumentos que agregamos, y un puerto que aterriza en el comando
 * equivocado es peor que no ofrecer la vista previa.
 */

const fs = require('fs');
const path = require('path');

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4173;

const SHELL_OPERATORS = /[;&|<>`$()\n\r]/;
const MAX_INDEX_SNIFF_BYTES = 64 * 1024;
const MAX_SCRIPT_LENGTH = 400;
const SCRIPT_PREFERENCE = ['dev', 'start', 'serve', 'develop'];

const hostPortLong = (host, port) => ['--host', host, '--port', String(port)];

/*
 * Cada entrada describe un servidor de desarrollo conocido: con que binario se
 * invoca, que subcomando lo levanta (`next dev`, `ng serve`) y como se le dice
 * en que host y puerto escuchar. `subcommandOptional` es para los que arrancan
 * sin subcomando, como `vite` a secas.
 */
const RUNTIMES = Object.freeze([
  { id: 'vite', bins: ['vite'], subcommands: ['dev', 'serve'], subcommandOptional: true, args: (host, port) => [...hostPortLong(host, port), '--strictPort'] },
  { id: 'next', bins: ['next'], subcommands: ['dev'], args: (host, port) => ['-H', host, '-p', String(port)] },
  { id: 'astro', bins: ['astro'], subcommands: ['dev', 'start'], args: hostPortLong },
  { id: 'nuxt', bins: ['nuxt', 'nuxi'], subcommands: ['dev'], args: hostPortLong },
  { id: 'angular', bins: ['ng'], subcommands: ['serve'], args: hostPortLong },
  { id: 'vue-cli', bins: ['vue-cli-service'], subcommands: ['serve'], args: hostPortLong },
  { id: 'react-scripts', bins: ['react-scripts'], subcommands: ['start'], args: () => [] },
  { id: 'gatsby', bins: ['gatsby'], subcommands: ['develop'], args: (host, port) => ['-H', host, '-p', String(port)] },
  { id: 'remix', bins: ['remix'], subcommands: ['vite:dev', 'dev'], args: hostPortLong },
  { id: 'svelte-kit', bins: ['svelte-kit'], subcommands: ['dev'], args: hostPortLong },
  { id: 'webpack', bins: ['webpack', 'webpack-dev-server'], subcommands: ['serve'], subcommandOptional: true, args: hostPortLong },
  { id: 'parcel', bins: ['parcel'], subcommands: ['serve', 'watch'], args: hostPortLong },
]);

/* Los que leen el puerto del entorno en vez de un argumento. */
const ENV_PORT_RUNTIMES = new Set(['react-scripts', 'gatsby', 'vue-cli']);

function binaryName(token) {
  const raw = String(token || '').toLowerCase().replace(/\\/g, '/');
  const base = raw.slice(raw.lastIndexOf('/') + 1);
  return base.replace(/\.(?:cmd|exe|bat|ps1|sh)$/, '');
}

function tokenizeScript(script) {
  const text = String(script || '').trim();
  if (!text || text.length > MAX_SCRIPT_LENGTH || SHELL_OPERATORS.test(text)) return null;
  const tokens = text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.length ? tokens.map((token) => token.replace(/^["']|["']$/g, '')) : null;
}

/* `cross-env FOO=1 vite`, `npx --yes astro dev`, `dotenv -e .env -- next dev`. */
function stripWrappers(tokens) {
  let rest = tokens;
  for (let round = 0; round < 3 && rest.length; round += 1) {
    const head = binaryName(rest[0]);
    if (head === 'cross-env' || head === 'env') {
      rest = rest.slice(1);
      while (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) rest = rest.slice(1);
      continue;
    }
    if (head === 'npx') {
      rest = rest.slice(1);
      while (rest.length && rest[0].startsWith('-')) rest = rest.slice(1);
      continue;
    }
    if (head === 'dotenv' || head === 'dotenv-cli') {
      const separator = rest.indexOf('--');
      if (separator === -1) return null;
      rest = rest.slice(separator + 1);
      continue;
    }
    break;
  }
  return rest.length ? rest : null;
}

function matchRuntime(tokens) {
  const bin = binaryName(tokens[0]);
  const runtime = RUNTIMES.find((candidate) => candidate.bins.includes(bin));
  if (!runtime) return null;
  const next = tokens[1];
  if (runtime.subcommands.includes(next)) return runtime;
  /*
   * Sin subcomando, o con una bandera detras, solo vale para los que arrancan
   * asi. Cualquier otra palabra suelta es otro comando del mismo binario
   * (`vite build`, `parcel build`) y esos no levantan un servidor.
   */
  if ((next === undefined || next.startsWith('-')) && runtime.subcommandOptional) return runtime;
  return null;
}

/*
 * Resuelve `npm run otro` hasta dos saltos: es comun que `dev` delegue en otro
 * script del mismo `package.json`.
 */
function resolveScriptTokens(scripts, name, depth = 0) {
  if (depth > 2) return null;
  const tokens = tokenizeScript(scripts?.[name]);
  if (!tokens) return null;
  const stripped = stripWrappers(tokens);
  if (!stripped) return null;
  const head = binaryName(stripped[0]);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(head) && stripped[1] === 'run' && stripped[2]) {
    return resolveScriptTokens(scripts, stripped[2], depth + 1);
  }
  return { tokens: stripped, delegationDepth: depth };
}

/**
 * Elige el script que levanta el proyecto y lo clasifica.
 *
 * @returns {{ script: string, runtime: object, tokens: string[] } | null}
 */
function findManagedScript(packageJson) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  for (const name of SCRIPT_PREFERENCE) {
    if (typeof scripts[name] !== 'string') continue;
    const resolved = resolveScriptTokens(scripts, name);
    if (!resolved) continue;
    const runtime = matchRuntime(resolved.tokens);
    if (runtime) return { script: name, runtime, tokens: resolved.tokens, delegationDepth: resolved.delegationDepth };
  }
  return null;
}

function firstDeclaredScript(packageJson) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  return SCRIPT_PREFERENCE.find((name) => typeof scripts[name] === 'string') || null;
}

/*
 * Un `index.html` que carga `/src/main.jsx` no es una pagina: es la entrada de
 * un bundler. Servirlo tal cual le mostraria al alumno una pantalla en blanco
 * y un error de consola, que es peor que decirle que no se puede.
 */
function looksLikeBundlerEntry(html) {
  const text = String(html || '');
  return /<script[^>]+src=["'][^"']*\.(?:jsx|tsx|ts|vue|svelte)(?:["'?])/i.test(text)
    || /<script[^>]+src=["'](?:\.?\/)?src\//i.test(text)
    || /%(?:PUBLIC_URL|VITE_)/.test(text);
}

function hasDeclaredDependencies(packageJson) {
  const count = (value) => (value && typeof value === 'object' ? Object.keys(value).length : 0);
  return count(packageJson?.dependencies) + count(packageJson?.devDependencies) > 0;
}

/**
 * Decide como se levanta una carpeta web.
 *
 * @param {object} facts
 * @param {object|null} facts.packageJson manifiesto ya parseado, o null
 * @param {boolean} facts.dependenciesInstalled si existe node_modules
 * @param {string|null} facts.indexHtml contenido de index.html, o null
 */
function planWebLaunch({ packageJson = null, dependenciesInstalled = false, indexHtml = null, host = PREVIEW_HOST, port = PREVIEW_PORT } = {}) {
  const managed = findManagedScript(packageJson);
  if (managed) {
    const extra = managed.runtime.args(host, port);
    const delegationSeparators = Array(managed.delegationDepth).fill('--');
    return {
      mode: 'managed-npm',
      runtime: managed.runtime.id,
      script: managed.script,
      npmArgs: extra.length ? ['run', managed.script, '--', ...delegationSeparators, ...extra] : ['run', managed.script],
      usesEnvironmentPort: ENV_PORT_RUNTIMES.has(managed.runtime.id),
      manualCommand: ['npm', 'run', managed.script],
      dependenciesInstalled,
      reason: null,
    };
  }
  /*
   * La primera pagina de un alumno no tiene manifiesto ni dependencias: es una
   * carpeta con `index.html`. Eso Vibe lo sirve solo, sin ejecutar nada del
   * proyecto, que es la vista previa mas segura que existe.
   */
  if (indexHtml !== null && !looksLikeBundlerEntry(indexHtml) && !hasDeclaredDependencies(packageJson)) {
    return {
      mode: 'managed-static', runtime: 'static', script: null, npmArgs: null,
      usesEnvironmentPort: false, manualCommand: null, dependenciesInstalled: true, reason: null,
    };
  }
  const fallbackScript = firstDeclaredScript(packageJson);
  if (fallbackScript) {
    return {
      mode: 'manual', runtime: null, script: fallbackScript, npmArgs: null, usesEnvironmentPort: false,
      manualCommand: ['npm', 'run', fallbackScript], dependenciesInstalled,
      reason: tokenizeScript(packageJson.scripts[fallbackScript]) ? 'SCRIPT_NOT_RECOGNIZED' : 'SCRIPT_NOT_SINGLE_COMMAND',
    };
  }
  return {
    mode: 'none', runtime: null, script: null, npmArgs: null, usesEnvironmentPort: false,
    manualCommand: null, dependenciesInstalled, reason: packageJson ? 'NO_START_SCRIPT' : 'NO_MANIFEST',
  };
}

/** Compatibilidad: identificador de perfil administrado, o `null`. */
function classifyWebScript(packageJson) {
  return findManagedScript(packageJson)?.runtime.id || null;
}

/* Lectura acotada del `index.html` de una carpeta, solo para reconocerlo. */
function readIndexHtmlHead(directory) {
  const filePath = path.join(directory, 'index.html');
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    const handle = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_INDEX_SNIFF_BYTES);
      const read = fs.readSync(handle, buffer, 0, MAX_INDEX_SNIFF_BYTES, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally { fs.closeSync(handle); }
  } catch { return null; }
}

module.exports = {
  PREVIEW_HOST,
  PREVIEW_PORT,
  classifyWebScript,
  findManagedScript,
  looksLikeBundlerEntry,
  planWebLaunch,
  readIndexHtmlHead,
  tokenizeScript,
};
