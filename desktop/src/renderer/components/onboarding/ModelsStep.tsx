import PiProviderLogin, {
  usePiStatus,
  type PiStatusState,
} from '../chat/PiProviderLogin';

// Providers Coco connects to directly. Everything else (OpenAI, Anthropic,
// Google, …) is offered through Pi, which handles sign-in.
const DIRECT_PROVIDERS = [
  ['tinker', 'Tinker'],
  ['tinfoil', 'Tinfoil (confidential)'],
  ['hosted_vllm', 'OpenAI-compatible endpoint'],
  ['lm_studio', 'LM Studio (local)'],
] as const;
const ENDPOINT_PROVIDERS = new Set(['hosted_vllm', 'lm_studio']);
const LEGACY_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  open_anonymity: 'Open Anonymity',
};
// Pi providers are encoded in the provider dropdown as `pi:<provider id>`.
const PI_PREFIX = 'pi:';

export interface ModelDraft {
  id: string;
  label: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  /** For `provider: 'pi'`: the Pi provider chosen before a model is picked. */
  piProvider?: string;
}

export interface ConnectionTestStatus {
  state: 'testing' | 'success' | 'error';
  message: string;
}

/** The Pi provider of a Pi model draft (`pi/<provider>/<model>`). */
const piProviderOf = (draft: ModelDraft) =>
  draft.piProvider || draft.model.split('/')[1] || '';

