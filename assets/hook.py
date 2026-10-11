#!/usr/bin/env python3
"""Hook de Claude Code para Hoshii.

Lee el evento que Claude Code manda por stdin y lo reenvía a la app por un socket Unix local
(solo accesible por tu usuario). Para PermissionRequest espera la respuesta de la app y la
imprime en el formato que Claude Code entiende.

Reglas de seguridad:
- Nunca decide por su cuenta. Si la app no está abierta, no responde o algo falla, sale sin
  imprimir nada y Claude Code pregunta en la terminal como siempre.
- No hace conexiones de red. Solo habla con el socket local.
- Solo reenvía los campos que la isla necesita, recortados. El texto del prompt no se envía.

Solo usa la biblioteca estándar de Python 3.
"""

import json
import os
import socket
import stat
import sys

PROTOCOL = 1
# Campos del evento que se reenvían. El resto (prompt, transcript, etc.) se descarta.
FIELDS = (
    'session_id',
    'cwd',
    'hook_event_name',
    'permission_mode',
    'tool_name',
    'tool_input',
    'tool_use_id',
    'message',
    'notification_type',
    'source',
    'reason',
)
MAX_STR = 2000
MAX_ITEMS = 40
MAX_DEPTH = 4
CONNECT_TIMEOUT_S = 0.5
# Tope de espera de una decisión. La app responde antes (su propio plazo); esto es un seguro.
WAIT_S = 320
MAX_REPLY = 4096


def _usable_dir(path):
    """Directorio real (no enlace), del usuario y sin permisos para otros."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid() and not (st.st_mode & 0o077)


def socket_path(env=None):
    """Misma búsqueda que src/main/paths.js."""
    env = os.environ if env is None else env
    if env.get('HOSHII_SOCKET'):
        return env['HOSHII_SOCKET']
    uid = os.getuid()
    runtime = env.get('XDG_RUNTIME_DIR') or ''
    if not os.path.isabs(runtime):
        run = '/run/user/%d' % uid
        runtime = run if _usable_dir(run) else ''
    if runtime:
        return os.path.join(runtime, 'hoshii', 'hoshii.sock')
    return '/tmp/hoshii-%d/hoshii.sock' % uid


def trim(value, depth=0):
    """Recorta textos largos y estructuras grandes para que el mensaje sea pequeño."""
    if depth > MAX_DEPTH:
        return None
    if isinstance(value, str):
        return value if len(value) <= MAX_STR else value[:MAX_STR] + '…'
    if isinstance(value, dict):
        return {str(k)[:100]: trim(v, depth + 1) for k, v in list(value.items())[:MAX_ITEMS]}
    if isinstance(value, list):
        return [trim(v, depth + 1) for v in value[:MAX_ITEMS]]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return None


def pick(data):
    event = {k: data[k] for k in FIELDS if k in data}
    if 'tool_input' in event:
        event['tool_input'] = trim(event['tool_input'])
    for k in ('message', 'cwd'):
        if isinstance(event.get(k), str):
            event[k] = trim(event[k])
    return event


def output_for(reply):
    """Convierte la respuesta de la app en la salida del hook. None: no decidir."""
    if not isinstance(reply, dict):
        return None
    behavior = reply.get('decision')
    if behavior not in ('allow', 'deny'):
        return None
    decision = {'behavior': behavior}
    if behavior == 'deny':
        decision['message'] = 'Denegado desde Hoshii.'
    return {'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': decision}}


def read_line(sock):
    buf = b''
    while b'\n' not in buf:
        chunk = sock.recv(1024)
        if not chunk:
            break
        buf += chunk
        if len(buf) > MAX_REPLY:
            return None
    line = buf.split(b'\n', 1)[0]
    return json.loads(line.decode('utf-8')) if line else None


def main(stdin=None, stdout=None, env=None):
    stdin = sys.stdin if stdin is None else stdin
    stdout = sys.stdout if stdout is None else stdout
    try:
        data = json.load(stdin)
    except (ValueError, OSError):
        return 0
    if not isinstance(data, dict) or not isinstance(data.get('hook_event_name'), str):
        return 0
    event = pick(data)
    asks = event['hook_event_name'] == 'PermissionRequest'
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.settimeout(CONNECT_TIMEOUT_S)
        sock.connect(socket_path(env))
        sock.sendall((json.dumps({'v': PROTOCOL, 'event': event}) + '\n').encode('utf-8'))
        if not asks:
            return 0
        sock.settimeout(WAIT_S)
        out = output_for(read_line(sock))
        if out is not None:
            stdout.write(json.dumps(out) + '\n')
            stdout.flush()
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    finally:
        sock.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
