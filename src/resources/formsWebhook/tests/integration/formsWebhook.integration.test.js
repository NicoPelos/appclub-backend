import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';

describe('POST /api/forms-webhook (integración)', () => {
  it('rechaza sin el secreto correcto (401)', async () => {
    const res = await request(app)
      .post('/api/forms-webhook')
      .send({ tipo: 'socio', nombre: 'Juan Pérez' });

    expect(res.status).toBe(401);
  });

  it('rechaza un tipo inválido (400)', async () => {
    const res = await request(app)
      .post('/api/forms-webhook')
      .set('x-webhook-secret', process.env.FORMS_WEBHOOK_SECRET)
      .send({ tipo: 'invalido', nombre: 'Juan Pérez' });

    expect(res.status).toBe(400);
  });

  it('acepta una solicitud válida con el secreto correcto', async () => {
    const res = await request(app)
      .post('/api/forms-webhook')
      .set('x-webhook-secret', process.env.FORMS_WEBHOOK_SECRET)
      .send({ tipo: 'escuelita_ninos', nombre: 'Sofía Gómez' });

    expect(res.status).toBe(200);
  });
});
