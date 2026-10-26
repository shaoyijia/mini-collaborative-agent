import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocalModelSettings from '../renderer/components/chat/LocalModelSettings';

function setup(connected = false) {
  const status = {
    connection: { mode: 'coco' },
    providers: [
      {
        id: 'test',
        name: 'Test provider',
        oauth: 'Sign in with Test',
        apiKey: true,
        connected,
      },
    ],
    models: [{ provider: 'test', id: 'model', name: 'Test model' }],
    flow: null as unknown,
  };
  const invoke = jest.fn(async (channel, action, payload) => {
    if (channel === 'pi-provider') {
      if (action === 'login') {
        status.flow = {
          busy: true,
          message: 'Waiting for login…',
          prompt: { id: 'p1', type: 'secret', message: 'API key' },
        };
      }
      if (action === 'answer') {
        status.flow = null;
        status.providers[0].connected = true;
      }
      return status;
    }
    if (channel === 'save-model-configuration') return { success: true };
    void payload;
    return null;
  });
  (window as any).electron = { ipcRenderer: { invoke } };
  return { invoke };
}

test('signs in to a Pi provider from the model card, then offers its models', async () => {
  const { invoke } = setup();
  const view = render(<LocalModelSettings />);
  const add = await screen.findByRole('button', { name: '+ Add a model' });
  // Wait for Pi status, so the new model starts on the Pi provider.
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'status', undefined),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.click(add);
  expect(screen.getByLabelText('Model provider')).toHaveValue('pi:test');
  expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enter API key' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'login', {
      provider: 'test',
      type: 'api_key',
    }),
  );
  fireEvent.change(await screen.findByLabelText('API key'), {
    target: { value: 'secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue login' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'answer', {
      id: 'p1',
      value: 'secret',
    }),
  );
  fireEvent.change(await screen.findByLabelText('Model'), {
    target: { value: 'pi/test/model' },
  });
  expect(screen.getByLabelText('Model display name')).toHaveValue('Test model');
  view.unmount();
  expect(invoke).toHaveBeenCalledWith('pi-provider', 'cancel', undefined);
});

test('a connected Pi provider can be refreshed and signed out', async () => {
  const { invoke } = setup(true);
  render(<LocalModelSettings />);
  const add = await screen.findByRole('button', { name: '+ Add a model' });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'status', undefined),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.click(add);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Refresh models' }),
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'refresh', {
      provider: 'test',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'logout', {
      provider: 'test',
    }),
  );
});
