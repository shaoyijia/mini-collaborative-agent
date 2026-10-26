import './Settings.css';
import { useCallback, useEffect, useState } from 'react';

const invoke = (action: string, payload?: unknown) =>
  window.electron.ipcRenderer.invoke('pi-provider', action, payload);

export interface PiProvider {
  id: string;
  name: string;
  oauth?: string;
  apiKey?: boolean;
  connected?: boolean;
}

export interface PiModel {
  provider: string;
  id: string;
  name: string;
  input?: string[];
}

export interface PiStatus {
  providers: PiProvider[];
  models: PiModel[];
  flow?: {
    busy?: boolean;
    message?: string;
    prompt?: {
      id: string;
      type: string;
      message: string;
      placeholder?: string;
      options?: { id: string; label: string }[];
    };
  } | null;
}

/**
 * Polls the Pi providers that the user can sign in to, and runs login,
 * logout and refresh actions. One instance per window: Pi allows a single
 * login flow at a time, and unmounting cancels it.
 */
export function usePiStatus() {
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  // The provider whose login flow is in progress, so only its card shows it.
  const [loginProvider, setLoginProvider] = useState('');

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await invoke('status');
        if (!Array.isArray(next?.providers))
          throw new Error('Provider status unavailable.');
        if (mounted) setStatus(next);
      } catch {
        if (mounted) setError('Could not load Pi providers.');
      }
      if (mounted) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => {
      mounted = false;
      clearTimeout(timer);
      void invoke('cancel').catch(() => {});
    };
  }, []);

  const act = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      setError('');
      setPending(true);
      if (action === 'login') setLoginProvider(String(payload?.provider ?? ''));
      try {
        await invoke(action, payload);
        setStatus(await invoke('status'));
      } catch (err) {
        setError(String(err));
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { status, error, pending, loginProvider, act };
}

export type PiStatusState = ReturnType<typeof usePiStatus>;

/** Sign-in controls for one Pi provider, shown inside its model card. */
export default function PiProviderLogin({
  provider,
  pi,
}: {
  provider: string;
  pi: PiStatusState;
}) {
  const [answer, setAnswer] = useState('');
  const { status, pending, act } = pi;
  const prompt =
    pi.loginProvider === provider ? status?.flow?.prompt : undefined;
  useEffect(() => {
    setAnswer('');
  }, [prompt?.id]);
  if (!status)
    return <p role="status">{pi.error || 'Loading Pi providers…'}</p>;
  const selected = status.providers.find((p) => p.id === provider);
  if (!selected) return null;
  const busy = pending || Boolean(status.flow?.busy);
  const showFlow = pi.loginProvider === provider && status.flow;

  return (
    <div className="pi-provider-settings">
      {!selected.connected && (
        <p>
          Sign in to {selected.name} through Pi
          {selected.oauth && selected.apiKey ? ' or enter an API key' : ''}.
        </p>
      )}
      <div className="coco-actions">
        {!selected.connected && selected.oauth && (
          <button
            className="coco-button"
            type="button"
            disabled={busy}
            onClick={() => act('login', { provider, type: 'oauth' })}
          >
            {selected.oauth}
          </button>
        )}
        {!selected.connected && selected.apiKey && (
          <button
            className="coco-button"
            type="button"
            disabled={busy}
            onClick={() => act('login', { provider, type: 'api_key' })}
          >
            Enter API key
          </button>
        )}
        {selected.connected && (
          <>
            <button
              className="coco-button pi-provider-refresh"
              type="button"
              disabled={busy}
              onClick={() => act('refresh', { provider })}
            >
              Refresh models
            </button>
            <button
              className="coco-button"
              type="button"
              disabled={busy}
              onClick={() => act('logout', { provider })}
            >
              Sign out
            </button>
          </>
        )}
      </div>
      {showFlow && status.flow?.message && (
        <p role="status">{status.flow.message}</p>
      )}
      {prompt && (
        <label className="coco-field">
          {prompt.message}
          {prompt.type === 'select' ? (
            <span className="coco-select-wrap">
              <select
                className="coco-select"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              >
                <option value="">Choose…</option>
                {prompt.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <input
              className="ob-custom-input"
              type={
                prompt.type === 'secret' || prompt.type === 'manual_code'
                  ? 'password'
                  : 'text'
              }
              autoComplete="off"
              value={answer}
              placeholder={prompt.placeholder}
              onChange={(e) => setAnswer(e.target.value)}
            />
          )}
        </label>
      )}
      {(prompt || (showFlow && status.flow?.busy)) && (
        <div className="coco-actions pi-provider-footer">
          {prompt && (
            <button
              className="coco-button coco-button--primary"
              type="button"
              disabled={pending || !answer}
              onClick={() => {
                void act('answer', { id: prompt.id, value: answer });
                setAnswer('');
              }}
            >
              Continue login
            </button>
          )}
          {status.flow?.busy && (
            <button
              className="coco-button"
              type="button"
              onClick={() => act('cancel')}
            >
              Cancel login
            </button>
          )}
        </div>
      )}
      {pi.error && <p role="alert">{pi.error}</p>}
    </div>
  );
}
