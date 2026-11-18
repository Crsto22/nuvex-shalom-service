import { currentTimeInTimeZone, isWithinWindow, startOfDayInTimeZone } from './schedule';

describe('schedule', () => {
  const timeZone = 'America/Lima';

  it('calcula la hora local del tenant', () => {
    // 2026-11-17T02:00:00Z = 2026-11-16 21:00 en Lima (UTC-5)
    expect(currentTimeInTimeZone(timeZone, new Date('2026-11-17T02:00:00Z'))).toBe('21:00');
  });

  it('valida la ventana operativa', () => {
    const now = new Date('2026-11-17T15:00:00Z'); // 10:00 en Lima
    expect(isWithinWindow(timeZone, '07:00', '21:00', now)).toBe(true);
    expect(isWithinWindow(timeZone, '11:00', '21:00', now)).toBe(false);
    expect(isWithinWindow(timeZone, '00:00', '09:00', now)).toBe(false);
  });

  it('inicio del dia local expresado en UTC', () => {
    const start = startOfDayInTimeZone(timeZone, new Date('2026-11-17T15:00:00Z'));
    // Medianoche en Lima (UTC-5) = 05:00 UTC
    expect(start.toISOString()).toBe('2026-11-17T05:00:00.000Z');
  });
});
