import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { installApiSecurity } from './api-security.js';
import { AuthGate } from './AuthGate.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

installApiSecurity();

createRoot(root).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
