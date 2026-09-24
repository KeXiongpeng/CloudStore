import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { QueueModule } from './queue/queue.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(QueueModule);
  app.enableShutdownHooks();
}

bootstrap();
