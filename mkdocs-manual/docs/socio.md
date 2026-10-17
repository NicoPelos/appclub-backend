# Manual de Socio

Así ve la app un **socio** del club: su estado de cuenta, su credencial digital, las novedades del club y sus notificaciones. Todo pensado para resolverse en un par de toques, sin tener que llamar o ir en persona por una consulta simple.

```text title="Login de prueba"
socio@demo.appclub.ar / DemoSocio2026!
```

!!! tip "¿Ya sos socio del CARC?"
    Entrá con tu usuario real desde [/app/login](https://app.appclub.net.ar/app/login) para ver tu propia cuenta.

## 1. Inicio

De un vistazo: tu estado de cuota, accesos rápidos (Deudas y pagos, Credencial, Mis Visitas y Comunidad, entre otros) y las últimas novedades del club. `Comunidad` aparece como acceso rápido solo si no tenés la solapa `Socios` (el staff ya la tiene abajo).

<figure markdown>
  ![Inicio](assets/screenshots/socio-inicio.png){ width="260" }
  <figcaption>Inicio</figcaption>
</figure>

**Reordenar los accesos rápidos**

<figure markdown>
  ![Modo edición del grid de accesos](assets/screenshots/inicio-reordenar-accesos.png){ width="260" }
  <figcaption>Mantené presionado un acceso para reordenar el grid</figcaption>
</figure>

Mantené presionado cualquier ícono del grid para entrar en modo edición, arrastrá para reordenarlos como prefieras, y tocá `Listo` para confirmar. En modo edición cada ícono tiene además un botón chico en la esquina, **Agrandar** / **Achicar**, que lo pasa de tamaño normal a grande (ocupa 2×2 casilleros) y viceversa. El orden y los tamaños quedan guardados en el celular (no es algo que vea el resto del equipo). Esto es igual para cualquier rol, no solo para socios.

**Cuando hay muchos accesos**

El grid tiene 4 columnas × 4 filas. Cuántos accesos entran depende de cuántos agrandaste (uno grande ocupa el lugar de cuatro normales). Si no entran todos (típicamente admin o secretaría, que ven casi todo), se muestran los primeros —según el orden que armaste arrastrando— y una tarjeta `Más` en el último lugar, que abre el resto en una lista titulada **Más accesos**.

<figure markdown>
  ![Grid con la tarjeta "Más"](assets/screenshots/inicio-mas-accesos-grid.png){ width="260" }
  <figcaption>Si no entran todos, el último lugar es "Más"</figcaption>
</figure>

<figure markdown>
  ![Lista de accesos extra](assets/screenshots/inicio-mas-accesos-sheet.png){ width="260" }
  <figcaption>Ahí aparece el resto</figcaption>
</figure>

En modo edición se ven todos los accesos completos, sin la tarjeta `Más`, para poder reordenar (y agrandar o achicar) también los que quedan escondidos.

## 2. Ver y pagar tus cuotas

Muestra tu estado actual y el total adeudado si tenés cuotas vencidas. Si tenés hijos vinculados, la deuda se muestra separada por perfil: la tuya y la de cada uno de ellos.

<figure markdown>
  ![Tus cuotas](assets/screenshots/socio-cuotas.png){ width="260" }
  <figcaption>Tus cuotas</figcaption>
</figure>

Cada cuota o cargo pendiente tiene un interruptor para incluirlo o no en el pago (viene tildado por defecto). Si una cuota tiene varios períodos adeudados, podés elegir cuáles pagar tocando los chips de período uno por uno. El botón de Mercado Pago muestra el total de lo que tildaste ("PAGAR $X CON MERCADO PAGO") y queda deshabilitado ("ELEGÍ QUÉ PAGAR") si no dejaste nada tildado.

Si preferís pagar en efectivo o transferencia, se registra en persona por secretaría (ver [manual de Secretaría](secretaria.md#1-registrar-el-cobro-de-una-cuota)) o admin, como acceso directo desde la ficha del socio (ver [manual de Admin](admin.md#1-socios-alta-baja-y-ficha)).

Más abajo en la pantalla, un bloque **Métodos de pago** lista los medios que acepta el club (efectivo, transferencia bancaria y Mercado Pago), y el bloque **Pagos realizados** muestra el historial de cobros ya registrados: fecha, medio de pago y monto de cada uno. Si tenés hijos vinculados, cada pago indica para quién fue.

## 3. Credencial digital (QR)

Tu identificación como socio, sin necesidad de carnet físico. El personal del club puede escanearla para ubicar tu ficha al toque (por ejemplo, en la recepción) — ya no hace falta para que se registre tu asistencia en muro libre o escuelita, eso ahora se hace de otra forma (ver la sección siguiente).

<figure markdown>
  ![Tu credencial](assets/screenshots/socio-credencial-qr.png){ width="260" }
  <figcaption>Tu credencial</figcaption>
</figure>

## 4. Check-in en Muro Libre y Escuelita

Para marcar tu asistencia ya no hace falta que te escaneen la credencial: en la pared del club hay un cartel fijo con un código QR (uno para Muro Libre, otro para Escuelita). Lo escaneás con la cámara normal de tu celular — ni siquiera hace falta abrir la app antes — y te lleva directo a una pantalla para confirmar el check-in.

- **Muro Libre:** el check-in queda registrado al toque. Si tenés un pase mensual vigente no se te genera ningún cargo; si no, queda pendiente de pago para abonarlo en el mostrador.

<figure markdown>
  ![Check-in registrado](assets/screenshots/socio-checkin-propio-exito.png){ width="260" }
  <figcaption>Check-in registrado</figcaption>
</figure>

- **Escuelita:** si sos la única opción posible (por ejemplo, entrás con tu propia cuenta y no tenés hijos vinculados), se registra directo tu asistencia. Si hay más de una opción entre vos mismo (si tenés cuenta de socio) y tus hijos vinculados —aunque sea un solo hijo—, la app te pregunta "¿A quién marcamos?" antes de confirmar.

<figure markdown>
  ![¿A quién marcamos?](assets/screenshots/socio-checkin-propio-a-quien-marcamos.png){ width="260" }
  <figcaption>Si sos tutor de más de un hijo inscripto, elegís a quién marcar</figcaption>
</figure>

Si por algo el cartel no está disponible, el personal del club siempre puede cargar tu asistencia a mano buscándote por nombre o DNI.

## 5. Novedades del club

Anuncios, salidas y avisos del club, en la solapa `Comunidad`. Algunas se publican a mano y otras llegan automáticamente desde redes sociales o el RSS de una federación.

<figure markdown>
  ![Comunidad](assets/screenshots/socio-comunidad-novedades.png){ width="260" }
  <figcaption>Comunidad</figcaption>
</figure>

## 6. Entrar como un hijo vinculado (para tutores)

Si sos tutor de uno o más socios (por ejemplo, tus hijos), no necesitás una cuenta separada para cada uno. Secretaría o admin te vincula desde la ficha de cada socio (ver el [manual de Admin](admin.md#2-vincular-a-un-tutor-padremadre-de-un-socio)), y desde ahí podés entrar como cualquiera de ellos con tu mismo usuario.

<figure markdown>
  ![Elegir con qué perfil entrar](assets/screenshots/socio-elegir-perfil.png){ width="260" }
  <figcaption>Si tenés más de un perfil, la app te pregunta al entrar</figcaption>
</figure>

Si tenés un solo perfil (el tuyo, sin ningún hijo vinculado), entrás directo — este paso solo aparece cuando hay más de uno para elegir.

**Cambiar de perfil sin volver a loguearte**

<figure markdown>
  ![Cambiar de perfil desde Configuración](assets/screenshots/socio-configuracion-cambiar-perfil.png){ width="260" }
  <figcaption>Cambiar de perfil desde Configuración</figcaption>
</figure>

1. Andá a `Perfil` → `Configuración` → `Cambiar de perfil`.
2. Elegí el perfil con el que querés entrar — el que está marcado es el activo en este momento.

<figure markdown>
  ![Lista de perfiles disponibles](assets/screenshots/socio-cambiar-perfil-modal.png){ width="260" }
  <figcaption>Lista de perfiles disponibles</figcaption>
</figure>

Todo lo que veas mientras actuás "como" un hijo vinculado (cuotas, credencial, notificaciones) es de ese socio, no tuyo — y solo con permisos de socio, aunque esa persona tenga otro rol en el club con su propia cuenta.

## 7. Mis Visitas (muro libre y escuelita)

`Mis Visitas` junta en una sola pantalla tu historial de check-ins en muro libre y de asistencias a escuelita. Arriba tiene un filtro (`Todas` / `Muro Libre` / `Escuelita`), y cada visita muestra la fecha, el tipo (para muro libre, el tipo de pase; para escuelita, la clase), el estado de pago si corresponde y cómo lo pagaste.

<figure markdown>
  ![Mis Visitas](assets/screenshots/socio-mis-visitas.png){ width="260" }
  <figcaption>Tu historial de visitas</figcaption>
</figure>

Se llega de dos formas:

- Desde el acceso rápido `Mis Visitas` en Inicio, que tiene cualquier socio.
- Desde la solapa `Mis Visitas` de abajo, que aparece solo si registraste al menos una visita a muro libre o si tenés una inscripción **activa** en escuelita. Si te dan de baja de escuelita y nunca fuiste a muro libre, la solapa deja de aparecer.

## 8. Notificaciones

Avisos personales: que se registró un pago tuyo, recordatorios de cuota, novedades nuevas del club, o cambios en tu ficha. Tocando el ícono de campana desde Inicio.

<figure markdown>
  ![Tus notificaciones](assets/screenshots/socio-notificaciones.png){ width="260" }
  <figcaption>Tus notificaciones</figcaption>
</figure>
