import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocalModelSettings from '../renderer/components/chat/LocalModelSettings';

it('saves connected Pi chat models through the shared configuration', async () => {
  const invoke = jest.fn(async (channel, action) => {
    if (channel === 'pi-provider')
      return {
        connection: { mode: 'coco' },
        flow: null,
        providers: [{ id: 'test', name: 'Test', connected: true }],
        models: [
          {
            provider: 'test',
            id: 'vision',
            name: 'Vision',
            input: ['text', 'image'],
          },
          { provider: 'test', id: 'text', name: 'Text only', input: ['text'] },
        ],
      };
    if (channel === 'get-model-configuration')
      return {
        tutors: [
          {
            id: 'chat',
            label: 'Chat',
            provider: 'pi',
            model: 'pi/test/vision',
          },
          { id: 'fast', label: 'Fast', provider: 'pi', model: 'pi/test/text' },
        ],
        defaultTutorId: 'chat',
      };
    if (channel === 'save-model-configuration')
      return { success: true, config: action };
    return null;
  });
  (window as any).electron = { ipcRenderer: { invoke } };
  const view = render(<LocalModelSettings />);
  await screen.findByDisplayValue('Fast');
  await waitFor(() =>
    expect(screen.getAllByLabelText('Model provider')[0]).toHaveValue(
      'pi:test',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  await screen.findByText('Saved');
  expect(invoke).toHaveBeenCalledWith('save-model-configuration', {
    tutors: [
      expect.objectContaining({ id: 'chat', model: 'pi/test/vision' }),
      expect.objectContaining({ id: 'fast', model: 'pi/test/text' }),
    ],
    defaultTutorId: 'chat',
    credentials: {},
  });
  view.unmount();
});

it('drops a sensing model left by an older configuration and offers no sensing settings', async () => {
  const connection = {
    id: 'chat',
    label: 'My chat',
    provider: 'pi',
    model: 'pi/test/text',
  };
  const invoke = jest.fn(async (channel) => {
    if (channel === 'get-model-configuration')
      return {
        sensing: { ...connection, id: 'sensing' },
        tutors: [connection],
        defaultTutorId: 'chat',
      };
    if (channel === 'pi-provider')
      return {
        connection: { mode: 'coco' },
        providers: [],
        models: [],
        flow: null,
      };
    if (channel === 'save-model-configuration') return { success: true };
    return null;
  });
  (window as any).electron = { ipcRenderer: { invoke } };
  const view = render(<LocalModelSettings />);
  await screen.findByDisplayValue('My chat');
  expect(screen.queryByText(/sensing/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  await screen.findByText('Saved');
  const saved = invoke.mock.calls.find(
    ([channel]) => channel === 'save-model-configuration',
  ) as unknown as [string, any];
  expect(saved[1]).toEqual({
    tutors: [expect.objectContaining(connection)],
    defaultTutorId: 'chat',
    credentials: {},
  });
  view.unmount();
});

it('offers Pi and direct providers in one dropdown and saves both', async () => {
  const invoke = jest.fn(async (channel) => {
    if (channel === 'pi-provider')
      return {
        connection: { mode: 'coco' },
        flow: null,
        providers: [{ id: 'test', name: 'Test', connected: true }],
        models: [
          { provider: 'test', id: 'chat', name: 'Pi chat', input: ['text'] },
        ],
      };
    if (channel === 'save-model-configuration') return { success: true };
    return null;
  });
  (window as any).electron = { ipcRenderer: { invoke } };
  const view = render(<LocalModelSettings />);
  const add = await screen.findByRole('button', { name: '+ Add a model' });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('pi-provider', 'status', undefined),
  );
  fireEvent.click(add);
  const [piCard] = screen.getAllByLabelText('Model provider');
  expect(
    [...(piCard as HTMLSelectElement).options].map((option) => option.value),
  ).toEqual(['tinker', 'tinfoil', 'hosted_vllm', 'lm_studio', 'pi:test']);
  fireEvent.change(await screen.findByLabelText('Model'), {
    target: { value: 'pi/test/chat' },
  });

  fireEvent.click(add);
  const direct = screen.getAllByLabelText('Model provider')[1];
  fireEvent.change(direct, { target: { value: 'lm_studio' } });
  fireEvent.change(screen.getAllByLabelText('Model display name')[1], {
    target: { value: 'Local chat' },
  });
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: 'lm_studio/local' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  await screen.findByText('Saved');
  const saved = invoke.mock.calls.find(
    ([channel]) => channel === 'save-model-configuration',
  ) as unknown as [string, any];
  expect(saved[1]).not.toHaveProperty('sensing');
  expect(saved[1]).toMatchObject({
    tutors: [
      { provider: 'pi', model: 'pi/test/chat', label: 'Pi chat' },
      { provider: 'lm_studio', model: 'lm_studio/local' },
    ],
  });
  expect(saved[1].tutors[0]).not.toHaveProperty('piProvider');
  expect(saved[1].defaultTutorId).toBe(saved[1].tutors[0].id);
  // Removing the default makes the remaining model the default.
  fireEvent.click(screen.getByRole('button', { name: 'Remove Pi chat' }));
  expect(
    screen.getByRole('radio', { name: 'Default for new chats' }),
  ).toBeChecked();
  view.unmount();
});

it('keeps an existing direct provider editable without offering it on new connections', async () => {
  const legacy = {
    id: 'legacy',
    label: 'Existing OpenAI',
    provider: 'openai',
    model: 'openai/existing',
  };
  const invoke = jest.fn(async (channel) => {
    if (channel === 'get-model-configuration')
      return { tutors: [legacy], defaultTutorId: 'legacy' };
    if (channel === 'pi-provider')
      return {
        connection: { mode: 'coco' },
        flow: null,
        providers: [],
        models: [],
      };
    if (channel === 'save-model-configuration') return { success: true };
    return null;
  });
  (window as any).electron = { ipcRenderer: { invoke } };
  const view = render(<LocalModelSettings />);
  await screen.findByDisplayValue('Existing OpenAI');
  expect(
    screen.getByRole('option', { name: 'OpenAI (existing connection)' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
  await screen.findByText('Saved');
  expect(invoke).toHaveBeenCalledWith(
    'save-model-configuration',
    expect.objectContaining({ tutors: [expect.objectContaining(legacy)] }),
  );
  view.unmount();
});
