import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';

/**
 * Mapea errores de validación/casteo de mongoose a 400.
 * No toca el resto del manejo de errores existente.
 */
@Catch(MongooseError.ValidationError, MongooseError.CastError)
export class MongooseExceptionFilter implements ExceptionFilter {
  catch(
    exception: MongooseError.ValidationError | MongooseError.CastError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let message = 'Error de validación';
    if (exception instanceof MongooseError.ValidationError) {
      message = Object.values(exception.errors)
        .map((e) => e?.message)
        .filter(Boolean)
        .join('; ');
      if (!message) {
        message = exception.message;
      }
    } else if (exception instanceof MongooseError.CastError) {
      message = `Valor inválido para ${exception.path}: ${exception.value}`;
    }

    const body = new BadRequestException(message).getResponse();
    response.status(400).json(body);
  }
}
