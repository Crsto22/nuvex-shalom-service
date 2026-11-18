import { Inject, Injectable } from '@nestjs/common';

import { mapTracking } from '../../../../../libs/shalom/src/tracking-status';
import { SHALOM_DRIVER } from '../../../../../libs/shalom/src/tokens';
import type { ShalomDriver } from '../../../../../libs/shalom/src/types';

@Injectable()
export class TrackingService {
  constructor(@Inject(SHALOM_DRIVER) private readonly driver: ShalomDriver) {}

  /** Consulta en vivo (abre navegador: 10-20 s). */
  async live(orden: string, codigo?: string) {
    const tracking = await this.driver.tracking(orden, codigo ?? null);
    const mapped = mapTracking(tracking);

    return {
      orden: tracking.orden,
      codigo: tracking.codigo,
      estado: tracking.estado,
      mensaje: tracking.mensaje,
      fecha: tracking.fecha,
      progreso: tracking.progreso,
      pasos: tracking.pasos,
      status: mapped.status,
      label: mapped.label,
    };
  }
}
