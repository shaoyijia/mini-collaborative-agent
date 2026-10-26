import { S } from './styles';
import type { ServiceHealthView } from './types';

interface Props {
  cocoSleeping: boolean;
  serviceHealth: ServiceHealthView | null;
  healthLoading: boolean;
  refreshServiceHealth: (forceModelTest?: boolean) => Promise<void>;
  healthError: string;
}

export default function HealthSettings({
  cocoSleeping,
  serviceHealth,
  healthLoading,
  refreshServiceHealth,
  healthError,
}: Props) {
  const health = serviceHealth?.tutor;
  const serviceStatusLabel = health
    ? `${health.connected ? 'Connected' : 'Not connected'} (service)`
    : `${healthLoading ? 'Checking…' : 'Not checked'} (service)`;
  const modelAssessment = health?.modelAssessment;
  const modelStatusLabel = modelAssessment
    ? modelAssessment.status === 'verified'
      ? 'Connected (model)'
      : modelAssessment.status === 'failed'
        ? 'Not connected (model)'
        : modelAssessment.status === 'not_configured'
          ? 'Not configured (model)'
          : 'Not assessed (model)'
    : `${healthLoading ? 'Checking…' : 'Not checked'} (model)`;
  const modelDetail = modelAssessment?.detail
    ?.replace(/^Connected\s*[—-]\s*/i, '')
    .replace(/^Connected\.?$/i, '');
  const details = [
    serviceStatusLabel,
    health?.detail,
    `${modelStatusLabel}${modelDetail ? ` — ${modelDetail}` : ''}`,
  ].filter(Boolean);
  const hasHealthIssue = Boolean(
    health && (!health.connected || modelAssessment?.status === 'failed'),
  );
  const isFullyConnected = Boolean(
    health?.connected && modelAssessment?.status === 'verified',
  );

  return (
    <section
      className="workspace-settings-section"
      aria-labelledby="health-heading"
    >
      <h2 id="health-heading" className="settings-heading">
        Coco Health
      </h2>
      <div style={S.helpText}>
        {cocoSleeping
          ? 'Coco is asleep. Voice activation is paused. Chats and agent runs remain available.'
          : 'Checks the agent service and model with a short test request.'}
      </div>
      {!cocoSleeping && (
        <div style={S.healthList}>
          <div
            style={S.healthRow}
            aria-label={`Tutor agent: ${serviceStatusLabel}; ${modelStatusLabel}`}
          >
            <span
              style={{
                ...S.healthDot,
                background: health
                  ? hasHealthIssue
                    ? '#ef4444'
                    : isFullyConnected
                      ? '#22c55e'
                      : '#f59e0b'
                  : 'var(--coco-color-border)',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={S.healthName}>Tutor agent</div>
              <div
                style={{
                  ...S.healthDetail,
                  color: hasHealthIssue
                    ? '#dc2626'
                    : isFullyConnected
                      ? 'var(--coco-color-success)'
                      : health
                        ? '#b45309'
                        : undefined,
                }}
              >
                {details.join(' · ')}
              </div>
            </div>
          </div>
        </div>
      )}
      {!cocoSleeping && (
        <div style={S.healthActions}>
          <button
            type="button"
            style={{ ...S.addBtn, ...(healthLoading ? S.sendBtnDisabled : {}) }}
            disabled={healthLoading}
            onClick={() => void refreshServiceHealth(true)}
          >
            {healthLoading ? 'Checking…' : 'Check again'}
          </button>
          {serviceHealth && !healthLoading && (
            <span style={S.healthDetail}>
              Checked {new Date(serviceHealth.checkedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
      {!cocoSleeping && healthError && (
        <div
          style={{
            color: 'var(--coco-color-danger)',
            fontSize: 'var(--coco-text-secondary)',
            marginBottom: 12,
          }}
        >
          Health check failed: {healthError}
        </div>
      )}
    </section>
  );
}
