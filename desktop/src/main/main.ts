import type { Rectangle } from 'electron';
import { placeAvatarMenu } from './avatar-menu';
import {
  placeAvatarBubble,
  avatarBubbleMaxHeight,
  type AvatarCardPlacement,
} from './avatar-bubble';
import configureMainWindow, { resizeMainWindow } from './main-window-behavior';
import setupWindowOptions from './setup-window-options';
import AgentProgressReminder from './services/agent-progress-reminder';
import isChatOutOfView from './services/chat-visibility';
import {
  readPiConnection,
  registerPiProvider,
  startPiInferenceBridge,
  validatePiModel,
} from './services/pi-provider';
/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { createServer } from 'net';
import { spawn } from 'child_process';
import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  dialog,
  screen,
  powerMonitor,
  systemPreferences,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { DesktopAppUpdater } from './app-updater';
import log from 'electron-log';
import axios from 'axios';
import { resolveHtmlPath } from './util';
import { serviceManager } from './services/manager';
import {
  configureServiceModelArguments,
  startModelServices,
} from './services/model-arguments';
import {
  consumeTutorStream,
  TutorStreamTimeoutError,
} from './services/tutor-stream';
import type { TutorStreamEvent } from './services/tutor-stream';
import {
  WakeWordService,
  type WakeWordStatusEvent,
} from './services/wake-word-service';
import {
  readConversations,
  saveConversation,
  saveConversationDirectory,
  settleStoredReply,
  restorableMessages,
  interruptStaleReplies,
} from './conversation-store';
import {
  defaultTutor,
  getModelConfigurationView,
  prepareModelConnectionTest,
  readModelConfiguration,
  resolveModelRuntime,
  resolveTutorModelId,
  saveModelConfiguration,
  type ModelConfigurationInput,
  type ModelConnection,
} from './model-config-store';
import AgentRuns from './services/agent-runs';
import ChatStreamStore from './services/chat-stream-store';
import { parseAgentActivity } from '../shared/agent-execution';
import configureFullscreenCompanionWindow from './services/fullscreen-companion-window';

const dotenv = require('dotenv');
const agentRuns = new AgentRuns();
const chatStreams = new ChatStreamStore();
registerPiProvider(
  () => agentRuns.busy,
  () => agentRuns.dispose(),
);
const piBridgeToken = randomUUID();
process.env.COCO_PI_BRIDGE_TOKEN = piBridgeToken;

app.setName('coco');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

// A dedicated development override makes first-launch testing reliable through
// npm's nested webpack/electronmon process tree. Chromium's --user-data-dir
// flag is not consistently forwarded by every npm/shell combination.
const developmentUserDataDir = process.env.COCO_DESKTOP_USER_DATA_DIR?.trim();
if (!app.isPackaged && developmentUserDataDir) {
  const resolvedUserDataDir = path.resolve(developmentUserDataDir);
  fs.mkdirSync(resolvedUserDataDir, { recursive: true });
  app.setPath('userData', resolvedUserDataDir);
  log.info(`[Development] userData override: ${resolvedUserDataDir}`);
}

if (app.isPackaged) {
  // Packaged: read .env from the user-data folder (e.g. ~/Library/Application
  // Support/coco/.env). Bundling it via extraResources would ship the
  // builder's API keys inside every distributed app bundle.
  dotenv.config({ path: path.join(app.getPath('userData'), '.env') });
} else {
  // Dev: cwd is the desktop app dir, but the canonical .env (with GEMINI_API_KEY,
  // ANTHROPIC_API_KEY, etc.) lives at the repo root, one level up.
  // Load both — dotenv doesn't override pre-existing process.env entries, so
  // root-level keys win and desktop/.env supplies UI-only overrides.
  dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
  dotenv.config();
}

// Create default workspace directory if it doesn't exist
const ensureDefaultWorkspaceExists = () => {
  const workspaceDir = path.join(os.homedir(), 'coco', 'tmp_workspace');
  try {
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
      log.info(`Created default workspace directory: ${workspaceDir}`);
    }
  } catch (error) {
    log.error(`Failed to create default workspace directory: ${error}`);
  }
};

let installUpdateAfterShutdown = false;
const desktopAppUpdater = new DesktopAppUpdater({
  updater: autoUpdater,
  logger: log,
  isPackaged: app.isPackaged,
  platform: process.platform,
  currentVersion: () => app.getVersion(),
  requestRestartAndInstall: () => {
    installUpdateAfterShutdown = true;
    app.quit();
  },
});

// ── Window state ─────────────────────────────────────────────────────────────
// avatarWindow      : always-on-top 150×150 pet/avatar (loads local index.html)
// chatWindow        : local tutor-chat side panel (loads index.html?view=session);
//                     created on demand, hidden (not destroyed) on close so the
//                     conversation survives a reopen. Talks only to the local
//                     tutor server — no external backend or WebSocket.
// imagePreviewWindow: full-display preview for pending and sent chat images.
let avatarWindow: BrowserWindow | null = null;
const AVATAR_BASE_SIZE = 180;
// avatarMenuWindow: Coco's ••• menu, shown next to the pet on demand.
let avatarMenuWindow: BrowserWindow | null = null;
// Menu content size, reported by its renderer once laid out.
let avatarMenuSize = { width: 0, height: 0 };
let avatarMenuOpen = false;
let avatarMenuClosedAt = 0;
// Transparent room around the menu for its drop shadow; matches the padding of
// .avatar-menu-view.
const AVATAR_MENU_PADDING = 24;
// avatarBubbleWindow: the agent's progress / reply-ready bubble, shown next to
// the pet.
let avatarBubbleWindow: BrowserWindow | null = null;
// The bubble the avatar renderer is showing (null when none), and the size of
// its card as laid out by the bubble window's renderer.
let avatarBubbleState: unknown = null;
let avatarBubbleCardSize = { width: 0, height: 0 };
// Transparent room around the card for its drop shadow; matches the padding of
// .avatar-bubble-view.
const AVATAR_BUBBLE_PADDING = 24;
// Whether Coco is being dragged; a drag ends this long after its last move.
let avatarDragging = false;
let avatarDragEndTimer: ReturnType<typeof setTimeout> | null = null;
const AVATAR_DRAG_END_MS = 150;
let chatWindow: BrowserWindow | null = null;
let imagePreviewWindow: BrowserWindow | null = null;
let imagePreviewDataUrl: string | null = null;
let imagePreviewEditable = false;
let imagePreviewSourceWindow: BrowserWindow | null = null;
let wakeWordCaptureWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hideAvatarMode = false;
let avatarRendererReady = false;
let pendingOpenHistory = false;
let cocoSleeping = false;
let wakeWordService: WakeWordService | null = null;
let wakeWordEnabled = false;
let wakeWordStatus: WakeWordStatusEvent = { status: 'disabled' };
let systemSuspended = false;
let wakeWordCapturePaused = false;
let wakeWordCapturePauseTimer: ReturnType<typeof setTimeout> | null = null;
let wakeWordCaptureState = 'stopped';
let wakeWordDetectionSequence = 0;
let pendingWakeWordDetection: {
  id: number;
  keyword: string;
  attempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
} | null = null;

const WAKE_WORDS = ['COCO', 'HI COCO', 'HEY COCO'] as const;
const WAKE_WORD_MODEL = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';

const isCocoSleeping = () => cocoSleeping;

const wakeWordSettingsPath = () =>
  path.join(app.getPath('userData'), 'wake-word.json');

const readWakeWordEnabled = (): boolean => {
  const settingsPath = wakeWordSettingsPath();
  try {
    const enabled =
      JSON.parse(fs.readFileSync(settingsPath, 'utf8'))?.enabled === true;
    log.info(`[Wake word] Loaded enabled=${enabled} from ${settingsPath}`);
    return enabled;
  } catch (error) {
    log.info(
      `[Wake word] No saved setting at ${settingsPath}; defaulting disabled (${(error as Error).message})`,
    );
    return false;
  }
};

const saveWakeWordEnabled = (enabled: boolean): void => {
  fs.writeFileSync(
    wakeWordSettingsPath(),
    `${JSON.stringify({ enabled }, null, 2)}\n`,
    'utf8',
  );
};

const publishWakeWordStatus = (status: WakeWordStatusEvent): void => {
  wakeWordStatus = status;
  chatWindow?.webContents.send('wake-word-status', status);
  if (status.detail) log.warn(`[Wake word] ${status.status}: ${status.detail}`);
  else log.info(`[Wake word] ${status.status}`);
};

const setWakeWordCapturePaused = (paused: boolean): void => {
  wakeWordCapturePaused = paused;
  if (wakeWordCapturePauseTimer) clearTimeout(wakeWordCapturePauseTimer);
  wakeWordCapturePauseTimer = null;
  wakeWordCaptureWindow?.webContents.send('wake-word-capture-paused-changed', {
    paused,
  });
  if (paused) {
    // Voice recording is capped at 30 seconds. Never leave activation paused
    // indefinitely if the chat renderer fails during the handoff.
    wakeWordCapturePauseTimer = setTimeout(() => {
      setWakeWordCapturePaused(false);
    }, 45_000);
  }
};

// True once the Python services have been started. Guards against double-start
// and lets us defer startup until the user has chosen their models.
let servicesStarted = false;
// isFloatMode: chat panel is in narrow side-panel mode (vs. expanded width).
let isFloatMode = false;
// Set true once the app is genuinely quitting so window 'close' handlers stop
// intercepting (they otherwise hide-instead-of-close, which would block quit).
let isQuitting = false;

function agentDirectory(sessionId: string | null = currentSessionId): string {
  const conversation = sessionId
    ? readConversations().find((item) => item.sessionId === sessionId)
    : undefined;
  if (conversation?.workingDirectory) return conversation.workingDirectory;
  let directory = path.join(app.getPath('userData'), 'workspace');
  // Older conversations used a single shared folder. Preserve that choice
  // when first opening them; new sessions start in Coco's default workspace.
  if (conversation?.messages.length) {
    try {
      const saved = JSON.parse(
        fs.readFileSync(
          path.join(app.getPath('userData'), 'agent-workspace.json'),
          'utf8',
        ),
      );
      if (typeof saved.directory === 'string' && saved.directory)
        directory = saved.directory;
    } catch {
      /* No legacy folder setting. */
    }
  }
  fs.mkdirSync(directory, { recursive: true });
  if (sessionId) saveConversationDirectory(sessionId, directory);
  return directory;
}

ipcMain.handle(
  'get-agent-workspace',
  (_event, { sessionId }: { sessionId?: string | null } = {}) => ({
    directory: agentDirectory(sessionId),
  }),
);
ipcMain.handle(
  'choose-agent-workspace',
  async (
    _event,
    { sessionId = currentSessionId }: { sessionId?: string | null } = {},
  ) => {
    if (!sessionId)
      throw new Error('Open a conversation before choosing a folder.');
    if (agentRuns.has(sessionId))
      throw new Error('Stop this conversation before changing its folder.');
    const result = await dialog.showOpenDialog({
      title: 'Choose Coco’s working folder',
      defaultPath: agentDirectory(sessionId),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (agentRuns.has(sessionId))
      throw new Error('Stop this conversation before changing its folder.');
    const directory = fs.realpathSync(result.filePaths[0]);
    saveConversationDirectory(sessionId, directory);
    return { directory };
  },
);
ipcMain.handle('get-agent-context', (_event, sessionId: string) =>
  typeof sessionId === 'string'
    ? agentRuns.get(sessionId).getContextSnapshot(sessionId)
    : null,
);
ipcMain.handle(
  'answer-agent-question',
  (_event, toolCallId: string, response: unknown, requestId: string) =>
    agentRuns.answer(requestId, toolCallId, response),
);
ipcMain.handle('stop-agent-run', (_event, requestId: string) => {
  return agentRuns.abort(requestId);
});

ipcMain.handle('select-chat-files', () =>
  dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }),
);

