import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import AgentBubble from '../renderer/components/AgentBubble';

const target = { sessionId: 'session', requestId: 'request' };

describe('AgentBubble', () => {
  it('offers View reply and dismiss on a completion reminder', () => {
    const onViewConversation = jest.fn();
    const onDismiss = jest.fn();
    render(
      <AgentBubble
        bubble={{
          kind: 'reply',
          text: 'Your reply is ready.',
          target,
          fadingOut: false,
        }}
        onViewConversation={onViewConversation}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Reply ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View reply →' }));
    expect(onViewConversation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('previews progress and truncates long notes', () => {
    const long = `Editing files ${'and more '.repeat(30)}`;
    render(
      <AgentBubble
        bubble={{ kind: 'working', text: long, target, fadingOut: false }}
      />,
    );
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View progress →' }),
    ).toBeInTheDocument();
  });

  it('renders nothing without a bubble', () => {
    const { container } = render(<AgentBubble bubble={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
