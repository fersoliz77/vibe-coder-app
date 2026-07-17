import { createContext, useContext, useEffect } from 'react';
import { dictionaries, getSystemLocale, SUPPORTED_LOCALES } from './locales';
import { useAppStore } from '../store/useAppStore';

const I18nContext = createContext(null);
const legacyAi = {
  en: { connected: 'Connected', notConnected: 'Not connected', checking: 'Checking...', notInstalled: 'Not installed', notAuthenticated: 'Not authenticated', clear: 'Clear', logout: 'Log out', refresh: 'Refresh status', model: 'Model', reasoning: 'Reasoning', you: 'You', thinkingClaude: 'Claude is thinking...', thinkingChatGPT: 'ChatGPT is thinking...', askClaude: 'Ask Claude...', askChatGPT: 'Ask ChatGPT...', stop: 'Stop', send: 'Send', inputHint: 'Enter to send · Shift+Enter for a new line', suggestions: { react: 'Create a React component', debug: 'Debug this error', explainCode: 'Explain this code', tests: 'Write unit tests', review: 'Review this code', explainError: 'Explain this error' } },
  es: { connected: 'Conectado', notConnected: 'No conectado', checking: 'Comprobando...', notInstalled: 'No instalado', notAuthenticated: 'No autenticado', clear: 'Limpiar', logout: 'Cerrar sesión', refresh: 'Actualizar estado', model: 'Modelo', reasoning: 'Razonamiento', you: 'Tú', thinkingClaude: 'Claude está pensando...', thinkingChatGPT: 'ChatGPT está pensando...', askClaude: 'Preguntale algo a Claude...', askChatGPT: 'Preguntale algo a ChatGPT...', stop: 'Detener', send: 'Enviar', inputHint: 'Enter para enviar · Shift+Enter para nueva línea', suggestions: { react: 'Creá un componente React', debug: 'Depurá este error', explainCode: 'Explicá este código', tests: 'Escribí tests unitarios', review: 'Revisá este código', explainError: 'Explicá este error' } },
};

function translate(locale, key, values) {
  const message = key.split('.').reduce((value, segment) => value?.[segment], dictionaries[locale])
    ?? key.split('.').reduce((value, segment) => value?.[segment], legacyAi[locale])
    ?? key.split('.').reduce((value, segment) => value?.[segment], dictionaries.en);
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
