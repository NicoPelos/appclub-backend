import mongoose from 'mongoose';
import Socio from '../../socios/models/Socio.js';
import MercadoPagoConfig from '../models/MercadoPagoConfig.js';
import PagoOnlineIntent from '../models/PagoOnlineIntent.js';
import { BusinessError } from './crearPreferenciaCobroMercadoPago.errors.js';

// Fallback solo para dev: en producción BACKEND_PUBLIC_URL tiene que estar
// definida con el dominio público (index.js avisa al arrancar si falta).
// Ver #303 y #327.
const BACKEND_PUBLIC_URL_FALLBACK = 'https://app.appclub.net.ar';
const MP_API_BASE = 'https://api.mercadopago.com';

// Se lee en cada llamada y no al importar el módulo: en dev, dotenv.config()
// corre en index.js después de que los imports ya se evaluaron. Sin barra
// final, para no armar URLs con `//`.
export const getBackendPublicUrl = () =>
  (process.env.BACKEND_PUBLIC_URL?.trim() || BACKEND_PUBLIC_URL_FALLBACK).replace(/\/+$/, '');

// Cola común a los dos flujos que generan un link de pago (staff y el propio
// socio): ambos ya resolvieron sus items e importes por su cuenta (con
// distinta confianza en el monto) y solo necesitan crear la preferencia en
// Mercado Pago con un único ítem agregado y guardar el PagoOnlineIntent.
//
// `normalizedItems` puede traer más de un socio (un tutor pagando su propia
// cuota y la de un hijo en el mismo link) — `primarySocioId` es solo el dueño
// "principal" que se guarda en el intent (campo legacy, pensado para un solo
// socio) y el que se usa como fallback de título/payer si no hay más datos.
export const crearPreferenciaYGuardarIntent = async ({
  clubId, requestedByUserId, requestedByEmail, primarySocioId, normalizedItems, totalAmount, description, payerEmail,
}) => {
  if (totalAmount <= 0) throw new BusinessError('El monto a cobrar debe ser mayor a cero');

  const config = await MercadoPagoConfig.findOne({ clubId, active: true });
  if (!config) throw new BusinessError('Este club todavía no configuró Mercado Pago');

  const socioIds = [...new Set(normalizedItems.map((item) => String(item.socioId)))];
  const socios = await Socio.find({ _id: { $in: socioIds }, clubId, active: true }).lean();
  if (socios.length !== socioIds.length) throw new BusinessError('Socio no encontrado', 404);

  const primero = socios.find((s) => String(s._id) === String(primarySocioId)) ?? socios[0];
  const titulo = socios.length === 1
    ? `Cobro ${primero.nombre} ${primero.apellido}`
    : `Cobro ${primero.nombre} ${primero.apellido} y ${socios.length - 1} más`;

  const intentId = new mongoose.Types.ObjectId();
  const externalReference = intentId.toString();

  const email = payerEmail || primero.correoElectronico;
  const publicUrl = getBackendPublicUrl();

  const preferenceBody = {
    items: [{
      title: `${titulo}${description ? ` — ${description}` : ''}`,
      quantity: 1,
      unit_price: totalAmount,
      currency_id: 'ARS',
    }],
    external_reference: externalReference,
    notification_url: `${publicUrl}/api/webhooks/mercadopago/${clubId}`,
    back_urls: {
      success: `${publicUrl}/pago/exito`,
      failure: `${publicUrl}/pago/error`,
      pending: `${publicUrl}/pago/pendiente`,
    },
    auto_return: 'approved',
    payer: email ? { email } : undefined,
    // Excluye tarjeta (crédito/débito/prepaga), efectivo en puntos de pago y
    // cajero — la comisión de MP por esos medios (~2-6%) se la termina
    // comiendo el club. Deja disponibles solo transferencia bancaria y saldo
    // en cuenta de MP, que no tienen ese cargo (o es mucho menor).
    payment_methods: {
      excluded_payment_types: [
        { id: 'credit_card' },
        { id: 'debit_card' },
        { id: 'prepaid_card' },
        { id: 'ticket' },
        { id: 'atm' },
      ],
    },
  };

  const mpResponse = await fetch(`${MP_API_BASE}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify(preferenceBody),
  });

  if (!mpResponse.ok) {
    const errBody = await mpResponse.text().catch(() => '');
    console.error('Error creando preferencia en Mercado Pago:', mpResponse.status, errBody);
    throw new BusinessError('No se pudo generar el link de pago con Mercado Pago', 502);
  }

  const mpData = await mpResponse.json();

  const intent = new PagoOnlineIntent({
    _id: intentId,
    clubId,
    socioId: primarySocioId,
    requestedByUserId,
    requestedByEmail,
    items: normalizedItems,
    totalAmount,
    preferenceId: mpData.id,
    externalReference,
  });
  await intent.save();

  return { initPoint: mpData.init_point, preferenceId: mpData.id, intentId: externalReference };
};

