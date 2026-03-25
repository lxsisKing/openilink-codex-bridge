import { Module } from '@nestjs/common';
import { AgentRunnerService } from './agent-runner.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BridgeService } from './bridge.service';
import { CodexService } from './codex.service';
import { SessionStoreService } from './session-store.service';
import { TtsService } from './tts.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    BridgeService,
    AgentRunnerService,
    CodexService,
    SessionStoreService,
    TtsService,
  ],
})
export class AppModule {}
