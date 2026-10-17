import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import routes from './appRoutes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { startInstagramSyncJob } from './jobs/syncInstagram.job.js';
import { startRecordatorioCuotasJob } from './jobs/recordatorioCuotas.job.js';
import { startSyncSheetsJob } from './jobs/syncSheets.job.js';
import { startFaaSyncJob } from './jobs/syncFaaFeed.job.js';
import { startResetDemoJob } from './jobs/resetDemo.job.js';
import { startAlertaPreciosJob } from './jobs/alertaPrecios.job.js';
import { startAvisoMorosidadJob } from './jobs/avisoMorosidad.job.js';
import { startReconciliarPagosMercadoPagoJob } from './jobs/reconciliarPagosMercadoPago.job.js';

// Load environment variables
dotenv.config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio — no se puede arrancar sin él. Definilo en backend/.env.');
}

// No se corta el arranque: sin la variable, Mercado Pago cae al host de
// Tailscale, que sigue funcionando. Pero las preferencias nuevas tienen que
// salir con el dominio público (#303).
if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_PUBLIC_URL?.trim()) {
  console.warn('⚠️  BACKEND_PUBLIC_URL no está definida: los links de Mercado Pago (notification_url y back_urls) usan el host de Tailscale. Definila en el .env (ej. https://app.appclub.net.ar).');
}

const app = express();
const PORT = process.env.PORT || 3001;

// Detrás de un solo reverse proxy (Tailscale Funnel / ngrok) que agrega
// X-Forwarded-For — sin esto, express-rate-limit rechaza ese header por
// considerarlo no confiable y tira ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// Swagger Configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Club Andino Río Cuarto API',
      version: '1.0.0',
      description: 'API para la gestión de socios, cuotas y movimientos del CARC',
      contact: {
        name: 'Secretaría CARC',
      },
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Servidor de Desarrollo',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/appRoutes.js', './src/resources/**/*.js'], // Ahora Swagger escanea los recursos y el router global
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

// Middleware
// En producción, la PWA/appCARC-web/superadmin se sirven desde el mismo
// gateway/dominio que la API (same-origin, CORS ni entra en juego ahí) —
// esto es principalmente para los dev servers locales (Vite de appCARC-web
// y superadmin, Expo web). CORS_ORIGINS permite sumar dominios de producción
// si en algún momento se sirve algo desde otro host, sin hardcodearlo acá.
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3002', 'http://localhost:3003',
  'http://localhost:8081', 'http://localhost:19006',
];
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS;
app.use(cors({ origin: corsOrigins }));
// contentSecurityPolicy: false porque este mismo Express sirve Swagger UI
// (/api-docs) y la PWA (/app), ambos con scripts inline/bundles propios que
// la CSP por default de helmet bloquearía — el resto de los headers
// (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) siguen activos.
app.use(helmet({ contentSecurityPolicy: false }));
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
// Los tests de integración (supertest) pegan contra este mismo Express real,
// todos desde el mismo origen — correr la suite completa fácilmente supera
// 300 requests/60s y algunos tests reciben un 429 real en vez del código que
// están probando (appcarc-backend#143).
if (process.env.NODE_ENV !== 'test') {
  app.use('/api', apiLimiter);
}
app.use(express.json());

// PWA de la app (alternativa a la instalación nativa, pensada para iOS) —
// tiene que montarse ANTES que el express.static genérico de más abajo: ese
// también matchea /app/* (sirve cualquier subcarpeta de public/) y, al estar
// registrado primero, respondía él sin llegar nunca a este middleware ni a
// su cache-control. Sin cache-control explícito acá, Safari (sobre todo
// "Agregar a inicio", que se comporta más como una app instalada que como
// una pestaña normal) podía quedarse sirviendo el index.html viejo
// indefinidamente sin volver a pedirlo al servidor, aunque ya hubiera una
// versión nueva deployada — el usuario ve la app vieja sin ningún indicio de
// que existe una más nueva. Los archivos con hash en el nombre
// (_expo/static/...) sí pueden cachearse agresivamente: cualquier cambio de
// contenido les cambia la URL.
app.use('/app', express.static(join(__dirname, '../public/app'), {
  extensions: ['html'],
  // cacheControl:false — sin esto, serve-static igual pisa el Cache-Control
  // de setHeaders con su propio default (max-age=0) después de emitir el
  // evento que dispara este callback.
  cacheControl: false,
  setHeaders: (res, path) => {
    if (path.includes('/_expo/static/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.use(express.static(join(__dirname, '../public')));
app.use('/uploads', express.static(join(__dirname, '../uploads')));

// MongoDB Connection
if (process.env.NODE_ENV !== 'test') {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch((err) => {
      console.error('❌ MongoDB connection error:', err);
      process.exit(1); 
    });
}

// Swagger UI Route
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Basic route
app.get('/', (req, res) => {
  res.send('Club Andino Rio Cuarto API');
});

// Página pública "link en bio" para Instagram
app.use('/link', express.static(join(__dirname, '../public/link')));

// Pantallas a las que Mercado Pago redirige tras un pago con link (ver
// back_urls en guardarPreferenciaMercadoPago.js) — antes caían en la raíz
// de la API, que solo devuelve texto plano.
app.use('/pago', express.static(join(__dirname, '../public/pago'), { extensions: ['html'] }));

// Use application routes
app.use('/api', routes);

// Start the server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    startInstagramSyncJob();
    startRecordatorioCuotasJob();
    startSyncSheetsJob();
    startFaaSyncJob();
    startResetDemoJob();
    startAlertaPreciosJob();
    startAvisoMorosidadJob();
    startReconciliarPagosMercadoPagoJob();
  });
}

export default app;
