/**
 * Shared types for the chat transcript, the agent's tool calls, and the pet.
 *
 * Lives in its own module so the main process, the chat window, and the
 * avatar all stay in sync without import cycles.
 */

export interface LLMCallMetrics {
  call_id?: string;
  operation?: string | null;
  model?: string;
  provider?: string;
  modality?: 'llm' | 'vlm';
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  duration_ms?: number;
  started_at?: number;
  ended_at?: number;
  success?: boolean;
  error?: string | null;
}

/** One question in an `ask_user_question` card (the "send user message" primitive). */
export interface AgentQuestion {
  header: string;
  question: string;
  multiSelect?: boolean;
  options: { label: string; description: string; preview?: string }[];
}

export interface TutorToolCall {
  id: string;
  name: string;
  arguments: {
    [key: string]: unknown;
    query?: string;
  };
  status: 'running' | 'completed' | 'error';
  result?: {
    waitingForAnswer?: boolean;
    questions?: AgentQuestion[];
    cancelled?: boolean;
    answers?: {
      questionIndex: number;
      answer: string | null;
      selected?: string[];
    }[];
    output?: string;
    count?: number;
    llm_metrics?: LLMCallMetrics | null;
    error?: string;
  };
}

export type PetMood = 'idle' | 'write' | 'wait' | 'tool' | 'sleep';