ipcMain.on('close-chat-window', () => chatWindow?.close());
ipcMain.on('quit-from-onboarding', () => app.quit());
ipcMain.on('quit-from-avatar', () => app.quit());

// ── User profile ──────────────────────────────────────────────────────────────
const profilePath = () =>
  path.join(app.getPath('userData'), 'coco-profile.json');

const isOnboardingComplete = (): boolean => {
  try {
    const raw = fs.readFileSync(profilePath(), 'utf-8');
    const profile = JSON.parse(raw);
    return profile?.onboardingComplete === true;
  } catch {
    return false;
  }
};

const readHideAvatarSetting = (): boolean => {
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath(), 'utf-8'));
    return profile?.hideAvatar === true;
  } catch {
    return false;
  }
};

// ── Chat session state ────────────────────────────────────────────────────────
let isSessionActive = false;
let currentUserId: string | null = null;
let currentSessionId: string | null = null;
let pendingTaskLabel: string | null = null;
let currentTutorModelId: string | null = null;

const requestedPort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
};

const canBindPort = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });

const findAvailablePort = async (
  preferred: number,
  excluded: Set<number>,
): Promise<number> => {
  if (!excluded.has(preferred) && (await canBindPort(preferred)))
    return preferred;
  for (let candidate = 49152; candidate <= 65535; candidate += 1) {
    if (!excluded.has(candidate) && (await canBindPort(candidate)))
      return candidate;
  }
  throw new Error('Coco could not find an available local service port.');
};

const configureLocalServicePorts = async (): Promise<void> => {
  const requestedTutorPort = requestedPort(process.env.TUTOR_PORT, 8081);
  const tutorPort = await findAvailablePort(requestedTutorPort, new Set());

  process.env.TUTOR_PORT = String(tutorPort);
  serviceManager.configureServiceArg('tutor-server', 'port', String(tutorPort));
  serviceManager.configureServiceEnv('tutor-server', {
    TUTOR_PORT: String(tutorPort),
  });

  if (tutorPort !== requestedTutorPort) {
    log.warn(
      `[Ports] Requested tutor=${requestedTutorPort}; using tutor=${tutorPort} because the port was occupied.`,
    );
  } else {
    log.info(`[Ports] tutor=${tutorPort}`);
  }
};

// Preload path helper
const preloadPath = () =>
  app.isPackaged
    ? path.join(__dirname, 'preload.js')
    : path.join(__dirname, '../../.erb/dll/preload.js');

// ── Onboarding window ─────────────────────────────────────────────────────────
// Shown once on first launch (when coco-profile.json doesn't exist yet).
// Centered modal; after the user completes or skips it, the profile is written
// and the normal avatar + webapp windows are created.

const createOnboardingWindow = (modelsOnly = false) => {
  onboardingWindow = new BrowserWindow({
    ...setupWindowOptions(screen.getPrimaryDisplay().workArea),
    webPreferences: { preload: preloadPath() },
  });

  const url = `${resolveHtmlPath('index.html')}?view=onboarding${
    modelsOnly ? '&modelsOnly=1' : ''
  }`;
  onboardingWindow.loadURL(url);

  onboardingWindow.on('ready-to-show', () => {
    onboardingWindow?.show();
  });

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });

  onboardingWindow.on('close', (event) => {
    if (
      isQuitting ||
      (isOnboardingComplete() &&
        (readModelConfiguration() || readPiConnection().mode === 'native'))
    ) {
      return;
    }
    event.preventDefault();
    onboardingWindow?.hide();
    createTray();
  });
};

// ── Avatar actions menu ───────────────────────────────────────────────────────
// The ••• menu lives in its own small transparent window. Growing the avatar
// window to fit it made macOS show that window blank or misplaced for a frame
// or two on every open. This window is sized and placed while hidden, and only
// becomes visible once its renderer has painted the menu.

const avatarMenuBounds = () => {
  if (!avatarWindow || avatarWindow.isDestroyed()) return null;
  const b = avatarWindow.getBounds();
  const { x, y, below } = placeAvatarMenu(
    {
      x: b.x + b.width - AVATAR_BASE_SIZE,
      y: b.y + b.height - AVATAR_BASE_SIZE,
    },
    avatarMenuSize,
    screen.getDisplayMatching(b).workArea,
  );
  return {
    below,
    bounds: {
      x: x - AVATAR_MENU_PADDING,
      y: y - AVATAR_MENU_PADDING,
      width: avatarMenuSize.width + AVATAR_MENU_PADDING * 2,
      height: avatarMenuSize.height + AVATAR_MENU_PADDING * 2,
    },
  };
};

function closeAvatarMenu(): void {
  if (!avatarMenuOpen) return;
  avatarMenuOpen = false;
  avatarMenuClosedAt = Date.now();
  if (avatarMenuWindow && !avatarMenuWindow.isDestroyed()) {
    avatarMenuWindow.setOpacity(0);
    avatarMenuWindow.hide();
    avatarMenuWindow.webContents.send('avatar-menu-closed');
  }
  avatarWindow?.webContents.send('avatar-menu-visibility', { open: false });
}

function openAvatarMenu(): void {
  if (avatarMenuOpen) {
    closeAvatarMenu();
    return;
  }
  // The click that closed the menu (by blurring it) must not reopen it.
  if (Date.now() - avatarMenuClosedAt < 300) return;
  const placement = avatarMenuBounds();
  if (
    !placement ||
    !avatarMenuWindow ||
    avatarMenuWindow.isDestroyed() ||
    avatarMenuSize.height === 0
  ) {
    return;
  }
  avatarMenuOpen = true;
  avatarMenuWindow.setOpacity(0);
  avatarMenuWindow.setBounds(placement.bounds);
  avatarMenuWindow.webContents.send('avatar-menu-open', {
    below: placement.below,
  });
  // Focus it so Escape and clicking elsewhere close it.
  avatarMenuWindow.show();
  avatarWindow?.webContents.send('avatar-menu-visibility', { open: true });
}

const createAvatarMenuWindow = () => {
  if (avatarMenuWindow && !avatarMenuWindow.isDestroyed()) return;
  avatarMenuWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: process.platform !== 'darwin',
    webPreferences: { preload: preloadPath(), backgroundThrottling: false },
  });
  if (process.platform === 'darwin') {
    avatarMenuWindow.excludedFromShownWindowsMenu = true;
  }
  configureFullscreenCompanionWindow(avatarMenuWindow);
  avatarMenuWindow.setOpacity(0);
  avatarMenuWindow.loadURL(`${resolveHtmlPath('index.html')}?view=avatar-menu`);
  // Clicking anywhere else closes the menu, like a native one.
  avatarMenuWindow.on('blur', () => closeAvatarMenu());
  avatarMenuWindow.on('closed', () => {
    avatarMenuWindow = null;
    avatarMenuOpen = false;
    avatarMenuSize = { width: 0, height: 0 };
  });
};

ipcMain.removeAllListeners('open-avatar-menu');
ipcMain.on('open-avatar-menu', (event) => {
  if (event.sender !== avatarWindow?.webContents) return;
  openAvatarMenu();
});

ipcMain.removeAllListeners('close-avatar-menu');
ipcMain.on('close-avatar-menu', (event) => {
  if (event.sender !== avatarMenuWindow?.webContents) return;
  closeAvatarMenu();
});

// The menu renderer has painted the freshly opened menu: reveal the window.
ipcMain.removeAllListeners('avatar-menu-painted');
ipcMain.on('avatar-menu-painted', (event) => {
  if (event.sender !== avatarMenuWindow?.webContents || !avatarMenuOpen) return;
  avatarMenuWindow.setOpacity(1);
});

ipcMain.removeAllListeners('avatar-menu-size');
ipcMain.on(
  'avatar-menu-size',
  (event, size: { width?: unknown; height?: unknown } | undefined) => {
    if (event.sender !== avatarMenuWindow?.webContents) return;
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (!(width > 0 && height > 0)) return;
    avatarMenuSize = { width: Math.ceil(width), height: Math.ceil(height) };
    // Content grew or shrank while open (e.g. a Hide error): keep it in place.
    const placement = avatarMenuOpen ? avatarMenuBounds() : null;
    if (placement) avatarMenuWindow?.setBounds(placement.bounds);
  },
);

// Menu items other than Hide run in the avatar renderer, which owns the state
// they touch (the current bubble, Coco's mood).
ipcMain.removeAllListeners('avatar-menu-action');
ipcMain.on('avatar-menu-action', (event, action: unknown) => {
  if (event.sender !== avatarMenuWindow?.webContents) return;
  if (typeof action !== 'string') return;
  closeAvatarMenu();
  avatarWindow?.webContents.send('avatar-menu-action', action);
});

// ── Avatar agent bubble ───────────────────────────────────────────────────────
// Like the ••• menu, the bubble lives in its own transparent window. Growing
// the avatar window to fit it pushed Coco down whenever the window would have
// crossed the menu bar, and could flash Coco out of place for a frame. The
// avatar renderer still owns the bubble's state and handles its actions; this
// window only draws it. Its transparent margin lets clicks through to whatever
// is below, so it never blocks Coco or the desktop. It is a child of the avatar
// window, so macOS moves it with Coco in the same frame while Coco is dragged;
// it is re-placed once the drag ends, in case Coco now sits near an edge.

const avatarFootprint = (bounds: Rectangle) => ({
  x: bounds.x + bounds.width - AVATAR_BASE_SIZE,
  y: bounds.y + bounds.height - AVATAR_BASE_SIZE,
});

const hideAvatarBubble = () => {
  if (!avatarBubbleWindow || avatarBubbleWindow.isDestroyed()) return;
  avatarBubbleWindow.setOpacity(0);
  avatarBubbleWindow.hide();
  avatarBubbleWindow.setIgnoreMouseEvents(true, { forward: true });
};

// Size and place the bubble window beside Coco's current position. Returns the side it went on, or null when it can't be
// placed yet.
const placeBesideAvatar = (
  win: BrowserWindow | null,
  card: { width: number; height: number },
  padding: number,
  options?: Parameters<typeof placeAvatarBubble>[3],
): AvatarCardPlacement | null => {
  if (
    !win ||
    win.isDestroyed() ||
    !avatarWindow ||
    avatarWindow.isDestroyed() ||
    !avatarWindow.isVisible() ||
    card.height === 0
  ) {
    return null;
  }
  const b = avatarWindow.getBounds();
  const placement = placeAvatarBubble(
    avatarFootprint(b),
    card,
    screen.getDisplayMatching(b).workArea,
    options,
  );
  win.setBounds({
    x: placement.x - padding,
    y: placement.y - padding,
    width: card.width + padding * 2,
    height: card.height + padding * 2,
  });
  return placement;
};

// Place the bubble next to Coco. Returns false when there is nothing to place.
const placeAvatarBubbleWindow = (): boolean => {
  if (!avatarBubbleState) return false;
  const placement = placeBesideAvatar(
    avatarBubbleWindow,
    avatarBubbleCardSize,
    AVATAR_BUBBLE_PADDING,
  );
  if (!placement) return false;
  avatarBubbleWindow?.webContents.send('avatar-bubble-placement', {
    side: placement.side,
  });
  return true;
};

