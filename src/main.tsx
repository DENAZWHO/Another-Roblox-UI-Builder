import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useStore } from './store';
import { loadAutosave, startAutosave, startRefImages } from './files';
import { demoDoc } from './model/presets';
import { loadWebFonts } from './model/fonts';
import { startLiveSync, startStudioEdits } from './sync';
import { loadEyedropper } from './ui/eyedropper';
import './styles.css';

loadWebFonts();
loadEyedropper();
const doc = loadAutosave() ?? demoDoc();
useStore.getState().loadDoc(doc);
startAutosave();
startRefImages();
startLiveSync();
startStudioEdits();

createRoot(document.getElementById('root')!).render(<App />);
