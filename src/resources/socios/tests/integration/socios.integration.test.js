import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../../../index.js';
import User from '../../../usuarios/models/User.js';
import Socio from '../../models/Socio.js';
import { getOrCreateRol } from '../../../../testUtils/integrationHelpers.js';

const CLUB_ID = 'CARC';

const createAdminToken = async () => {
  const rol = await getOrCreateRol({ clubId: CLUB_ID, nombre: 'superadmin' });
  const user = await User.create({
    email: 'admin-test@carc.local',
    password: 'hashed-not-used',
    roles: [rol._id],
    clubId: CLUB_ID,
  });
  return jwt.sign({ id: user._id, roles: [rol.slug], clubId: user.clubId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

describe('GET /api/socios (integración)', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/socios');
    expect(res.status).toBe(401);
  });

  it('devuelve los socios del club cuando el token es válido', async () => {
    const token = await createAdminToken();
    await Socio.create({
      apellido: 'Perez',
      nombre: 'Juan',
      dni: '12345678',
      clubId: CLUB_ID,
      estado: 'Activo',
      createdBy: 'test',
      updatedBy: 'test',
    });

    const res = await request(app)
      .get('/api/socios')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const socios = Array.isArray(res.body) ? res.body : res.body.socios;
    expect(socios.some((s) => s.dni === '12345678')).toBe(true);
  });
});
