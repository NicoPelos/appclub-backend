// Único lugar donde viven estas constantes — antes estaban copiadas
// literalmente en create/update/deleteHorario.handler.js, más una cuarta
// variante (unión de ambas) en getHorarios.handler.js (appcarc-backend#135).
export const ROLES_EDIT_ALL = ['admin', 'secretaria'];
export const ROLES_READ_ONLY = ['autoridad', 'superadmin'];
export const ROLES_VER_TODO = [...ROLES_EDIT_ALL, ...ROLES_READ_ONLY];

// Tope superior para totalHoras autoreportado: nadie hace un turno de más de
// un día. Sin este tope, cualquier staff con horarios:write podía inflar a
// mano cuánto le debe el club — es el input que getDeudaStaff.handler.js
// multiplica directo por el precio por hora (appcarc-backend#134).
export const MAX_TOTAL_HORAS = 24;
