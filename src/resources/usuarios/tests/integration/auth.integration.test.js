import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../../../../index.js';
import User from '../../models/User.js';
import { CLUB_ID, getOrCreateRol } from '../../../../testUtils/integrationHelpers.js';

const createUserConPassword = async (password, overrides = {}) => {
  const hashed = await bcrypt.hash(password, 10);
  const clubId = overrides.clubId || CLUB_ID;
  const nombresRoles = overrides.roles || ['secretaria'];
  const roles = await Promise.all(nombresRoles.map((nombre) => getOrCreateRol({ clubId, nombre })));
  return User.create({
    email: overrides.email || 'secretaria@carc.local',
    password: hashed,
    clubId,
    active: overrides.active ?? true,
    ...overrides,
    roles: roles.map((r) => r._id),
  });
};

describe('POST /api/auth/login (integración)', () => {
  it('devuelve token y datos de usuario con credenciales correctas', async () => {
    await createUserConPassword('unaClaveSegura123');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'secretaria@carc.local', password: 'unaClaveSegura123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('secretaria@carc.local');
  });

  it('rechaza contraseña incorrecta (400)', async () => {
    await createUserConPassword('unaClaveSegura123');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'secretaria@carc.local', password: 'incorrecta' });

    expect(res.status).toBe(400);
  });

  it('rechaza un email inexistente (400)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'noexiste@carc.local', password: 'cualquiera' });

    expect(res.status).toBe(400);
  });

  it('rechaza un usuario desactivado (403)', async () => {
    await createUserConPassword('unaClaveSegura123', { active: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'secretaria@carc.local', password: 'unaClaveSegura123' });

    expect(res.status).toBe(403);
  });
});

describe('Invalidación de sesión por cambio de contraseña (integración)', () => {
  it('rechaza un token emitido antes de un cambio de contraseña posterior', async () => {
    const user = await createUserConPassword('claveOriginal123', { roles: ['superadmin'] });

    const tokenViejo = jwt.sign(
      { id: user._id, roles: ['superadmin'], clubId: user.clubId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    // Simula un cambio de contraseña posterior a la emisión del token
    await new Promise((resolve) => setTimeout(resolve, 1100));
    user.passwordChangedAt = new Date();
    await user.save();

    const res = await request(app)
      .get('/api/socios')
      .set('Authorization', `Bearer ${tokenViejo}`);

    expect(res.status).toBe(401);
  });

  it('acepta un token emitido después del cambio de contraseña', async () => {
    const user = await createUserConPassword('claveOriginal123', { roles: ['superadmin'] });
    user.passwordChangedAt = new Date();
    await user.save();

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const tokenNuevo = jwt.sign(
      { id: user._id, roles: ['superadmin'], clubId: user.clubId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    const res = await request(app)
      .get('/api/socios')
      .set('Authorization', `Bearer ${tokenNuevo}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/refresh (integración)', () => {
  it('renueva el access token a partir de un refresh token vigente', async () => {
    await createUserConPassword('unaClaveSegura123', { roles: ['superadmin'] });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'secretaria@carc.local', password: 'unaClaveSegura123' });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('secretaria@carc.local');

    // El access token nuevo funciona contra un endpoint protegido.
    const protegido = await request(app)
      .get('/api/socios')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(protegido.status).toBe(200);
  });

  it('rota el refresh token: el usado no sirve una segunda vez', async () => {
    await createUserConPassword('unaClaveSegura123');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'secretaria@carc.local', password: 'unaClaveSegura123' });

    await request(app).post('/api/auth/refresh').send({ refreshToken: loginRes.body.refreshToken });
    const segundoUso = await request(app).post('/api/auth/refresh').send({ refreshToken: loginRes.body.refreshToken });

    expect(segundoUso.status).toBe(401);
  });

  it('rechaza un refreshToken inexistente o inválido (401)', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'no-existe' });
    expect(res.status).toBe(401);
  });

  it('rechaza el pedido sin refreshToken (400)', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout (integración)', () => {
  it('invalida el token: no se puede usar después de hacer logout', async () => {
    const user = await createUserConPassword('claveOriginal123', { roles: ['superadmin'] });
    const token = jwt.sign(
      { id: user._id, roles: ['superadmin'], clubId: user.clubId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    const logoutRes = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);

    const res = await request(app).get('/api/socios').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
