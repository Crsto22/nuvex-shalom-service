import { stripAgencyPlaceholder } from './agency-name';

describe('stripAgencyPlaceholder', () => {
  it('quita el sufijo por definir', () => {
    expect(stripAgencyPlaceholder('HUARAZ PALMIRA (POR DEFINIR)')).toBe(
      'HUARAZ PALMIRA',
    );
  });

  it('quita el sufijo de una ruta completa', () => {
    expect(
      stripAgencyPlaceholder(
        'ANCASH / HUARAZ / INDEPENDENCIA / HUARAZ PALMIRA (POR DEFINIR)',
      ),
    ).toBe('ANCASH / HUARAZ / INDEPENDENCIA / HUARAZ PALMIRA');
  });

  it('tolera espacios y mayusculas distintas', () => {
    expect(stripAgencyPlaceholder('  PIMENTEL   ( por definir )  ')).toBe(
      'PIMENTEL',
    );
  });

  it('no toca los nombres normales', () => {
    expect(stripAgencyPlaceholder('BAGUA CAPITAL')).toBe('BAGUA CAPITAL');
  });
});
