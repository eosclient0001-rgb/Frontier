import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';

// An identifying line in the console: when several tabs are open it is otherwise easy to paste
// another project's errors and think they are this one's.
console.info('%cFrontier — Terrain', 'color:#d6a078;font-weight:600', 'WebGPU terrain generator');

createRoot(document.getElementById('root')).render(<App />);
