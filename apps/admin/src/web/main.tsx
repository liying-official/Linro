import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './tailadmin/theme.css';
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
createRoot(root).render(<App/>);
