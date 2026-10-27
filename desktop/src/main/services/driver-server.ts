import fs from 'fs';
import http from 'http';
import path from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * A loopback HTTP endpoint that lets a local script drive Coco's chat the way
 * a person would: start a conversation, send a message, or answer a question
 * card. It exists so user simulators (e.g. the CS329X Persimmon script) don't
 * need the person to copy and paste every turn.
 *
 * Off unless COCO_DRIVER=1. Every request needs the bearer token written to
 * `driver.json` (mode 0600) in the app's user-data folder, because whoever can
 * message the agent can ask it to run commands in its working folder.
 */
export interface DriverHandlers {
  /** Starts a new chat, sends `opener` as its first message, returns its id. */
  startSession(opener: string): Promise<string>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  /** `answers` is one free-text answer per question; null skips the card. */
  answerQuestions(
    sessionId: string,
    toolCallId: string,
    answers: string[] | null,
  ): void | Promise<void>;
}

export class DriverError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 1_000_000;

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new DriverError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error();
        resolve(value);
      } catch {
        reject(new DriverError(400, 'Send a JSON object.'));
      }
    });
    req.on('error', reject);
  });
}

const nonEmptyString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new DriverError(400, `\`${name}\` must be a non-empty string.`);
  return value;
};

export async function startDriverServer(
  handlers: DriverHandlers,
  infoPath: string,
): Promise<{ port: number; close: () => void }> {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);

  const route = async (req: http.IncomingMessage) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new DriverError(401, 'Invalid driver token.');
    if (req.method !== 'POST') throw new DriverError(405, 'Use POST.');
    const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
    const body = await readJson(req);
    if (parts.length === 1 && parts[0] === 'sessions') {
      const sessionId = await handlers.startSession(
        nonEmptyString(body.opener, 'opener'),
      );
      return { sessionId };
    }
    if (parts.length === 3 && parts[0] === 'sessions') {
      const sessionId = decodeURIComponent(parts[1]);
      if (parts[2] === 'messages') {
        await handlers.sendMessage(
          sessionId,
          nonEmptyString(body.text, 'text'),
        );
        return { success: true };
      }
      if (parts[2] === 'answers') {
        const { answers } = body;
        if (
          answers !== null &&
          !(
            Array.isArray(answers) &&
            answers.length > 0 &&
            answers.every((a) => typeof a === 'string' && a.trim())
          )
        )
          throw new DriverError(
            400,
            '`answers` must be a list of non-empty strings, or null to skip.',
          );
        await handlers.answerQuestions(
          sessionId,
          nonEmptyString(body.toolCallId, 'toolCallId'),
          answers as string[] | null,
        );
        return { success: true };
      }
    }
    throw new DriverError(404, 'Unknown driver route.');
  };

  const server = http.createServer((req, res) => {
    route(req)
      .then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        const status = error instanceof DriverError ? error.status : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (error as Error).message }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as { port: number };
  fs.mkdirSync(path.dirname(infoPath), { recursive: true });
  fs.writeFileSync(
    infoPath,
    `${JSON.stringify({ url: `http://127.0.0.1:${port}`, token }, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(infoPath, 0o600);
  return {
    port,
    close: () => {
      server.close();
      try {
        fs.unlinkSync(infoPath);
      } catch {
        /* already removed */
      }
    },
  };
}