const createAvatarBubbleWindow = () => {
  if (avatarBubbleWindow && !avatarBubbleWindow.isDestroyed()) return;
  if (!avatarWindow || avatarWindow.isDestroyed()) return;
  avatarBubbleWindow = new BrowserWindow({
    parent: avatarWindow,
    show: false,
    width: 1,
    height: 1,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Showing a bubble must never take focus from the user's work.
    focusable: false,
    skipTaskbar: process.platform !== 'darwin',
    webPreferences: { preload: preloadPath(), backgroundThrottling: false },
  });
  if (process.platform === 'darwin') {
    avatarBubbleWindow.excludedFromShownWindowsMenu = true;
  }
  configureFullscreenCompanionWindow(avatarBubbleWindow);
  avatarBubbleWindow.setOpacity(0);
  avatarBubbleWindow.setIgnoreMouseEvents(true, { forward: true });
  avatarBubbleWindow.loadURL(
    `${resolveHtmlPath('index.html')}?view=avatar-bubble`,
  );
  // A reloaded renderer needs the current bubble again.
  avatarBubbleWindow.webContents.on('did-finish-load', () => {
    avatarBubbleWindow?.webContents.send('avatar-bubble-state', {
      bubble: avatarBubbleState,
    });
  });
  avatarBubbleWindow.on('closed', () => {
    avatarBubbleWindow = null;
    avatarBubbleCardSize = { width: 0, height: 0 };
  });
};

// The avatar renderer's bubble changed (null when it went away).
ipcMain.removeAllListeners('avatar-bubble-state');
ipcMain.on('avatar-bubble-state', (event, payload: { bubble?: unknown }) => {
  if (event.sender !== avatarWindow?.webContents) return;
  avatarBubbleState = payload?.bubble ?? null;
  if (!avatarBubbleWindow || avatarBubbleWindow.isDestroyed()) return;
  if (!avatarBubbleState) {
    hideAvatarBubble();
    avatarBubbleCardSize = { width: 0, height: 0 };
  }
  const { workArea } = screen.getDisplayMatching(
    avatarWindow?.getBounds() ?? screen.getPrimaryDisplay().workArea,
  );
  avatarBubbleWindow.webContents.send('avatar-bubble-state', {
    bubble: avatarBubbleState,
    maxHeight: avatarBubbleMaxHeight(workArea, AVATAR_BUBBLE_PADDING),
  });
});

ipcMain.removeAllListeners('avatar-bubble-size');
ipcMain.on(
  'avatar-bubble-size',
  (event, size: { width?: unknown; height?: unknown } | undefined) => {
    if (event.sender !== avatarBubbleWindow?.webContents) return;
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (!(width > 0 && height > 0)) return;
    avatarBubbleCardSize = {
      width: Math.ceil(width),
      height: Math.ceil(height),
    };
    placeAvatarBubbleWindow();
  },
);

// The bubble renderer has painted a new bubble at its final size: reveal it.
ipcMain.removeAllListeners('avatar-bubble-painted');
ipcMain.on('avatar-bubble-painted', (event) => {
  if (event.sender !== avatarBubbleWindow?.webContents) return;
  if (!placeAvatarBubbleWindow()) return;
  avatarBubbleWindow.showInactive();
  avatarBubbleWindow.setOpacity(1);
});

// Only the card catches the mouse; its transparent margin lets clicks through.
ipcMain.removeAllListeners('avatar-bubble-pointer');
ipcMain.on(
  'avatar-bubble-pointer',
  (event, { inside }: { inside?: boolean } = {}) => {
    if (event.sender !== avatarBubbleWindow?.webContents) return;
    avatarBubbleWindow.setIgnoreMouseEvents(inside !== true, {
      forward: true,
    });
  },
);

// Clicks and hovers on the bubble run in the avatar renderer, which owns the
// bubble's state.
ipcMain.removeAllListeners('avatar-bubble-event');
ipcMain.on('avatar-bubble-event', (event, type: unknown) => {
  if (event.sender !== avatarBubbleWindow?.webContents) return;
  if (typeof type !== 'string') return;
  avatarWindow?.webContents.send('avatar-bubble-event', type);
});

// ── Avatar window ─────────────────────────────────────────────────────────────

let avatarPointerDrag: {
  x: number;
  y: number;
  windowX: number;
  windowY: number;
} | null = null;
ipcMain.on('avatar-pointer', (event, value: { inside?: boolean } = {}) => {
  if (event.sender !== avatarWindow?.webContents || !avatarWindow) return;
  if (!avatarPointerDrag)
    avatarWindow.setIgnoreMouseEvents(value.inside !== true, { forward: true });
});
ipcMain.on('avatar-pointer-drag', (event, value: { phase?: string } = {}) => {
  if (event.sender !== avatarWindow?.webContents || !avatarWindow) return;
  if (value.phase === 'start') {
    const point = screen.getCursorScreenPoint();
    const bounds = avatarWindow.getBounds();
    avatarPointerDrag = { ...point, windowX: bounds.x, windowY: bounds.y };
    avatarWindow.setIgnoreMouseEvents(false);
  } else if (value.phase === 'move' && avatarPointerDrag) {
    const point = screen.getCursorScreenPoint();
    avatarWindow.setPosition(
      avatarPointerDrag.windowX + point.x - avatarPointerDrag.x,
      avatarPointerDrag.windowY + point.y - avatarPointerDrag.y,
    );
  } else if (value.phase === 'end') {
    avatarPointerDrag = null;
  }
});

const createAvatarWindow = () => {
  if (avatarWindow && !avatarWindow.isDestroyed()) return;

  // Just the pet. The bubble and menu have their own windows,
  // so this one never resizes: resizing it pushed Coco around near the top of
  // the screen, and its transparent margins would intercept desktop clicks.
  avatarWindow = new BrowserWindow({
    show: false,
    width: AVATAR_BASE_SIZE,
    height: AVATAR_BASE_SIZE,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: process.platform !== 'darwin',
    webPreferences: { preload: preloadPath() },
  });
  if (process.platform === 'darwin') {
    // The avatar is a companion surface, not a second Coco document. Keep it
    // out of the Dock's window list while the main chat remains listed there.
    avatarWindow.excludedFromShownWindowsMenu = true;
  }
  configureFullscreenCompanionWindow(avatarWindow);

  avatarWindow.loadURL(resolveHtmlPath('index.html'));
  avatarWindow.setIgnoreMouseEvents(true, { forward: true });
  // Screen coordinates and content bounds are both DIP units. Polling also
  // handles animation/scale changes when the pointer does not move.
  const pointerTimer = setInterval(() => {
    if (
      !avatarWindow ||
      avatarWindow.isDestroyed() ||
      !avatarWindow.isVisible()
    )
      return;
    const point = screen.getCursorScreenPoint();
    const bounds = avatarWindow.getContentBounds();
    const zoom = avatarWindow.webContents.getZoomFactor();
    avatarWindow.webContents.send('avatar-pointer-position', {
      x: (point.x - bounds.x) / zoom,
      y: (point.y - bounds.y) / zoom,
    });
  }, 33);

  avatarWindow.on('ready-to-show', () => {
    if (hideAvatarMode) {
      avatarWindow?.hide();
    } else if (process.env.START_MINIMIZED) {
      avatarWindow?.minimize();
    } else {
      avatarWindow?.showInactive();
    }
  });

  avatarWindow.on('closed', () => {
    clearInterval(pointerTimer);
    avatarPointerDrag = null;
    avatarWindow = null;
    avatarMenuWindow?.destroy();
    avatarBubbleWindow?.destroy();
    avatarBubbleState = null;
    if (avatarDragEndTimer) clearTimeout(avatarDragEndTimer);
    avatarDragEndTimer = null;
    avatarDragging = false;
  });

  // A drag shows up as a run of move events, the first preceded by will-move
  // where the platform reports it. Treat a short pause in them as the drag's
  // end. While dragging, the ••• trigger stays hidden even though the pointer
  // is over Coco, and the bubble (a child window) moves with Coco by itself.
  const setAvatarDragging = (dragging: boolean) => {
    if (avatarDragging === dragging) return;
    avatarDragging = dragging;
    if (avatarWindow && !avatarWindow.isDestroyed()) {
      avatarWindow.webContents.send('avatar-dragging', { dragging });
    }
  };
  const noteAvatarMove = () => {
    setAvatarDragging(true);
    if (avatarDragEndTimer) clearTimeout(avatarDragEndTimer);
    avatarDragEndTimer = setTimeout(() => {
      avatarDragEndTimer = null;
      setAvatarDragging(false);
      placeAvatarBubbleWindow();
    }, AVATAR_DRAG_END_MS);
  };
  avatarWindow.on('will-move', noteAvatarMove);
  avatarWindow.on('move', noteAvatarMove);
  avatarWindow.on('hide', () => {
    avatarPointerDrag = null;
    hideAvatarBubble();
  });
  avatarWindow.on('show', () => {
    if (!placeAvatarBubbleWindow() || !avatarBubbleWindow) return;
    avatarBubbleWindow.showInactive();
    avatarBubbleWindow.setOpacity(1);
  });

  avatarWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Native drag regions do not reliably dispatch DOM context-menu events. Use
  // Electron's native hooks to open the same menu as the ellipsis button so
  // both entry points stay visually and functionally consistent.
  avatarWindow.webContents.on('context-menu', (event) => {
    event.preventDefault();
    openAvatarMenu();
  });
  avatarWindow.on('system-context-menu', (event) => {
    event.preventDefault();
    openAvatarMenu();
  });

  createAvatarMenuWindow();
  createAvatarBubbleWindow();
};

// ── Chat window (local tutor session) ─────────────────────────────────────────
// A frameless right-edge side panel hosting the local SessionChatView. Unlike
// the old webapp window there is no WebSocket to keep alive, so it is created on
// demand and hidden (not destroyed) on close so the conversation persists if the
// user reopens it. All chat traffic goes straight to the local tutor server via
// the 'send-chat-message' IPC handler — no external backend involved.

const CHAT_PANEL_W = 520;
const CHAT_EXPANDED_W = 1160;
const CHAT_CONTENT_ZOOM_LEVELS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
let chatContentZoomFactor = 1;

let chatWindowPinned = false;

ipcMain.on('get-chat-window-pin-state', (event) => {
  if (event.sender !== chatWindow?.webContents) return;
  event.sender.send('chat-window-pin-state', { pinned: chatWindowPinned });
});
ipcMain.on(
  'set-chat-window-pinned',
  (event, value: { pinned?: boolean } = {}) => {
    if (
      event.sender !== chatWindow?.webContents ||
      !chatWindow ||
      typeof value?.pinned !== 'boolean'
    )
      return;
    chatWindow.setAlwaysOnTop(value.pinned);
    chatWindowPinned = chatWindow.isAlwaysOnTop();
    event.sender.send('chat-window-pin-state', { pinned: chatWindowPinned });
  },
);

