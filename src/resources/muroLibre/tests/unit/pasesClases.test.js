import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../asistencias/models/Asistencia.js', () => ({ default: { countDocuments: vi.fn() } }));

import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import { rangoSemanaArgentina, pasesIncluidosSemana } from '../../services/pasesClases.service.js';

const sesion = { session: vi.fn() };
const suscripcionesCon = (...pases) => ({
  populate: vi.fn().mockReturnValue({
    session: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(pases.map((p) => ({ etiquetaId: { pasesMuroPorSemana: p } }))),
    }),
  }),
});

describe('rangoSemanaArgentina', () => {
  it('va del lunes 00:00 al domingo 23:59 en hora argentina', () => {
    // miércoles 7 de octubre 2026, 15:00 ART
    const { inicio, fin } = rangoSemanaArgentina(new Date('2026-10-07T18:00:00.000Z'));
    expect(inicio.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-10-12T02:59:59.999Z');
  });

  it('un domingo a la noche sigue en la semana que termina ese día', () => {
    // domingo 11 de octubre 2026, 23:30 ART
    const { inicio } = rangoSemanaArgentina(new Date('2026-10-12T02:30:00.000Z'));
    expect(inicio.toISOString()).toBe('2026-10-05T03:00:00.000Z');
  });
});

describe('pasesIncluidosSemana', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toma el plan que más pases da, sin sumar planes', async () => {
    Suscripcion.find = vi.fn().mockReturnValue(suscripcionesCon(1, 3));
    Asistencia.countDocuments = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(0) });
    const r = await pasesIncluidosSemana({ clubId: 'CARC', socioId: 's1', fecha: new Date('2026-10-07T18:00:00.000Z') });
    expect(r).toEqual(expect.objectContaining({ max: 3, usados: 0, restantes: 3 }));
  });

  it('descuenta las visitas ya incluidas de la semana', async () => {
    Suscripcion.find = vi.fn().mockReturnValue(suscripcionesCon(3));
    Asistencia.countDocuments = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(2) });
    const r = await pasesIncluidosSemana({ clubId: 'CARC', socioId: 's1', fecha: new Date('2026-10-07T18:00:00.000Z') });
    expect(r.restantes).toBe(1);
    expect(Asistencia.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ motivoExento: 'plan_clases', tipoPase: 'diario' }));
  });

  it('sin plan con pases no da ninguno (planes de niños)', async () => {
    Suscripcion.find = vi.fn().mockReturnValue(suscripcionesCon(0));
    const r = await pasesIncluidosSemana({ clubId: 'CARC', socioId: 's1', fecha: new Date('2026-10-07T18:00:00.000Z') });
    expect(r).toEqual(expect.objectContaining({ max: 0, usados: 0, restantes: 0 }));
    expect(Asistencia.countDocuments).not.toHaveBeenCalled();
  });

  it('nunca devuelve restantes negativos si hubo más visitas que pases', async () => {
    Suscripcion.find = vi.fn().mockReturnValue(suscripcionesCon(1));
    Asistencia.countDocuments = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(3) });
    const r = await pasesIncluidosSemana({ clubId: 'CARC', socioId: 's1', fecha: new Date('2026-10-07T18:00:00.000Z') });
    expect(r.restantes).toBe(0);
  });
});

describe('proximaRenovacion', () => {
  it('es el lunes siguiente a las 00:00 argentina', async () => {
    Suscripcion.find = vi.fn().mockReturnValue(suscripcionesCon(3));
    Asistencia.countDocuments = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(0) });
    const r = await pasesIncluidosSemana({ clubId: 'CARC', socioId: 's1', fecha: new Date('2026-10-07T18:00:00.000Z') });
    expect(new Date(r.proximaRenovacion).toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });
});
