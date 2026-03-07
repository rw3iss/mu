import { h, render } from 'preact';
import { App } from './app';
import './styles/global.scss';

const root = document.getElementById('app');

if (root) {
  render(<App />, root);
}
