import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ToolCallCard } from '../renderer/components/SessionChatView';

describe('Tutor tool-call visualization', () => {
  it('summarizes a tool call and keeps the raw call in its details', () => {
    const { rerender } = render(
      <ToolCallCard
        call={{
          id: 'tool-read',
          name: 'read',
          arguments: { path: 'notes.md' },
          status: 'running',
        }}
      />,
    );

    expect(screen.getByText('Read a file')).toBeInTheDocument();
    expect(screen.getByText('Working…')).toBeInTheDocument();

    rerender(
      <ToolCallCard
        call={{
          id: 'tool-read',
          name: 'read',
          arguments: { path: 'notes.md' },
          status: 'completed',
          result: { output: 'Trip ideas' },
        }}
      />,
    );

    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText(/"output": "Trip ideas"/)).toBeInTheDocument();
  });

  it('labels unknown tools generically', () => {
    render(
      <ToolCallCard
        call={{
          id: 'tool-x',
          name: 'list_calendars',
          arguments: {},
          status: 'error',
        }}
      />,
    );
    expect(screen.getByText('Use a tool')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
