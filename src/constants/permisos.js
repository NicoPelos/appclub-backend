export const PERMISOS = {
  // Socios
  SOCIOS_READ:    'socios:read',
  SOCIOS_CREATE:  'socios:create',
  SOCIOS_WRITE:   'socios:write',
  SOCIOS_DELETE:  'socios:delete',
  SOCIOS_RESTORE: 'socios:restore',

  // Cobros
  COBROS_READ:   'cobros:read',
  COBROS_WRITE:  'cobros:write',
  COBROS_DELETE: 'cobros:delete',
  // Cobrar la deuda de suscripciones al precio que regía cada mes en vez del
  // de hoy, con motivo obligatorio (appcarc-backend#285).
  COBROS_PRECIO_HISTORICO: 'cobros:precio-historico',

  // Movimientos
  MOVIMIENTOS_READ:   'movimientos:read',
  MOVIMIENTOS_WRITE:  'movimientos:write',
  MOVIMIENTOS_DELETE: 'movimientos:delete',

  // Escuelita
  ESCUELITA_READ:    'escuelita:read',
  ESCUELITA_WRITE:   'escuelita:write',
  ESCUELITA_DELETE:  'escuelita:delete',
  ESCUELITA_CHECKIN: 'escuelita:checkin',
  // Check-in de un socio sobre sí mismo (o un hijo vinculado), vía QR de
  // pared — distinto de escuelita:checkin (staff registrando a cualquiera).
  ESCUELITA_CHECKIN_PROPIO: 'escuelita:checkin_propio',

  // Muro Libre
  MURO_LIBRE_READ:    'muroLibre:read',
  MURO_LIBRE_WRITE:   'muroLibre:write',
  MURO_LIBRE_DELETE:  'muroLibre:delete',
  MURO_LIBRE_CHECKIN: 'muroLibre:checkin',
  // Check-in de un socio sobre sí mismo vía QR de pared — ver ESCUELITA_CHECKIN_PROPIO.
  MURO_LIBRE_CHECKIN_PROPIO: 'muroLibre:checkin_propio',

  // Horarios
  HORARIOS_READ:   'horarios:read',
  HORARIOS_WRITE:  'horarios:write',
  HORARIOS_DELETE: 'horarios:delete',
  HORARIOS_DEUDA:  'horarios:deuda',

  // Etiquetas
  ETIQUETAS_READ:   'etiquetas:read',
  ETIQUETAS_WRITE:  'etiquetas:write',
  ETIQUETAS_DELETE: 'etiquetas:delete',

  // Precios
  PRECIOS_READ:   'precios:read',
  PRECIOS_WRITE:  'precios:write',
  PRECIOS_DELETE: 'precios:delete',

  // Planes
  PLANES_READ:   'planes:read',
  PLANES_WRITE:  'planes:write',
  PLANES_DELETE: 'planes:delete',

  // Suscripciones
  SUSCRIPCIONES_READ:   'suscripciones:read',
  SUSCRIPCIONES_WRITE:  'suscripciones:write',
  SUSCRIPCIONES_CLOSE:  'suscripciones:close',
  SUSCRIPCIONES_DELETE: 'suscripciones:delete',

  // Asistencias
  ASISTENCIAS_READ:  'asistencias:read',
  ASISTENCIAS_WRITE: 'asistencias:write',

  // Advertencias — panel de seguimiento con datos de contacto de socios
  // (nombre, teléfono, WhatsApp), separado de asistencias:read a propósito:
  // ese permiso también lo usan roles como profesor/colaborador/socio para
  // ver asistencia (propia o de sus alumnos), que no debe habilitar ver
  // los datos de contacto de todo el club para hacer seguimiento de deuda.
  ADVERTENCIAS_READ: 'advertencias:read',

  // Novedades
  NOVEDADES_WRITE: 'novedades:write',

  // Export
  EXPORT_SHEETS: 'export:sheets',

  // Audit
  AUDIT_READ:   'audit:read',
  AUDIT_REVERT: 'audit:revert',

  // Usuarios (gestión dentro del club)
  USUARIOS_WRITE: 'usuarios:write',

  // Roles (gestión dentro del club)
  ROLES_READ:   'roles:read',
  ROLES_WRITE:  'roles:write',
  ROLES_DELETE: 'roles:delete',

  // Recursos externos (topos de escalada, senderos de trekking, etc. — links
  // curados a sitios de terceros como theCrag/Wikiloc, sin dato propio del club)
  RECURSOS_READ:   'recursos:read',
  RECURSOS_WRITE:  'recursos:write',
  RECURSOS_DELETE: 'recursos:delete',

  // Eventos (viajes, cursos, ventas puntuales — appcarc-backend#178): roster
  // de participantes socios y no socios, cada uno con su propio pago/seña.
  EVENTOS_READ:   'eventos:read',
  EVENTOS_WRITE:  'eventos:write',
  EVENTOS_DELETE: 'eventos:delete',

  // Inventario (equipo del club: cuerdas, cascos, herramientas, etc.) — cada
  // ítem con su foto y su estado. Lectura y escritura separadas por rol.
  INVENTARIO_READ:   'inventario:read',
  INVENTARIO_WRITE:  'inventario:write',
  INVENTARIO_DELETE: 'inventario:delete',

  // Juego (mini-juego "Escalada Infinita" dentro de la app — registrar
  // puntaje y ver el podio). Un solo permiso, sin read/write/delete: no hay
  // dato del club detrás para separar por nivel de acceso, solo "puede jugar".
  JUEGO_JUGAR: 'juego:jugar',
};

