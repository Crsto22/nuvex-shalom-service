import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

import { AUTH_REQUEST_KEY, type AuthContext } from './auth-context';

export const SCOPES_METADATA = 'shalom:scopes';

/** Declara los scopes requeridos por un endpoint. */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_METADATA, scopes);

/** Inyecta el contexto de autenticacion resuelto por ApiKeyGuard. */
export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<Request>();
  return (request as unknown as Record<string, AuthContext>)[AUTH_REQUEST_KEY]!;
});
