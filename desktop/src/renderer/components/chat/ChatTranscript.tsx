import type React from 'react';
import { S } from './styles';
import type { SavedConversation, ChatMessage } from './types';
import { TutorMessage } from './MessageContent';
import AgentActivityList from './AgentActivityList';
import ChatMetrics from './ChatMetrics';
import { messageCopyKey } from './message-format';

interface Props {
  reviewing: SavedConversation | null;
  listRef: React.RefObject<HTMLDivElement | null>;
  visibleMessages: ChatMessage[];
  sending: boolean;
  startingNewSession: boolean;
  openImagePreview: (imageDataUrl: string) => void;
  copiedMessageKey: string | null;
  copyMessage: (message: ChatMessage, key: string) => Promise<void>;
  retryMessage: (message: ChatMessage) => Promise<void>;
  hasRunningTool: boolean;
}

export default function ChatTranscript({
  reviewing,
  listRef,
  visibleMessages,
  sending,
  startingNewSession,
  openImagePreview,
  copiedMessageKey,
  copyMessage,
  retryMessage,
  hasRunningTool,
}: Props) {
  return (
    <div style={S.list} ref={listRef}>
      {visibleMessages.length === 0 && !sending && (
        <div style={S.empty}>
          Ask Coco about your task, or anything else.
          <br />
          Coco can&apos;t see your screen. Paste an image or attach files to
          share what you&apos;re working on.
        </div>
      )}
      {visibleMessages.map((m, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div
          key={i}
          data-request-id={m.requestId}
          style={m.role === 'user' ? S.userRow : S.tutorRow}
        >
          {m.role === 'user' ? (
            <>
              <div style={S.userBubble}>
                {m.text}
                {m.images && m.images.length > 0 && (
                  <div style={S.thumbRow}>
                    {m.images.map((src, j) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <button
                        key={j}
                        type="button"
                        style={S.imagePreviewButton}
                        aria-label={`Preview message attachment ${j + 1}`}
                        title="Preview attachment"
                        onClick={() => openImagePreview(src)}
                      >
                        <img
                          src={src}
                          alt={`Attachment ${j + 1}`}
                          style={S.thumb}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {m.text.trim() && (
                <div style={S.userMessageActions}>
                  <button
                    type="button"
                    style={{
                      ...S.copyMessageBtn,
                      ...(copiedMessageKey === messageCopyKey(m, i)
                        ? S.copyMessageBtnDone
                        : {}),
                    }}
                    aria-label="Copy user message"
                    title="Copy message"
                    onClick={() => void copyMessage(m, messageCopyKey(m, i))}
                  >
                    {copiedMessageKey === messageCopyKey(m, i)
                      ? 'Copied ✓'
                      : 'Copy'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={S.tutorAvatar}>C</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                {(m.activity && m.activity.length > 0) ||
                (!m.activity && m.toolCalls?.length) ? (
                  <AgentActivityList
                    requestId={m.requestId}
                    activity={
                      m.activity ??
                      m.toolCalls?.map((call) => ({
                        kind: 'tool' as const,
                        call,
                      })) ??
                      []
                    }
                    interactive={
                      !reviewing && sending && i === visibleMessages.length - 1
                    }
                  />
                ) : null}
                {(m.text || m.isError) && (
                  <div style={m.isError ? S.errBubble : S.tutorBubble}>
                    {m.isError ? (
                      <>
                        <div>{m.text}</div>
                        {m.retryText !== undefined && (
                          <button
                            type="button"
                            style={{
                              ...S.retryBtn,
                              ...(sending || startingNewSession
                                ? S.sendBtnDisabled
                                : {}),
                            }}
                            disabled={sending || startingNewSession}
                            onClick={() => retryMessage(m)}
                          >
                            Retry
                          </button>
                        )}
                      </>
                    ) : (
                      <TutorMessage text={m.text} />
                    )}
                  </div>
                )}
                {m.stopped && (
                  <div style={S.typing}>
                    Run stopped · completed changes remain
                  </div>
                )}
                {!m.isError && <ChatMetrics tutorMetrics={m.tutorMetrics} />}
                {m.text.trim() && (
                  <div style={S.feedbackRow}>
                    <button
                      type="button"
                      style={{
                        ...S.copyMessageBtn,
                        ...(copiedMessageKey === messageCopyKey(m, i)
                          ? S.copyMessageBtnDone
                          : {}),
                      }}
                      aria-label="Copy tutor message"
                      title="Copy message"
                      onClick={() => void copyMessage(m, messageCopyKey(m, i))}
                    >
                      {copiedMessageKey === messageCopyKey(m, i)
                        ? 'Copied ✓'
                        : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ))}
      {sending && !hasRunningTool && (
        <div style={S.typing}>Coco is thinking…</div>
      )}
    </div>
  );
}
