export type AuthContext = {
  apiKeyId: string;
  tenantId: string;
  applicationId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  scopes: string[];
};

export const AUTH_REQUEST_KEY = 'auth';
