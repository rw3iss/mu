import { render } from 'preact';
import { App } from './app';
import './styles/global.scss';

const root = document.getElementById('app');

if (root) {
	render(<App />, root);
}

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/sw.js').catch(() => {});
}
