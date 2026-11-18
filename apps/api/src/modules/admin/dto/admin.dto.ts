import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { API_KEY_SCOPES } from '../../../../../../libs/security/src/api-key';

export const WEBHOOK_EVENTS = ['order.registered', 'order.status_changed'] as const;

export class CreateApiKeyDto {
  @IsOptional()
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment?: 'SANDBOX' | 'PRODUCTION';

  @IsOptional()
  @IsArray()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CreateWebhookDto {
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  url!: string;

  @IsArray()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events!: string[];
}

export class UpdateShalomCredentialsDto {
  @IsEmail()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class CreateTenantDto {
  @Matches(/^[a-z0-9-]{2,50}$/, { message: 'code debe ser minusculas, numeros o guiones' })
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEmail()
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]{2,50}$/)
  applicationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  applicationName?: string;
}

export class UpdateCredentialsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  validate?: string;
}

export class AuditQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
