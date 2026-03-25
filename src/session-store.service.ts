import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { loadConfig } from './config';
import { BridgeSessionRecord } from './types';

interface UpsertSessionInput {
  agentName: string;
  agentMode: 'codex' | 'review' | 'chat';
  senderId: string;
  transport: 'codex-exec-resume';
  threadId?: string;
  lastMessagePreview?: string;
  lastError?: string | null;
  incrementMessageCount?: boolean;
}

@Injectable()
export class SessionStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionStoreService.name);
  private readonly config = loadConfig();
  private readonly sessions = new Map<string, BridgeSessionRecord>();
  private cleanupTimer?: NodeJS.Timeout;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      const removed = this.cleanupExpiredSessions();
      if (removed > 0) {
        this.logger.log(`cleaned up ${removed} expired session(s)`);
      }
    }, this.config.sessionCleanupIntervalMs);

    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  get(agentName: string, senderId: string): BridgeSessionRecord | null {
    const key = this.buildKey(agentName, senderId);
    const record = this.sessions.get(key);

    if (!record) {
      return null;
    }

    if (record.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }

    return { ...record, codex: record.codex ? { ...record.codex } : undefined };
  }

  upsert(input: UpsertSessionInput): BridgeSessionRecord {
    const now = Date.now();
    const key = this.buildKey(input.agentName, input.senderId);
    const current = this.get(input.agentName, input.senderId);

    const next: BridgeSessionRecord = {
      key,
      agentName: input.agentName,
      agentMode: input.agentMode,
      senderId: input.senderId,
      transport: input.transport,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      messageCount:
        (current?.messageCount ?? 0) +
        (input.incrementMessageCount === false ? 0 : 1),
      lastMessagePreview:
        input.lastMessagePreview ?? current?.lastMessagePreview,
      lastError: input.lastError ?? null,
      codex: {
        threadId: input.threadId ?? current?.codex?.threadId,
      },
    };

    this.sessions.set(key, next);
    return { ...next, codex: next.codex ? { ...next.codex } : undefined };
  }

  delete(agentName: string, senderId: string): BridgeSessionRecord | null {
    const key = this.buildKey(agentName, senderId);
    const current = this.get(agentName, senderId);

    if (!current) {
      return null;
    }

    this.sessions.delete(key);
    return current;
  }

  cleanupExpiredSessions(now = Date.now()): number {
    let removed = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  private buildKey(agentName: string, senderId: string): string {
    return `${agentName}:${senderId}`;
  }
}
