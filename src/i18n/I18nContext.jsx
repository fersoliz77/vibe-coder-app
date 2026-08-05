import { createContext, useContext, useEffect } from 'react';
import { dictionaries, getSystemLocale, SUPPORTED_LOCALES } from './locales';
import { useAppStore } from '../store/useAppStore';

const I18nContext = createContext(null);

const resolve = (source, key) => key.split('.').reduce((value, segment) => value?.[segment], source);

/*
 * Busca en el idioma activo y, si falta la clave, cae al ingles antes de
 * mostrar la clave cruda.
 *
 * Aca vivia un tercer diccionario, `legacyAi`, que parcheaba las claves de
 * `ai.*` borradas por un Object.assign en locales.js. Nunca funciono: sus
 * claves estaban al nivel raiz ('clear') y las busquedas llegan con prefijo
 * ('ai.clear'), asi que jamas resolvio nada. La causa se arreglo en
 * locales.js y este fallback se elimino.
 */
function translate(locale, key, values) {
  const message = resolve(dictionaries[locale], key) ?? resolve(dictionaries.en, key);
  if (typeof message !== 'string') return key;
  return message.replace(/{{(\w+)}}/g, (_, name) => values?.[name] ?? `{{${name}}}`);
}

export function I18nProvider({ children }) {
  const language = useAppStore((state) => state.language);
  const initialized = useAppStore((state) => state.initialized);
  const init = useAppStore((state) => state.init);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const locale = SUPPORTED_LOCALES.includes(language) ? language : getSystemLocale();

  useEffect(() => { init(); }, [init]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  return <I18nContext.Provider value={{ language: locale, initialized, setLanguage, t: (key, values) => translate(locale, key, values), formatDate: (value, options) => new Intl.DateTimeFormat(locale, options).format(new Date(value)) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