const createChatWindow = () => {
  if (chatWindow && !chatWindow.isDestroyed()) return;

  chatWindow = new BrowserWindow({
    show: false,
    width: CHAT_PANEL_W,
    height: 700,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {}),
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    webPreferences: { preload: preloadPath(), backgroundThrottling: true },
  });

  configureMainWindow(chatWindow);
  chatWindow.loadURL(`${resolveHtmlPath('index.html')}?view=session`);

  const reportChatContentZoom = () => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    chatWindow.webContents.send(
      'chat-content-zoom-factor',
      chatContentZoomFactor,
    );
  };
  chatWindow.webContents.setZoomFactor(1);
  void chatWindow.webContents.setVisualZoomLevelLimits(1, 1);
  chatWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.meta || input.control) &&
      ['+', '-', '=', '0'].includes(input.key)
    ) {
      event.preventDefault();
      const currentIndex = CHAT_CONTENT_ZOOM_LEVELS.reduce(
        (closest, level, index) =>
          Math.abs(level - chatContentZoomFactor) <
          Math.abs(CHAT_CONTENT_ZOOM_LEVELS[closest] - chatContentZoomFactor)
            ? index
            : closest,
        0,
      );
      if (input.key === '0') {
        chatContentZoomFactor = 1;
      } else if (input.key === '+' || input.key === '=') {
        chatContentZoomFactor =
          CHAT_CONTENT_ZOOM_LEVELS[
            Math.min(currentIndex + 1, CHAT_CONTENT_ZOOM_LEVELS.length - 1)
          ];
      } else {
        chatContentZoomFactor =
          CHAT_CONTENT_ZOOM_LEVELS[Math.max(currentIndex - 1, 0)];
      }
      reportChatContentZoom();
    }
  });
  chatWindow.webContents.on('did-finish-load', () => {
    chatWindow?.webContents.setZoomFactor(1);
    reportChatContentZoom();
  });

  // Closing hides rather than destroys so the in-memory conversation survives
  // a reopen. On a real app quit, let it close so shutdown isn't blocked.
  chatWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    chatWindow?.hide();
    if (hideAvatarMode) return;
    if (!avatarWindow || avatarWindow.isDestroyed()) {
      createAvatarWindow();
    } else {
      avatarWindow.show();
    }
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  chatWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

// Position the chat window as a right-edge side panel and show it.
const showChatPanel = () => {
  createChatWindow();
  if (!chatWindow || chatWindow.isDestroyed()) return;

  const disp = screen.getDisplayMatching(chatWindow.getBounds());
  resizeMainWindow(
    chatWindow,
    isFloatMode ? CHAT_PANEL_W : CHAT_EXPANDED_W,
    disp.workArea,
  );
  chatWindow.webContents.send('float-window-state', { isFloat: isFloatMode });
  chatWindow.show();
  chatWindow.focus();
  // The avatar stays visible alongside the chat panel — never hide it, so the
  // pet is always available and closing the chat can't leave a blank screen.
  if (
    !hideAvatarMode &&
    avatarWindow &&
    !avatarWindow.isDestroyed() &&
    !avatarWindow.isVisible()
  ) {
    avatarWindow.show();
  }
};

const clearImagePreviewState = (target: BrowserWindow) => {
  if (imagePreviewWindow !== target) return;
  imagePreviewWindow = null;
  imagePreviewDataUrl = null;
  imagePreviewEditable = false;
  imagePreviewSourceWindow = null;
};

const dismissImagePreviewWindow = (target: BrowserWindow) => {
  clearImagePreviewState(target);
  if (!target.isDestroyed()) target.destroy();
};

const openImagePreviewWindow = (
  sourceWindow: BrowserWindow | null,
  imageDataUrl: string,
  editable = false,
) => {
  imagePreviewDataUrl = imageDataUrl;
  imagePreviewEditable = editable;
  imagePreviewSourceWindow = sourceWindow;
  const display = sourceWindow
    ? screen.getDisplayMatching(sourceWindow.getBounds())
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  if (imagePreviewWindow && !imagePreviewWindow.isDestroyed()) {
    if (
      process.platform === 'darwin' &&
      imagePreviewWindow.isSimpleFullScreen()
    ) {
      imagePreviewWindow.setSimpleFullScreen(false);
    }
    imagePreviewWindow.setBounds(display.bounds);
    if (process.platform === 'darwin') {
      imagePreviewWindow.setSimpleFullScreen(true);
    }
    if (!imagePreviewWindow.webContents.isLoadingMainFrame()) {
      imagePreviewWindow.webContents.send('image-preview', {
        imageDataUrl,
        editable,
      });
      imagePreviewWindow.show();
      imagePreviewWindow.focus();
    }
    return;
  }

  const previewWindow = new BrowserWindow({
    show: false,
    ...display.bounds,
    frame: false,
    transparent: false,
    backgroundColor: '#111827',
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: preloadPath() },
  });
  imagePreviewWindow = previewWindow;
  previewWindow.setAlwaysOnTop(
    true,
    process.platform === 'darwin' ? 'screen-saver' : 'floating',
  );
  if (process.platform === 'darwin') {
    // A bounded frameless window is constrained below macOS's live menu bar,
    // which leaves the captured menu bar visible underneath it. Simple
    // fullscreen covers the menu bar and Dock without creating a new Space.
    previewWindow.setSimpleFullScreen(true);
  }
  previewWindow.loadURL(`${resolveHtmlPath('index.html')}?view=image-preview`);
  previewWindow.on('closed', () => {
    // A rapid close → reopen sequence can create the next preview before the
    // old window emits `closed`. Never let the old callback clear the new one.
    clearImagePreviewState(previewWindow);
  });
};

const deliverPendingWakeWordDetection = (): void => {
  const pending = pendingWakeWordDetection;
  if (!pending) return;
  if (pending.attempts >= 30) {
    log.warn(
      `[Wake word] Chat did not acknowledge detection ${pending.id}; resuming listening`,
    );
    pendingWakeWordDetection = null;
    setWakeWordCapturePaused(false);
    return;
  }
  pending.attempts += 1;
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('wake-word-detected', {
      id: pending.id,
      keyword: pending.keyword,
    });
  }
  pending.retryTimer = setTimeout(deliverPendingWakeWordDetection, 500);
};

const queueWakeWordDetection = (keyword: string): void => {
  if (pendingWakeWordDetection?.retryTimer) {
    clearTimeout(pendingWakeWordDetection.retryTimer);
  }
  wakeWordDetectionSequence += 1;
  pendingWakeWordDetection = {
    id: wakeWordDetectionSequence,
    keyword,
    attempts: 0,
    retryTimer: null,
  };
  setWakeWordCapturePaused(true);
  showChatPanel();
  deliverPendingWakeWordDetection();
};

const createWakeWordCaptureWindow = (): void => {
  if (wakeWordCaptureWindow && !wakeWordCaptureWindow.isDestroyed()) return;
  const { x, y } = screen.getPrimaryDisplay().workArea;
  wakeWordCaptureWindow = new BrowserWindow({
    show: false,
    x,
    y,
    width: 1,
    height: 1,
    opacity: 0,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath(),
      backgroundThrottling: false,
    },
  });
  wakeWordCaptureWindow.setIgnoreMouseEvents(true);
  wakeWordCaptureWindow.setAlwaysOnTop(true, 'floating');
  wakeWordCaptureWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  wakeWordCaptureWindow.loadURL(
    `${resolveHtmlPath('index.html')}?view=wake-word-capture`,
  );
  wakeWordCaptureWindow.webContents.on(
    'render-process-gone',
    (_event, details) => {
      log.error(
        `[Wake word] Capture renderer exited: ${details.reason} (${details.exitCode})`,
      );
    },
  );
  wakeWordCaptureWindow.on('closed', () => {
    wakeWordCaptureWindow = null;
  });
};

const syncWakeWordService = (): void => {
  if (!wakeWordService) return;
  if (!wakeWordEnabled) wakeWordService.stop('disabled');
  else if (isCocoSleeping() || systemSuspended) {
    wakeWordService.stop('sleeping');
  } else wakeWordService.start();
};

const initializeWakeWordService = (): void => {
  if (wakeWordService) return;
  wakeWordEnabled = readWakeWordEnabled();
  const modelDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'wake-word', WAKE_WORD_MODEL)
    : path.resolve(process.cwd(), 'assets', 'wake-word', WAKE_WORD_MODEL);
  const executable = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'service-dist',
        'coco-services',
        process.platform === 'win32'
          ? 'wake-word-worker.exe'
          : 'wake-word-worker',
      )
    : undefined;
  wakeWordService = new WakeWordService({
    projectRoot: app.isPackaged
      ? process.resourcesPath
      : path.resolve(process.cwd(), '..'),
    modelDir,
    stateDir: path.join(app.getPath('userData'), 'wake-word'),
    logPath: path.join(app.getPath('userData'), 'logs', 'wake-word.log'),
    packagedExecutable: executable,
    onStatus: publishWakeWordStatus,
    onDetected: (keyword) => {
      if (!wakeWordEnabled || isCocoSleeping() || systemSuspended) return;
      log.info(`[Wake word] Detected ${keyword}`);
      queueWakeWordDetection(keyword);
    },
  });
  syncWakeWordService();
};

const openChatSettings = () => {
  createChatWindow();
  if (!chatWindow || chatWindow.isDestroyed()) return;

  showChatPanel();
  const revealSettings = () => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    chatWindow.webContents.send('open-chat-settings');
  };
  if (chatWindow.webContents.isLoadingMainFrame()) {
    chatWindow.webContents.once('did-finish-load', revealSettings);
  } else {
    revealSettings();
  }
};

ipcMain.removeAllListeners('open-chat-settings');
ipcMain.on('open-chat-settings', openChatSettings);

async function openCoco(): Promise<void> {
  if (isSessionActive && currentSessionId) {
    openChatForSession(currentSessionId, pendingTaskLabel || '');
    return;
  }
  const problemStatement = pendingTaskLabel || 'General help session';
  await createChatSession(problemStatement);
}

function setupPending(): boolean {
  return (
    !isOnboardingComplete() ||
    (!readModelConfiguration() && readPiConnection().mode !== 'native')
  );
}

function openPrimaryTrayAction(): void {
  if (setupPending()) {
    if (!onboardingWindow || onboardingWindow.isDestroyed()) {
      createOnboardingWindow(isOnboardingComplete());
    } else {
      onboardingWindow.show();
      onboardingWindow.focus();
    }
    return;
  }
  openCoco().catch((err) => log.warn(`[Tray] Could not open Coco: ${err}`));
}

function handleTrayClick(): void {
  // Preserve the setup-window recovery path, but once setup is complete let
  // the user choose an explicit action instead of opening chat immediately.
  if (setupPending()) {
    openPrimaryTrayAction();
    return;
  }
  tray?.popUpContextMenu();
}

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icon.png')
    : path.join(__dirname, '../../assets/icon.png');
}

