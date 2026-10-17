# appClub

**Gestión simple para clubes de montaña**: cuotas y cobros, escuelita, muro libre, credencial digital con QR, novedades del club y control de horas del staff — todo desde el celular, tanto para el equipo del club como para los socios.

!!! success "Ya en uso real"
    En uso real en el **Club Andino Río Cuarto**, con toda su comisión, secretaría, profesores, palestreros y socios.

## Elegí un rol para ver su manual y probarlo

Cada rol tiene su propio login de prueba en un club demo (con datos ficticios, que se reinicia solo todos los días) y su propio manual paso a paso.

<div class="grid cards" markdown>

-   :material-cards-heart:{ .lg .middle } **Socio**

    ---

    Cuotas y pago, credencial digital, novedades del club y notificaciones.

    [:octicons-arrow-right-24: Ver manual de Socio](socio.md)

-   :material-wall:{ .lg .middle } **Palestrero**

    ---

    Check-in y cobro del pase de muro libre, y carga de horas propias.

    [:octicons-arrow-right-24: Ver manual de Palestrero](palestrero.md)

-   :material-school:{ .lg .middle } **Profesor**

    ---

    Alumnos de escuelita, toma de asistencia clase a clase y carga de horas propias.

    [:octicons-arrow-right-24: Ver manual de Profesor](profesor.md)

-   :material-clipboard-text:{ .lg .middle } **Secretaría**

    ---

    El día a día: cobros de cuota, inscripción a escuelita, check-in de muro libre y novedades del club.

    [:octicons-arrow-right-24: Ver manual de Secretaría](secretaria.md)

-   :material-briefcase:{ .lg .middle } **Admin / Autoridad**

    ---

    Alta y baja de socios, planes y precios, reportes de deuda del staff, y auditoría revertible de cualquier cambio.

    [:octicons-arrow-right-24: Ver manual de Admin](admin.md)

</div>

## Cómo entrar

Desde el navegador (funciona en iPhone y en cualquier computadora):

[:material-web: Entrar desde el navegador](https://app.appclub.net.ar/app/login){ .md-button .md-button--primary }
[:material-cellphone-arrow-down: Descargar la app nativa (Android)](https://app.appclub.net.ar/download/){ .md-button }

Desde Safari en iPhone podés además "Agregar a inicio" para tenerla como una app más.

Los datos del club de prueba son ficticios y se reinician automáticamente todos los días — probá lo que quieras, sin miedo a romper nada.

### La pantalla de login

Es bien simple: correo electrónico y contraseña.

<figure markdown>
  ![Pantalla de login](assets/screenshots/login-screen.png){ width="260" }
  <figcaption>Pantalla de login</figcaption>
</figure>

- **Primer acceso de un socio real:** la contraseña inicial es su **DNI**. Al entrar por primera vez, la app pide cambiarla por una propia.
- **Roles de prueba (demo):** usá directamente el email y la contraseña que te dimos en cada manual — ya están listos, sin paso adicional.
- En la app nativa (no en el navegador) también existe la opción de entrar con Google.
- **Si tu cuenta tiene más de un perfil vinculado** (por ejemplo, un padre/madre con hijos socios), después del login aparece una pantalla intermedia, **¿Como quién entrás?**, con la lista de perfiles: foto o inicial, nombre, si es `Tu cuenta` o `Vinculado`, y la cantidad de notificaciones sin leer de cada uno. Tocás el perfil con el que querés entrar (o `Volver` para regresar al login). Más detalle en el [manual de Socio](socio.md#6-entrar-como-un-hijo-vinculado-para-tutores); después podés cambiar de perfil sin volver a loguearte desde `Perfil` → `Configuración` → `Cuenta`.

## Tu perfil y personalización

Esto es igual para cualquier rol — se accede desde la solapa `Perfil`, abajo a la derecha.

<figure markdown>
  ![Mi Perfil](assets/screenshots/perfil-cuenta.png){ width="260" }
  <figcaption>Mi Perfil</figcaption>
</figure>

- **Foto de perfil:** tocá tu avatar (círculo con tus iniciales) para elegir una foto de tu galería. Si ya tenés una foto puesta, aparece además un botón aparte **Quitar foto** debajo del avatar para sacarla.
- **Mis datos:** tus datos personales (nombre, contacto, etc.).
- **Configuración:** desde acá accedés a varias secciones en una misma pantalla:
    - **Apariencia:** appClub trae 5 temas de color para elegir, además de "Sistema" (que sigue el modo claro/oscuro del celular).
    - **Seguridad** (si tu celular soporta huella o rostro): un interruptor para pedir esa verificación cada vez que abrís la app, en lugar de escribir la contraseña.
    - **Cuenta** (solo si tenés más de un perfil vinculado, por ejemplo un padre/madre con hijos socios): un botón para cambiar de perfil sin cerrar sesión.
- **Cambiar contraseña** y **Acerca de** (info de la app y cómo apoyar su desarrollo).

<figure markdown>
  ![Apariencia: 5 temas de color a elegir](assets/screenshots/perfil-apariencia.png){ width="260" }
  <figcaption>Apariencia — 5 temas a elegir</figcaption>
</figure>

### Cambiar contraseña

<figure markdown>
  ![Cambiar contraseña](assets/screenshots/perfil-cambiar-contrasena.png){ width="260" }
  <figcaption>Cambiar contraseña, desde Perfil</figcaption>
</figure>

Se pide la nueva contraseña (dos veces, para confirmarla), y en algunos casos también la actual. Hay dos situaciones distintas, con un formulario levemente distinto en cada una:

- **Voluntario:** desde `Perfil` → `Cambiar contraseña`, cuando quieras. Acá sí se pide la contraseña actual, además de la nueva.
- **Obligatorio:** en el primer login con una contraseña inicial (el DNI, para un socio; o la temporal que se genera al crear una cuenta de tutor — ver [vínculo padre-hijo](admin.md#2-vincular-a-un-tutor-padremadre-de-un-socio)), la app te lo pide antes de dejarte usar el resto de las pantallas. Acá no se pide la contraseña actual (todavía no la cambiaste), solo la nueva dos veces.

En los dos casos, al guardar la app muestra "Contraseña actualizada correctamente. Ingresa de nuevo." y, a los pocos segundos, cierra la sesión y vuelve al login: entrás de nuevo con la contraseña nueva.

!!! tip "¿Ya sos del Club Andino Río Cuarto?"
    No hace falta usar las credenciales de prueba: entrá con tu usuario real y vas a encontrar las mismas pantallas que se explican en cada manual, con los datos reales del club.

## Apoyá el desarrollo

appClub es un proyecto desarrollado de forma independiente por un socio del club, en su tiempo libre, con el objetivo de que la gestión del CARC (y de otros clubes de montaña) sea un poco más simple para todos.

Si te resulta útil y querés colaborar para que siga creciendo (nuevas funciones, mantenimiento, hosting), podés invitar un cafecito. Cualquier aporte ayuda un montón.

[:material-coffee: Invitame un cafecito](https://cafecito.app/nicopelos){ .md-button }
