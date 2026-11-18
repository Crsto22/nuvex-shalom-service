import { ApplicationRateLimiter } from './rate-limiter';

function buildLimiter(limit: number): ApplicationRateLimiter {
  const config = {
    get: (key: string) => (key === 'RATE_LIMIT_PER_MINUTE' ? String(limit) : undefined),
  };
  return new ApplicationRateLimiter(config as never);
}

describe('ApplicationRateLimiter', () => {
  it('permite hasta el limite por minuto', () => {
    const limiter = buildLimiter(3);
    const now = Date.now();

    expect(limiter.consume('app-1', now)).toBe(true);
    expect(limiter.consume('app-1', now)).toBe(true);
    expect(limiter.consume('app-1', now)).toBe(true);
    expect(limiter.consume('app-1', now)).toBe(false);
  });

  it('separa el cupo por aplicacion', () => {
    const limiter = buildLimiter(1);
    const now = Date.now();

    expect(limiter.consume('app-1', now)).toBe(true);
    expect(limiter.consume('app-1', now)).toBe(false);
    expect(limiter.consume('app-2', now)).toBe(true);
  });

  it('reinicia la ventana al pasar el minuto', () => {
    const limiter = buildLimiter(1);
    const now = Date.now();

    expect(limiter.consume('app-1', now)).toBe(true);
    expect(limiter.consume('app-1', now)).toBe(false);
    expect(limiter.consume('app-1', now + 61_000)).toBe(true);
  });
});
