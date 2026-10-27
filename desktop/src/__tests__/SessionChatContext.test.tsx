import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import SessionChatView from '../renderer/components/SessionChatView';

// Paste one PNG into the composer, as copying a screenshot would.
const pasteImage = (textarea: HTMLElement) =>
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [
        {
          type: 'image/png',
          getAsFile: () => new File(['png'], 'shot.png', { type: 'image/png' }),
        },
      ],
    },
  });

describe('session chat view', () => {
  it('does not display the task banner for the active chat', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: unknown) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke: jest.fn(async () => null),
      },
    };

    render(<SessionChatView />);
    await act(async () => {
      listeners.get('session-init')?.({
        sessionId: 'general-help',
        problemStatement: 'General help session',
      });
    });

    expect(screen.queryByText(/^Task:/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask Coco/)).toBeInTheDocument();
  });

  it('sends a driver message like a typed one, and asks main to retry for another session', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    const sendMessage = jest.fn();
    const invoke = jest.fn(async (channel: string) =>
      channel === 'send-chat-message' ? { streamed: true } : null,
    );
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: unknown) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage,
        invoke,
      },
    };

    render(<SessionChatView />);
    await act(async () => {
      listeners.get('session-init')?.({
        sessionId: 'session-1',
        problemStatement: 'General help session',
      });
    });
    await act(async () => {
      listeners.get('driver-send-message')?.({
        id: 1,
        sessionId: 'other-session',
        text: 'Wrong chat',
      });
    });
    expect(sendMessage).toHaveBeenCalledWith('driver-send-message-result', {
      id: 1,
      ok: false,
      retry: true,
    });

    await act(async () => {
      listeners.get('driver-send-message')?.({
        id: 2,
        sessionId: 'session-1',
        text: 'Plan a weekend in Big Sur',
      });
    });
    expect(sendMessage).toHaveBeenCalledWith('driver-send-message-result', {
      id: 2,
      ok: true,
    });
    expect(screen.getByText('Plan a weekend in Big Sur')).toBeInTheDocument();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'send-chat-message',
        expect.objectContaining({
          sessionId: 'session-1',
          userText: 'Plan a weekend in Big Sur',
        }),
      ),
    );
  });

  it('scales chat content without scaling the header', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-chat-content-zoom-factor') return 1;
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: unknown) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get-chat-content-zoom-factor');
    });
    await act(async () => {
      listeners.get('chat-content-zoom-factor')?.(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId('chat-scalable-content')).toHaveStyle({
        transform: 'scale(2)',
        width: '50%',
        height: '50%',
      });
    });
    expect(
      screen.getByRole('toolbar', { name: 'Chat actions' }),
    ).not.toHaveStyle({
      transform: 'scale(2)',
    });
  });

  it('shows tutor agent health and allows a refresh', async () => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-coco-sleep-mode') return { sleeping: false };
      if (channel === 'get-service-health') {
        return {
          checkedAt: 1753200000000,
          tutor: {
            connected: false,
            status: 'unavailable',
            detail: 'Service is not running.',
            modelAssessment: {
              status: 'failed',
              detail: 'The tutor model rejected the API key.',
            },
          },
        };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    fireEvent.click(screen.getByTitle('Settings'));

    expect(
      await screen.findByLabelText(
        'Tutor agent: Not connected (service); Not connected (model)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sensing server/)).not.toBeInTheDocument();
    expect(screen.getByText(/Service is not running/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(
          ([channel]) => channel === 'get-service-health',
        ),
      ).toHaveLength(2);
      expect(invoke).toHaveBeenLastCalledWith('get-service-health', {
        forceModelTest: true,
      });
    });
  });

  it('shows sleep state without checking intentionally stopped services', async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-coco-sleep-mode') return { sleeping: true };
      if (channel === 'get-service-health') {
        const service = {
          connected: true,
          status: 'healthy',
          modelAssessment: { status: 'verified', detail: 'Connected.' },
        };
        return { checkedAt: Date.now(), tutor: service };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (...args: any[]) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);

    fireEvent.click(screen.getByTitle('Settings'));
    expect(
      await screen.findByText(/Coco is asleep\. Voice activation is paused\./),
    ).toBeInTheDocument();
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'get-service-health'),
    ).toHaveLength(0);

    await act(async () => {
      listeners.get('coco-sleep-mode-changed')?.({ sleeping: false });
    });
    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(
          ([channel]) => channel === 'get-service-health',
        ),
      ).toHaveLength(1);
    });
  });

  it('shows missing model configuration in Settings', async () => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-coco-sleep-mode') return { sleeping: false };
      if (channel === 'get-service-health') {
        const modelAssessment = {
          status: 'not_configured',
          detail: 'No model configuration was found.',
        };
        return {
          checkedAt: 1753200000000,
          tutor: { connected: true, status: 'healthy', modelAssessment },
        };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByText('Coco Health')).toBeInTheDocument();
    expect(
      await screen.findAllByText(/No model configuration was found/),
    ).toHaveLength(1);
  });

  it('shows a failed real model check in the chat header', async () => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-coco-sleep-mode') return { sleeping: false };
      if (channel === 'get-service-health') {
        return {
          checkedAt: 1753200000000,
          tutor: {
            connected: true,
            status: 'healthy',
            modelAssessment: {
              status: 'failed',
              detail: 'The API key was rejected.',
            },
          },
        };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    fireEvent.click(screen.getByTitle('Settings'));
    expect(
      await screen.findByText(/The API key was rejected/),
    ).toBeInTheDocument();
  });

  it('applies desktop avatar visibility immediately', async () => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-profile') {
        return {
          tutorScenario: 'everyday_support',
          aiTools: [],
          hideAvatar: false,
        };
      }
      if (channel === 'update-avatar-visibility') {
        return { success: true };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    fireEvent.click(screen.getByTitle('Settings'));
    const checkbox = screen.getByRole('switch', {
      name: 'Desktop avatar',
    });
    fireEvent.click(checkbox);

    expect(checkbox).not.toBeChecked();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update-avatar-visibility', {
        hideAvatar: true,
      });
      expect(
        screen.queryByRole('button', { name: 'Save changes' }),
      ).not.toBeInTheDocument();
    });
  });

  it('opens the settings panel from the tray event', async () => {
    const listeners = new Map<string, (data?: unknown) => void>();
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data?: unknown) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke: jest.fn(async () => null),
      },
    };

    render(<SessionChatView />);
    expect(screen.queryByText('Models & providers')).not.toBeInTheDocument();

    await act(async () => {
      listeners.get('open-chat-settings')?.();
    });

    expect(
      screen.getByRole('heading', { name: 'Models & providers' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Coco Health')).toBeInTheDocument();
  });

  it('opens and resumes a past conversation from the hover sidebar', async () => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-chat-conversations') {
        return [
          {
            sessionId: 'past-session',
            title: 'Launch checklist',
            problem: 'Plan the launch',
            createdAt: 1753200000000,
            updatedAt: 1753203600000,
            messages: [
              { role: 'user', text: 'What should I do first?' },
              { role: 'tutor', text: 'Start by naming the launch owner.' },
            ],
          },
        ];
      }
      if (channel === 'resume-chat-conversation') {
        return { success: true };
      }
      if (channel === 'send-chat-message') {
        return { guidance: 'Continue by setting a launch date.' };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Chat' }));

    expect(await screen.findByText('Launch checklist')).toBeInTheDocument();
    expect(screen.getByText('What should I do first?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Launch checklist'));
    expect(
      await screen.findByText('Start by naming the launch owner.'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask Coco/)).toBeInTheDocument();
    expect(
      screen.queryByText('Viewing a past conversation'),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('get-agent-workspace', {
        sessionId: 'past-session',
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Choose working folder' }),
    ).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'What should I do next?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('resume-chat-conversation', {
        sessionId: 'past-session',
      });
      expect(invoke).toHaveBeenCalledWith(
        'send-chat-message',
        expect.objectContaining({ userText: 'What should I do next?' }),
      );
    });
    expect(screen.getByText('What should I do first?')).toBeInTheDocument();
    expect(screen.getByText('What should I do next?')).toBeInTheDocument();
    expect(
      screen.queryByText('Viewing a past conversation'),
    ).not.toBeInTheDocument();
  });

  it('starts a fresh chat session from the header', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    const invoke = jest.fn(async () => ({ success: true }));

    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: unknown) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);

    act(() => {
      listeners.get('session-init')?.({
        sessionId: 'old-session',
        problemStatement: 'Draft a project plan',
      });
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Start a new session' }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('start-new-chat-session', {
        problemStatement: 'Draft a project plan',
      });
    });
  });

  it('restores the active transcript after a renderer reload', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const savedConversation = {
      sessionId: 'active-session',
      problem: 'Review prior literature',
      createdAt: 1753200000000,
      updatedAt: 1753203600000,
      messages: [
        { role: 'user', text: 'What does previous work fall short of?' },
        {
          role: 'tutor',
          text:
            'Prior work often assumes memory is already available.\n\n' +
            '```python\nfrom huggingface_hub import snapshot_download\n```\n',
        },
      ],
    };
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-chat-conversations') return [savedConversation];
      return null;
    });

    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: unknown) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    act(() => {
      listeners.get('session-init')?.({
        sessionId: 'active-session',
        problemStatement: 'Review prior literature',
      });
    });

    expect(
      await screen.findByText('What does previous work fall short of?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Prior work often assumes memory is already available.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('from huggingface_hub import snapshot_download'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy tutor message' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        savedConversation.messages[1].text.trim(),
      );
      expect(screen.getByText('Copied ✓')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy user message' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(
        savedConversation.messages[0].text,
      );
    });
  });

  it('sends exactly what the user typed, with no hidden context', async () => {
    const invoke = jest.fn(async (channel: string, _payload?: unknown) => {
      if (channel === 'send-chat-message') {
        return { guidance: 'Let’s discuss it.' };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(() => jest.fn()),
        sendMessage: jest.fn(),
        invoke,
      },
    };

    render(<SessionChatView />);
    expect(screen.getByText(/Coco can't see your screen/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith(
      'send-chat-message',
      expect.anything(),
    );

    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'Why would that help?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'send-chat-message',
        expect.objectContaining({ userText: 'Why would that help?' }),
      );
    });
    const payload = invoke.mock.calls.find(
      ([channel]) => channel === 'send-chat-message',
    )?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('screenContext');
    expect(payload).not.toHaveProperty('hotkeyImages');
    expect(await screen.findByText('Let’s discuss it.')).toBeInTheDocument();
  });

  it('renders streamed text and tool-call lifecycle events in one reply', async () => {
    const listeners = new Map<string, (data: any) => void>();
    let requestId = '';
    const invoke = jest.fn(async (channel: string, payload?: any) => {
      if (channel === 'send-chat-message') {
        requestId = payload.requestId;
        return { streamed: true };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: any) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };
    render(<SessionChatView />);

    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'What was I working on?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(requestId).not.toBe(''));

    act(() => {
      listeners.get('chat-stream-event')?.({
        requestId,
        type: 'tool_call_started',
        call: {
          id: 'tool-1',
          name: 'read',
          arguments: { path: 'roadmap.md' },
          status: 'running',
        },
      });
    });
    expect(screen.getByText('Working…')).toBeInTheDocument();
    expect(screen.queryByText('Coco is thinking…')).not.toBeInTheDocument();

    act(() => {
      listeners.get('chat-stream-event')?.({
        requestId,
        type: 'tool_call_completed',
        call: {
          id: 'tool-1',
          name: 'read',
          arguments: { path: 'roadmap.md' },
          status: 'completed',
          result: { output: 'Q3 roadmap' },
        },
      });
      listeners.get('chat-stream-event')?.({
        requestId,
        type: 'text_delta',
        text: 'Your roadmap ',
      });
      listeners.get('chat-stream-event')?.({
        requestId,
        type: 'text_delta',
        text: 'was open.',
      });
    });
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Your roadmap was open.')).toBeInTheDocument();

    act(() => {
      listeners.get('chat-stream-event')?.({
        requestId,
        type: 'done',
        guidance: 'Your roadmap was open.',
        llm_metrics: { total_tokens: 12 },
        tool_calls: [],
      });
    });
    expect(screen.queryByText('Coco is thinking…')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy tutor message' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
  });

  it('opens desktop previews for pending and sent image attachments', async () => {
    const sendMessage = jest.fn();
    const invoke = jest.fn(async (channel: string) => {
      if (channel === 'get-model-configuration') {
        return {
          tutors: [
            {
              id: 'primary',
              label: 'Primary',
              provider: 'anthropic',
              model: 'anthropic/tutor',
            },
          ],
          defaultTutorId: 'primary',
        };
      }
      if (channel === 'send-chat-message') {
        return { guidance: 'I can see the attachment.' };
      }
      return null;
    });
    (window as any).electron = {
      ipcRenderer: { on: jest.fn(() => jest.fn()), sendMessage, invoke },
    };
    render(<SessionChatView />);
    await screen.findByRole('combobox', { name: 'Chat model' });

    pasteImage(screen.getByPlaceholderText(/Ask Coco/));
    const preview = await screen.findByRole('button', {
      name: 'Preview attached image 1',
    });
    const imageDataUrl = screen
      .getByAltText('Attachment 1')
      .getAttribute('src');
    expect(imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(
      screen.queryByRole('button', { name: /Annotate/ }),
    ).not.toBeInTheDocument();
    sendMessage.mockClear();
    fireEvent.click(preview);
    expect(sendMessage).toHaveBeenCalledWith('open-image-preview', {
      imageDataUrl,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'send-chat-message',
        expect.objectContaining({ images: [imageDataUrl] }),
      );
    });
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Preview message attachment 1',
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith('open-image-preview', {
      imageDataUrl,
    });
  });

  it('keeps concurrent manual runs available during sleep and ignores background completion', async () => {
    const listeners = new Map<string, (data: any) => void>();
    const pending = new Map<string, (result: unknown) => void>();
    const invoke = jest.fn(async (channel: string, payload?: any) => {
      if (channel === 'start-new-chat-session') {
        listeners.get('session-init')?.({
          sessionId: 'b',
          preserveDraft: true,
        });
        return { success: true };
      }
      if (channel === 'send-chat-message')
        return new Promise((resolve) =>
          pending.set(payload.sessionId, resolve),
        );
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: any) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };
    render(<SessionChatView />);
    await act(async () => listeners.get('session-init')?.({ sessionId: 'a' }));
    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'Task A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(pending.has('a')).toBe(true));
    await act(async () =>
      listeners.get('coco-sleep-mode-changed')?.({ sleeping: true }),
    );
    expect(
      screen.getByRole('button', { name: 'Start a new session' }),
    ).toBeEnabled();
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Start a new session' }),
      ),
    );
    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'Task B' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(pending.has('b')).toBe(true));
    const requests = invoke.mock.calls
      .filter(([channel]) => channel === 'send-chat-message')
      .map(([, payload]) => payload);
    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'Follow-up' },
    });
    await act(async () => {
      listeners.get('chat-stream-event')?.({
        sessionId: 'a',
        requestId: requests[0].requestId,
        type: 'done',
        guidance: 'A finished',
      });
      pending.get('a')?.({ streamed: true });
    });
    expect(screen.queryByText('A finished')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await act(async () => {
      listeners.get('chat-stream-event')?.({
        sessionId: 'b',
        requestId: requests[1].requestId,
        type: 'done',
        guidance: 'B finished',
      });
      pending.get('b')?.({ streamed: true });
    });
    expect(screen.getByText('B finished')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('carries a pasted image and draft text into a new conversation', async () => {
    const listeners = new Map<string, (data: any) => void>();
    const invoke = jest.fn(async (channel: string, _payload?: unknown) => {
      if (channel === 'start-new-chat-session') {
        listeners.get('session-init')?.({
          sessionId: 'new',
          preserveDraft: true,
        });
        return { success: true };
      }
      if (channel === 'send-chat-message') return { guidance: 'Done.' };
      return null;
    });
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn((channel: string, callback: (data: any) => void) => {
          listeners.set(channel, callback);
          return jest.fn();
        }),
        sendMessage: jest.fn(),
        invoke,
      },
    };
    render(<SessionChatView />);
    await act(async () =>
      listeners.get('session-init')?.({ sessionId: 'old' }),
    );
    pasteImage(screen.getByPlaceholderText(/Ask Coco/));
    await screen.findByRole('button', { name: 'Preview attached image 1' });
    fireEvent.change(screen.getByPlaceholderText(/Ask Coco/), {
      target: { value: 'Use @"/tmp/report.csv"' },
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Start a new session' }),
      ),
    );
    expect(screen.getByPlaceholderText(/Ask Coco/)).toHaveValue(
      'Use @"/tmp/report.csv"',
    );
    expect(
      screen.getByRole('button', { name: 'Preview attached image 1' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'send-chat-message',
        expect.objectContaining({
          sessionId: 'new',
          userText: 'Use @"/tmp/report.csv"',
          images: [expect.stringMatching(/^data:image\/png;base64,/)],
        }),
      ),
    );
  });
});
