import { revertirCobro } from './revertirCobro.js';
import { revertirMovimiento } from './revertirMovimiento.js';
import { revertirMuroLibre } from './revertirMuroLibre.js';

// Recursos con efectos en cascada que el revert genérico (soft-delete /
// restore de un único documento) no puede deshacer correctamente. Cada
// reverser recibe el AuditLog completo y se encarga de restaurar tanto el
// documento principal como todo lo que su acción original haya cascadeado.
export const REVERSERS = {
  Cobro: revertirCobro,
  Movimiento: revertirMovimiento,
  Asistencia: revertirMuroLibre,
};

export default REVERSERS;
