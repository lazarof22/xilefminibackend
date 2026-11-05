import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { MongooseExceptionFilter } from './common/filters/mongoose-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // Configuracion del swagger
  const config = new DocumentBuilder()
    .setTitle('XILEF')
    .setDescription('API XILEF')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
