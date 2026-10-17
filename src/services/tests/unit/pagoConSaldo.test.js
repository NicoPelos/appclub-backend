import { describe, it, expect } from 'vitest';
import { aplicarPagoConSaldo } from '../../pagoConSaldo.service.js';

describe('aplicarPagoConSaldo', () => {
  const baseDoc = () => ({
    pagos: [],
    montoPagadoSnapshot: 0,
    montoEsperadoSnapshot: 30000,
    estado: 'pendiente',
    updatedBy: null,
  });

  it('registra el pago en pagos[] con sus datos', () => {
    const doc = baseDoc();
    const fecha = new Date('2026-09-14T15:00:00Z');
    aplicarPagoConSaldo({
      doc, monto: 30000, fecha, paymentMethod: 'Transferencia', movimientoId: 'mov1', actor: 'user@test.com',
    });

    expect(doc.pagos).toEqual([{
      monto: 30000, fecha, paymentMethod: 'Transferencia', movimientoId: 'mov1', esPagoParcial: false,
    }]);
  });

  it('guarda esPagoParcial en el propio pago, no solo lo usa para decidir estado', () => {
    const doc = baseDoc();
    aplicarPagoConSaldo({
      doc, monto: 15000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov1', esPagoParcial: true, actor: 'a',
    });
    expect(doc.pagos[0].esPagoParcial).toBe(true);
  });

  it('incluye cobroId solo cuando se lo pasan', () => {
    const doc = baseDoc();
    aplicarPagoConSaldo({
      doc, monto: 30000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov1', cobroId: 'cobro1', actor: 'a',
    });
    expect(doc.pagos[0].cobroId).toBe('cobro1');

    const docSinCobro = baseDoc();
    aplicarPagoConSaldo({
      doc: docSinCobro, monto: 30000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov1', actor: 'a',
    });
    expect(docSinCobro.pagos[0]).not.toHaveProperty('cobroId');
  });

  it('suma montoPagadoSnapshot sobre pagos previos', () => {
    const doc = baseDoc();
    doc.pagos.push({ monto: 10000 });
    doc.montoPagadoSnapshot = 10000;

    aplicarPagoConSaldo({
      doc, monto: 5000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov2', actor: 'a',
    });

    expect(doc.montoPagadoSnapshot).toBe(15000);
  });

  it('queda en pagada cuando no viene esPagoParcial, sin importar el monto', () => {
    const doc = baseDoc();
    aplicarPagoConSaldo({
      doc, monto: 5000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov1', actor: 'a',
    });
    expect(doc.estado).toBe('pagada');
  });

  it('queda en parcial cuando esPagoParcial es true y falta saldo', () => {
    const doc = baseDoc();
    aplicarPagoConSaldo({
      doc, monto: 15000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov1', esPagoParcial: true, actor: 'a',
    });
    expect(doc.estado).toBe('parcial');
  });

  it('cierra en pagada cuando esPagoParcial es true pero ya se cubrió el total', () => {
    const doc = baseDoc();
    doc.pagos.push({ monto: 15000 });
    doc.montoPagadoSnapshot = 15000;

    aplicarPagoConSaldo({
      doc, monto: 15000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov2', esPagoParcial: true, actor: 'a',
    });

    expect(doc.estado).toBe('pagada');
  });

  it('actualiza updatedBy', () => {
    const doc = baseDoc();
    aplicarPagoConSaldo({
      doc, monto: 1000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: 'mov1', actor: 'staff@test.com',
    });
    expect(doc.updatedBy).toBe('staff@test.com');
  });
});
