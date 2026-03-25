import { Injectable, Logger } from '@nestjs/common';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly config = loadConfig();

  async synthesizeToWav(text: string): Promise<Buffer | null> {
    if (!this.config.ttsEnabled || !text.trim()) {
      return null;
    }

    const workdir = await mkdtemp(join(tmpdir(), 'openilink-tts-'));
    const wavPath = join(workdir, `${randomUUID()}.wav`);

    try {
      const args = [this.config.ttsScript, text, wavPath];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.config.ttsPythonBin, args, {
          cwd: this.config.codexWorkdir,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => reject(error));
        child.on('close', (code) => {
          if (code === 0) {
            this.logger.log(`[tts] synth ok wav=${wavPath} stdout=${stdout.trim()} stderr=${stderr.trim()}`);
            resolve();
            return;
          }
          reject(
            new Error(
              `tts failed code=${code} stdout=${stdout.trim()} stderr=${stderr.trim()}`,
            ),
          );
        });
      });

      await this.waitForFile(wavPath);
      return await readFile(wavPath);
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async waitForFile(filePath: string): Promise<void> {
    const maxAttempts = 20;
    const sleepMs = 150;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await access(filePath);
        const info = await stat(filePath);
        if (info.size > 0) {
          return;
        }
      } catch {
        // file not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    throw new Error(`tts output not ready: ${filePath}`);
  }
}
