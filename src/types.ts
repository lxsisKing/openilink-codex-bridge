export interface RelayEnvelope<T = unknown> {
  type: string;
  req_id?: string;
  data: T;
}

export interface RelayMediaItem {
  url?: string;
  raw_url?: string;
  media_type?: string;
  play_time?: number;
  sample_rate?: number;
  bits_per_sample?: number;
  encode_type?: number;
}

export interface RelayMessageItem {
  type: string;
  text?: string;
  fileName?: string;
  media?: RelayMediaItem;
}

export interface RelayInboundMessage {
  seq_id?: number;
  sender?: string;
  timestamp?: number;
  items?: RelayMessageItem[];
  context_token?: string;
  session_id?: string;
}

export interface RelaySendTextData {
  recipient: string;
  text: string;
}

export interface BridgeSessionRecord {
  key: string;
  agentName: string;
  agentMode: 'codex' | 'review' | 'chat';
  senderId: string;
  transport: 'codex-exec-resume';
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  messageCount: number;
  lastMessagePreview?: string;
  lastError?: string | null;
  codex?: {
    threadId?: string;
  };
}

export interface CodexRunResult {
  reply: string;
  sessionId?: string;
}

export type AgentCommand = 'status' | 'reset';

export interface AgentRunResult {
  reply: string;
  commandHandled?: AgentCommand;
  session?: BridgeSessionRecord | null;
  sessionReused?: boolean;
}