function createTray(): void {
  if (!tray || tray.isDestroyed()) {
    const image = nativeImage.createFromPath(trayIconPath()).resize({
      width: 22,
      height: 22,
    });
    tray = new Tray(image);
    tray.on('click', handleTrayClick);
  }
  const pendingSetup = setupPending();
  const sleeping = isCocoSleeping();
  tray.setToolTip(
    pendingSetup ? 'Coco' : `Coco — ${sleeping ? 'Sleeping' : 'Awake'}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate(
      pendingSetup
        ? [
            {
              label: isOnboardingComplete()
                ? 'Open Model Setup'
                : 'Continue Setup',
              click: openPrimaryTrayAction,
            },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() },
          ]
        : [
            {
              label: sleeping ? 'Status: Sleeping' : 'Status: Awake',
              enabled: false,
            },
            {
              label: sleeping ? 'Wake Coco' : 'Put Coco to Sleep',
              click: () => {
                // Function declaration is intentionally below the tray setup.
                // eslint-disable-next-line no-use-before-define
                setCocoSleepMode(!sleeping).catch((err) =>
                  log.warn(`[Tray] Could not change sleep mode: ${err}`),
                );
              },
            },
            { type: 'separator' },
            {
              label: 'Open Chat',
              click: openPrimaryTrayAction,
            },
            {
              label: 'Settings…',
              click: () => {
                openChatSettings();
              },
            },
            { type: 'separator' },
            ...(desktopAppUpdater.isSupported()
              ? [
                  {
                    label: 'Check for Updates…',
                    click: () => {
                      void desktopAppUpdater.checkForUpdates(true);
                    },
                  },
                ]
              : []),
            { label: 'Quit', click: () => app.quit() },
          ],
    ),
  );
}

function applyAvatarVisibility(hidden: boolean): void {
  hideAvatarMode = hidden;
  if (hidden) {
    closeAvatarMenu();
    avatarWindow?.hide();
    createTray();
    return;
  }
  tray?.destroy();
  tray = null;
  createAvatarWindow();
  avatarWindow?.show();
}

// Open the chat panel for a session and push the session context to it.
const openChatForSession = (sessionId: string, problemStatement: string) => {
  const alreadyLoaded = chatWindow && !chatWindow.isDestroyed();
  showChatPanel();
  if (!chatWindow) return;

  const send = () => {
    chatWindow?.webContents.send('session-init', {
      sessionId,
      problemStatement,
      tutorModelId: currentTutorModelId,
    });
  };
  if (alreadyLoaded) {
    send();
  } else {
    chatWindow.webContents.once('did-finish-load', () => setTimeout(send, 300));
  }
};

// ── IPC handlers ──────────────────────────────────────────────────────────────
// Use removeAllListeners before each .on() so hot-reloads in development never
// accumulate duplicate handlers (which would fire multiple notifications).

// ── Onboarding ────────────────────────────────────────────────────────────────

// Returns the saved onboarding profile so renderer/webapp code can read it
// without needing filesystem access. Returns null if the profile doesn't exist.
ipcMain.handle('get-profile', () => {
  try {
    const raw = fs.readFileSync(profilePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle('get-chat-content-zoom-factor', () => chatContentZoomFactor);

// Model/provider configuration is owned by the main process. The renderer sees
// only masked credential status; plaintext keys are accepted on save and never
// returned over IPC.
ipcMain.handle('get-model-configuration', () => getModelConfigurationView());

type ModelHealthAssessment = {
  status: 'verified' | 'failed' | 'legacy_unassessed' | 'not_configured';
  detail: string;
};
const modelHealthCache = new Map<
  string,
  { checkedAt: number; assessment: ModelHealthAssessment }
>();
const modelHealthInFlight = new Map<string, Promise<ModelHealthAssessment>>();
const MODEL_HEALTH_CACHE_MS = 30 * 60 * 1000;

ipcMain.handle(
  'get-service-health',
  async (
    _event,
    { forceModelTest = false }: { forceModelTest?: boolean } = {},
  ) => {
    // Sleep pauses voice activation; the health view reports that instead.
    if (isCocoSleeping()) {
      return { checkedAt: Date.now(), sleeping: true };
    }
    type ModelAssessment = {
      status: ModelHealthAssessment['status'];
      detail: string;
    };
    const savedConfig = readModelConfiguration();
    const assessModelConfiguration = async (): Promise<ModelAssessment> => {
      const connection =
        savedConfig?.tutors.find((item) => item.id === currentTutorModelId) ??
        savedConfig?.tutors.find(
          (item) => item.id === savedConfig.defaultTutorId,
        );
      if (connection) {
        const cacheKey = JSON.stringify(connection);
        const cached = modelHealthCache.get(cacheKey);
        if (
          !forceModelTest &&
          cached &&
          Date.now() - cached.checkedAt < MODEL_HEALTH_CACHE_MS
        ) {
          return cached.assessment;
        }
        const existingTest = modelHealthInFlight.get(cacheKey);
        if (existingTest) return existingTest;
        const test = (async (): Promise<ModelHealthAssessment> => {
          const result = await testModelConnection(null, { connection });
          const assessment: ModelHealthAssessment = result.success
            ? {
                status: 'verified',
                detail: result.message || 'Model connection verified.',
              }
            : {
                status: 'failed',
                detail: result.error || 'The model connection test failed.',
              };
          modelHealthCache.set(cacheKey, { checkedAt: Date.now(), assessment });
          return assessment;
        })();
        modelHealthInFlight.set(cacheKey, test);
        try {
          return await test;
        } finally {
          modelHealthInFlight.delete(cacheKey);
        }
      }
      if (process.env.TUTOR_MODEL?.trim()) {
        return {
          status: 'legacy_unassessed',
          detail:
            'Model uses environment settings and cannot be assessed here.',
        };
      }
      return {
        status: 'not_configured',
        detail: 'No model configuration was found.',
      };
    };

    const checkService = async (
      url: string,
      expectedService: 'coco-tutor',
      modelAssessment: ModelAssessment,
    ) => {
      try {
        const response = await axios.get(url, { timeout: 2500 });
        const data = response.data as {
          status?: unknown;
          service?: unknown;
        };
        if (data?.service !== expectedService) {
          return {
            connected: false,
            status: 'wrong-service',
            detail: 'This port is occupied by another process.',
            modelAssessment,
          };
        }
        return {
          connected: true,
          status: typeof data?.status === 'string' ? data.status : 'healthy',
          modelAssessment,
        };
      } catch (error) {
        let detail = 'Service is not reachable.';
        if (axios.isAxiosError(error)) {
          const responseData = error.response?.data as
            | { detail?: unknown }
            | undefined;
          if (
            typeof responseData?.detail === 'string' &&
            responseData.detail.trim()
          ) {
            detail = responseData.detail;
          } else if (error.code === 'ECONNREFUSED') {
            detail = 'Service is not running.';
          } else if (error.code === 'ECONNABORTED') {
            detail = 'Health check timed out.';
          } else if (error.message) {
            detail = error.message;
          }
        } else if (error instanceof Error) {
          detail = error.message;
        }
        return {
          connected: false,
          status: 'unavailable',
          detail,
          modelAssessment,
        };
      }
    };

    const tutorPort = process.env.TUTOR_PORT || '8081';
    const tutor = await checkService(
      `http://127.0.0.1:${tutorPort}/health`,
      'coco-tutor',
      await assessModelConfiguration(),
    );
    return { checkedAt: Date.now(), tutor };
  },
);

async function testModelConnection(
  _event: unknown,
  {
    connection,
    apiKey,
  }: {
    connection?: ModelConnection;
    apiKey?: string;
  } = {},
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!connection) {
    return { success: false, error: 'Invalid model test request.' };
  }
  try {
    if (connection.provider === 'pi') await validatePiModel(connection.model);
    const prepared = prepareModelConnectionTest(connection, apiKey ?? '');
    const providerEnvNames = new Set([
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'OPENAI_API_KEY',
      'TINFOIL_API_KEY',
      'HOSTED_VLLM_API_KEY',
      'HOSTED_VLLM_API_BASE',
      'LM_STUDIO_HOST',
      'OA_TICKET_FILE',
      'OA_DESTINATION',
      'OA_BASE_URL',
    ]);
    const childEnv = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !providerEnvNames.has(name),
        ),
      ),
      ...prepared.env,
      PYTHONIOENCODING: 'utf-8',
    };
    const executable = app.isPackaged
      ? path.join(
          process.resourcesPath,
          'service-dist',
          'coco-services',
          `tutor-server${process.platform === 'win32' ? '.exe' : ''}`,
        )
      : 'uv';
    const args = app.isPackaged
      ? ['--test-model-connection', '--model', prepared.connection.model]
      : [
          'run',
          'python',
          '-m',
          'proactive_tutor.model_connection_test',
          '--model',
          prepared.connection.model,
        ];
    const cwd = app.isPackaged
      ? path.dirname(executable)
      : path.resolve(process.cwd(), '..');
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd,
        env: childEnv,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Connection test timed out after 60 seconds.'));
      }, 60_000);
      child.stdout?.on('data', (chunk) => {
        stdout = `${stdout}${String(chunk)}`.slice(-32_000);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-32_000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    const parsed = result.stdout
      .trim()
      .split('\n')
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line) as { success?: boolean; error?: string };
        } catch {
          return null;
        }
      })
      .find((item) => item !== null);
    if (result.code === 0 && parsed?.success) {
      return { success: true, message: 'Connected — text input accepted.' };
    }
    const rawError =
      parsed?.error || result.stderr.trim() || 'Connection failed.';
    const redactedError = apiKey
      ? rawError.split(apiKey).join('[redacted]')
      : rawError;
    return { success: false, error: redactedError };
  } catch (err) {
    const rawError = (err as Error).message;
    return {
      success: false,
      error: apiKey ? rawError.split(apiKey).join('[redacted]') : rawError,
    };
  }
}

ipcMain.handle('test-model-connection', testModelConnection);

async function restoreSessionAfterModelRestart(): Promise<void> {
  if (!currentSessionId) return;
  const conversation = readConversations().find(
    (item) => item.sessionId === currentSessionId,
  );
  const tutorPort = process.env.TUTOR_PORT || '8081';
  const tutor = `http://127.0.0.1:${tutorPort}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await axios.get(`${tutor}/health`, { timeout: 1000 });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const { aiTools, scenario, userName } = readProfile();
  await axios.post(`${tutor}/config/scenario`, { scenario }, { timeout: 8000 });
  await axios.post(
    `${tutor}/context/problem_statement`,
    { problem_statement: conversation?.problem || pendingTaskLabel || '' },
    { timeout: 8000 },
  );
  await axios.post(
    `${tutor}/context/ai_tools`,
    { ai_tools: aiTools },
    { timeout: 8000 },
  );
  await axios.post(
    `${tutor}/context/user_name`,
    { user_name: userName },
    { timeout: 8000 },
  );
  if (conversation) {
    await axios.post(
      `${tutor}/context/conversation`,
      {
        messages: conversation.messages
          .filter((message) => !message.isError)
          .map(({ role, text }) => ({ role, text })),
      },
      { timeout: 8000 },
    );
  }
}

ipcMain.handle(
  'save-model-configuration',
  async (_event, input: ModelConfigurationInput) => {
    try {
      if (agentRuns.busy)
        throw new Error('Stop the current run before changing models.');
      await agentRuns.dispose();
      for (const connection of input.tutors) {
        if (connection?.provider === 'pi')
          await validatePiModel(connection.model);
      }
      const config = saveModelConfiguration(input);
      modelHealthCache.clear();
      const runtime = resolveModelRuntime();
      if (servicesStarted && runtime) {
        const defaultTutorModel = defaultTutor(runtime.config);
        const activeTutorModel =
          runtime.config.tutors.find(
            (item) => item.id === currentTutorModelId,
          ) ?? defaultTutorModel;
        currentTutorModelId = activeTutorModel.id;
        process.env.TUTOR_MODEL = defaultTutorModel.model;
        await serviceManager.stopService('tutor-server');
        serviceManager.configureServiceEnv(
          'tutor-server',
          runtime.tutorEnv,
          true,
        );
        serviceManager.configureServiceArg(
          'tutor-server',
          'model_name',
          activeTutorModel.model,
        );
        startModelServices(serviceManager);
        try {
          await restoreSessionAfterModelRestart();
        } catch (err) {
          log.warn(
            `[Models] Services restarted but active session restoration failed: ${(err as Error).message}`,
          );
        }
      } else if (isOnboardingComplete()) {
        startServices();
      }
      return { success: true, config };
    } catch (err) {
      log.warn(
        `[Models] Could not save configuration: ${(err as Error).message}`,
      );
      return { success: false, error: (err as Error).message };
    }
  },
);

ipcMain.handle(
  'set-chat-model',
  async (_event, { modelId }: { modelId?: string } = {}) => {
    if (agentRuns.has(currentSessionId))
      return {
        success: false,
        error: 'Stop this conversation before changing its model.',
      };
    const config = readModelConfiguration();
    const selected = config?.tutors.find((item) => item.id === modelId);
    if (!selected) return { success: false, error: 'Tutor model not found.' };
    currentTutorModelId = selected.id;
    const conversation = readConversations().find(
      (c) => c.sessionId === currentSessionId,
    );
    if (conversation)
      saveConversation({ ...conversation, tutorModelId: selected.id });
    void axios
      .post(
        `http://127.0.0.1:${process.env.TUTOR_PORT || '8081'}/config/model`,
        { model: selected.model },
        { timeout: 1500 },
      )
      .catch(() => {});
    return { success: true, modelId: selected.id };
  },
);

