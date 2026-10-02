import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useStore } from './store';
import { loadAutosave, startAutosave, startRefImages } from './files';
import { demoDoc } from './model/presets';
import { startProjects } from './projects';
import { loadWebFonts } from './model/fonts';
import { startLiveSync, startStudioEdits } from './sync';
import { loadEyedropper } from './ui/eyedropper';
import './styles.css';

loadWebFonts();
loadEyedropper();
const autosaved = loadAutosave();
useStore.getState().loadDoc(autosaved ?? demoDoc());
startAutosave();
startRefImages();
startProjects(!!autosaved);
startLiveSync();
startStudioEdits();

createRoot(document.getElementById('root')!).render(<App />);
