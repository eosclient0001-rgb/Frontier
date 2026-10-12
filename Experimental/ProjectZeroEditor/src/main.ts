import { RoadEditor } from './editor/editor';
import { mountUI } from './editor/ui';
import { generateCity } from './model/generator';
import { serializeNetwork } from './model/network';

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing');

const { editor } = mountUI(root, (viewport) => new RoadEditor(viewport));

if (!editor.restoreAutosave()) {
  // First run: start with a modest city so there is something to fly around.
  editor.setNetwork(generateCity({ seed: 1337, width: 1600, depth: 1600, block: 120 }));
}
editor.frameAll();
editor.start();

// Keep the latest state even if the tab closes within the autosave debounce.
window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem('project-zero-road-editor:autosave:v1', serializeNetwork(editor.net));
  } catch {
    /* storage unavailable; nothing else to do */
  }
});

// Handy for poking at the document from the browser console.
(window as unknown as { roadEditor: RoadEditor }).roadEditor = editor;
