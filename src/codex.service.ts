import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfig, BridgeConfig } from './config';
import { loadConfig } from './config';
import { CodexRunResult } from './types';

@Injectable()
export class CodexService {
  private readonly logger = new Logger(CodexService.name);
  private readonly config: BridgeConfig = loadConfig();

  async exec(agent: AgentConfig, prompt: string): Promise<CodexRunResult> {
    const outputPath = this.buildOutputPath(agent.name);
    const args = [...this.buildExecArgs(), '-o', outputPath, prompt];
    return this.runProcess(agent, args, outputPath);
  }

  async resume(
    agent: AgentConfig,
    sessionId: string,
    prompt: string,
  ): Promise<CodexRunResult> {
    const outputPath = this.buildOutputPath(agent.name);
    const args = [...this.buildResumeArgs(sessionId), '-o', outputPath, prompt];
    return this.runProcess(agent, args, outputPath);
  }

  private async runProcess(
    agent: AgentConfig,
    args: string[],
    outputPath: string,
  ): Promise<CodexRunResult> {
    return await new Promise<CodexRunResult>((resolve, reject) => {
      const child = spawn(this.config.codexBin, args, {
        cwd: this.config.codexWorkdir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => reject(error));
      child.on('close', async (code) => {
        try {
          const reply = await this.readReply(outputPath, stdout, stderr);
          const sessionId = this.extractThreadId(stdout);

          if (code === 0 || reply) {
            if (code !== 0) {
              this.logger.warn(
                `${agent.name} exited with code ${code} but recovered reply from output stream`,
              );
            }
            resolve({ reply: reply || '没有返回内容。', sessionId });
            return;
          }

          const reason = this.extractError(stderr) || this.extractError(stdout);
          this.logger.error(
            `${agent.name} exited with code ${code}: ${reason}`,
          );
          reject(new Error(reason || `${agent.name} exited with code ${code}`));
        } catch (error) {
          reject(error);
        } finally {
          await rm(outputPath, { force: true }).catch(() => undefined);
        }
      });
    });
  }

  private buildExecArgs(): string[] {
    return [...this.normalizeExecArgs(), ...this.buildSharedArgs()];
  }

  private buildResumeArgs(sessionId: string): string[] {
    const args = this.normalizeExecArgs();
    const execIndex = args.indexOf('exec');
    const beforeExecOptions = args.slice(0, execIndex + 1);
    const afterExecOptions = args.slice(execIndex + 1);

    return [
      ...beforeExecOptions,
      'resume',
      ...afterExecOptions,
      ...this.buildSharedArgs(),
      sessionId,
    ];
  }

  private normalizeExecArgs(): string[] {
    const args =
      this.config.codexArgs.length > 0 ? [...this.config.codexArgs] : ['exec'];
    if (!args.includes('exec')) {
      args.unshift('exec');
    }

    return args.filter((arg) => arg !== '--ephemeral');
  }

  private buildSharedArgs(): string[] {
    const args: string[] = [];
    if (!this.hasOption(this.config.codexArgs, '--model', '-m')) {
      args.push('--model', this.config.codexModel);
    }
    if (!this.hasOption(this.config.codexArgs, '--json')) {
      args.push('--json');
    }
    return args;
  }

  private hasOption(args: string[], ...options: string[]): boolean {
    return args.some((arg) => options.includes(arg));
  }

  private buildOutputPath(agentName: string): string {
    return join(
      tmpdir(),
      `openilink-codex-bridge-${agentName}-${randomUUID()}.txt`,
    );
  }

  private async readReply(
    outputPath: string,
    stdout: string,
    stderr: string,
  ): Promise<string> {
    try {
      const output = (await readFile(outputPath, 'utf8')).trim();
      if (output) {
        return output;
      }
    } catch {
      // Fall back to parsed JSON events when the output file is missing.
    }

    const fallback =
      this.extractLastAgentMessage(stdout) ||
      this.extractLastAgentMessage(stderr) ||
      this.extractTextFromWarnings(stdout) ||
      this.extractTextFromWarnings(stderr);

    return fallback || '';
  }

  private extractThreadId(stdout: string): string | undefined {
    const events = this.parseJsonLines(stdout);
    const threadStarted = events.find(
      (event) =>
        event.type === 'thread.started' && typeof event.thread_id === 'string',
    );
    return typeof threadStarted?.thread_id === 'string'
      ? threadStarted.thread_id
      : undefined;
  }

  private extractLastAgentMessage(output: string): string | undefined {
    const events = this.parseJsonLines(output).reverse();
    for (const event of events) {
      if (
        event.type === 'task_complete' &&
        typeof event.last_agent_message === 'string'
      ) {
        return event.last_agent_message.trim();
      }

      if (event.type === 'agent_message' && typeof event.message === 'string') {
        return event.message.trim();
      }

      if (
        event.type === 'response.completed' &&
        typeof event.output_text === 'string'
      ) {
        return event.output_text.trim();
      }
    }

    return undefined;
  }

  private extractTextFromWarnings(output: string): string | undefined {
    const trimmed = output.trim();
    if (!trimmed) return undefined;

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const useful = lines.filter(
      (line) =>
        !line.startsWith('Warning: no last agent message') &&
        !line.startsWith('WARNING:') &&
        !line.startsWith('{') &&
        !line.startsWith('['),
    );

    return useful.length > 0 ? useful.join('\n') : undefined;
  }

  private extractError(output: string): string {
    const errors = this.parseJsonLines(output)
      .filter(
        (event) => event.type === 'error' && typeof event.message === 'string',
      )
      .map((event) => String(event.message).trim())
      .filter(Boolean);

    if (errors.length > 0) {
      return errors.join('\n');
    }

    return output.trim();
  }

  private parseJsonLines(output: string): Record<string, unknown>[] {
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  }
}
