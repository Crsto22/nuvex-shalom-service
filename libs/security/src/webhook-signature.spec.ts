import { signWebhook, verifyWebhook } from './api-key';

const SECRET = 'whsec_prueba_123';

describe('webhook signature', () => {
  it('firma y verifica el mismo cuerpo', () => {
    const body = JSON.stringify({ event: 'order.registered', id: 1 });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signWebhook(SECRET, timestamp, body);

    expect(header.startsWith(`t=${timestamp},v1=`)).toBe(true);
    expect(verifyWebhook(SECRET, header, body)).toBe(true);
  });

  it('rechaza un cuerpo alterado', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signWebhook(SECRET, timestamp, '{"a":1}');

    expect(verifyWebhook(SECRET, header, '{"a":2}')).toBe(false);
  });

  it('rechaza otro secreto', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signWebhook('otro', timestamp, '{}');

    expect(verifyWebhook(SECRET, header, '{}')).toBe(false);
  });

  it('rechaza timestamps fuera de la tolerancia (replay)', () => {
    const old = Math.floor(Date.now() / 1000) - 1_000;
    const header = signWebhook(SECRET, old, '{}');

    expect(verifyWebhook(SECRET, header, '{}')).toBe(false);
  });

  it('rechaza headers malformados', () => {
    expect(verifyWebhook(SECRET, 'basura', '{}')).toBe(false);
  });
});
