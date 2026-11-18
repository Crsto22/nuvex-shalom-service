import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Variables de entorno obligatorias y sus valores por defecto.
 * Fallar al arrancar es preferible a fallar en el primer request.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsString()
  API_HOST: string = '0.0.0.0';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number = 4100;

  @IsString()
  @MinLength(10)
  DATABASE_URL!: string;

  /** 32 bytes en base64: openssl rand -base64 32 */
  @IsString()
  @MinLength(32)
  SECRETS_ENCRYPTION_KEY!: string;

  /** Secreto HMAC de las API keys (minimo 32 caracteres). */
  @IsString()
  @MinLength(32)
  API_KEY_PEPPER!: string;

  @IsString()
  SHALOM_BASE_URL: string = 'https://pro.shalom.pe';

  @IsString()
  SHALOM_TRACKING_URL: string = 'https://shalom.com.pe/rastrea/';

  @IsIn(['true', 'false'])
  SHALOM_HEADLESS: string = 'true';

  @IsOptional()
  @IsIn(['chrome', 'chromium'])
  SHALOM_BROWSER_CHANNEL?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  SHALOM_MAX_CONTEXTS: number = 2;

  @Type(() => Number)
  @IsInt()
  @Min(5_000)
  SHALOM_ACQUIRE_TIMEOUT_MS: number = 60_000;

  @Type(() => Number)
  @IsInt()
  @Min(5000)
  SHALOM_LOGIN_TIMEOUT_MS: number = 45_000;

  /** Barrido automatico de rastreo en el worker (desactivado por defecto). */
  @IsIn(['true', 'false'])
  SHALOM_TRACKING_ENABLED: string = 'false';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  SHALOM_TRACKING_INTERVAL_MINUTES: number = 15;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  SHALOM_TRACKING_BATCH: number = 20;

  /** Limite de peticiones por aplicacion (por minuto, por replica). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  RATE_LIMIT_PER_MINUTE: number = 120;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60_000)
  WEBHOOK_TIMEOUT_MS: number = 10_000;

  /** Segundos minimos entre intentos automaticos de re-login por tenant. */
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(3_600)
  SHALOM_RELOGIN_COOLDOWN_SECONDS: number = 30;

  /** Token de administracion temporal (Fase 5 lo reemplaza por API keys). */
  @IsOptional()
  @IsString()
  ADMIN_TOKEN?: string;

  /** Origenes permitidos para la API (coma separada). Vacio = reflejar el origen. */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  /** Numero de proxies de confianza (para IP real detras de nginx/traefik). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY_HOPS: number = 0;

  @IsOptional()
  @IsString()
  WORKER_ID?: string;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const parsed = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .filter(Boolean)
      .join(' | ');
    throw new Error(`Configuracion invalida: ${details}`);
  }

  return parsed;
}
