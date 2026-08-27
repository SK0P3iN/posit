import cookieParser from 'cookie-parser';
import { json } from 'express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@gitroom/saas-bff/app.module';

async function bootstrap() {
  const mobileOrigin =
    process.env.SAAS_MOBILE_URL || 'http://localhost:4210';

  const app = await NestFactory.create(AppModule, {
    cors: {
      ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
      origin: [mobileOrigin, 'http://localhost:4210'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'saas_session',
      ],
      exposedHeaders: [
        ...(process.env.NOT_SECURED ? ['saas_session'] : []),
      ],
    },
  });

  app.use(json({ limit: '10mb' }));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const port = process.env.SAAS_BFF_PORT || 3010;
  await app.listen(port);

  Logger.log(`SaaS BFF listening on http://localhost:${port}`);
}

bootstrap();
