import { ForbiddenException } from '@nestjs/common';

import type { AuthContext } from './auth-context';

/** Un tenant solo puede operar sobre sus propios recursos. */
export function assertTenantAccess(auth: AuthContext, tenantId: string): void {
  if (auth.tenantId !== tenantId) {
    throw new ForbiddenException('La API key no pertenece a este tenant');
  }
}
