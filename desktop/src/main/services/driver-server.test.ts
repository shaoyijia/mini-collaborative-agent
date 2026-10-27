/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DriverError, startDriverServer } from './driver-server';

const setup = async () => {
  const handlers = {
    startSession: jest.fn(async () => 'session-1'),
    sendMessage: jest.fn(async () => {}),
    answerQuestions: jest.fn(),
  };
  const infoPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'coco-driver-')),
    'driver.json',
  );
  const server = await startDriverServer(handlers, infoPath);
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const post = async (route: string, body: unknown, token = info.token) => {
    const response = await fetch(`${info.url}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { handlers, infoPath, info, server, post };
};

it('writes an owner-only info file and removes it on close', async () => {
  const { infoPath, info, server } = await setup();
  expect(info.url).toBe(`http://127.0.0.1:${server.port}`);
  expect(fs.statSync(infoPath).mode & 0o777).toBe(0o600);
  server.close();
  expect(fs.existsSync(infoPath)).toBe(false);
});

it('rejects requests without the token', async () => {
  const { handlers, server, post } = await setup();
  expect((await post('/sessions', { opener: 'hi' }, 'wrong')).status).toBe(401);
  expect(handlers.startSession).not.toHaveBeenCalled();
  server.close();
});

it('starts sessions, sends messages, and answers or skips question cards', async () => {
  const { handlers, server, post } = await setup();
  expect(await post('/sessions', { opener: 'Plan my trip' })).toEqual({
    status: 200,
    body: { sessionId: 'session-1' },
  });
  expect(handlers.startSession).toHaveBeenCalledWith('Plan my trip');

  await post('/sessions/session-1/messages', { text: 'Under $500' });
  expect(handlers.sendMessage).toHaveBeenCalledWith('session-1', 'Under $500');

  await post('/sessions/session-1/answers', {
    toolCallId: 'call-1',
    answers: ['May', 'Two people'],
  });
  await post('/sessions/session-1/answers', {
    toolCallId: 'call-2',
    answers: null,
  });
  expect(handlers.answerQuestions.mock.calls).toEqual([
    ['session-1', 'call-1', ['May', 'Two people']],
    ['session-1', 'call-2', null],
  ]);
  server.close();
});

it('validates input and reports handler errors with their status', async () => {
  const { handlers, server, post } = await setup();
  expect((await post('/sessions', { opener: ' ' })).status).toBe(400);
  expect(
    (
      await post('/sessions/s/answers', {
        toolCallId: 'call-1',
        answers: [],
      })
    ).status,
  ).toBe(400);
  expect((await post('/nope', {})).status).toBe(404);
  handlers.sendMessage.mockRejectedValueOnce(
    new DriverError(409, 'Coco is still replying.'),
  );
  expect(await post('/sessions/s/messages', { text: 'hi' })).toEqual({
    status: 409,
    body: { error: 'Coco is still replying.' },
  });
  server.close();
});
