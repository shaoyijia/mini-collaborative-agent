import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import App from '../renderer/App';

// The bubble most recently sent to the bubble window.
const lastBubbleState = (sendMessage: jest.Mock) =>
  sendMessage.mock.calls
    .filter(([channel]) => channel === 'avatar-bubble-state')
    .at(-1)?.[1]?.bubble;

const replyReady = { sessionId: 's', requestId: 'r' };

describe('App', () => {
  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });

  it('clears an agent bubble when the system suspends', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    (window as any).electron = {
      ipcRenderer: {
        on: (channel: string, callback: (...args: unknown[]) => void) => {
          listeners.set(channel, callback);
          return () => listeners.delete(channel);
        },
        sendMessage: jest.fn(),
        invoke: jest.fn().mockResolvedValue([]),
      },
    };

    render(<App />);
    await waitFor(() => {
      expect(window.electron?.ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-coco-sleep-mode',
      );
    });
    const { sendMessage } = window.electron!.ipcRenderer as any;
    act(() => listeners.get('agent-reply-ready')?.(replyReady));
    expect(lastBubbleState(sendMessage)).toEqual(
      expect.objectContaining({ kind: 'reply', target: replyReady }),
    );

    act(() => listeners.get('system-suspend')?.());
    expect(lastBubbleState(sendMessage)).toBeNull();
  });

  const setupMenuIpc = (
    invoke: jest.Mock = jest.fn().mockResolvedValue({ sleeping: false }),
  ) => {
    const sendMessage = jest.fn();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    (window as any).electron = {
      ipcRenderer: {
        on: jest.fn(
          (channel: string, callback: (...args: unknown[]) => void) => {
            listeners.set(channel, callback);
            return () => listeners.delete(channel);
          },
        ),
        sendMessage,
        invoke,
      },
    };
    const chooseMenuItem = (action: string) =>
      act(() => listeners.get('avatar-menu-action')?.(action));
    return { sendMessage, listeners, chooseMenuItem };
  };

  it('shows working updates briefly and clears them as soon as the run ends', async () => {
    jest.useFakeTimers();
    try {
      const { listeners, sendMessage } = setupMenuIpc();
      render(<App />);
      const target = {
        sessionId: 's',
        requestId: 'r',
        text: 'Checking results.',
      };
      await act(async () => listeners.get('agent-working')?.(target));
      expect(lastBubbleState(sendMessage)).toEqual(
        expect.objectContaining({
          kind: 'working',
          text: 'Checking results.',
          target: { sessionId: 's', requestId: 'r' },
        }),
      );
      expect(screen.getByAltText('Desktop Pet')).not.toHaveClass(
        'pet-image-awake',
      );
      act(() => jest.advanceTimersByTime(6000));
      expect(lastBubbleState(sendMessage)).toBeNull();
      act(() => listeners.get('agent-working')?.(target));
      act(() => listeners.get('agent-work-ended')?.({ requestId: 'r' }));
      expect(lastBubbleState(sendMessage)).toBeNull();
      // Final cleanup must not remove the completion reminder.
      act(() => listeners.get('agent-reply-ready')?.(target));
      act(() => listeners.get('agent-work-ended')?.({ requestId: 'r' }));
      expect(lastBubbleState(sendMessage)).toEqual(
        expect.objectContaining({
          kind: 'reply',
          target: { sessionId: 's', requestId: 'r' },
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens the completed reply while asleep and clears its reminder', async () => {
    const { listeners, sendMessage } = setupMenuIpc();
    render(<App />);
    const target = { sessionId: 'session-1', requestId: 'request-1' };
    await act(async () =>
      listeners.get('coco-sleep-mode-changed')?.({ sleeping: true }),
    );
    await act(async () => listeners.get('agent-reply-ready')?.(target));
    await act(async () =>
      listeners.get('coco-sleep-mode-changed')?.({ sleeping: true }),
    );
    expect(lastBubbleState(sendMessage)).toEqual(
      expect.objectContaining({
        kind: 'reply',
        target,
        text: 'Your reply is ready.',
      }),
    );
    act(() => listeners.get('avatar-bubble-event')?.('view-conversation'));
    expect(sendMessage).toHaveBeenCalledWith('view-agent-reply', target);
    expect(lastBubbleState(sendMessage)).toBeNull();
  });

  it('expires ignored reply reminders without repeating, even while hovered', async () => {
    jest.useFakeTimers();
    try {
      const { listeners, sendMessage } = setupMenuIpc();
      render(<App />);
      await act(async () =>
        listeners.get('agent-reply-ready')?.({
          sessionId: 's',
          requestId: 'r',
        }),
      );
      act(() => listeners.get('avatar-bubble-event')?.('enter'));
      act(() => jest.advanceTimersByTime(3000));
      expect(screen.getByAltText('Desktop Pet')).not.toHaveClass(
        'pet-image-awake',
      );
      expect(lastBubbleState(sendMessage)).not.toBeNull();
      act(() => jest.advanceTimersByTime(5000));
      expect(screen.getByAltText('Desktop Pet')).toHaveClass('pet-image-awake');
      expect(lastBubbleState(sendMessage)).toBeNull();
      act(() => jest.advanceTimersByTime(30000));
      expect(lastBubbleState(sendMessage)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('dismisses reply reminders', async () => {
    jest.useFakeTimers();
    try {
      const { listeners, sendMessage } = setupMenuIpc();
      render(<App />);
      await act(async () =>
        listeners.get('agent-reply-ready')?.({
          sessionId: 's',
          requestId: 'r',
        }),
      );
      act(() => listeners.get('avatar-bubble-event')?.('dismiss'));
      act(() => jest.advanceTimersByTime(400));
      expect(lastBubbleState(sendMessage)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends a new bubble to its own window without resizing the avatar', () => {
    const { listeners, sendMessage } = setupMenuIpc();
    const { invoke } = window.electron!.ipcRenderer as any;

    render(<App />);
    act(() => listeners.get('agent-reply-ready')?.(replyReady));

    expect(lastBubbleState(sendMessage)).toEqual(
      expect.objectContaining({ kind: 'reply', text: expect.any(String) }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'resize-avatar-window',
      expect.anything(),
    );
  });

  it('hides the ••• trigger while Coco is dragged', () => {
    const { listeners } = setupMenuIpc();
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    const container = trigger.closest('.pet-container');
    expect(container).not.toHaveClass('is-dragging');

    act(() => listeners.get('avatar-dragging')?.({ dragging: true }));
    expect(container).toHaveClass('is-dragging');
    act(() => listeners.get('avatar-dragging')?.({ dragging: false }));
    expect(container).not.toHaveClass('is-dragging');
  });

  it('keeps Coco asleep on avatar click and wakes it from the menu', async () => {
    const invoke = jest.fn(
      (channel: string, payload?: { sleeping?: boolean }) => {
        if (channel === 'get-coco-sleep-mode') {
          return Promise.resolve({ sleeping: false });
        }
        return Promise.resolve({ success: true, sleeping: payload?.sleeping });
      },
    );
    const { sendMessage, chooseMenuItem } = setupMenuIpc(invoke);

    render(<App />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get-coco-sleep-mode');
    });
    chooseMenuItem('toggle-sleep');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set-coco-sleep-mode', {
        sleeping: true,
      });
    });

    // Let the sleep result settle before interacting again.
    await act(async () => {});
    fireEvent.click(screen.getByAltText('Desktop Pet'));
    expect(sendMessage).not.toHaveBeenCalledWith('open-main-window');
    expect(invoke).not.toHaveBeenCalledWith('set-coco-sleep-mode', {
      sleeping: false,
    });

    chooseMenuItem('toggle-sleep');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set-coco-sleep-mode', {
        sleeping: false,
      });
    });
  });

  it('asks main to open the menu from the ••• button and a right-click', () => {
    const { sendMessage, listeners } = setupMenuIpc();

    render(<App />);
    expect(screen.getByText('Right-click for menu')).toBeInTheDocument();
    const trigger = screen.getByTitle('More actions');
    fireEvent.click(trigger);
    expect(sendMessage).toHaveBeenCalledWith('open-avatar-menu');

    sendMessage.mockClear();
    fireEvent.contextMenu(
      screen.getByAltText('Desktop Pet').closest('.pet-container')!,
    );
    expect(sendMessage).toHaveBeenCalledWith('open-avatar-menu');

    act(() => listeners.get('avatar-menu-visibility')?.({ open: true }));
    expect(trigger).toHaveClass('is-open');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    act(() => listeners.get('avatar-menu-visibility')?.({ open: false }));
    expect(trigger).not.toHaveClass('is-open');
  });

  it('runs the navigation and Quit items chosen in the menu window', () => {
    const { sendMessage, chooseMenuItem } = setupMenuIpc();

    render(<App />);
    chooseMenuItem('open-main-window');
    expect(sendMessage).toHaveBeenCalledWith('open-main-window');
    chooseMenuItem('open-training');
    expect(sendMessage).toHaveBeenCalledWith('open-training');
    chooseMenuItem('open-chat-settings');
    expect(sendMessage).toHaveBeenCalledWith('open-chat-settings');
    chooseMenuItem('quit');
    expect(sendMessage).toHaveBeenCalledWith('quit-from-avatar');
  });
});
