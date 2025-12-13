// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true, // Permite automáticamente el origen que solicita
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Habilitar validación global para DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Ignorar campos que no estén en el DTO
    forbidNonWhitelisted: true, // Lanzar error si se reciben campos extra
    transform: true, // Transformar payloads a tipos de DTO
  }));

  // Prefijo global para la API (ej. /api/v1/clientes)
  app.setGlobalPrefix('api/v1');

  await app.listen(3000);
  console.log(`Backend escuchando en http://localhost:3000`);
}
bootstrap();