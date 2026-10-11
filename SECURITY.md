# Seguridad

## Reportar una vulnerabilidad

Usa el reporte privado de GitHub: pestaña **Security → Report a vulnerability** de este repositorio. No abras un issue público.

Incluye la versión, los pasos para reproducirlo y el impacto. Respondo en cuanto pueda; es un proyecto personal.

## Qué cuenta

- Que alguien que no seas tú pueda conectarse al socket o mandar decisiones.
- Que un permiso se apruebe sin tu clic (por plazo, error o un mensaje manipulado).
- Que la conexión con Claude Code dañe o borre ajustes que no son de Hoshii.
- Que la app o el hook hagan conexiones de red o filtren datos de tus sesiones.

## Diseño

- Socket Unix en un directorio `700`, archivo `600`.
- El hook solo imprime `allow` o `deny` si la app lo dice; ante cualquier fallo no decide y Claude Code pregunta en la terminal.
- La isla corre con `contextIsolation`, `sandbox` y una CSP sin red; todo el texto se inserta con `textContent`.
- Las GitHub Actions están fijadas por SHA y Dependabot las vigila.