export const TODOS_LOS_PERMISOS = Object.values(PERMISOS);

// Agrupación de PERMISOS por categoría, para UIs que arman un rol eligiendo
// permisos (ver appcarc-superadmin#5 punto 2) — un checkbox plano de ~47
// ítems es inmanejable, conviene agruparlos por el mismo recurso que ya
// separa a PERMISOS en comentarios más arriba.
export const PERMISOS_POR_CATEGORIA = [
  { categoria: 'Socios', permisos: [PERMISOS.SOCIOS_READ, PERMISOS.SOCIOS_CREATE, PERMISOS.SOCIOS_WRITE, PERMISOS.SOCIOS_DELETE, PERMISOS.SOCIOS_RESTORE] },
  { categoria: 'Cobros', permisos: [PERMISOS.COBROS_READ, PERMISOS.COBROS_WRITE, PERMISOS.COBROS_DELETE, PERMISOS.COBROS_PRECIO_HISTORICO] },
  { categoria: 'Movimientos', permisos: [PERMISOS.MOVIMIENTOS_READ, PERMISOS.MOVIMIENTOS_WRITE, PERMISOS.MOVIMIENTOS_DELETE] },
  { categoria: 'Escuelita', permisos: [PERMISOS.ESCUELITA_READ, PERMISOS.ESCUELITA_WRITE, PERMISOS.ESCUELITA_DELETE, PERMISOS.ESCUELITA_CHECKIN, PERMISOS.ESCUELITA_CHECKIN_PROPIO] },
  { categoria: 'Muro Libre', permisos: [PERMISOS.MURO_LIBRE_READ, PERMISOS.MURO_LIBRE_WRITE, PERMISOS.MURO_LIBRE_DELETE, PERMISOS.MURO_LIBRE_CHECKIN, PERMISOS.MURO_LIBRE_CHECKIN_PROPIO] },
  { categoria: 'Horarios', permisos: [PERMISOS.HORARIOS_READ, PERMISOS.HORARIOS_WRITE, PERMISOS.HORARIOS_DELETE, PERMISOS.HORARIOS_DEUDA] },
  { categoria: 'Etiquetas', permisos: [PERMISOS.ETIQUETAS_READ, PERMISOS.ETIQUETAS_WRITE, PERMISOS.ETIQUETAS_DELETE] },
  { categoria: 'Precios', permisos: [PERMISOS.PRECIOS_READ, PERMISOS.PRECIOS_WRITE, PERMISOS.PRECIOS_DELETE] },
  { categoria: 'Planes', permisos: [PERMISOS.PLANES_READ, PERMISOS.PLANES_WRITE, PERMISOS.PLANES_DELETE] },
  { categoria: 'Suscripciones', permisos: [PERMISOS.SUSCRIPCIONES_READ, PERMISOS.SUSCRIPCIONES_WRITE, PERMISOS.SUSCRIPCIONES_CLOSE, PERMISOS.SUSCRIPCIONES_DELETE] },
  { categoria: 'Asistencias', permisos: [PERMISOS.ASISTENCIAS_READ, PERMISOS.ASISTENCIAS_WRITE] },
  { categoria: 'Advertencias', permisos: [PERMISOS.ADVERTENCIAS_READ] },
  { categoria: 'Novedades', permisos: [PERMISOS.NOVEDADES_WRITE] },
  { categoria: 'Export', permisos: [PERMISOS.EXPORT_SHEETS] },
  { categoria: 'Auditoría', permisos: [PERMISOS.AUDIT_READ, PERMISOS.AUDIT_REVERT] },
  { categoria: 'Usuarios', permisos: [PERMISOS.USUARIOS_WRITE] },
  { categoria: 'Roles', permisos: [PERMISOS.ROLES_READ, PERMISOS.ROLES_WRITE, PERMISOS.ROLES_DELETE] },
  { categoria: 'Recursos externos', permisos: [PERMISOS.RECURSOS_READ, PERMISOS.RECURSOS_WRITE, PERMISOS.RECURSOS_DELETE] },
  { categoria: 'Eventos', permisos: [PERMISOS.EVENTOS_READ, PERMISOS.EVENTOS_WRITE, PERMISOS.EVENTOS_DELETE] },
  { categoria: 'Juego', permisos: [PERMISOS.JUEGO_JUGAR] },
  { categoria: 'Inventario', permisos: [PERMISOS.INVENTARIO_READ, PERMISOS.INVENTARIO_WRITE, PERMISOS.INVENTARIO_DELETE] },
];
