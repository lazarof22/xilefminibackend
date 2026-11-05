// Primero: carga el .env antes de que cualquier módulo lea process.env (p. ej. JWT_SECRET).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp, configurarSwagger } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configurarApp(app);
  configurarSwagger(app);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
