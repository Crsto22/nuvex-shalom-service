import type { TrackingResult } from './types';

/** Estados logisticos que persiste el servicio (espejo de ShalomOrderStatus). */
export type OrderTrackingStatus =
  | 'REGISTRADO'
  | 'EN_ORIGEN'
  | 'EN_TRANSITO'
  | 'ENTREGADO'
  | 'INCIDENCIA'
  | 'ANULADO';

export type MappedTracking = {
  status: OrderTrackingStatus;
  progress: number;
  label: string;
  message: string | null;
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Traduce el rastreo publico de Shalom a nuestros estados.
 *
 * Se combina el texto del estado, el ultimo paso activo del timeline y el
 * progreso (0-3) para no depender de una sola senal.
 */
export function mapTracking(tracking: Pick<TrackingResult, 'estado' | 'mensaje' | 'pasos' | 'progreso'>): MappedTracking {
  const estado = normalize(tracking.estado ?? '');
  const activos = tracking.pasos.filter((paso) => paso.activo).map((paso) => normalize(paso.nombre));
  const ultimoPaso = activos.at(-1) ?? '';
  const progreso = Math.max(0, Math.min(3, tracking.progreso));

  const message = tracking.mensaje;

  if (/anulado|cancelad/.test(estado)) {
    return { status: 'ANULADO', progress: progreso, label: tracking.estado ?? 'Anulado', message };
  }

  if (/incidencia|no entregad|devuelt|rechazad|extraviad|observad/.test(estado) ||
      /incidencia|no entregad|devuelt/.test(ultimoPaso)) {
    return {
      status: 'INCIDENCIA',
      progress: progreso,
      label: tracking.estado ?? 'Incidencia',
      message,
    };
  }

  if (/entregad/.test(estado) || /entregad/.test(ultimoPaso) || progreso === 3) {
    return { status: 'ENTREGADO', progress: 3, label: tracking.estado ?? 'Entregado', message };
  }

  if (/en destino|disponible|en agencia destino/.test(estado) || /en destino/.test(ultimoPaso)) {
    return {
      status: 'EN_TRANSITO',
      progress: Math.max(progreso, 2),
      label: tracking.estado ?? 'En destino',
      message,
    };
  }

  if (
    /en transito|en camino|en ruta|despachad|en agencia origen/.test(estado) ||
    /en transito/.test(ultimoPaso)
  ) {
    return {
      status: 'EN_TRANSITO',
      progress: Math.max(progreso, 1),
      label: tracking.estado ?? 'En transito',
      message,
    };
  }

  if (/en origen|recibid|recepcionad|recolectad/.test(estado) || /en origen/.test(ultimoPaso)) {
    return {
      status: 'EN_ORIGEN',
      progress: Math.max(progreso, 1),
      label: tracking.estado ?? 'En origen',
      message,
    };
  }

  return {
    status: 'REGISTRADO',
    progress: progreso,
    label: tracking.estado ?? 'Registrado',
    message,
  };
}
