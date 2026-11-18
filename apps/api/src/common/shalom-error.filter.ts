import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { ShalomError } from '../../../../libs/shalom/src/types';

/**
 * Traduce los errores tipados del driver a respuestas HTTP:
 * - PERMANENT -> 422 (datos rechazados por Shalom)
 * - RETRYABLE -> 503 (fallo temporal del sitio)
 * - SESSION_REQUIRED -> 409 (hay que volver a iniciar sesion)
 */
@Catch(ShalomError)
export class ShalomErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ShalomErrorFilter.name);

  catch(error: ShalomError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const statusCode =
      error.kind === 'SESSION_REQUIRED'
        ? HttpStatus.CONFLICT
        : error.kind === 'RETRYABLE'
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.UNPROCESSABLE_ENTITY;

    this.logger.warn(`ShalomError (${error.kind}): ${error.message}`);

    response.status(statusCode).json({
      statusCode,
      error: error.kind,
      message: error.message,
      retryable: error.kind === 'RETRYABLE',
    });
  }
}
