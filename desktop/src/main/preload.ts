// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import {
  contextBridge,
  ipcRenderer,
  IpcRendererEvent,
  webUtils,
} from 'electron';

export type Channels =
  | 'reveal-agent-reply'
  | 'set-chat-window-pinned'
  | 'get-chat-window-pin-state'
  | 'chat-window-pin-state'
  | 'view-agent-reply'
  | 'toggle-sleep'
  | 'quit'
  | 'open-avatar-menu'
  | 'close-avatar-menu'
  | 'avatar-pointer-position'
  | 'avatar-pointer-drag'
  | 'avatar-pointer'
  | 'avatar-menu-visibility'
  | 'avatar-menu-size'
  | 'avatar-menu-painted'
  | 'avatar-menu-open'
  | 'avatar-menu-closed'
  | 'avatar-menu-action'
  | 'avatar-dragging'
  | 'avatar-bubble-state'
  | 'avatar-bubble-size'
  | 'avatar-bubble-pointer'
  | 'avatar-bubble-placement'
  | 'avatar-bubble-painted'
  | 'avatar-bubble-event'
  | 'agent-working'
  | 'agent-work-ended'
  | 'agent-reply-ready'
  | 'pi-provider'
  | 'open-avatar-actions-menu'
  | 'quit-from-avatar'
  | 'avatar-visibility-changed'
  | 'get-agent-workspace'
  | 'choose-agent-workspace'
  | 'get-agent-context'
  | 'answer-agent-question'
  | 'stop-agent-run'
  | 'close-chat-window'
  | 'quit-from-onboarding'
  | 'open-main-window'
  | 'close-main-window'
  | 'system-suspend'
  | 'shell-show-item-in-finder'
  | 'download-benchmark-file'
  | 'get-benchmark-files'
  | 'select-chat-files'
  | 'select-directory'
  | 'select-file-or-directory'
  | 'set-user-id'
  | 'toggle-float-window'
  | 'float-window-state'
  | 'get-float-window-state'
  | 'get-chat-content-zoom-factor'
  | 'chat-content-zoom-factor'
  | 'open-chat-settings'
  | 'session-active'
  // Local chat (SessionChatView) — session context + user turns
  | 'session-init'
  | 'start-new-chat-session'
  | 'send-chat-message'
  | 'send-audio-message'
  | 'chat-stream-event'
  | 'get-chat-conversations'
  | 'save-chat-conversation'
  | 'resume-chat-conversation'
  // Full-display image preview shared by pending and sent chat attachments
  | 'open-image-preview'
  | 'image-preview'
  | 'image-preview-ready'
  | 'close-image-preview'
  | 'save-image-annotation'
  | 'image-annotation-saved'
  // Onboarding
  | 'onboarding-complete'
  | 'model-configuration-complete'
  | 'hide-onboarding'
  | 'get-profile'
  | 'get-model-configuration'
  | 'get-service-health'
  | 'test-model-connection'
  | 'save-model-configuration'
  | 'set-chat-model'
  // Settings (post-onboarding profile edits)
  | 'save-profile'
  | 'update-avatar-visibility'
  | 'avatar-renderer-ready'
  // Renderer asks main to resize the avatar window to fit current content
  | 'resize-avatar-window'
  | 'get-coco-sleep-mode'
  | 'set-coco-sleep-mode'
  | 'coco-sleep-mode-changed'
  | 'get-wake-word-settings'
  | 'set-wake-word-settings'
  | 'wake-word-settings-changed'
  | 'wake-word-status'
  | 'wake-word-audio-frame'
  | 'wake-word-detected'
  | 'wake-word-detection-ack'
  | 'set-wake-word-capture-paused'
  | 'wake-word-capture-paused-changed'
  | 'wake-word-capture-status'
  | 'wake-word-capture-renderer-ready'
  | 'wake-word-capture-window-ready';

const electronHandler = {
  platform: process.platform,
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
    invoke(channel: Channels, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
  },
  webUtils: {
    // Expose webUtils.getPathForFile to get the real file path in the renderer process
    // This is necessary because the File object in the browser/renderer does not expose the full path for security reasons
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  benchmark: {
    downloadFile: (
      apiUrl: string,
      taskId: string,
      filename: string,
      workspaceDir: string,
    ) =>
      ipcRenderer.invoke('download-benchmark-file', {
        apiUrl,
        taskId,
        filename,
        workspaceDir,
      }),
    getFileList: (apiUrl: string, taskId: string) =>
      ipcRenderer.invoke('get-benchmark-files', { apiUrl, taskId }),
  },
  auth: {
    setUserId: (userId: string) => ipcRenderer.invoke('set-user-id', userId),
  },
  dialog: {
    selectFileOrDirectory: () => ipcRenderer.invoke('select-file-or-directory'),
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
