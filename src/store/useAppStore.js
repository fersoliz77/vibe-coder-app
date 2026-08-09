import { create } from 'zustand';
import { getSystemLocale, SUPPORTED_LOCALES } from '../i18n/locales';
import { normalizeTheme } from '../utils/theme';

let initializationPromise = null;

// Simple store that syncs with Electron local DB
export const useAppStore = create((set, get) => ({
  // State
  initialized: false,
  initializationStatus: 'idle',
  initializationError: '',
  currentProject: null,
  recentProjects: [],
  theme: 'dark',
  language: getSystemLocale(),
  // Ultima vista abierta. Se guarda para volver donde el usuario dejo el
  // trabajo; App.jsx decide si es seguro restaurarla.
  lastView: null,

  // Actions
  init: async () => {
    if (initializationPromise) return initializationPromise;
    set({ initializationStatus: 'loading', initializationError: '' });
    initializationPromise = (async () => {
      try {
        if (window.electronAPI?.store) {
          const config = await window.electronAPI.store.getAll();
          set({
            initialized: true,
            initializationStatus: 'ready',
            initializationError: '',
            currentProject: config.currentProject || null,
            recentProjects: config.recentProjects || [],
            theme: normalizeTheme(config.theme),
            language: SUPPORTED_LOCALES.includes(config.language) ? config.language : getSystemLocale(),
            lastView: typeof config.lastView === 'string' ? config.lastView : null,
          });
          return;
        }
        set({ initialized: true, initializationStatus: 'ready', initializationError: '' });
      } catch (error) {
        set({ initialized: false, initializationStatus: 'error', initializationError: error?.message || 'No se pudo leer la configuracion local.' });
      } finally {
        initializationPromise = null;
      }
    })();
    return initializationPromise;
  },

  setCurrentProject: async (project) => {
    set({ currentProject: project });
    if (window.electronAPI?.store) {
      await window.electronAPI.store.set('currentProject', project);
    }
  },

  clearCurrentProject: async () => {
    set({ currentProject: null });
    if (window.electronAPI?.store) {
      await window.electronAPI.store.delete('currentProject');
    }
  },

  addRecentProject: async (project) => {
    const { recentProjects } = get();
    // Avoid duplicates, move to top
    const filtered = recentProjects.filter(p => p.path !== project.path);
    const newRecent = [project, ...filtered].slice(0, 10); // keep max 10
    
    set({ recentProjects: newRecent });
    if (window.electronAPI?.store) {
      await window.electronAPI.store.set('recentProjects', newRecent);
    }
  },

  removeRecentProject: async (path) => {
    const { recentProjects, currentProject } = get();
    const newRecent = recentProjects.filter(p => p.path !== path);
    
    set({ recentProjects: newRecent });
    if (currentProject?.path === path) {
      set({ currentProject: null });
      if (window.electronAPI?.store) {
        await window.electronAPI.store.delete('currentProject');
      }
    }
    
    if (window.electronAPI?.store) {
      await window.electronAPI.store.set('recentProjects', newRecent);
    }
  },
  
  setTheme: async (theme) => {
    const normalized = normalizeTheme(theme);
    set({ theme: normalized });
    if (window.electronAPI?.store) {
      await window.electronAPI.store.set('theme', normalized);
    }
  },

  setLastView: async (view) => {
    if (get().lastView === view) return;
    set({ lastView: view });
    if (window.electronAPI?.store) {
      await window.electronAPI.store.set('lastView', view);
    }
  },

  setLanguage: async (language) => {
    if (!SUPPORTED_LOCALES.includes(language)) return;
    set({ language });
    if (window.electronAPI?.store) {
      await window.electronAPI.store.set('language', language);
    }
  }
}));
