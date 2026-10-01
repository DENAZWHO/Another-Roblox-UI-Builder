import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useStore } from './store';
import { loadAutosave, startAutosave } from './files';
import { demoDoc } from './model/presets';
import { loadWebFonts } from './model/fonts';
import { startLiveSync, startStudioEdits } from './sync';
import './styles.css';

loadWebFonts();
const doc = loadAutosave() ?? demoDoc();
useStore.getState().loadDoc(doc);
startAutosave();
startLiveSync();
startStudioEdits();

createRoot(document.getElementById('root')!).render(<App />);
