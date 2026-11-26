import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
