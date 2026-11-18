import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export type RequestWithId = Request & { requestId: string };

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * Correlacion de peticiones: reutiliza un X-Request-Id valido o genera uno.
 * Mismo comportamiento que nuvex-billing-service.
 */
export function requestIdMiddleware(request: Request, response: Response, next: NextFunction) {
  const incoming = request.header('x-request-id');
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  (request as RequestWithId).requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}
