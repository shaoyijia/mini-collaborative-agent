import subscribeCocoSleepMode from './services/coco-sleep-mode';
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import type { BubbleState } from './components/AgentBubble';
import PetSprite from './components/PetSprite';
import usePetPointer from './components/usePetPointer';
import type { PetMood } from './components/agent-types';
import type { AvatarMenuAction } from './components/AvatarMenuView';
import type { AvatarBubbleEvent } from './components/AvatarBubbleView';

// How long a progress note stays up while the chat is out of view.
const WORKING_HOLD_MS = 6_000;
// How long the "reply ready" reminder stays up. No repeat reminders.
const REPLY_HOLD_MS = 8_000;
// CSS transition for the bubble fade-out after a dismissal.
const FADE_MS = 400;

// ── Pet View ──────────────────────────────────────────────────────────────────
// The avatar is a GUI entry point to the chat, not a sensor: it never watches
// the user. It only reflects the agent's own state — writing while a run is in
// progress with the chat hidden, and a reminder once the reply is ready.

function PetView() {
  usePetPointer();
  const [mood, setMood] = useState<PetMood>('idle');
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;

  const [cocoSleeping, setCocoSleeping] = useState(false);
  // Mirrors whether the ••• menu window is open, for the trigger's styling.
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const menuActionRef = useRef<(action: AvatarMenuAction) => void>(() => {});
  // While Coco is dragged the pointer stays over it, so its hover controls
  // are hidden until the drag ends.
  const [dragging, setDragging] = useState(false);
  const bubbleEventRef = useRef<(type: AvatarBubbleEvent) => void>(() => {});

  // Agent bubbles are short reminders: they expire on schedule even while
  // the pointer is over them.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
  };

  const hideBubble = () => {
    clearTimers();
    setBubble(null);
    setMood('idle');
  };

  const showBubble = (next: Omit<BubbleState, 'fadingOut'>, holdMs: number) => {
    clearTimers();
    setBubble({ ...next, fadingOut: false });
    setMood('write');
    hideTimer.current = setTimeout(hideBubble, holdMs);
  };

  // The menu has its own window; main places it next to Coco and toggles it.
  const openActionsMenu = () =>
    window.electron?.ipcRenderer.sendMessage('open-avatar-menu');

  useEffect(() => {
    const cleanupMenuVisibility = window.electron?.ipcRenderer.on(
      'avatar-menu-visibility',
      (value: unknown) => {
        setActionsMenuOpen(
          (value as { open?: boolean } | undefined)?.open === true,
        );
      },
    );
    const cleanupMenuAction = window.electron?.ipcRenderer.on(
      'avatar-menu-action',
      (action: unknown) => menuActionRef.current(action as AvatarMenuAction),
    );
    const cleanupBubbleEvent = window.electron?.ipcRenderer.on(
      'avatar-bubble-event',
      (type: unknown) => bubbleEventRef.current(type as AvatarBubbleEvent),
    );
    const cleanupDragging = window.electron?.ipcRenderer.on(
      'avatar-dragging',
      (value: unknown) =>
        setDragging((value as { dragging?: boolean })?.dragging === true),
    );
    return () => {
      if (typeof cleanupMenuVisibility === 'function') cleanupMenuVisibility();
      if (typeof cleanupMenuAction === 'function') cleanupMenuAction();
      if (typeof cleanupBubbleEvent === 'function') cleanupBubbleEvent();
      if (typeof cleanupDragging === 'function') cleanupDragging();
    };
  }, []);

  const applySleepMode = useCallback((sleeping: boolean) => {
    setCocoSleeping(sleeping);
  }, []);

  useEffect(() => subscribeCocoSleepMode(applySleepMode), [applySleepMode]);

  const setCocoSleepMode = async (sleeping: boolean) => {
    const result = (await window.electron?.ipcRenderer.invoke(
      'set-coco-sleep-mode',
      { sleeping },
    )) as { success?: boolean; sleeping?: boolean } | undefined;
    if (result?.success) {
      applySleepMode(result.sleeping === true);
    }
  };

  // ── Agent progress: the run continues while the chat is out of view ────────
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    const cleanupWorking = ipc?.on('agent-working', (data: any) => {
      if (!data?.sessionId || !data?.requestId || !data?.text) return;
      // Do not replace a completion reminder.
      if (bubbleRef.current?.kind === 'reply') return;
      showBubble(
        {
          kind: 'working',
          text: data.text,
          target: { sessionId: data.sessionId, requestId: data.requestId },
        },
        WORKING_HOLD_MS,
      );
    });
    const cleanupEnd = ipc?.on('agent-work-ended', (data: any) => {
      const current = bubbleRef.current;
      if (current?.kind !== 'working') return;
      if (current.target.requestId !== data?.requestId) return;
      hideBubble();
    });
    const cleanupReply = ipc?.on('agent-reply-ready', (data: any) => {
      if (!data?.sessionId || !data?.requestId) return;
      showBubble(
        {
          kind: 'reply',
          text: 'Your reply is ready.',
          target: { sessionId: data.sessionId, requestId: data.requestId },
        },
        REPLY_HOLD_MS,
      );
    });
    const cleanupSuspend = ipc?.on('system-suspend', hideBubble);
    return () => {
      if (typeof cleanupWorking === 'function') cleanupWorking();
      if (typeof cleanupEnd === 'function') cleanupEnd();
      if (typeof cleanupReply === 'function') cleanupReply();
      if (typeof cleanupSuspend === 'function') cleanupSuspend();
      clearTimers();
    };
    // The handlers only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenChat = (e?: SyntheticEvent) => {
    e?.stopPropagation?.();
    window.electron?.ipcRenderer.sendMessage('open-main-window');
  };

  const handleViewConversation = () => {
    const target = bubbleRef.current?.target;
    if (target)
      window.electron?.ipcRenderer.sendMessage('view-agent-reply', target);
    else window.electron?.ipcRenderer.sendMessage('open-main-window');
    hideBubble();
  };

  const handleDismiss = () => {
    clearTimers();
    setBubble((b) => (b ? { ...b, fadingOut: true } : null));
    fadeTimer.current = setTimeout(hideBubble, FADE_MS);
  };

  // Menu items chosen in the ••• menu window run here, where Coco's mood
  // lives. Refreshed every render so the listener sees the current state.
  menuActionRef.current = (action: AvatarMenuAction) => {
    if (action === 'open-main-window') handleOpenChat();
    else if (action === 'toggle-sleep')
      setCocoSleepMode(!cocoSleeping).catch(() => undefined);
    else if (action === 'quit')
      window.electron?.ipcRenderer.sendMessage('quit-from-avatar');
    else window.electron?.ipcRenderer.sendMessage(action);
  };

  // Clicks on the bubble, which is drawn in its own window. Hovers
  // ('enter' / 'leave') only matter to that window's mouse handling.
  bubbleEventRef.current = (type: AvatarBubbleEvent) => {
    if (type === 'dismiss') handleDismiss();
    else if (type === 'view-conversation') handleViewConversation();
  };

  // The bubble window draws whatever bubble is current here.
  useEffect(() => {
    window.electron?.ipcRenderer.sendMessage('avatar-bubble-state', {
      bubble,
    });
  }, [bubble]);

  return (
    <div className="pet-stage">
      <div
        className={`pet-container${actionsMenuOpen ? ' has-open-actions' : ''}${
          dragging ? ' is-dragging' : ''
        }`}
        onContextMenu={(event) => {
          event.preventDefault();
          openActionsMenu();
        }}
      >
        <PetSprite mood={cocoSleeping && !bubble ? 'sleep' : mood} />
        <span className="pet-drag-hint" aria-hidden>
          Right-click for menu
        </span>

        <button
          type="button"
          className={`pet-actions-trigger${actionsMenuOpen ? ' is-open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            openActionsMenu();
          }}
          title="More actions"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={actionsMenuOpen}
        >
          •••
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<PetView />} />
      </Routes>
    </Router>
  );
}
