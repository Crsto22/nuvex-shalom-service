import { IsOptional, Matches } from 'class-validator';

export class TrackingQueryDto {
  @Matches(/^\d{6,12}$/, { message: 'orden debe tener entre 6 y 12 digitos' })
  orden!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{3,8}$/, { message: 'codigo invalido' })
  codigo?: string;
}
