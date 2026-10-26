import type { LLMCallMetrics, TutorToolCall } from '../agent-types';
import type { AgentActivity } from '../../../shared/agent-execution';

export interface Guidance {
  text: string;
  /** Display separately while retaining combined text for copy/export. */
  mainText?: string;
  coaching?: string;
  competency?: 'delegation' | 'description' | 'discernment' | 'diligence';
  examplePrompt?: string | null;
  vizCode?: string | null;
}
export interface WakeWordSettingsInfo {
  enabled: boolean;
  keywords: string[];
  status: 'disabled' | 'starting' | 'ready' | 'sleeping' | 'error';
  detail?: string;
  logPath?: string;
}
export interface ChatMessage {
  activity?: AgentActivity[];
  stopped?: boolean;
  role: 'user' | 'tutor';
  text: string;
  images?: string[];
  isError?: boolean;
  /** Stable id for tutor messages. */
  id?: string;
  /** When the message was appended. */
  ts?: number;
  tutorMetrics?: LLMCallMetrics | null;
  toolCalls?: TutorToolCall[];
  /** Correlates incremental main-process events with this pending reply. */
  requestId?: string;
  isStreaming?: boolean;
  /** Exact request payload retained so an error can be retried in place. */
  retryText?: string;
  retryImages?: string[];
  retryRequestKind?: 'chat';
}

export interface SavedConversation {
  sessionId: string;
  title?: string;
  problem: string;
  createdAt: number;
  updatedAt: number;
  tutorModelId?: string;
  workingDirectory?: string;
  messages: ChatMessage[];
}

export interface TutorModelOption {
  id: string;
  label: string;
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface ServiceHealth {
  connected: boolean;
  status: string;
  detail?: string;
  modelAssessment?: {
    status: 'verified' | 'failed' | 'legacy_unassessed' | 'not_configured';
    detail: string;
  };
}

export interface ServiceHealthView {
  checkedAt: number;
  tutor: ServiceHealth;
}

export interface SleepingServiceHealthView {
  checkedAt: number;
  sleeping: true;
}

export interface ConnectionTestStatus {
  state: 'testing' | 'success' | 'error';
  message: string;
}
