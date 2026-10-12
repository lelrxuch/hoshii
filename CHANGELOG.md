# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [0.1.1] - 2026-10-11

### Seguridad

- El hook solo habla con un socket tuyo: comprueba el directorio (700), el dueño del socket y, ya conectado, que el proceso del otro lado corre con tu usuario. Antes, si se usaba `/tmp`, otro usuario del equipo podía hacerse pasar por la app y aprobar permisos.
- "Permitir" solo aparece si el pedido se ve completo. Si el hook recortó algo o el texto es muy largo, hay que responder en la terminal.
- Las rutas fuera del proyecto se muestran completas (`~/.ssh/authorized_keys`, no `authorized_keys`) y con aviso.
- Las herramientas MCP y desconocidas muestran todos sus argumentos.
- Los caracteres invisibles y de control (bidi, ancho cero, escapes ANSI) se marcan como `⟨U+XXXX⟩`.
- Un pedido recién llegado no se puede permitir durante 600 ms, ni con clic ni con atajo; tampoco el siguiente de la cola al mantener la tecla.
- Máximo 8 pedidos en espera y 32 conexiones; lo demás vuelve a la terminal.
- La conexión con Claude Code solo reconoce el comando exacto de Hoshii, escribe temporales con `wx` y conserva los últimos 5 respaldos de `settings.json`.
- Release: el checkout no guarda credenciales, sin caché de npm al compilar y la AppImage lleva atestación de origen (`gh attestation verify`).
- Dependabot tampoco propone saltos de versión mayor en las Actions.

## [0.1.0]

### Agregado

- Isla arriba al centro con la mascota Hoshii animada en cinco estados.
- Estado de cada sesión de Claude Code: herramienta, archivo o comando, espera, fin y error.
- Pedidos de permiso desde la isla: Permitir, Denegar o devolverlos a la terminal, con plazo de 90 s y atajos `Ctrl+Alt+Y` / `Ctrl+Alt+N`.
- Notificación al terminar un turno.
- Menú con clic derecho en la isla, para GNOME sin la extensión AppIndicator.
- Conexión con Claude Code desde la isla, con respaldo de `settings.json`, y desconexión desde la bandeja.
- Hook en Python sin dependencias que nunca decide por su cuenta.
