import crypto from 'crypto';

// Math.random() no es apto para generar secretos (no es criptográficamente
// seguro) — esta contraseña temporal es la credencial real del usuario hasta
// que hace el primer login (mustChangePassword la fuerza a cambiar).
export const generarPasswordTemporal = () => crypto.randomBytes(8).toString('base64url');

export default generarPasswordTemporal;
