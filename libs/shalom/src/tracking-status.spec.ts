import { mapTracking } from './tracking-status';

describe('mapTracking', () => {
  const base = { mensaje: null, pasos: [], progreso: 0 };

  it('envio no confirmado => REGISTRADO', () => {
    const result = mapTracking({
      ...base,
      estado: 'Envío no confirmado',
      mensaje: 'Tu envío fue registrado, pero aún no está en la agencia.',
    });
    expect(result.status).toBe('REGISTRADO');
    expect(result.progress).toBe(0);
  });

  it('en origen => EN_ORIGEN', () => {
    expect(
      mapTracking({ ...base, estado: 'En origen', progreso: 1, pasos: [{ nombre: 'En origen', activo: true }] })
        .status,
    ).toBe('EN_ORIGEN');
  });

  it('en transito => EN_TRANSITO', () => {
    expect(
      mapTracking({
        ...base,
        estado: 'En tránsito',
        progreso: 2,
        pasos: [{ nombre: 'En tránsito', activo: true }],
      }).status,
    ).toBe('EN_TRANSITO');
  });

  it('en destino se mantiene en transito', () => {
    expect(mapTracking({ ...base, estado: 'En destino', progreso: 2 }).status).toBe('EN_TRANSITO');
  });

  it('entregado => ENTREGADO con progreso 3', () => {
    const result = mapTracking({ ...base, estado: 'Entregado', progreso: 3 });
    expect(result.status).toBe('ENTREGADO');
    expect(result.progress).toBe(3);
  });

  it('incidencias y devoluciones', () => {
    expect(mapTracking({ ...base, estado: 'No entregado' }).status).toBe('INCIDENCIA');
    expect(mapTracking({ ...base, estado: 'Devuelto al remitente' }).status).toBe('INCIDENCIA');
    expect(mapTracking({ ...base, estado: 'Anulado' }).status).toBe('ANULADO');
  });

  it('usa el ultimo paso activo cuando el estado es ambiguo', () => {
    const result = mapTracking({
      ...base,
      estado: 'Consulta',
      progreso: 2,
      pasos: [
        { nombre: 'En origen', activo: true },
        { nombre: 'En tránsito', activo: true },
      ],
    });
    expect(result.status).toBe('EN_TRANSITO');
  });
});
