import React from 'react';
import type { TutorToolCall } from '../agent-types';
import toolSummary from './tool-summary';
import './ToolActivity.css';
import QuestionCard from './QuestionCard';

export function ToolCallCard({
  requestId,
  call,
  interactive = false,
  grouped = false,
}: {
  requestId?: string;
  call: TutorToolCall;
  interactive?: boolean;
  grouped?: boolean;
}) {
  if (call.name === 'ask_user_question')
    return (
      <QuestionCard
        call={call}
        interactive={interactive}
        requestId={requestId}
      />
    );
  const rawDetails = (
    <div className="tool-activity-details">
      <div className="tool-activity-caption">Full tool call · JSON</div>
      <pre className="agent-tool-output">{JSON.stringify(call, null, 2)}</pre>
    </div>
  );
  const status = (
    <span className={`tool-activity-status ${call.status}`}>
      {call.status === 'running'
        ? 'Working…'
        : call.status === 'error'
          ? 'Failed'
          : 'Done'}
    </span>
  );
  if (grouped) {
    return (
      <details className="tool-activity-call">
        <summary>
          <span className="tool-activity-description">{call.name}</span>
          {status}
          <span className="tool-activity-detail-label">Details</span>
        </summary>
        {rawDetails}
      </details>
    );
  }
  return (
    <details className="tool-activity-call">
      <summary>
        <span className="tool-activity-description">{toolSummary(call)}</span>
        {status}
        <span className="tool-activity-detail-label">Details</span>
      </summary>
      {rawDetails}
    </details>
  );
}

ToolCallCard.defaultProps = { interactive: false, grouped: false };
