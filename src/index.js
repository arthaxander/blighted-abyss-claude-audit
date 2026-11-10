import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { UIProvider } from './contexts/UIContext';
import { GameTermHelpProvider } from './components/GameTermHelp';
import AccountBootstrap from './components/account/AccountBootstrap';
import './components/account/AccountBootstrap.css';
import { initializeTelegramWebApp } from './telegramWebApp';

initializeTelegramWebApp();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <UIProvider>
      <AccountBootstrap><GameTermHelpProvider><App /></GameTermHelpProvider></AccountBootstrap>
    </UIProvider>
  </React.StrictMode>
);
