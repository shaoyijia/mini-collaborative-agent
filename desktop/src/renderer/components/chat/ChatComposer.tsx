import { useState } from 'react';
import type React from 'react';
import { S } from './styles';
import ChatComposerActions from './ChatComposerActions';
import './ChatComposer.css';
import AgentWorkspace from './AgentWorkspace';
import type { SavedConversation } from './types';
import type { VoiceRecorderStatus } from '../../voice-recorder';

interface Props {
  modelPicker?: React.ReactNode;
  workspaceSessionId: string | null;
  agentRunning: boolean;
  stopAgent: () => Promise<void>;
  pendingImages: string[];
  openImagePreview: (imageDataUrl: string) => void;
  setPendingImages: React.Dispatch<React.SetStateAction<string[]>>;
  understandingError: string;
  sending: boolean;
  voiceState: VoiceRecorderStatus | 'idle' | 'requesting';
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  voiceActive: boolean;
  startingNewSession: boolean;
  reviewing: SavedConversation | null;
  handleVoiceClick: (fromWakeWord?: boolean) => Promise<void>;
  checkingUnderstanding: boolean;
  canSend: boolean;
  handleSend: () => void;
  voiceStatusText: string;
  voiceError: string;
}

export default function ChatComposer({
  modelPicker,
  workspaceSessionId,
  agentRunning,
  stopAgent,
  pendingImages,
  openImagePreview,
  setPendingImages,
  understandingError,
  sending,
  voiceState,
  input,
  setInput,
  onPaste,
  onKeyDown,
  voiceActive,
  startingNewSession,
  reviewing,
  handleVoiceClick,
  checkingUnderstanding,
  canSend,
  handleSend,
  voiceStatusText,
  voiceError,
}: Props) {
  const [attachmentError, setAttachmentError] = useState('');
  const attachmentDisabled =
    sending ||
    startingNewSession ||
    checkingUnderstanding ||
    voiceState !== 'idle';
  const attachPaths = (paths: string[]) => {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return;
    setAttachmentError('');
    // Keep references in the prompt so they also survive conversation saves and retries.
    // JSON quoting preserves spaces, newlines, and Windows path separators.
    const references = uniquePaths.map((path) => `@${JSON.stringify(path)}`);
    setInput(
      (previous) =>
        `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${references.join('\n')}\n`,
    );
  };
  const attachFiles = async () => {
    try {
      const result =
        await window.electron?.ipcRenderer.invoke('select-chat-files');
      if (result && !result.canceled) attachPaths(result.filePaths);
    } catch {
      setAttachmentError('Could not select files. Please try again.');
    }
  };

  return (
    <div style={S.composer}>
      <AgentWorkspace
        key={workspaceSessionId}
        sessionId={workspaceSessionId}
        disabled={sending || startingNewSession || checkingUnderstanding}
        running={agentRunning}
        onStop={stopAgent}
      />
      <div className="chat-composer-surface" style={S.composerSurface}>
        {pendingImages.length > 0 && (
          <div style={S.pending}>
            {pendingImages.map((src, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} style={S.pendingThumbWrap}>
                <button
                  type="button"
                  style={S.imagePreviewButton}
                  aria-label={`Preview attached image ${i + 1}`}
                  title="Preview image"
                  onClick={() => openImagePreview(src)}
                >
                  <img src={src} alt={`Attachment ${i + 1}`} style={S.thumb} />
                </button>
                <button
                  type="button"
                  style={S.pendingX}
                  aria-label={`Remove attached image ${i + 1}`}
                  title="Remove image"
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {understandingError && (
          <div style={S.understandingError}>{understandingError}</div>
        )}
        {attachmentError && (
          <div role="alert" style={S.understandingError}>
            {attachmentError}
          </div>
        )}
        <textarea
          style={S.textarea}
          rows={2}
          aria-label="Message Coco"
          placeholder={
            voiceState !== 'idle'
              ? 'Listening to your voice…'
              : 'Ask Coco… (drop files or paste an image)'
          }
          value={input}
          disabled={voiceState !== 'idle'}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = attachmentDisabled
                ? 'none'
                : 'copy';
            }
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            if (attachmentDisabled) return;
            try {
              const paths = Array.from(event.dataTransfer.files).map(
                (file) => window.electron?.webUtils.getPathForFile(file) || '',
              );
              attachPaths(paths);
              if (paths.some((path) => !path)) {
                setAttachmentError(
                  'Some files have no local path. Save them to your computer first.',
                );
              }
            } catch {
              setAttachmentError(
                'Could not attach files. Try the Attach files button.',
              );
            }
          }}
          onKeyDown={onKeyDown}
        />
        <ChatComposerActions
          onAttachFiles={attachFiles}
          attachmentDisabled={attachmentDisabled}
          modelPicker={modelPicker}
          sessionId={workspaceSessionId}
          voiceActive={voiceActive}
          voiceDisabled={
            sending ||
            startingNewSession ||
            checkingUnderstanding ||
            Boolean(reviewing) ||
            voiceState === 'requesting'
          }
          onVoiceClick={() => handleVoiceClick()}
          canSend={canSend}
          onSend={handleSend}
        />
      </div>
      {voiceState !== 'idle' && (
        <div style={S.voiceHint}>{voiceStatusText}</div>
      )}
      {voiceState === 'idle' && voiceError && (
        <div style={S.voiceError}>{voiceError}</div>
      )}
    </div>
  );
}
