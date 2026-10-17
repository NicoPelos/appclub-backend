import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../../../index.js';
import Socio from '../../models/Socio.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import { CLUB_ID, createAdminUser, createSocio, createEtiqueta, createSuscripcion } from '../../../../testUtils/integrationHelpers.js';

describe('DELETE /api/socios/:id y restore (integración)', () => {
  it('desactiva un socio (soft delete) y luego lo restaura', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const delRes = await request(app).delete(`/api/socios/${socio._id}`).set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    const enPapelera = await Socio.findById(socio._id);
    expect(enPapelera.active).toBe(false);
    expect(enPapelera.deletedAt).toBeTruthy();

    const restoreRes = await request(app).put(`/api/socios/${socio._id}/restore`).set('Authorization', `Bearer ${token}`);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.active).toBe(true);
  });

  it('devuelve 404 al borrar un socio ya inactivo', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    await request(app).delete(`/api/socios/${socio._id}`).set('Authorization', `Bearer ${token}`);

    const res = await request(app).delete(`/api/socios/${socio._id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 al restaurar un socio que no está en papelera', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const res = await request(app).put(`/api/socios/${socio._id}/restore`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('cierra las suscripciones activas del socio al borrarlo (papelera)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id });

    const res = await request(app).delete(`/api/socios/${socio._id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const actualizada = await Suscripcion.findById(suscripcion._id);
    expect(actualizada.fechaHasta).not.toBeNull();
  });
});

describe('GET /api/socios/:id/qr (integración)', () => {
  it('genera un token QR válido para el socio', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const res = await request(app).get(`/api/socios/${socio._id}/qr`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.body.token);
    expect(decoded.socioId).toBe(String(socio._id));
    expect(decoded.clubId).toBe(CLUB_ID);
    expect(decoded.type).toBe('socio_qr');
  });

  it('un socio no puede pedir el QR de otro socio (403)', async () => {
    const socio = await createSocio();
    const otroSocio = await createSocio();
    const { token } = await createAdminUser({ roles: ['socio'], socioId: String(socio._id) });

    const res = await request(app).get(`/api/socios/${otroSocio._id}/qr`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/socios/verify (integración)', () => {
  it('verifica un socio por token QR', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const qrRes = await request(app).get(`/api/socios/${socio._id}/qr`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post('/api/socios/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: qrRes.body.token });

    expect(res.status).toBe(200);
  });

  it('verifica un socio por DNI', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const res = await request(app)
      .post('/api/socios/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ dni: socio.dni });

    expect(res.status).toBe(200);
  });

  it('rechaza un QR generado para otro club (403)', async () => {
    const { token } = await createAdminUser({ clubId: CLUB_ID });
    const socioOtroClub = await createSocio({ clubId: 'OTRO_CLUB' });
    const { token: tokenOtroClub } = await createAdminUser({ clubId: 'OTRO_CLUB' });

    const qrRes = await request(app)
      .get(`/api/socios/${socioOtroClub._id}/qr`)
      .set('Authorization', `Bearer ${tokenOtroClub}`);
    expect(qrRes.status).toBe(200);

    const res = await request(app)
      .post('/api/socios/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: qrRes.body.token });

    expect(res.status).toBe(403);
  });
});
