import { Injectable } from '@nestjs/common';
import { loadConfig } from './config';

@Injectable()
export class AppService {
  getHello(): object {
    const config = loadConfig();
    return {
      ok: true,
      service: 'openilink-codex-bridge',
      workdir: config.codexWorkdir,
      sessionTtlMs: config.sessionTtlMs,
      sessionCleanupIntervalMs: config.sessionCleanupIntervalMs,
      agents: config.agents.map((agent) => ({
        name: agent.name,
        mode: agent.mode,
        persistentSessionReuse: true,
      })),
    };
  }

  getHealth(): object {
    const config = loadConfig();
    return {
      ok: true,
      service: 'openilink-codex-bridge',
      port: config.port,
      workdir: config.codexWorkdir,
      allowedSendersConfigured: config.allowedSenders.length > 0,
      agentCount: config.agents.length,
      agents: config.agents.map((agent) => ({
        name: agent.name,
        mode: agent.mode,
        wsConfigured: Boolean(agent.wsUrl),
        persistentSessionReuse: true,
      })),
    };
  }
}
