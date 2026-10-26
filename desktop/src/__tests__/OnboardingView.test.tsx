import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import OnboardingView from '../renderer/components/OnboardingView';

describe('onboarding window', () => {
  it('can be hidden temporarily from model-only setup', () => {
    window.history.pushState({}, '', '/?view=onboarding&modelsOnly=1');
    const sendMessage = jest.fn();
    (window as any).electron = {
      ipcRenderer: {
        invoke: jest.fn(async () => null),
        sendMessage,
      },
    };

    render(<OnboardingView />);

    expect(screen.getByText('Model setup')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Close setup for now' }),
    );

    expect(sendMessage).toHaveBeenCalledWith('hide-onboarding');
  });
});

it('goes from your name straight to voice, with no permissions step', async () => {
  window.history.pushState({}, '', '/?view=onboarding');
  const invoke = jest.fn(async () => null);
  (window as any).electron = {
    ipcRenderer: { invoke, sendMessage: jest.fn() },
  };
  const view = render(<OnboardingView />);
  expect(screen.getByText('1 / 5')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(document.getElementById('ob-user-name')!, {
    target: { value: 'Alex' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(
    await screen.findByRole('heading', { name: 'Hey Coco' }),
  ).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalledWith('get-system-permissions');
  view.unmount();
});
