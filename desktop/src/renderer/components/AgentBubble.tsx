/**
 * The bubble beside the desktop avatar. It only speaks up about the agent's
 * own work: a progress note while a run continues with the chat out of view,
 * and a reminder once the reply is ready. Coco cannot sense what the user is
 * doing, so there are no proactive suggestions here.
 */
export interface BubbleState {
  kind: 'working' | 'reply';
  text: string;
  /** The run this bubble is about; "View" opens its conversation. */
  target: { sessionId: string; requestId: string };
  fadingOut: boolean;
}

const PREVIEW_CHARS = 120;

function truncatePreview(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text;
  const cutoff = text.lastIndexOf(' ', PREVIEW_CHARS);
  const end = cutoff > 40 ? cutoff : PREVIEW_CHARS;
  return `${text.slice(0, end)}…`;
}

export default function AgentBubble({
  bubble,
  onDismiss,
  onViewConversation,
  onMouseEnter,
  onMouseLeave,
}: {
  bubble: BubbleState | null;
  onDismiss?: () => void;
  onViewConversation?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (!bubble) return null;
  const working = bubble.kind === 'working';

  return (
    <div
      className={`agent-bubble ${working ? 'status-observing' : 'status-progress'} is-tier3${
        bubble.fadingOut ? ' is-leaving' : ''
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="agent-bubble-header">
        <div className="agent-bubble-label">
          {working ? 'Working' : 'Reply ready'}
        </div>
        {onDismiss && (
          <button
            type="button"
            className="bubble-dismiss-btn"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </div>

      <div className="agent-bubble-text agent-bubble-tutor-preview">
        {truncatePreview(bubble.text)}
      </div>

      <button
        type="button"
        className="bubble-action-btn"
        onClick={onViewConversation}
      >
        {working ? 'View progress →' : 'View reply →'}
      </button>

      <span className="agent-bubble-tail" aria-hidden />
    </div>
  );
}