// Persist profile edits made post-onboarding (the Settings surface in the
// webapp).
ipcMain.handle('save-profile', (_event, profile: object) => {
  try {
    fs.writeFileSync(profilePath(), JSON.stringify(profile, null, 2), 'utf-8');
    log.info('[Settings] Profile saved:', profilePath());
    return { success: true };
  } catch (err) {
    log.error('[Settings] Failed to save profile:', err);
    return { success: false, error: String(err) };
  }
});

ipcMain.on('onboarding-complete', (_event, profile: object) => {
  // Write the profile so isOnboardingComplete() returns true on next launch.
  try {
    fs.writeFileSync(profilePath(), JSON.stringify(profile, null, 2), 'utf-8');
    log.info('[Onboarding] Profile saved:', profilePath());
  } catch (err) {
    log.error('[Onboarding] Failed to save profile:', err);
  }

  // Start the tutor service now that the user has completed onboarding.
  startServices();

  // Onboarding window closes itself (window.close() in renderer). Start the
  // avatar now that setup is complete; the chat panel is created on demand.
  applyAvatarVisibility(readHideAvatarSetting());
});

ipcMain.removeAllListeners('hide-onboarding');
ipcMain.on('hide-onboarding', () => {
  onboardingWindow?.hide();
  createTray();
});

ipcMain.removeAllListeners('model-configuration-complete');
ipcMain.on('model-configuration-complete', () => {
  // Existing users sent directly to model setup already have a profile. Once
  // models are saved, start (or restart) the services and reveal the app
  // without making them repeat the rest of onboarding.
  startServices();
  applyAvatarVisibility(readHideAvatarSetting());
});

// Pet click / "open chat". If a session is already active, reopen its chat
// panel; otherwise start a fresh local session so there is a conversation to
// show.
ipcMain.removeAllListeners('open-main-window');
ipcMain.on('open-main-window', () => {
  openCoco().catch((err) => log.warn(`[Chat] Could not open Coco: ${err}`));
});

ipcMain.removeHandler('get-coco-sleep-mode');
ipcMain.handle('get-coco-sleep-mode', () => ({
  sleeping: isCocoSleeping(),
}));

async function setCocoSleepMode(sleeping: boolean) {
  if (cocoSleeping === sleeping) {
    return { success: true, sleeping };
  }

  // Sleep pauses voice activation. Chats and agent runs stay available, and
  // there is no sensing to pause: this Coco never watches the screen.
  cocoSleeping = sleeping;
  syncWakeWordService();
  if (!sleeping && !servicesStarted && isOnboardingComplete()) startServices();

  const state = { sleeping };
  avatarMenuWindow?.webContents.send('coco-sleep-mode-changed', state);
  avatarWindow?.webContents.send('coco-sleep-mode-changed', state);
  chatWindow?.webContents.send('coco-sleep-mode-changed', state);
  wakeWordCaptureWindow?.webContents.send('coco-sleep-mode-changed', state);
  if (tray && !tray.isDestroyed()) createTray();
  return { success: true, sleeping };
}

ipcMain.removeHandler('set-coco-sleep-mode');
ipcMain.handle(
  'set-coco-sleep-mode',
  async (_event, { sleeping }: { sleeping?: boolean } = {}) => {
    if (typeof sleeping !== 'boolean') {
      return { success: false, error: 'Invalid sleep mode.' };
    }
    try {
      return await setCocoSleepMode(sleeping);
    } catch (error) {
      log.error('[Sleep] Could not change Coco sleep mode:', error);
      return {
        success: false,
        sleeping: isCocoSleeping(),
        error: (error as Error).message,
      };
    }
  },
);

ipcMain.removeHandler('get-wake-word-settings');
ipcMain.handle('get-wake-word-settings', () => ({
  enabled: wakeWordEnabled,
  keywords: [...WAKE_WORDS],
  capturePaused: wakeWordCapturePaused,
  ...wakeWordStatus,
  logPath: path.join(app.getPath('userData'), 'logs', 'wake-word.log'),
}));

ipcMain.removeHandler('set-wake-word-settings');
ipcMain.handle(
  'set-wake-word-settings',
  async (_event, { enabled }: { enabled?: boolean } = {}) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid voice activation setting.' };
    }
    if (
      enabled &&
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('microphone') !== 'granted'
    ) {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      if (!granted) {
        return {
          success: false,
          error:
            'Microphone access is required. Enable Coco under Privacy & Security → Microphone.',
        };
      }
    }
    wakeWordEnabled = enabled;
    if (!enabled) setWakeWordCapturePaused(false);
    saveWakeWordEnabled(enabled);
    syncWakeWordService();
    const settings = {
      enabled,
      keywords: [...WAKE_WORDS],
      capturePaused: wakeWordCapturePaused,
      ...wakeWordStatus,
    };
    chatWindow?.webContents.send('wake-word-settings-changed', settings);
    wakeWordCaptureWindow?.webContents.send(
      'wake-word-settings-changed',
      settings,
    );
    return { success: true, ...settings };
  },
);

ipcMain.removeHandler('set-wake-word-capture-paused');
ipcMain.handle(
  'set-wake-word-capture-paused',
  (_event, { paused }: { paused?: boolean } = {}) => {
    if (typeof paused !== 'boolean') return { success: false };
    setWakeWordCapturePaused(paused);
    return { success: true, paused };
  },
);

ipcMain.removeAllListeners('wake-word-capture-renderer-ready');
ipcMain.on('wake-word-capture-renderer-ready', (event) => {
  if (
    !wakeWordCaptureWindow ||
    event.sender !== wakeWordCaptureWindow.webContents
  ) {
    return;
  }
  // getUserMedia can remain pending forever in a genuinely hidden renderer on
  // macOS. Keep this 1 px, fully transparent window technically visible.
  wakeWordCaptureWindow.showInactive();
  wakeWordCaptureWindow.webContents.send('wake-word-settings-changed', {
    enabled: wakeWordEnabled,
    keywords: [...WAKE_WORDS],
    capturePaused: wakeWordCapturePaused,
    ...wakeWordStatus,
  });
  setImmediate(() => {
    wakeWordCaptureWindow?.webContents.send('wake-word-capture-window-ready');
  });
  log.info('[Wake word] Microphone capture renderer ready');
});

ipcMain.removeAllListeners('wake-word-detection-ack');
ipcMain.on(
  'wake-word-detection-ack',
  (event, value: { id?: unknown } | undefined) => {
    if (!chatWindow || event.sender !== chatWindow.webContents) return;
    const id = typeof value?.id === 'number' ? value.id : null;
    if (!pendingWakeWordDetection || pendingWakeWordDetection.id !== id) return;
    if (pendingWakeWordDetection.retryTimer) {
      clearTimeout(pendingWakeWordDetection.retryTimer);
    }
    log.info(
      `[Wake word] Chat acknowledged detection ${id} after ${pendingWakeWordDetection.attempts} attempt(s)`,
    );
    pendingWakeWordDetection = null;
  },
);

ipcMain.removeAllListeners('wake-word-capture-status');
ipcMain.on('wake-word-capture-status', (event, value: unknown) => {
  if (
    !wakeWordCaptureWindow ||
    event.sender !== wakeWordCaptureWindow.webContents
  ) {
    return;
  }
  const status = value as { state?: unknown; detail?: unknown } | undefined;
  const state = typeof status?.state === 'string' ? status.state : 'unknown';
  if (state === wakeWordCaptureState && !status?.detail) return;
  wakeWordCaptureState = state;
  const detail = typeof status?.detail === 'string' ? `: ${status.detail}` : '';
  log.info(`[Wake word] Microphone capture ${state}${detail}`);
  chatWindow?.webContents.send('wake-word-capture-status', {
    state,
    detail: typeof status?.detail === 'string' ? status.detail : undefined,
  });
});

ipcMain.removeAllListeners('wake-word-audio-frame');
ipcMain.on('wake-word-audio-frame', (event, frame: unknown) => {
  if (
    !wakeWordEnabled ||
    isCocoSleeping() ||
    systemSuspended ||
    wakeWordCapturePaused ||
    !wakeWordCaptureWindow ||
    event.sender !== wakeWordCaptureWindow.webContents
  ) {
    return;
  }
  if (frame instanceof Uint8Array) {
    wakeWordService?.writeAudio(Buffer.from(frame));
  } else if (frame instanceof ArrayBuffer) {
    wakeWordService?.writeAudio(Buffer.from(new Uint8Array(frame)));
  }
});

// ── Chat-panel width toggle ────────────────────────────────────────────────────
// The renderer sends this when the user clicks the expand / collapse button to
// switch the chat between the narrow side panel and a wider reading width.
// The renderer requests the current mode after installing its listener, so
// a newly mounted or reloaded view cannot miss the initial window state.
ipcMain.removeAllListeners('get-float-window-state');
ipcMain.on('get-float-window-state', (event) => {
  if (event.sender !== chatWindow?.webContents) return;
  event.sender.send('float-window-state', { isFloat: isFloatMode });
});

ipcMain.removeAllListeners('toggle-float-window');
ipcMain.on(
  'toggle-float-window',
  (_event, options?: { expanded?: boolean }) => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    isFloatMode =
      typeof options?.expanded === 'boolean' ? !options.expanded : !isFloatMode;
    showChatPanel();
  },
);

ipcMain.on('shell-show-item-in-finder', (event, fullPath) => {
  shell.showItemInFolder(fullPath);
});

// ── Chat session IPC handlers ─────────────────────────────────────────────────

// Webapp signals that a tutor session is now active (or has ended).
// Payload: { active: boolean; sessionId?: string }
ipcMain.removeAllListeners('session-active');
ipcMain.on(
  'session-active',
  (_event, payload: { active: boolean; sessionId?: string }) => {
    isSessionActive = payload.active;
    if (payload.active && payload.sessionId) {
      currentSessionId = payload.sessionId;
      // Dismiss the onboarding overlay if still open — a live session takes over.
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.destroy();
        onboardingWindow = null;
      }
    }
    if (!payload.active) currentSessionId = null;
    log.info(
      `[ChatSession] isSessionActive=${payload.active}, sessionId=${payload.sessionId}`,
    );
  },
);

