import { describe, it, expect } from 'vitest';
import { PRECIO_NO_VIGENTE, detallePrecioNoVigente, mensajePrecioNoVigente, mensajePrecioNoVigenteSocio } from '../../precioNoVigente.js';

describe('precioNoVigente (#317)', () => {
  it('nombra la cuota, el mes y dónde cargarlo', () => {
    expect(mensajePrecioNoVigente({ etiquetaNombre: 'Cuota Social', periodo: '2026-10' }))
      .toBe('No hay precio vigente para «Cuota Social» en octubre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.');
  });

  it('sin nombre ni período no queda un mensaje roto', () => {
    expect(mensajePrecioNoVigente({}))
      .toBe('No hay precio vigente para esta cuota. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.');
  });

  it('al socio no lo manda a la pantalla de precios', () => {
    const mensaje = mensajePrecioNoVigenteSocio({ etiquetaNombre: 'Remeras', periodo: '2026-12' });
    expect(mensaje).toBe('Todavía no está cargado el precio de «Remeras» para diciembre 2026, así que por ahora no se puede pagar online. Le avisamos al club para que lo cargue.');
    expect(mensaje).not.toContain('Etiquetas → Precios');
    expect(mensajePrecioNoVigenteSocio({})).toBe('Todavía no está cargado el precio de esta cuota, así que por ahora no se puede pagar online. Le avisamos al club para que lo cargue.');
  });

  it('el detalle lleva el código estable y los datos de la etiqueta como strings', () => {
    expect(detallePrecioNoVigente({ etiqueta: { _id: { toString: () => 'abc' }, nombre: 'Remeras' }, periodo: '2026-12' }))
      .toEqual({ code: PRECIO_NO_VIGENTE, etiquetaId: 'abc', etiquetaNombre: 'Remeras', periodo: '2026-12' });
    expect(detallePrecioNoVigente({ etiqueta: null }))
      .toEqual({ code: 'PRECIO_NO_VIGENTE', etiquetaId: null, etiquetaNombre: null, periodo: null });
  });
});
