import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifyMercadoPagoSignature } from '../../services/verifyMercadoPagoSignature.service.js';

// NOTA: estos casos verifican que la implementación es internamente consistente
// con el algoritmo documentado por Mercado Pago (manifest "id:...;request-id:...;ts:...;"
// + HMAC-SHA256), generando la firma esperada con la misma fórmula en el test.
// No incluyen el vector de ejemplo oficial publicado por MP (no se pudo reproducir
// con certeza desde acá) — antes de ir a producción, cross-chequear contra una
// notificación real de MP en el sandbox (ver plan de pruebas manual).
const WEBHOOK_SECRET = 'test-secret-1234';
const DATA_ID = '123456789';
const X_REQUEST_ID = 'req-abc-123';
const TS = '1700000000';

const buildValidSignature = ({
  dataId = DATA_ID,
  xRequestId = X_REQUEST_ID,
  ts = TS,
  secret = WEBHOOK_SECRET,
} = {}) => {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return { xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId, webhookSecret: secret };
};

describe('verifyMercadoPagoSignature', () => {
  it('acepta una firma válida', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature(args)).toBe(true);
  });

  it('normaliza dataId a minúsculas antes de firmar', () => {
    const args = buildValidSignature({ dataId: DATA_ID });
    // el webhook llega con dataId en mayúsculas, pero la firma se generó con minúsculas
    expect(verifyMercadoPagoSignature({ ...args, dataId: DATA_ID.toUpperCase() })).toBe(true);
  });

  it('rechaza si el v1 no coincide (ts alterado)', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, xSignature: `ts=9999999999,v1=${args.xSignature.split('v1=')[1]}` })).toBe(false);
  });

  it('rechaza si el secreto no coincide', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, webhookSecret: 'otro-secreto' })).toBe(false);
  });

  it('rechaza si falta x-signature', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, xSignature: undefined })).toBe(false);
  });

  it('rechaza si falta x-request-id', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, xRequestId: undefined })).toBe(false);
  });

  it('rechaza si falta dataId', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, dataId: undefined })).toBe(false);
  });

  it('rechaza si falta webhookSecret', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, webhookSecret: undefined })).toBe(false);
  });

  it('rechaza x-signature mal formado (sin v1)', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, xSignature: `ts=${TS}` })).toBe(false);
  });

  it('rechaza una v1 de longitud distinta sin explotar timingSafeEqual', () => {
    const args = buildValidSignature();
    expect(verifyMercadoPagoSignature({ ...args, xSignature: `ts=${TS},v1=abcd` })).toBe(false);
  });
});
