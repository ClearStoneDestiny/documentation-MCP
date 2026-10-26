#!/usr/bin/env node
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

function reportError(error: unknown): void {
  console.error(error);
  process.exitCode = 1;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: {
      log: console.error,
      error: console.error,
      warn: console.error,
      debug: console.error,
      verbose: console.error,
      fatal: console.error,
    },
    abortOnError: false,
  });

  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  process.stdin.once('end', () => {
    void app.close().catch(reportError);
  });
}

void bootstrap().catch(reportError);
