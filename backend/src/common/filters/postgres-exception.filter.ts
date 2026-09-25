import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Request, Response } from 'express';

@Catch(QueryFailedError)
export class PostgresExceptionFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const error = exception.driverError as { code?: string; message?: string };
    const code = error.code;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno en la base de datos';

    switch (code) {
      case '23505': // unique_violation
        status = HttpStatus.CONFLICT;
        message = 'El registro ya existe.';
        break;
      case '23503': // foreign_key_violation
        status = HttpStatus.BAD_REQUEST;
        message = 'El registro relacionado no existe o todavía está en uso.';
        break;
      case '22P02': // invalid_text_representation
        status = HttpStatus.BAD_REQUEST;
        message = 'El formato de uno de los campos es incorrecto.';
        break;
      case '23502': // not_null_violation
        status = HttpStatus.BAD_REQUEST;
        message = 'Falta un campo obligatorio.';
        break;
      case '23514': // check_violation
        status = HttpStatus.BAD_REQUEST;
        message = 'El valor recibido no cumple una regla de negocio.';
        break;
      case 'P0001': // RAISE EXCEPTION de reglas de negocio
        status = HttpStatus.BAD_REQUEST;
        message = error.message?.split('\n')[0]?.slice(0, 300) || 'La operación no cumple las reglas de negocio.';
        break;
      case '40001':
      case '40P01':
      case '55P03':
        status = HttpStatus.CONFLICT;
        message = 'Otro usuario modificó los datos. Actualiza e intenta nuevamente.';
        break;
      default:
        // Mensaje genérico para otros errores de BD no mapeados explícitamente
        message = 'No fue posible completar la operación en la base de datos.';
        break;
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: response.locals.requestId as string | undefined,
      message,
    });
  }
}
