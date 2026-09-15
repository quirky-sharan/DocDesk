import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter/opsz.css';
import App from './App';
import './index.css';
import { installPressEffects } from './lib/press';

installPressEffects();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Opt into the v7 behaviours now so the router stops warning and the
        eventual upgrade is a no-op. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
