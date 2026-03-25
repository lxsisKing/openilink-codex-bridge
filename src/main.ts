import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');

process.on('uncaughtException', (error) => {
  logger.error(`uncaughtException: ${error?.stack || String(error)}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${String(reason)}`);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((error) => {
  logger.error(`bootstrap failed: ${error?.stack || String(error)}`);
  process.exitCode = 1;
});
