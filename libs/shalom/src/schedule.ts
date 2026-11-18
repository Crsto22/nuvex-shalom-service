/**
 * Ventana horaria y limite diario por tenant, en la zona horaria de la empresa.
 */

export function timeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );

  return (asUtc - date.getTime()) / 60_000;
}

/** Medianoche local del tenant expresada en UTC. */
export function startOfDayInTimeZone(timeZone: string, now: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';

  const guess = new Date(`${read('year')}-${read('month')}-${read('day')}T00:00:00Z`);
  const offset = timeZoneOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60_000);
}

/** Hora actual del tenant en formato HH:mm. */
export function currentTimeInTimeZone(timeZone: string, now: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export function isWithinWindow(
  timeZone: string,
  start: string,
  end: string,
  now: Date = new Date(),
): boolean {
  const current = currentTimeInTimeZone(timeZone, now);
  return current >= start && current <= end;
}
