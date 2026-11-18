export type LoginOutcome =
  | 'SUCCESS'
  | 'CAPTCHA'
  | 'BAD_CREDENTIALS'
  | 'NEEDS_CODE'
  | 'BLOCKED'
  | 'HTTP_ERROR'
  | 'UNKNOWN';

export type LoginResult = {
  outcome: LoginOutcome;
  message: string | null;
  /** storageState serializado (cookies + localStorage). Cifrar antes de persistir. */
  storageState?: string;
};

export type RegisterOrderInput = {
  /** DNI (8) / RUC (11) / CE (hasta 12). */
  recipientDocument: string;
  /** Tipo de documento del destinatario. Default DNI. */
  documentType?: 'DNI' | 'RUC' | 'CE';
  /** Nombre del destinatario (se usa si Shalom no lo autocompleta). */
  recipientName?: string;
  recipientPaternalLastName?: string;
  recipientMaternalLastName?: string;
  /** Razon social, solo para RUC. */
  businessName?: string;
  /** Celular del destinatario (9 digitos). */
  recipientPhone?: string;
  /** Nombre de agencia de origen tal como aparece en Shalom (ej. "AV TACNA"). */
  originAgency: string;
  /** Nombre de agencia destino (ej. "ZAMACOLA"). */
  destinationAgency: string;
  /** SOBRE | PAQUETE XXS | PAQUETE XS | PAQUETE S | PAQUETE M | PAQUETE L */
  packageType: string;
  /** Clave de seguridad de 4 digitos. La define el usuario final. */
  securityKey: string;
  /** Declaracion jurada. Default: Articulos de uso personal. */
  declarationType?: 'Articulos de uso personal' | 'Documentos' | 'Ropa' | 'Electrodomesticos';
  /** Servicio adicional "Envio Sobreprotegido". */
  extraSecurity?: boolean;
  /** Servicio "Cobro Seguro". */
  cashOnDelivery?: boolean;
};

export type RegisterOrderResult = {
  orden: string;
  codigo: string | null;
  monto: number | null;
  /** Texto crudo del comprobante, util para diagnostico. */
  reference: string;
};

export type TrackingStep = { nombre: string; activo: boolean };

export type TrackingResult = {
  orden: string;
  codigo: string | null;
  estado: string | null;
  mensaje: string | null;
  fecha: string | null;
  progreso: number;
  pasos: TrackingStep[];
  url: string;
};

export type ShalomErrorKind = 'PERMANENT' | 'RETRYABLE' | 'SESSION_REQUIRED';

export class ShalomError extends Error {
  constructor(
    message: string,
    readonly kind: ShalomErrorKind,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ShalomError';
  }

  get retryable(): boolean {
    return this.kind === 'RETRYABLE';
  }
}

export type PendingShipment = {
  orden: string;
  codigo: string | null;
  monto: number | null;
  contenido: string;
  documento: string;
};

export interface ShalomDriver {
  login(username: string, password: string): Promise<LoginResult>;
  registerOrder(input: RegisterOrderInput, storageState: string): Promise<RegisterOrderResult>;
  getOrderCode(orden: string, storageState: string): Promise<string | null>;
  listPending(storageState: string): Promise<PendingShipment[]>;
  tracking(orden: string, codigo: string | null): Promise<TrackingResult>;
}
