const MP_API_BASE = 'https://api.mercadopago.com';
const PAGE_SIZE = 50;
const MAX_RESULTADOS = 500;

/**
 * Busca pagos de la cuenta de Mercado Pago del club, en una de dos
 * direcciones (ver `direccion`). Dos modos de rango:
 * - `fecha` + `rangoDias`: ventana centrada en una fecha (vincular contra un
 *   Movimiento puntual).
 * - `desde` + `hasta`: rango explícito (revisión general de pagos sin
 *   vincular, paginada).
 *
 * /v1/payments/search trae tanto plata que ENTRÓ (el club como
 * `collector_id`) como plata que SALIÓ por transferencia interna de MP a
 * otra cuenta MP, no por CVU/banco (el club como `payer_id`) — sin filtrar
 * por una sola dirección a la vez, una transferencia saliente aparecía en la
 * lista de "sin vincular" de ingresos como si fuera plata que entró (bug
 * encontrado 2026-08-25). `direccion: 'ingreso'` (default) filtra por
 * `collector_id`; `direccion: 'egreso'` filtra por `payer_id`, para vincular
 * pagos del club a proveedores hechos por MP.
 *
 * LIMITACIÓN CONOCIDA (verificado 2026-09-07): algunas transferencias
 * salientes que sí aparecen en "Actividad" del panel de MP no vienen en
 * `/v1/payments/search`, aunque se pida el rango de fechas completo sin
 * ningún filtro nuestro — probablemente porque salieron por la red
 * interoperable de Transferencias 3.0 (CVU/CBU, compensada por el BCRA vía
 * COELSA) en vez del circuito interno de "pagos" de MP. Se probó también el
 * reporte oficial de conciliación `/v1/account/settlement_report`
 * ("Todas las transacciones") como alternativa: tampoco las incluye. No hay
 * ninguna API pública de MP que las exponga — para esos casos puntuales, el
 * Egreso se carga a mano en la app sin vínculo automático al pago real.
 */
export const buscarPagosMercadoPago = async ({ accessToken, fecha, rangoDias = 5, desde, hasta, direccion = 'ingreso' }) => {
  let desdeDate;
  let hastaDate;
  if (desde || hasta) {
    desdeDate = desde ? new Date(desde) : new Date(0);
    hastaDate = hasta ? new Date(hasta) : new Date();
  } else {
    desdeDate = new Date(fecha);
    desdeDate.setDate(desdeDate.getDate() - rangoDias);
    hastaDate = new Date(fecha);
    hastaDate.setDate(hastaDate.getDate() + rangoDias);
  }

  const userRes = await fetch(`${MP_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) {
    throw new Error(`Mercado Pago devolvió ${userRes.status} identificando la cuenta`);
  }
  const clubUserId = (await userRes.json()).id;

  const resultados = [];
  let offset = 0;
  while (offset < MAX_RESULTADOS) {
    const params = new URLSearchParams({
      sort: 'date_approved',
      criteria: 'desc',
      range: 'date_approved',
      begin_date: desdeDate.toISOString(),
      end_date: hastaDate.toISOString(),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    const response = await fetch(`${MP_API_BASE}/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mercado Pago devolvió ${response.status} buscando pagos`);
    }
    const data = await response.json();
    const batch = data.results ?? [];
    resultados.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Un egreso también puede ser un pago tipo compra (QR, link, pago de
  // servicios/pólizas: `regular_payment`) hecho desde la cuenta del club — no
  // aparece como transferencia. Para ingresos no se incluye: ahí los
  // regular_payment son cobros de links de pago de la app, ya conciliados aparte.
  const tiposValidos = direccion === 'egreso'
    ? ['money_transfer', 'account_fund', 'regular_payment']
    : ['money_transfer', 'account_fund'];

  return resultados
    .filter((p) => (
      p.status === 'approved'
      && tiposValidos.includes(p.operation_type)
      && (direccion === 'egreso' ? p.payer_id === clubUserId : p.collector_id === clubUserId)
    ))
    .map((p) => ({
      paymentId: String(p.id),
      // Para un egreso, "transaction_amount" es lo que le llegó al
      // destinatario, no lo que salió de la cuenta del club — MP descuenta
      // un cargo aparte (ver charges_details) que sí está incluido en
      // total_paid_amount. Un Movimiento de egreso tiene que reflejar la
      // plata real que salió, así que se usa ese campo (con fallback si no
      // viniera, aunque en la práctica siempre está presente).
      monto: direccion === 'egreso' ? (p.transaction_details?.total_paid_amount ?? p.transaction_amount) : p.transaction_amount,
      fecha: p.date_approved,
      // Para un ingreso, la contraparte es quien pagó (`payer`); para un
      // egreso, el club es el payer y la contraparte es quien cobró
      // (`collector`) — MP casi nunca expone su email (privacidad), por eso
      // sigue "sin email" en la mayoría de los egresos.
      payerEmail: (direccion === 'egreso' ? p.collector?.email : p.payer?.email) ?? '',
      descripcion: p.description ?? '',
    }));
};
