import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import WebSocket from 'ws';
import { AgentRunnerService } from './agent-runner.service';
import type { AgentConfig } from './config';
import { loadConfig } from './config';
import { TtsService } from './tts.service';
import {
  RelayEnvelope,
  RelayInboundMessage,
  RelayMessageItem,
  RelaySendTextData,
} from './types';

interface AgentRuntime {
  agent: AgentConfig;
  ws: WebSocket;
  reqCounter: number;
}

interface DedupRecord {
  seenAt: number;
  agentName: string;
}

interface PendingVoiceRecord {
  sender: string;
  items: RelayMessageItem[];
  receivedAt: number;
}

interface RoutedMessage {
  targetAgentName?: string;
  strippedText: string;
}

@Injectable()
export class BridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BridgeService.name);
  private readonly config = loadConfig();
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly seenMessages = new Map<string, DedupRecord>();
  private readonly pendingVoice = new Map<string, PendingVoiceRecord>();
  private readonly dedupTtlMs = 30 * 1000;
  private readonly pendingVoiceTtlMs = 60 * 1000;

  constructor(
    private readonly agentRunnerService: AgentRunnerService,
    private readonly ttsService: TtsService,
  ) {}

  onModuleInit() {
    for (const agent of this.config.agents) {
      this.connect(agent);
    }
  }

  onModuleDestroy() {
    for (const runtime of this.runtimes.values()) {
      runtime.ws.close();
    }
  }

  private connect(agent: AgentConfig) {
    this.logger.log(`[${agent.name}] connecting to ${agent.wsUrl}`);
    const ws = new WebSocket(agent.wsUrl);
    const runtime: AgentRuntime = { agent, ws, reqCounter: 0 };
    this.runtimes.set(agent.name, runtime);

    ws.on('open', () => {
      this.logger.log(`[${agent.name}] connected to openilink websocket`);
    });

    ws.on('message', async (raw: WebSocket.RawData) => {
      try {
        const env = JSON.parse(raw.toString()) as RelayEnvelope;
        await this.handleEnvelope(runtime, env);
      } catch (error) {
        this.logger.error(
          `[${agent.name}] failed to handle message: ${String(error)}`,
        );
      }
    });

    ws.on('close', () => {
      this.logger.warn(`[${agent.name}] websocket closed, retry in 3s`);
      setTimeout(() => this.connect(agent), 3000);
    });

    ws.on('error', (error) => {
      this.logger.error(`[${agent.name}] websocket error: ${String(error)}`);
    });
  }

  private async handleEnvelope(runtime: AgentRuntime, env: RelayEnvelope) {
    if (env.type !== 'message' && env.type !== 'message_media_ready') return;

    const data = env.data as RelayInboundMessage;
    const sender = data.sender || '';
    const items = data.items || [];

    this.cleanupPendingVoice();

    if (!sender || items.length === 0) return;

    if (this.shouldDeferVoiceProcessing(env.type, data)) {
      const pendingKey = this.buildPendingVoiceKey(data, sender);
      this.pendingVoice.set(pendingKey, {
        sender,
        items,
        receivedAt: Date.now(),
      });
      this.logger.log(
        `[${runtime.agent.name}] defer voice until media ready for ${sender}: ${pendingKey}`,
      );
      return;
    }

    const text = await this.extractMessageText(items);

    if (!text) return;

    const routed = this.resolveTargetAgent(text);
    if (
      routed.targetAgentName &&
      routed.targetAgentName !== runtime.agent.name
    ) {
      this.logger.log(
        `[${runtime.agent.name}] skip routed message for ${sender}, target=${routed.targetAgentName}: ${text}`,
      );
      return;
    }

    const effectiveText = routed.strippedText || text;
    if (!effectiveText.trim()) {
      this.logger.warn(
        `[${runtime.agent.name}] empty message after route stripping for ${sender}: ${text}`,
      );
      return;
    }

    const dedupKey = this.buildDedupKey(data, sender, text);
    if (dedupKey && this.isDuplicate(dedupKey, runtime.agent.name)) {
      this.logger.warn(
        `[${runtime.agent.name}] duplicate message ignored for ${sender}: ${dedupKey}`,
      );
      return;
    }

    if (
      this.config.allowedSenders.length > 0 &&
      !this.config.allowedSenders.includes(sender)
    ) {
      this.logger.warn(`[${runtime.agent.name}] blocked sender ${sender}`);
      await this.sendText(runtime, sender, '你没有使用这个 agent 的权限。');
      return;
    }

    this.logger.log(
      `[${runtime.agent.name}] message from ${sender}: ${effectiveText}`,
    );
    try {
      await this.sendTyping(runtime);
      const processingTimer = setTimeout(async () => {
        try {
          await this.sendText(runtime, sender, '正在处理…');
        } catch (error) {
          this.logger.error(
            `[${runtime.agent.name}] failed to send processing notice: ${String(error)}`,
          );
        }
      }, 3000);

      const result = await this.agentRunnerService.run(
        runtime.agent,
        sender,
        effectiveText,
      );
      const reply = result.reply;
      clearTimeout(processingTimer);
      this.logger.log(`[${runtime.agent.name}] reply to ${sender}: ${reply}`);
      await this.sendReply(runtime, sender, reply);
    } catch (error) {
      this.logger.error(
        `[${runtime.agent.name}] failed to reply: ${String(error)}`,
      );
      await this.sendText(runtime, sender, `执行失败：${String(error)}`);
    }
  }

  private async sendTyping(runtime: AgentRuntime) {
    this.send(runtime, {
      type: 'send_typing',
      req_id: `req-${++runtime.reqCounter}`,
      data: { status: 'typing' },
    });
  }

  private async sendText(
    runtime: AgentRuntime,
    recipient: string,
    text: string,
  ) {
    const data: RelaySendTextData = { recipient, text };
    this.send(runtime, {
      type: 'send_text',
      req_id: `req-${++runtime.reqCounter}`,
      data,
    });
  }

  private async sendReply(
    runtime: AgentRuntime,
    recipient: string,
    text: string,
  ) {
    if (this.config.ttsEnabled && runtime.agent.sendKey) {
      try {
        const wav = await this.ttsService.synthesizeToWav(text);
        if (wav) {
          await this.sendVoice(runtime, recipient, wav);
          return;
        }
      } catch (error) {
        this.logger.error(
          `[${runtime.agent.name}] voice reply failed, fallback to text: ${String(error)}`,
        );
      }
    }

    const chunks = this.splitMessageChunks(text);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const chunkText =
        chunks.length > 1 ? `(${index + 1}/${chunks.length})\n${chunk}` : chunk;
      await this.sendText(runtime, recipient, chunkText);
    }
  }

  private async sendVoice(
    runtime: AgentRuntime,
    recipient: string,
    wav: Buffer,
  ) {
    const form = new FormData();
    form.set('recipient', recipient);
    const wavBytes = new Uint8Array(wav);
    form.set(
      'file',
      new Blob([wavBytes], { type: 'audio/wav' }),
      'reply.wav',
    );

    const response = await fetch(
      `${this.config.hubBaseUrl}/api/v1/channels/send?key=${runtime.agent.sendKey}`,
      {
        method: 'POST',
        body: form,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`send voice failed: HTTP ${response.status} ${body}`);
    }

    this.logger.log(
      `[${runtime.agent.name}] sent voice reply to ${recipient} bytes=${wav.length}`,
    );
  }

  private send(runtime: AgentRuntime, payload: RelayEnvelope) {
    if (runtime.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`${runtime.agent.name} websocket is not connected`);
    }
    runtime.ws.send(JSON.stringify(payload));
  }

  private splitMessageChunks(text: string): string[] {
    const normalized = (text || '').trim() || '没有返回内容。';
    const max = 1500;
    if (normalized.length <= max) {
      return [normalized];
    }

    const chunks: string[] = [];
    let remaining = normalized;

    while (remaining.length > max) {
      let splitAt = remaining.lastIndexOf('\n\n', max);
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = remaining.lastIndexOf('\n', max);
      }
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = remaining.lastIndexOf('。', max);
      }
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = remaining.lastIndexOf('！', max);
      }
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = remaining.lastIndexOf('？', max);
      }
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = remaining.lastIndexOf('. ', max);
      }
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = remaining.lastIndexOf(' ', max);
      }
      if (splitAt < Math.floor(max * 0.5)) {
        splitAt = max;
      }

      const chunk = remaining.slice(0, splitAt).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks.length > 0 ? chunks : ['没有返回内容。'];
  }

  private async extractMessageText(items: RelayMessageItem[]): Promise<string> {
    const textParts = items
      .filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text?.trim())
      .filter((value): value is string => Boolean(value));
    if (textParts.length > 0) {
      return textParts.join('\n').trim();
    }

    const voiceItem = items.find((item) => item.type === 'voice');
    if (voiceItem) {
      return await this.formatVoiceMessage(voiceItem);
    }

    const fileItem = items.find((item) => item.type === 'file');
    if (fileItem?.fileName) {
      return `[文件消息]\n文件名：${fileItem.fileName}`;
    }

    const imageItem = items.find((item) => item.type === 'image');
    if (imageItem) {
      return '[图片消息]';
    }

    const videoItem = items.find((item) => item.type === 'video');
    if (videoItem) {
      return '[视频消息]';
    }

    return '';
  }

  private async formatVoiceMessage(item: RelayMessageItem): Promise<string> {
    const lines = ['[语音消息]'];
    const voiceText = item.text?.trim() || '';

    if (voiceText) {
      lines.push(`转写：${voiceText}`);
    } else {
      lines.push('转写：<无文字>');
    }
    if (item.media?.play_time) {
      lines.push(`时长：${(item.media.play_time / 1000).toFixed(2)} 秒`);
    }
    if (item.media?.sample_rate) {
      lines.push(`采样率：${item.media.sample_rate} Hz`);
    }
    if (item.media?.encode_type !== undefined) {
      lines.push(`编码类型：${item.media.encode_type}`);
    }
    if (item.media?.url) {
      lines.push(`语音地址：${item.media.url}`);
    }
    lines.push(
      '请结合以上语音内容回答用户；如果转写为空，就明确说明当前只有语音元数据。',
    );
    return lines.join('\n');
  }

  private resolveTargetAgent(text: string): RoutedMessage {
    const trimmed = text.trim();
    const { targetAgentName, matchedPrefix } = this.matchAgentPrefix(trimmed);
    if (!targetAgentName || !matchedPrefix) {
      return { strippedText: trimmed };
    }

    const strippedText = trimmed.slice(matchedPrefix.length).trim();
    return {
      targetAgentName,
      strippedText,
    };
  }

  private matchAgentPrefix(text: string): {
    targetAgentName?: string;
    matchedPrefix?: string;
  } {
    const prefixMatch = text.match(/^@?([^\s,:，：]+(?:\s+[^\s,:，：]+)?)/i);
    if (!prefixMatch) {
      return {};
    }

    const matchedPrefix = prefixMatch[0];
    const rawToken = prefixMatch[1] || '';
    const normalized = rawToken.toLowerCase().replace(/[^a-z]/g, '');

    if (
      ['codex', 'codexagent', 'codx', 'codexx'].includes(normalized) ||
      /^(codex|codx)$/.test(normalized)
    ) {
      return { targetAgentName: 'codex', matchedPrefix };
    }
    if (
      ['review', 'reviewer', 'reveiw', 'rewiew', 'rvw', 'reviewagent'].includes(
        normalized,
      ) ||
      /^(review|reviewer)$/.test(normalized)
    ) {
      return { targetAgentName: 'review', matchedPrefix };
    }
    if (['chat', 'cht'].includes(normalized)) {
      return { targetAgentName: 'chat', matchedPrefix };
    }

    return {};
  }

  private buildDedupKey(
    data: RelayInboundMessage,
    sender: string,
    text: string,
  ): string {
    return [data.context_token || '', data.session_id || '', sender, text]
      .filter(Boolean)
      .join('::');
  }

  private buildPendingVoiceKey(
    data: RelayInboundMessage,
    sender: string,
  ): string {
    return [data.context_token || '', data.session_id || '', data.seq_id || '', sender]
      .filter(Boolean)
      .join('::');
  }

  private shouldDeferVoiceProcessing(
    eventType: string,
    data: RelayInboundMessage,
  ): boolean {
    if (eventType !== 'message') {
      return false;
    }
    const voiceItem = (data.items || []).find((item) => item.type === 'voice');
    if (!voiceItem) {
      return false;
    }
    return !voiceItem.media?.raw_url;
  }

  private cleanupPendingVoice() {
    const now = Date.now();
    for (const [key, record] of this.pendingVoice.entries()) {
      if (record.receivedAt + this.pendingVoiceTtlMs <= now) {
        this.pendingVoice.delete(key);
      }
    }
  }

  private isDuplicate(key: string, agentName: string): boolean {
    const now = Date.now();

    for (const [existingKey, record] of this.seenMessages.entries()) {
      if (record.seenAt + this.dedupTtlMs <= now) {
        this.seenMessages.delete(existingKey);
      }
    }

    const current = this.seenMessages.get(key);
    if (!current) {
      this.seenMessages.set(key, { seenAt: now, agentName });
      return false;
    }

    return (
      current.agentName !== agentName || current.seenAt + this.dedupTtlMs > now
    );
  }
}
