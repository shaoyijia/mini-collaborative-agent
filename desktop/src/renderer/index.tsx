import AvatarBubbleView from './components/AvatarBubbleView';
import AvatarMenuView from './components/AvatarMenuView';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { ReactElement } from 'react';
import './global.css';
import ImagePreviewView from './components/ImagePreviewView';
import OnboardingView from './components/OnboardingView';
import SessionChatView from './components/SessionChatView';
import WakeWordCaptureView from './components/WakeWordCaptureView';

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
const view = new URLSearchParams(window.location.search).get('view');

let rendered: ReactElement;
if (view === 'avatar-bubble') {
  rendered = <AvatarBubbleView />;
} else if (view === 'avatar-menu') {
  rendered = <AvatarMenuView />;
} else if (view === 'onboarding') {
  rendered = <OnboardingView />;
} else if (view === 'session') {
  rendered = <SessionChatView />;
} else if (view === 'image-preview') {
  rendered = <ImagePreviewView />;
} else if (view === 'wake-word-capture') {
  rendered = <WakeWordCaptureView />;
} else {
  rendered = <App />;
}

root.render(rendered);
