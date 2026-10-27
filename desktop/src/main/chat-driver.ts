/**
 * The local driver (COCO_DRIVER=1): lets a script such as a user simulator act
 * in the chat as the user would. See services/driver-server.ts for the HTTP
 * side. Messages go to the chat window, which sends them exactly as if they
 * were typed, so the conversation and its saved transcript are the same.
 */
import path from 'path';
import { app, ipcMain, type BrowserWindow } from 'electron';
import log from 'electron-log';
import type AgentRuns from './services/agent-runs';
import { DriverError, startDriverServer } from './services/driver-server';

type SendResult = { ok?: boolean; retry?: boolean; error?: string };

/** What the driver needs from the chat in main.ts. */
export interface ChatDriverDeps {
  agentRuns: AgentRuns;
  getChatWindow: () => BrowserWindow | null;
  /** Start a new, empty conversation, show it, and return its id. */
  createChatSession: () => Promise<string>;
  /** Show a saved conversation in the chat; false if it doesn't exist. */
  showConversation: (sessionId: string) => boolean;
}

// Messages handed to the chat window, waiting for it to accept them.
const pending = new Map<number, (result: SendResult) => void>();
let sequence = 0;

export async function startChatDriver(deps: ChatDriverDeps) {
  const { agentRuns, getChatWindow } = deps;

  ipcMain.on('driver-send-message-result', (event, result: unknown) => {
    if (event.sender !== getChatWindow()?.webContents) return;
    const value = (result ?? {}) as SendResult & { id?: unknown };
    if (typeof value.id !== 'number') return;
    pending.get(value.id)?.(value);
    pending.delete(value.id);
  });

  // Ask the chat window to send `text` in `sessionId`; resolves once it has
  // (or asks to retry, e.g. while it is still switching conversations).
  const askChatToSend = (sessionId: string, text: string) => {
    sequence += 1;
    const id = sequence;
    return new Promise<SendResult>((resolve) => {
      pending.set(id, resolve);
      getChatWindow()?.webContents.send('driver-send-message', {
        id,
        sessionId,
        text,
      });
      setTimeout(() => {
        if (pending.delete(id))
          resolve({ retry: true, error: 'The chat window did not respond.' });
      }, 1000);
    });
  };

  const sendMessage = async (sessionId: string, text: string) => {
    if (agentRuns.has(sessionId))
      throw new DriverError(
        409,
        'Coco is still replying in this conversation.',
      );
    if (!deps.showConversation(sessionId))
      throw new DriverError(404, 'Conversation not found.');
    // A chat window that is still loading has not received the session yet.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (getChatWindow()) {
        const result = await askChatToSend(sessionId, text);
        if (result.ok) return;
        if (!result.retry)
          throw new DriverError(409, result.error || 'Could not send.');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new DriverError(503, 'The chat window is not ready.');
  };

  const answerQuestions = (
    sessionId: string,
    toolCallId: string,
    answers: string[] | null,
  ) => {
    const request = [...agentRuns.requests].find(
      ([, item]) => item.sessionId === sessionId && !item.stopped,
    );
    if (!request)
      throw new DriverError(
        409,
        'This conversation is not waiting for answers.',
      );
    try {
      // The same shape a question card submits: free-text answers, or a skip.
      agentRuns.answer(
        request[0],
        toolCallId,
        answers
          ? {
              answers: answers.map((text) => ({ selected: [], text })),
              cancelled: false,
            }
          : { answers: [], cancelled: true },
      );
    } catch (error) {
      throw new DriverError(409, (error as Error).message);
    }
  };

  const infoPath = path.join(app.getPath('userData'), 'driver.json');
  const driver = await startDriverServer(
    {
      startSession: async (opener) => {
        const sessionId = await deps.createChatSession();
        await sendMessage(sessionId, opener);
        return sessionId;
      },
      sendMessage,
      answerQuestions,
    },
    infoPath,
  );
  app.once('will-quit', driver.close);
  log.warn(
    `[Driver] Local driver listening on 127.0.0.1:${driver.port}; token in ${infoPath}`,
  );
}
