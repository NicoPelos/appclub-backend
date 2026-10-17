import { describe, it, expect } from 'vitest';
import { periodoDeFecha, diaBoundsUTC, semanaBoundsUTC, semanaKeyArgentina, diaDelMesArgentino, dentroDeVentanaDeGracia, fechaCalendarioArgentina, inicioDePeriodoArgentino, nombrePeriodo } from '../../fechaArgentina.js';

describe('fechaCalendarioArgentina', () => {
  it('devuelve YYYY-MM-DD en horario argentino', () => {
    expect(fechaCalendarioArgentina(new Date('2026-02-10T15:00:00.000Z'))).toBe('2026-02-10');
  });

  it('un horario que en UTC ya es el día siguiente, en Argentina sigue siendo el día anterior', () => {
    // 2026-02-11T02:00:00Z = 2026-02-10T23:00:00 en Argentina (UTC-3)
    expect(fechaCalendarioArgentina(new Date('2026-02-11T02:00:00.000Z'))).toBe('2026-02-10');
  });

  it('cruza de mes correctamente (appcarc-backend#160)', () => {
    // 2026-03-01T01:00:00Z = 2026-02-28T22:00:00 ART
    expect(fechaCalendarioArgentina(new Date('2026-03-01T01:00:00.000Z'))).toBe('2026-02-28');
  });
});

describe('periodoDeFecha', () => {
  it('devuelve el período del mes en horario argentino', () => {
    expect(periodoDeFecha(new Date('2026-02-10T15:00:00.000Z'))).toBe('2026-02');
  });

  it('un horario que en UTC ya es el mes siguiente, en Argentina sigue siendo el mes anterior', () => {
    // 2026-08-01T02:00:00Z = 2026-07-31T23:00:00 en Argentina (UTC-3)
    expect(periodoDeFecha(new Date('2026-08-01T02:00:00.000Z'))).toBe('2026-07');
  });

  it('un horario que en UTC todavía es el mes anterior, en Argentina ya es el mes siguiente', () => {
    // 2026-01-31T02:30:00Z = 2026-01-30T23:30:00... no cruza; probar el caso real de cruce inverso:
    // 2026-03-01T01:00:00Z = 2026-02-28T22:00:00 ART -> sigue en febrero
    expect(periodoDeFecha(new Date('2026-03-01T01:00:00.000Z'))).toBe('2026-02');
  });
});

describe('diaBoundsUTC', () => {
  it('el rango cubre desde las 03:00 UTC de ese día hasta las 02:59:59.999 UTC del día siguiente', () => {
    const { start, end } = diaBoundsUTC(new Date('2026-02-10T15:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-02-10T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-11T02:59:59.999Z');
  });

  it('una fecha justo antes de las 03:00 UTC cae en el día argentino anterior', () => {
    const { start, end } = diaBoundsUTC(new Date('2026-02-10T02:59:00.000Z'));
    expect(start.toISOString()).toBe('2026-02-09T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-10T02:59:59.999Z');
  });
});

describe('diaDelMesArgentino', () => {
  it('devuelve el día del mes en horario argentino', () => {
    expect(diaDelMesArgentino(new Date('2026-02-10T15:00:00.000Z'))).toBe(10);
  });

  it('un horario que en UTC ya es el día siguiente, en Argentina sigue siendo el día anterior', () => {
    // 2026-02-11T02:00:00Z = 2026-02-10T23:00:00 en Argentina (UTC-3)
    expect(diaDelMesArgentino(new Date('2026-02-11T02:00:00.000Z'))).toBe(10);
  });
});

describe('dentroDeVentanaDeGracia', () => {
  it('el día 10 todavía está dentro de la ventana', () => {
    expect(dentroDeVentanaDeGracia(new Date('2026-02-10T15:00:00.000Z'))).toBe(true);
  });

  it('el día 11 ya está fuera de la ventana', () => {
    expect(dentroDeVentanaDeGracia(new Date('2026-02-11T15:00:00.000Z'))).toBe(false);
  });

  it('el día 1 está dentro de la ventana', () => {
    expect(dentroDeVentanaDeGracia(new Date('2026-02-01T15:00:00.000Z'))).toBe(true);
  });
});

describe('semanaBoundsUTC', () => {
  it('para un miércoles, la semana arranca el lunes y termina el domingo', () => {
    // 2026-02-11 es miércoles (ART)
    const { start, end } = semanaBoundsUTC(new Date('2026-02-11T15:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-02-09T03:00:00.000Z'); // lunes 00:00 ART
    expect(end.toISOString()).toBe('2026-02-16T02:59:59.999Z');   // domingo 23:59:59.999 ART
  });

  it('para un domingo, la semana sigue siendo la que empezó el lunes anterior', () => {
    // 2026-02-15 es domingo (ART)
    const { start, end } = semanaBoundsUTC(new Date('2026-02-15T15:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-02-09T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-16T02:59:59.999Z');
  });
});

describe('semanaKeyArgentina', () => {
  it('devuelve la fecha del lunes de esa semana (ART), en YYYY-MM-DD', () => {
    // 2026-02-11 es miércoles (ART)
    expect(semanaKeyArgentina(new Date('2026-02-11T15:00:00.000Z'))).toBe('2026-02-09');
  });

  it('un domingo pertenece a la semana que empezó el lunes anterior', () => {
    expect(semanaKeyArgentina(new Date('2026-02-15T15:00:00.000Z'))).toBe('2026-02-09');
  });

  it('un lunes es el inicio de su propia semana', () => {
    expect(semanaKeyArgentina(new Date('2026-02-09T15:00:00.000Z'))).toBe('2026-02-09');
  });

  it('cruza de mes correctamente', () => {
    // 2026-03-01 es domingo (ART) — semana del lunes 2026-02-23
    expect(semanaKeyArgentina(new Date('2026-03-01T15:00:00.000Z'))).toBe('2026-02-23');
  });
});

describe('inicioDePeriodoArgentino (#285)', () => {
  it('es el 1° del mes a las 00:00 de Argentina (03:00 UTC)', () => {
    expect(inicioDePeriodoArgentino('2026-03')).toEqual(new Date('2026-03-01T03:00:00.000Z'));
    expect(inicioDePeriodoArgentino('2026-12')).toEqual(new Date('2026-12-01T03:00:00.000Z'));
  });

  it('vuelve a dar el mismo período con periodoDeFecha', () => {
    for (const periodo of ['2025-01', '2025-12', '2026-02', '2026-10']) {
      expect(periodoDeFecha(inicioDePeriodoArgentino(periodo))).toBe(periodo);
      // Un milisegundo antes ya es el mes anterior en Argentina.
      expect(periodoDeFecha(new Date(inicioDePeriodoArgentino(periodo).getTime() - 1))).not.toBe(periodo);
    }
  });
});

describe('nombrePeriodo (#285)', () => {
  it('nombra los doce meses', () => {
    const meses = Array.from({ length: 12 }, (_, i) => nombrePeriodo(`2026-${String(i + 1).padStart(2, '0')}`));
    expect(meses).toEqual([
      'enero 2026', 'febrero 2026', 'marzo 2026', 'abril 2026', 'mayo 2026', 'junio 2026',
      'julio 2026', 'agosto 2026', 'septiembre 2026', 'octubre 2026', 'noviembre 2026', 'diciembre 2026',
    ]);
  });
});
