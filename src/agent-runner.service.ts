import { Injectable, Logger } from '@nestjs/common';
import type { AgentConfig } from './config';
import { loadConfig } from './config';
import { CodexService } from './codex.service';
import { SessionStoreService } from './session-store.service';
import { AgentCommand, AgentRunResult, BridgeSessionRecord } from './types';

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);
  private readonly config = loadConfig();

  constructor(
    private readonly codexService: CodexService,
    private readonly sessionStore: SessionStoreService,
  ) {}

  async run(
    agent: AgentConfig,
    sender: string,
    text: string,
  ): Promise<AgentRunResult> {
    const command = this.parseCommand(text);
    if (command) {
      return this.handleCommand(agent, sender, command);
    }

    return this.runPersistentAgent(agent, sender, text);
  }

  private async runPersistentAgent(
    agent: AgentConfig,
    sender: string,
    text: string,
  ): Promise<AgentRunResult> {
    const session = this.sessionStore.get(agent.name, sender);
    const existingThreadId = session?.codex?.threadId;
    const prompt = existingThreadId
      ? this.buildResumePrompt(agent, sender, text)
      : this.buildInitialPrompt(agent, sender, text);

    if (existingThreadId) {
      this.logger.log(
        `[${agent.name}] resuming session ${existingThreadId} for ${sender}`,
      );
    } else {
      this.logger.log(`[${agent.name}] starting new session for ${sender}`);
    }

    try {
      const result = existingThreadId
        ? await this.codexService.resume(agent, existingThreadId, prompt)
        : await this.codexService.exec(agent, prompt);

      const nextSession = this.sessionStore.upsert({
        agentName: agent.name,
        agentMode: agent.mode,
        senderId: sender,
        transport: 'codex-exec-resume',
        threadId: result.sessionId ?? existingThreadId,
        lastMessagePreview: this.buildPreview(text),
        lastError: null,
      });

      return {
        reply: result.reply,
        session: nextSession,
        sessionReused: Boolean(existingThreadId),
      };
    } catch (error) {
      this.sessionStore.upsert({
        agentName: agent.name,
        agentMode: agent.mode,
        senderId: sender,
        transport: 'codex-exec-resume',
        threadId: existingThreadId,
        lastMessagePreview: this.buildPreview(text),
        lastError: String(error),
        incrementMessageCount: false,
      });

      throw error;
    }
  }

  private handleCommand(
    agent: AgentConfig,
    sender: string,
    command: AgentCommand,
  ): AgentRunResult {
    if (command === 'reset') {
      return {
        reply: this.handleReset(agent, sender),
        commandHandled: command,
        session: null,
      };
    }

    const session = this.sessionStore.get(agent.name, sender);
    return {
      reply: this.buildStatus(agent, sender, session),
      commandHandled: command,
      session,
    };
  }

  private handleReset(agent: AgentConfig, sender: string): string {
    const deleted = this.sessionStore.delete(agent.name, sender);
    if (!deleted) {
      return [
        `agent: ${agent.name}`,
        `mode: ${agent.mode} (stateful)`,
        'session: none',
        '当前没有可重置的本地会话。',
      ].join('\n');
    }

    return [
      `agent: ${agent.name}`,
      `mode: ${agent.mode} (stateful)`,
      'session: cleared',
      deleted.codex?.threadId
        ? `previousThreadId: ${deleted.codex.threadId}`
        : 'previousThreadId: n/a',
      '下一条消息会创建新的会话。',
    ].join('\n');
  }

  private buildStatus(
    agent: AgentConfig,
    sender: string,
    session: BridgeSessionRecord | null,
  ): string {
    if (!session) {
      return [
        `agent: ${agent.name}`,
        `mode: ${agent.mode} (stateful)`,
        `sender: ${sender}`,
        'session: none',
        `ttlMs: ${this.config.sessionTtlMs}`,
        'send a normal message to create a new session',
      ].join('\n');
    }

    return [
      `agent: ${agent.name}`,
      `mode: ${agent.mode} (stateful)`,
      `sender: ${sender}`,
      'session: active',
      `sessionKey: ${session.key}`,
      `threadId: ${session.codex?.threadId || 'n/a'}`,
      `createdAt: ${new Date(session.createdAt).toISOString()}`,
      `updatedAt: ${new Date(session.updatedAt).toISOString()}`,
      `expiresAt: ${new Date(session.expiresAt).toISOString()}`,
      `messageCount: ${session.messageCount}`,
      `lastMessagePreview: ${session.lastMessagePreview || 'none'}`,
      `lastError: ${session.lastError || 'none'}`,
    ].join('\n');
  }

  private parseCommand(text: string): AgentCommand | null {
    const normalized = text.trim();
    if (normalized === '/status') {
      return 'status';
    }
    if (normalized === '/reset') {
      return 'reset';
    }
    return null;
  }

  private buildInitialPrompt(
    agent: AgentConfig,
    sender: string,
    text: string,
  ): string {
    return [
      agent.systemPrompt,
      '',
      `当前 agent: ${agent.name}`,
      `发送者: ${sender}`,
      '这是一次新的 agent 输入。',
      '用户消息如下：',
      text,
    ].join('\n');
  }

  private buildResumePrompt(
    agent: AgentConfig,
    sender: string,
    text: string,
  ): string {
    return [
      `当前 agent: ${agent.name}`,
      `发送者: ${sender}`,
      '继续使用已有会话上下文回答，不要重置身份和任务边界。',
      '用户消息如下：',
      text,
    ].join('\n');
  }

  private buildPreview(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
  }
}
