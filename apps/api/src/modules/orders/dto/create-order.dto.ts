import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

import {
  DECLARATION_TYPES,
  PACKAGE_TYPES,
  securityKeyIssue,
} from '../../../../../../libs/shalom/src/security-key';

@ValidatorConstraint({ name: 'shalomSecurityKey', async: false })
export class IsShalomSecurityKey implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && securityKeyIssue(value) === null;
  }

  defaultMessage(): string {
    return 'securityKey debe tener 4 digitos, sin consecutivos ni todos iguales';
  }
}

export class CreateOrderDto {
  /** Identificador de la venta en el sistema que llama (ej. publicId de Nuvex). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  externalRef?: string;

  /** DNI (8, 9 o 11) del destinatario. */
  @Matches(/^\d{6,12}$/, { message: 'recipientDocument debe tener entre 6 y 12 digitos' })
  recipientDocument!: string;

  @IsOptional()
  @IsIn(['DNI', 'RUC', 'CE'])
  documentType?: 'DNI' | 'RUC' | 'CE';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientPaternalLastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientMaternalLastName?: string;

  /** Razon social (solo RUC). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessName?: string;

  @IsOptional()
  @Matches(/^\d{6,12}$/, { message: 'recipientPhone invalido' })
  recipientPhone?: string;

  @IsString()
  @MaxLength(120)
  originAgency!: string;

  @IsString()
  @MaxLength(120)
  destinationAgency!: string;

  @IsIn(PACKAGE_TYPES)
  packageType!: (typeof PACKAGE_TYPES)[number];

  @Validate(IsShalomSecurityKey)
  securityKey!: string;

  @IsOptional()
  @IsIn(DECLARATION_TYPES)
  declarationType?: (typeof DECLARATION_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  extraSecurity?: boolean;

  @IsOptional()
  @IsBoolean()
  cashOnDelivery?: boolean;

  /** Si el cliente reintenta con la misma clave, no se crea otro job. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}
