import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MongooseExceptionFilter } from './common/filters/mongoose-exception.filter';

/**
 * Configuración global de la aplicación (pipes, filtros y CORS). La usan
 * `main.ts` y la suite e2e, para que las pruebas corran con exactamente las
 * mismas reglas que producción.
 */
export function configurarApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new MongooseExceptionFilter());

  // Configuracion de CORS para permitir solicitudes desde el frontend
  app.enableCors({
    origin: ['http://localhost:5173'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    // Idempotency-Key: la envía el punto de venta en POST /venta/checkout.
    allowedHeaders: 'Content-Type, Authorization, Idempotency-Key',
    // Lets the browser read the .req filename of GET /licencia/solicitud?descargar=true
    // and whether a checkout response is a replay (Idempotency-Replayed).
    exposedHeaders: ['Content-Disposition', 'Idempotency-Replayed'],
    credentials: true,
  });
}

/** Documentación Swagger en `/docs` (JSON en `/docs-json`). */
export function configurarSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('XILEF')
    .setDescription('API XILEF')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
