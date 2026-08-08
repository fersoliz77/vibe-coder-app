import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><I18nProvider><App /></I18nProvider></ErrorBoundary>
  </React.StrictMode>
);
