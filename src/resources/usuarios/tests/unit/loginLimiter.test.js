import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { crearLoginLimiter } from '../../middleware/loginLimiter.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/login', crearLoginLimiter(), (req, res) => {
    if (req.body.password === 'correcta') return res.status(200).json({ ok: true });
    return res.status(400).json({ message: 'Credenciales inválidas.' });
  });
  return app;
};

describe('loginLimiter (appcarc-backend#250)', () => {
  it('bloquea a partir del intento 11 fallido contra la misma cuenta desde la misma IP', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      await request(app).post('/login').send({ email: 'a@club.ar', password: 'mal' });
    }
    const res = await request(app).post('/login').send({ email: 'a@club.ar', password: 'mal' });
    expect(res.status).toBe(429);
  });

  it('no bloquea a otra persona desde la misma IP (ej. la wifi del club)', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      await request(app).post('/login').send({ email: 'a@club.ar', password: 'mal' });
    }
    const res = await request(app).post('/login').send({ email: 'otra@club.ar', password: 'correcta' });
    expect(res.status).toBe(200);
  });

  it('los logins exitosos no cuentan para el límite', async () => {
    const app = buildApp();
    for (let i = 0; i < 15; i++) {
      await request(app).post('/login').send({ email: 'a@club.ar', password: 'correcta' });
    }
    const res = await request(app).post('/login').send({ email: 'a@club.ar', password: 'correcta' });
    expect(res.status).toBe(200);
  });
});