// Read the local profile. Execution capabilities come from the Pi harness.
// Returns sensible defaults when the file is missing or malformed.
function readProfile(): {
  aiTools: string[];
  scenario: string;
  userName: string;
} {
  const aiTools: string[] = [];
  // Everyday support is the only agent mode in this build.
  const scenario = 'everyday_support';
  let userName = '';
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath(), 'utf-8'));
    if (typeof profile.userName === 'string' && profile.userName.trim()) {
      userName = profile.userName.trim();
    }
  } catch (err) {
    log.warn(`[Profile] Could not read profile at ${profilePath()}: ${err}.`);
  }
  return { aiTools, scenario, userName };
}

// Create a chat session entirely against the LOCAL tutor server (no backend).
// A "session" here is just a fresh conversation on the tutor server. Returns
// the new (locally generated) session id.
async function createChatSession(problemStatement: string): Promise<string> {
  const { aiTools, scenario, userName } = readProfile();

  const tutorPort = process.env.TUTOR_PORT || '8081';
  const tutor = `http://127.0.0.1:${tutorPort}`;
  const sessionId = randomUUID();
  const modelConfig = readModelConfiguration();
  const selectedTutor = modelConfig ? defaultTutor(modelConfig) : null;
  currentTutorModelId = selectedTutor?.id ?? null;

  // Open the chat panel immediately so the user always gets a UI, even if the
  // server is still starting up. Configuration below is best-effort.
  currentSessionId = sessionId;
  pendingTaskLabel = problemStatement;
  activateAgentSession(sessionId);
  isSessionActive = true;
  openChatForSession(sessionId, problemStatement);
  log.info(`[ChatSession] Local tutor session started: ${sessionId}`);

  try {
    await axios.post(`${tutor}/context/reset`, {}, { timeout: 8000 });
    if (currentSessionId !== sessionId) return sessionId;
    if (selectedTutor) {
      await axios.post(
        `${tutor}/config/model`,
        { model: selectedTutor.model },
        { timeout: 8000 },
      );
    }
    await axios.post(
      `${tutor}/config/scenario`,
      { scenario },
      { timeout: 8000 },
    );
    await axios.post(
      `${tutor}/context/problem_statement`,
      { problem_statement: problemStatement },
      { timeout: 8000 },
    );
    await axios.post(
      `${tutor}/context/ai_tools`,
      { ai_tools: aiTools },
      { timeout: 8000 },
    );
    await axios.post(
      `${tutor}/context/user_name`,
      { user_name: userName },
      { timeout: 8000 },
    );
  } catch (err) {
    log.warn(
      `[ChatSession] Tutor context setup failed: ${(err as Error).message}`,
    );
  }

  return sessionId;
}

// Start a fresh conversation directly from the chat header. Reuse the regular
// session setup path so tutor context and profile settings move to the same new
// session boundary.
ipcMain.removeHandler('start-new-chat-session');
ipcMain.handle(
  'start-new-chat-session',
  async (_event, { problemStatement }: { problemStatement?: string } = {}) => {
    const task =
      problemStatement?.trim() || pendingTaskLabel || 'General help session';
    try {
      const sessionId = await createChatSession(task);
      return { success: true, sessionId };
    } catch (err) {
      log.warn(
        `[ChatSession] Could not start a new chat session: ${(err as Error).message}`,
      );
      return { success: false, error: (err as Error).message };
    }
  },
);

// Chat history is local-only: the renderer persists completed turns here and
// asks main to rebuild tutor context before continuing an older conversation.
ipcMain.removeHandler('get-chat-conversations');
ipcMain.handle('get-chat-conversations', () =>
  readConversations().map((conversation) =>
    interruptStaleReplies(
      {
        ...conversation,
        messages: chatStreams.overlay(
          conversation.sessionId,
          conversation.messages,
        ),
      },
      (id) => agentRuns.requests.has(id),
    ),
  ),
);

ipcMain.removeHandler('save-chat-conversation');
ipcMain.handle('save-chat-conversation', (_event, payload) => {
  saveConversation({
    ...(payload ?? {}),
    messages: chatStreams.overlay(payload?.sessionId, payload?.messages ?? []),
    tutorModelId:
      payload?.sessionId === currentSessionId ? currentTutorModelId : undefined,
  });
  return { success: true };
});

ipcMain.removeHandler('resume-chat-conversation');
ipcMain.handle(
  'resume-chat-conversation',
  async (_event, { sessionId }: { sessionId?: string } = {}) => {
    const conversation = readConversations().find(
      (saved) => saved.sessionId === sessionId,
    );
    if (!conversation) {
      return { success: false, error: 'Conversation not found.' };
    }

    const config = readModelConfiguration();
    currentTutorModelId =
      config?.tutors.find((item) => item.id === conversation.tutorModelId)
        ?.id ?? (config ? defaultTutor(config).id : null);
    currentSessionId = conversation.sessionId;
    isSessionActive = true;
    pendingTaskLabel = conversation.problem;
    activateAgentSession(conversation.sessionId);
    return {
      success: true,
      tutorModelId: currentTutorModelId,
      conversation: interruptStaleReplies(
        {
          ...conversation,
          messages: chatStreams.overlay(
            conversation.sessionId,
            conversation.messages,
          ),
        },
        (id) => agentRuns.requests.has(id),
      ),
    };
  },
);

// ── Local chat turn ────────────────────────────────────────────────────────────
// The renderer (SessionChatView) sends the user's message — typed or spoken —
// here, and the Pi agent harness runs one turn against the local tutor server.
// Coco only knows what the user sends: there is no screen observation. The
// turn ends when the agent replies, so the conversation then waits for the
// user to continue. Pasted images arrive as data URLs.
interface AgentTurnInput {
  requestId: string;
  userText?: string;
  displayText?: string;
  images?: string[];
  audioData?: string;
  sessionId?: string;
  isRetry?: boolean;
}
function activateAgentSession(sessionId: string) {
  void axios
    .post(
      `http://127.0.0.1:${process.env.TUTOR_PORT || '8081'}/agent/active/${encodeURIComponent(sessionId)}`,
      {},
      { headers: { Authorization: `Bearer ${piBridgeToken}` }, timeout: 1500 },
    )
    .catch(() => {});
}
async function runAgentTurn(
  event: Electron.IpcMainInvokeEvent,
  input: AgentTurnInput,
) {
  const sessionId = input.sessionId || currentSessionId;
  if (!sessionId)
    return { error: 'Open a conversation before sending a message.' };
  if (typeof input.requestId !== 'string' || !input.requestId)
    return { error: 'A request ID is required.' };
  if (
    input.audioData !== undefined &&
    (!input.audioData || input.audioData.length > 16_000_000)
  )
    return { error: 'The voice recording is empty or too large.' };
  try {
    agentRuns.begin(sessionId, input.requestId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  const conversation = readConversations().find(
    (item) => item.sessionId === sessionId,
  );
  const config = readModelConfiguration();
  const modelId =
    sessionId === currentSessionId
      ? currentTutorModelId
      : conversation?.tutorModelId;
  const selected =
    config?.tutors.find((item) => item.id === modelId) ??
    (config ? defaultTutor(config) : null);
  const profile = readProfile();
  const legacyPi = !config ? readPiConnection() : null;
  const selectedModel =
    selected?.model ||
    (legacyPi?.mode === 'native'
      ? `pi/${legacyPi.provider}/${legacyPi.model}`
      : process.env.TUTOR_MODEL || '');
  const context = {
    model: selectedModel,
    scenario: profile.scenario,
    problem:
      conversation?.problem ||
      (sessionId === currentSessionId ? pendingTaskLabel : '') ||
      '',
    user_name: profile.userName,
    ai_tools: profile.aiTools,
    messages: restorableMessages(
      conversation?.messages ?? [],
      input.displayText ?? input.userText,
    ),
  };
  const progressReminder = new AgentProgressReminder((text) => {
    void isChatOutOfView(chatWindow).then((hidden) => {
      if (
        hidden &&
        agentRuns.requests.has(input.requestId) &&
        !agentRuns.requests.get(input.requestId)?.stopped &&
        !hideAvatarMode
      )
        avatarWindow?.webContents.send('agent-working', {
          sessionId,
          requestId: input.requestId,
          text,
        });
    });
  });
  const emit = (streamEvent: TutorStreamEvent) => {
    progressReminder.update(streamEvent);
    if (streamEvent.type === 'done' && !streamEvent.stopped)
      void isChatOutOfView(chatWindow).then((hidden) => {
        if (hidden && !hideAvatarMode)
          avatarWindow?.webContents.send('agent-reply-ready', {
            sessionId,
            requestId: input.requestId,
          });
      });
    chatStreams.accept(input.requestId, streamEvent);
    if (streamEvent.type === 'done' || streamEvent.type === 'error')
      chatStreams.flush(input.requestId);
    if (chatWindow && !chatWindow.isDestroyed())
      chatWindow.webContents.send('chat-stream-event', {
        requestId: input.requestId,
        sessionId,
        ...streamEvent,
      });
  };
  try {
    chatStreams.begin(
      sessionId,
      input.requestId,
      input.displayText ?? input.userText ?? 'Voice message',
      input.images ?? [],
      input.isRetry,
      modelId,
    );
    if (sessionId === currentSessionId) activateAgentSession(sessionId);
    const images = input.images ?? [];
    const text = input.userText ?? '';
    await agentRuns.get(sessionId).run({
      requestId: input.requestId,
      sessionId,
      directory: agentDirectory(sessionId),
      tutorUrl: `http://127.0.0.1:${process.env.TUTOR_PORT || '8081'}`,
      token: piBridgeToken,
      text,
      images,
      audioData: input.audioData,
      context,
      emit,
    });
    return { streamed: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The agent could not complete this request.';
    log.error('[Agent]', message);
    emit({ type: 'error', error: message });
    return { error: message };
  } finally {
    progressReminder.dispose();
    avatarWindow?.webContents.send('agent-work-ended', {
      requestId: input.requestId,
    });
    chatStreams.finish(input.requestId);
    agentRuns.finish(input.requestId);
  }
}
ipcMain.handle('send-chat-message', runAgentTurn);
ipcMain.on(
  'view-agent-reply',
  (_event, target: { sessionId?: string; requestId?: string } = {}) => {
    const conversation = readConversations().find(
      (c) => c.sessionId === target.sessionId,
    );
    if (!conversation) return;
    currentSessionId = conversation.sessionId;
    currentTutorModelId = conversation.tutorModelId ?? null;
    isSessionActive = true;
    activateAgentSession(conversation.sessionId);
    openChatForSession(conversation.sessionId, conversation.problem);
    const reveal = () =>
      chatWindow?.webContents.send('reveal-agent-reply', {
        sessionId: conversation.sessionId,
        requestId: target.requestId,
      });
    if (chatWindow?.webContents.isLoading())
      chatWindow.webContents.once('did-finish-load', () =>
        setTimeout(reveal, 300),
      );
    else reveal();
  },
);

ipcMain.removeAllListeners('open-image-preview');
ipcMain.on('open-image-preview', (event, payload: unknown) => {
  const preview = (payload ?? {}) as {
    imageDataUrl?: unknown;
    editable?: unknown;
  };
  const { imageDataUrl } = preview;
  if (
    typeof imageDataUrl !== 'string' ||
    !imageDataUrl.startsWith('data:image/')
  ) {
    log.warn('[ImagePreview] Ignored an invalid image preview request.');
    return;
  }
  openImagePreviewWindow(
    BrowserWindow.fromWebContents(event.sender),
    imageDataUrl,
    preview.editable === true,
  );
});

ipcMain.removeAllListeners('image-preview-ready');
ipcMain.on('image-preview-ready', (event) => {
  if (
    !imagePreviewWindow ||
    imagePreviewWindow.isDestroyed() ||
    imagePreviewWindow.webContents.id !== event.sender.id ||
    !imagePreviewDataUrl
  ) {
    return;
  }
  imagePreviewWindow.webContents.send('image-preview', {
    imageDataUrl: imagePreviewDataUrl,
    editable: imagePreviewEditable,
  });
  if (
    process.platform === 'darwin' &&
    !imagePreviewWindow.isSimpleFullScreen()
  ) {
    imagePreviewWindow.setSimpleFullScreen(true);
  }
  imagePreviewWindow.show();
  imagePreviewWindow.focus();
});

ipcMain.removeAllListeners('close-image-preview');
ipcMain.on('close-image-preview', (event) => {
  if (
    imagePreviewWindow &&
    !imagePreviewWindow.isDestroyed() &&
    imagePreviewWindow.webContents.id === event.sender.id
  ) {
    dismissImagePreviewWindow(imagePreviewWindow);
  }
});

ipcMain.removeAllListeners('save-image-annotation');
ipcMain.on('save-image-annotation', (event, payload: unknown) => {
  const annotatedImageDataUrl = (payload as { imageDataUrl?: unknown } | null)
    ?.imageDataUrl;
  if (
    !imagePreviewEditable ||
    !imagePreviewDataUrl ||
    !imagePreviewWindow ||
    imagePreviewWindow.isDestroyed() ||
    imagePreviewWindow.webContents.id !== event.sender.id ||
    typeof annotatedImageDataUrl !== 'string' ||
    !annotatedImageDataUrl.startsWith('data:image/png;base64,') ||
    annotatedImageDataUrl.length > 50_000_000
  ) {
    log.warn('[ImagePreview] Ignored an invalid annotation result.');
    return;
  }

  if (imagePreviewSourceWindow && !imagePreviewSourceWindow.isDestroyed()) {
    imagePreviewSourceWindow.webContents.send('image-annotation-saved', {
      originalImageDataUrl: imagePreviewDataUrl,
      imageDataUrl: annotatedImageDataUrl,
    });
  }
  dismissImagePreviewWindow(imagePreviewWindow);
});

ipcMain.handle('send-audio-message', runAgentTurn);

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

// Note: electron-debug auto-opens DevTools, so we don't use it here
// Instead, we'll register a global shortcut to toggle DevTools manually

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

// IPC Handler for directory selection
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return result;
});

// IPC Handler for file/directory selection (for context)
ipcMain.handle('select-file-or-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'openDirectory', 'multiSelections'],
  });
  return result;
});

