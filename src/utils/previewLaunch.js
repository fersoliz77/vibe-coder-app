/*
 * Como se cuenta "esto se levanta asi" en las pantallas.
 *
 * El panel y la vista previa decian cosas distintas sobre lo mismo, y ninguna
 * de las dos decia el comando. Ahora las dos leen de aca, y la respuesta
 * siempre es una de dos: o Vibe lo inicia solo, o este es el comando que hay
 * que escribir en la terminal.
 */

/* Nombres propios de cada motor: no se traducen. */
export const RUNTIME_LABELS = {
  vite: 'Vite',
  next: 'Next.js',
  astro: 'Astro',
  nuxt: 'Nuxt',
  angular: 'Angular',
  'vue-cli': 'Vue CLI',
  'react-scripts': 'Create React App',
  gatsby: 'Gatsby',
  remix: 'Remix',
  'svelte-kit': 'SvelteKit',
  webpack: 'webpack',
  parcel: 'Parcel',
  static: 'HTML',
  flutter: 'Flutter',
};

export function runtimeLabel(runtime) {
  return RUNTIME_LABELS[runtime] || runtime || '';
}

/**
 * @param {object|null} launch bloque `launch` del analisis o del estado de vista previa
 * @param {Function} t traductor de `useI18n`
 * @returns {{ managed: boolean, title: string, detail: string, command: string|null }}
 */
export function describeLaunch(launch, t) {
  const mode = launch?.mode || 'none';
  if (mode === 'managed-static') return { managed: true, title: t('launch.managedStatic'), detail: t('launch.managedStaticCopy'), command: null };
  if (mode === 'managed-android') return { managed: true, title: t('launch.managedAndroid'), detail: t('launch.managedAndroidCopy'), command: null };
  if (mode === 'managed-npm') return { managed: true, title: t('launch.managed'), detail: t('launch.managedCopy', { runtime: runtimeLabel(launch.runtime) }), command: null };
  const command = Array.isArray(launch?.command) && launch.command.length ? launch.command.join(' ') : null;
  if (command) return { managed: false, title: t('launch.manual'), detail: t('launch.manualCopy'), command };
  return { managed: false, title: t('launch.none'), detail: t(`launch.reasons.${launch?.reason || 'NO_MANIFEST'}`), command: null };
}

/**
 * Traduce un fallo de vista previa. Los codigos viajan como mensaje del error,
 * asi que lo que no sea un codigo conocido cae en el mensaje generico.
 */
export function previewErrorText(value, t) {
  const code = String(value || '').trim();
  if (!code) return '';
  if (!/^PREVIEW_[A-Z_]+$/.test(code)) return code;
  const translated = t(`preview.errors.${code}`);
  return translated === `preview.errors.${code}` ? t('preview.actionFailed') : translated;
}
