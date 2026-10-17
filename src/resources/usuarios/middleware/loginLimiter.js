import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Solo el login recibe contraseña, así que es el único que se limita. La clave
// combina IP y email: varias personas detrás de la misma IP del club no se
// bloquean entre sí, pero sí se frena la fuerza bruta contra una cuenta
// (appcarc-backend#250). Los logins exitosos no cuentan.
export const crearLoginLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de login. Intentá de nuevo en 15 minutos.' },
});

export default crearLoginLimiter;
