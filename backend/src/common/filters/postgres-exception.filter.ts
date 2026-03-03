import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Request, Response } from 'express';

@Catch(QueryFailedError)
export class PostgresExceptionFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const error = exception as any;
    const code = error.code;
    const detail = error.detail || '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno en la base de datos';

    switch (code) {
      case '23505': // unique_violation
        status = HttpStatus.CONFLICT;
        message = `El registro ya existe. (Detalles: ${detail})`;
        break;
      case '23503': // foreign_key_violation
        status = HttpStatus.BAD_REQUEST;
        message = `Violación de llave foránea, el registro referenciado no existe o está en uso. (Detalles: ${detail})`;
        break;
      case '22P02': // invalid_text_representation
        status = HttpStatus.BAD_REQUEST;
        message = 'El formato de uno de los campos es incorrecto.';
        break;
      case '23502': // not_null_violation
        status = HttpStatus.BAD_REQUEST;
        message = `No se puede insertar un valor nulo en una columna obligatoria. (Columna: ${error.column})`;
        break;
      default:
        // Mensaje genérico para otros errores de BD no mapeados explícitamente
        message = `Error de base de datos no manejado. (Código: ${code})`;
        break;
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
