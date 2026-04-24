import './style.css';
import { MultiplayerApp } from './client/MultiplayerApp';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Unable to find #app container');
}

const app = new MultiplayerApp(root);
void app.start().catch((error) => {
  console.error('Failed to initialize multiplayer app', error);
});

window.addEventListener('beforeunload', () => {
  app.dispose();
});
