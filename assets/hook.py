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
  Si recorta algo de lo que se va a aprobar, lo marca (truncated) y la isla no ofrece "Permitir".
- Antes de mandar nada comprueba que el socket es tuyo: directorio 700 tuyo, socket tuyo y, ya
  conectado, que el proceso del otro lado corre con tu usuario (SO_PEERCRED). Así otro usuario
  del equipo no puede hacerse pasar por la app y aprobar permisos.

Solo usa la biblioteca estándar de Python 3.
"""

import json
import os
import socket
import stat
import struct
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
# Campos que agrega el hook (no vienen de Claude Code).
# truncated: se recortó parte de tool_input.
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


def trim(value, depth=0, cut=None):
    """Recorta textos largos y estructuras grandes para que el mensaje sea pequeño.
    Si `cut` es una lista, agrega True cada vez que se pierde algo."""
    def lost():
        if cut is not None:
            cut.append(True)

    if depth > MAX_DEPTH:
        lost()
        return None
    if isinstance(value, str):
        if len(value) <= MAX_STR:
            return value
        lost()
        return value[:MAX_STR] + '…'
    if isinstance(value, dict):
        items = list(value.items())
        if len(items) > MAX_ITEMS:
            lost()
        out = {}
        for k, v in items[:MAX_ITEMS]:
            key = str(k)
            if len(key) > 100:
                lost()
            out[key[:100]] = trim(v, depth + 1, cut)
        return out
    if isinstance(value, list):
        if len(value) > MAX_ITEMS:
            lost()
        return [trim(v, depth + 1, cut) for v in value[:MAX_ITEMS]]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    lost()
    return None


def pick(data):
    event = {k: data[k] for k in FIELDS if k in data}
    if 'tool_input' in event:
        cut = []
        event['tool_input'] = trim(event['tool_input'], cut=cut)
        if cut:
            event['truncated'] = True
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


def _safe_socket(path):
    """El socket y su directorio son tuyos y nadie más puede tocarlos."""
    if not _usable_dir(os.path.dirname(path) or '.'):
        return False
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISSOCK(st.st_mode) and st.st_uid == os.getuid()


def _peer_is_me(sock):
    """El proceso al otro lado del socket corre con tu usuario (Linux)."""
    opt = getattr(socket, 'SO_PEERCRED', None)
    if opt is None:
        return False
    raw = sock.getsockopt(socket.SOL_SOCKET, opt, struct.calcsize('iII'))
    _pid, uid, _gid = struct.unpack('iII', raw)
    return uid == os.getuid()


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
    path = socket_path(env)
    if not _safe_socket(path):
        return 0
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.settimeout(CONNECT_TIMEOUT_S)
        sock.connect(path)
        if not _peer_is_me(sock):
            return 0
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
