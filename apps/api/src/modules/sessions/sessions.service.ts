import { Injectable } from '@nestjs/common';

import { SessionManager, type LoginAttempt, type SessionView } from '../../../../../libs/session/src/session-manager.service';

@Injectable()
export class SessionsService {
  constructor(private readonly sessions: SessionManager) {}

  login(tenantId: string): Promise<LoginAttempt> {
    return this.sessions.login(tenantId);
  }

  get(tenantId: string): Promise<SessionView> {
    return this.sessions.get(tenantId);
  }
}