function ModelFields({
  value,
  onChange,
  onTest,
  testStatus,
  pi,
}: {
  value: ModelDraft;
  onChange: (next: ModelDraft) => void;
  onTest: () => void;
  testStatus: ConnectionTestStatus | undefined;
  pi: PiStatusState;
}) {
  const isPi = value.provider === 'pi';
  const piProvider = isPi ? piProviderOf(value) : '';
  const piProviders = pi.status?.providers ?? [];
  const connected = piProviders.find((p) => p.id === piProvider)?.connected;
  const piModels = (pi.status?.models ?? []).filter(
    (m) => m.provider === piProvider,
  );
  const legacyProvider =
    !isPi && !DIRECT_PROVIDERS.some(([id]) => id === value.provider);
  const update = (field: keyof ModelDraft, next: string) =>
    onChange({ ...value, [field]: next });
  const selectProvider = (next: string) =>
    onChange({
      ...value,
      ...(next.startsWith(PI_PREFIX)
        ? { provider: 'pi', piProvider: next.slice(PI_PREFIX.length) }
        : { provider: next, piProvider: undefined }),
      model: '',
      apiKey: '',
      baseUrl: '',
    });
  const modelPlaceholder =
    value.provider === 'hosted_vllm'
      ? 'Exact model ID returned by /v1/models'
      : 'Model ID (provider/model)';

  return (
    <div className="ob-model-card">
      <div className="ob-model-card-title">{value.label || 'New model'}</div>
      <input
        className="ob-custom-input"
        value={value.label}
        aria-label="Model display name"
        placeholder="Display name"
        onChange={(event) => update('label', event.target.value)}
      />
      <select
        className="ob-custom-input"
        aria-label="Model provider"
        value={isPi ? `${PI_PREFIX}${piProvider}` : value.provider}
        onChange={(event) => selectProvider(event.target.value)}
      >
        {isPi && !piProviders.some((p) => p.id === piProvider) && (
          <option value={`${PI_PREFIX}${piProvider}`}>
            {piProvider || 'Choose a provider…'}
          </option>
        )}
        {legacyProvider && (
          <option value={value.provider}>
            {LEGACY_PROVIDER_LABELS[value.provider] || value.provider} (existing
            connection)
          </option>
        )}
        <optgroup label="Direct connection">
          {DIRECT_PROVIDERS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </optgroup>
        {piProviders.length > 0 && (
          <optgroup label="Through Pi (sign in or API key)">
            {piProviders.map((p) => (
              <option key={p.id} value={`${PI_PREFIX}${p.id}`}>
                {p.name}
                {p.connected ? ' — connected' : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {isPi && <PiProviderLogin provider={piProvider} pi={pi} />}
      {isPi && connected && (
        <select
          className="ob-custom-input"
          aria-label="Model"
          value={value.model}
          onChange={(event) => {
            const selected = piModels.find(
              (m) => `pi/${m.provider}/${m.id}` === event.target.value,
            );
            onChange({
              ...value,
              model: event.target.value,
              label: value.label || selected?.name || '',
            });
          }}
        >
          <option value="">Choose a model…</option>
          {value.model &&
            !piModels.some(
              (m) => `pi/${m.provider}/${m.id}` === value.model,
            ) && (
              <option value={value.model}>{value.model} (unavailable)</option>
            )}
          {piModels.map((m) => (
            <option key={m.id} value={`pi/${m.provider}/${m.id}`}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      {!isPi && (
        <input
          className="ob-custom-input"
          value={value.model}
          aria-label="Model ID"
          placeholder={modelPlaceholder}
          onChange={(event) => update('model', event.target.value)}
        />
      )}
      {ENDPOINT_PROVIDERS.has(value.provider) && (
        <input
          className="ob-custom-input"
          value={value.baseUrl}
          placeholder={
            value.provider === 'lm_studio'
              ? 'Host (default localhost:1234)'
              : 'OpenAI-compatible base URL, ending in /v1'
          }
          onChange={(event) => update('baseUrl', event.target.value)}
        />
      )}
      {!isPi && value.provider !== 'lm_studio' && (
        <input
          className="ob-custom-input"
          type="password"
          value={value.apiKey}
          placeholder={
            value.provider === 'hosted_vllm' ? 'API key (optional)' : 'API key'
          }
          autoComplete="off"
          onChange={(event) => update('apiKey', event.target.value)}
        />
      )}
      {(!isPi || connected) && (
        <div className="ob-connection-test-row">
          <button
            type="button"
            className="ob-connection-test-btn"
            disabled={testStatus?.state === 'testing'}
            onClick={onTest}
          >
            {testStatus?.state === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
          {testStatus?.state === 'success' && (
            <span className="ob-connection-test-success">
              {testStatus.message}
            </span>
          )}
          {testStatus?.state === 'error' && (
            <details className="ob-connection-test-error">
              <summary>Connection failed — show details</summary>
              <pre>{testStatus.message}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function ModelsStep({
  tutors,
  setTutors,
  defaultTutorId,
  setDefaultTutorId,
  error,
  testStatuses,
  onTest,
}: {
  tutors: ModelDraft[];
  setTutors: (next: ModelDraft[]) => void;
  defaultTutorId: string;
  setDefaultTutorId: (id: string) => void;
  error: string;
  testStatuses: Record<string, ConnectionTestStatus>;
  onTest: (model: ModelDraft) => void;
}) {
  const pi = usePiStatus();
  const addModel = () => {
    // Start from a provider the user is already signed in to, if any.
    const providers = pi.status?.providers ?? [];
    const piProvider = (providers.find((p) => p.connected) ?? providers[0])?.id;
    const draft: ModelDraft = {
      id: `model-${Date.now()}`,
      label: '',
      provider: piProvider ? 'pi' : 'tinker',
      piProvider,
      model: '',
      apiKey: '',
      baseUrl: '',
    };
    setTutors([...tutors, draft]);
    if (!defaultTutorId) setDefaultTutorId(draft.id);
  };

  return (
    <section aria-labelledby="chat-models-heading">
      <h3 id="chat-models-heading" className="ob-model-section-title">
        Add available models to Coco
      </h3>
      <p className="ob-sub">
        Pick a provider for each model. Models you add show up in the chat.
      </p>
      {tutors.map((tutor) => (
        <div key={tutor.id} className="ob-model-wrap">
          <ModelFields
            pi={pi}
            value={tutor}
            onChange={(next) =>
              setTutors(
                tutors.map((item) => (item.id === tutor.id ? next : item)),
              )
            }
            onTest={() => onTest(tutor)}
            testStatus={testStatuses[tutor.id]}
          />
          <div className="ob-model-actions">
            <label htmlFor={`default-${tutor.id}`}>
              <input
                id={`default-${tutor.id}`}
                type="radio"
                name="default-chat-model"
                checked={defaultTutorId === tutor.id}
                onChange={() => setDefaultTutorId(tutor.id)}
              />{' '}
              Default for new chats
            </label>
            <button
              type="button"
              className="ob-model-remove"
              aria-label={`Remove ${tutor.label || 'model'}`}
              onClick={() => {
                const next = tutors.filter((item) => item.id !== tutor.id);
                setTutors(next);
                if (defaultTutorId === tutor.id)
                  setDefaultTutorId(next[0]?.id || '');
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="ob-model-add" onClick={addModel}>
        + Add a model
      </button>
      {error && <div className="ob-model-error">{error}</div>}
    </section>
  );
}
