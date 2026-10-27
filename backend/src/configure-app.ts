import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { PostgresExceptionFilter } from './common/filters/postgres-exception.filter';
import { browserOrigins } from './auth/browser-auth';

export function configureApp(app: INestApplication): void {
  if(process.env.AUTH_TRUST_LOOPBACK_PROXY==='true'){
    const server=app.getHttpAdapter().getInstance() as {set:(key:string,value:string)=>void};
    server.set('trust proxy','loopback');
  }
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const supplied = req.header('X-Request-ID');
    const requestId = supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    const startedAt = performance.now();
    res.on('finish', () => {
      const current = req as Request & { user?: { idUser?: number } };
      console.log(JSON.stringify({
        type: 'http_request', requestId, method: req.method, path: req.path,
        statusCode: res.statusCode, durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        idUser: current.user?.idUser ?? null,
      }));
    });
    next();
  });
  const allowedOrigins = browserOrigins();
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    exposedHeaders: ['X-Request-ID', 'X-Fiscal-Mode'],
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
    validationError: { target: false, value: false },
  }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new PostgresExceptionFilter());
  app.enableShutdownHooks();
}