// IPC Handlers for benchmark file downloads
ipcMain.handle(
  'download-benchmark-file',
  async (event, { apiUrl, taskId, filename, workspaceDir }) => {
    try {
      // Ensure workspace directory exists
      if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
      }

      // Download file from server
      const response = await axios.get(
        `${apiUrl}/benchmark_files/download/${taskId}/${encodeURIComponent(filename)}`,
        { responseType: 'arraybuffer' },
      );

      // Save to workspace directory
      const filePath = path.join(workspaceDir, filename);
      fs.writeFileSync(filePath, Buffer.from(response.data));

      log.info(`Downloaded benchmark file: ${filename} to ${filePath}`);
      return { success: true, filePath };
    } catch (error) {
      log.error(`Error downloading benchmark file ${filename}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
);

ipcMain.handle('get-benchmark-files', async (event, { apiUrl, taskId }) => {
  try {
    const response = await axios.get(
      `${apiUrl}/benchmark_files/list/${taskId}`,
    );
    return { success: true, data: response.data };
  } catch (error) {
    log.error(`Error fetching benchmark file list:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// The desktop-avatar toggle is independent from the other editable settings,
// so persist and apply it as soon as the checkbox changes.
ipcMain.removeHandler('update-avatar-visibility');
ipcMain.handle(
  'update-avatar-visibility',
  (_event, { hideAvatar }: { hideAvatar?: boolean } = {}) => {
    if (typeof hideAvatar !== 'boolean') {
      return { success: false, error: 'Invalid avatar visibility setting.' };
    }
    try {
      let profile: Record<string, unknown> = {};
      try {
        profile = JSON.parse(fs.readFileSync(profilePath(), 'utf-8'));
      } catch {
        /* no existing profile — start fresh */
      }
      profile.hideAvatar = hideAvatar;
      fs.writeFileSync(
        profilePath(),
        JSON.stringify(profile, null, 2),
        'utf-8',
      );
      applyAvatarVisibility(hideAvatar);
      chatWindow?.webContents.send('avatar-visibility-changed', { hideAvatar });
      return { success: true };
    } catch (err) {
      log.error('[Settings] Failed to update avatar visibility:', err);
      return { success: false, error: String(err) };
    }
  },
);

// IPC Handler for setting the local user id (used only to key training data).
// There is no auth backend in the local build; the id is a stable local uuid.
ipcMain.handle('set-user-id', async (event, userId) => {
  if (!userId || typeof userId !== 'string') {
    log.error('Invalid userId provided to set-user-id');
    return { success: false, error: 'Invalid userId' };
  }
  currentUserId = userId;
  log.info(`[User] local userId set to ${userId}`);
  return { success: true };
});

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const onboardingComplete = isOnboardingComplete();
  const modelConfiguration = readModelConfiguration();
  if (!onboardingComplete) {
    // First launch — show onboarding. The avatar is created after the user
    // completes or skips onboarding (see 'onboarding-complete' handler).
    createOnboardingWindow();
    createTray();
  } else if (!modelConfiguration && readPiConnection().mode !== 'native') {
    // Legacy environment variables may be sufficient to start the services,
    // but users still need an explicit, inspectable model configuration.
    createOnboardingWindow(true);
    createTray();
  } else {
    applyAvatarVisibility(readHideAvatarSetting());
  }

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  desktopAppUpdater.start();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin' && !hideAvatarMode) {
    app.quit();
  }
});

app.on('second-instance', () => {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    onboardingWindow.focus();
  } else if (chatWindow && !chatWindow.isDestroyed()) {
    showChatPanel();
  } else if (avatarWindow && !avatarWindow.isDestroyed()) {
    avatarWindow.show();
    avatarWindow.focus();
  } else {
    openPrimaryTrayAction();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// Warning shown when neither first-launch configuration nor legacy developer
// environment variables provide a chat model.
const showModelsRequiredWarning = () => {
  void dialog.showMessageBox({
    type: 'info',
    message: 'Open Settings and configure at least one chat model to use Coco.',
    buttons: ['Got it'],
  });
};

// Starts the tutor service. Called once onboarding is complete (or
// immediately on subsequent launches where it's already done), and again the
// moment the user first saves their models.
const startServices = () => {
  // Already running — nothing to do (guards the several call sites).
  if (servicesStarted) return;

  // Managed app configuration wins when present; the legacy TUTOR_MODEL
  // environment variable remains supported as a developer fallback.
  const tutorModel = resolveTutorModelId(readModelConfiguration());
  if (!tutorModel) {
    log.warn('[Models] No models chosen yet — services not started.');
    if (readPiConnection().mode !== 'native') showModelsRequiredWarning();
    return;
  }
  servicesStarted = true;

  // Records directory. The tutor server reads $COCO_RECORDS_DIR and appends
  // its JSONL call log there. It lives alongside the user's other local data
  // under the app's userData dir. Set before services spawn so the children
  // inherit it.
  if (!process.env.COCO_RECORDS_DIR) {
    const dir = path.join(
      app.getPath('userData'),
      'coco-records',
      `session_${Math.floor(Date.now() / 1000)}`,
    );
    process.env.COCO_RECORDS_DIR = dir;
    log.info(`[Records] COCO_RECORDS_DIR=${dir}`);
  }

  // Pass the resolved model to the service. config.json references
  // ${TUTOR_MODEL}, which the service manager expands from env.
  process.env.TUTOR_MODEL = tutorModel;
  log.info(`[Models] tutor=${tutorModel}`);

  try {
    // services.json may be loaded earlier while choosing available ports. On a
    // clean install there is no legacy .env, so its model placeholders have
    // already expanded to empty strings by this point. Always apply the saved
    // model IDs directly before startup instead of relying on load-time env
    // expansion.
    configureServiceModelArguments(serviceManager, tutorModel);
    const runtime = resolveModelRuntime();
    if (runtime) {
      const { userName } = readProfile();
      serviceManager.configureServiceEnv(
        'tutor-server',
        {
          ...runtime.tutorEnv,
          ...(userName && { COCO_USER_NAME: userName }),
        },
        true,
      );
    }
    startModelServices(serviceManager);
  } catch (e) {
    console.warn('Failed to start services:', e);
  }
};

app
  .whenReady()
  .then(async () => {
    await startPiInferenceBridge();
    await configureLocalServicePorts();
    initializeWakeWordService();
    powerMonitor.on('suspend', () => {
      log.info('[Power] System suspended; pausing voice activation.');
      systemSuspended = true;
      syncWakeWordService();
      if (avatarWindow && !avatarWindow.isDestroyed()) {
        avatarWindow.webContents.send('system-suspend');
      }
      chatWindow?.webContents.send('system-suspend');
    });

    powerMonitor.on('resume', () => {
      log.info('[Power] System resumed; resuming voice activation.');
      systemSuspended = false;
      syncWakeWordService();
    });

    // Ensure default workspace directory exists
    ensureDefaultWorkspaceExists();

    // Only start the tutor service if onboarding is already done. If not, it
    // will be started by the 'onboarding-complete' IPC handler after the user
    // finishes onboarding.
    const canStartConfiguredModels = Boolean(
      readModelConfiguration() || process.env.TUTOR_MODEL?.trim(),
    );
    if (isOnboardingComplete() && canStartConfiguredModels) {
      hideAvatarMode = readHideAvatarSetting();
      startServices();
    }

    createWindow();
    createWakeWordCaptureWindow();
    // Keep chat state alive while its panel is closed.
    createChatWindow();

    // Register global shortcut to toggle DevTools (Cmd/Ctrl+Shift+I)
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      const devTarget =
        BrowserWindow.getFocusedWindow() ?? chatWindow ?? avatarWindow;
      if (devTarget && devTarget.webContents) {
        devTarget.webContents.toggleDevTools();
      }
    });

    // Cmd/Ctrl+Shift+Space opens the chat from anywhere. It never captures
    // the screen: Coco only sees what the user explicitly sends.
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      openPrimaryTrayAction();
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (avatarWindow === null && chatWindow === null) createWindow();
    });
  })
  .catch(console.log);

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  desktopAppUpdater.stop();
  log.info('App quitting: waiting up to 10s for services to stop...');
  void agentRuns.dispose();
  wakeWordService?.stop('disabled');
  const shutdownTimeoutMs = 10_000;
  serviceManager
    .shutdown(shutdownTimeoutMs)
    .then(() => {
      log.info('Services stopped, quitting app.');
      if (installUpdateAfterShutdown) autoUpdater.quitAndInstall();
      else app.quit();
    })
    .catch((e) => {
      log.warn('Error while stopping services, quitting anyway', e);
      app.quit();
    });
});
