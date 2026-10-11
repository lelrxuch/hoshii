"""Hoshii: mascota original estilo chibi/moe, chica nerd rubia en pixel art 64x64.

Genera los cuadros de animación de cada estado en src/renderer/sprites/<estado>-<cuadro>.png,
el ícono de la app (assets/icon.png) y una hoja de muestra. Requiere Pillow (solo para desarrollo):

    python3 tools/sprites.py

Se edita este script, no los PNG."""
from PIL import Image
import sys

W = H = 64
T = None
P = {
    'out': (52, 32, 50), 'out_soft': (120, 78, 88),
    'skin': (255, 224, 204), 'skin_s': (240, 186, 164), 'skin_h': (255, 240, 230),
    'blush': (255, 150, 170), 'blush_l': (255, 190, 200),
    'hair': (250, 214, 104), 'hair_s': (226, 172, 66), 'hair_d': (178, 122, 44), 'hair_h': (255, 246, 190),
    'frame': (70, 52, 92), 'glint': (255, 255, 255),
    'iris_t': (40, 70, 160), 'iris': (80, 140, 230), 'iris_b': (140, 200, 255), 'pupil': (28, 30, 70),
    'white': (255, 255, 255), 'mouth': (170, 70, 90), 'tongue': (255, 130, 150),
    'hood': (132, 112, 228), 'hood_s': (96, 78, 184), 'hood_h': (170, 156, 245), 'string': (250, 248, 255),
    'lap': (200, 205, 218), 'lap_s': (150, 156, 175), 'lap_h': (232, 236, 245), 'logo': (100, 210, 255),
    'st1': (255, 159, 10), 'st2': (48, 209, 88), 'clip': (255, 120, 170),
    'q': (255, 159, 10), 'spark': (48, 209, 88), 'spark2': (255, 214, 10), 'sweat': (120, 210, 255),
    'heart': (255, 90, 130),
}


class C:
    def __init__(self):
        self.p = [[T] * W for _ in range(H)]

    def s(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.p[y][x] = P[c]

    def g(self, x, y):
        return self.p[y][x] if 0 <= x < W and 0 <= y < H else T

    def pts(self, c, *pp):
        for x, y in pp:
            self.s(x, y, c)

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.s(x, y, c)

    def ell(self, cx, cy, rx, ry, c, shade=None, light=None, keep=None):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1 and (keep is None or keep(x, y)):
                    col = c
                    if shade and dx * 0.5 + dy * 0.85 > 0.5:
                        col = shade
                    elif light and dx * 0.55 + dy * 0.8 < -0.55:
                        col = light
                    self.s(x, y, col)

    def outline(self):
        add = [(x, y) for y in range(H) for x in range(W) if self.p[y][x] is T and any(
            self.g(x + a, y + b) not in (T, P['out']) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
        for x, y in add:
            self.p[y][x] = P['out']

    def img(self, k=1):
        im = Image.new('RGBA', (W, H))
        for y in range(H):
            for x in range(W):
                c = self.p[y][x]
                im.putpixel((x, y), (0, 0, 0, 0) if c is T else (*c, 255))
        return im.resize((W * k, H * k), Image.NEAREST) if k > 1 else im


HX, HY = 32, 27  # centro de la cabeza


def back_hair(c):
    c.ell(HX, HY, 22, 21, 'hair', 'hair_s')
    # melena que cae a los lados del cuerpo
    for x in range(10, 55):
        end = 50 + (2 if x % 5 in (1, 2, 3) else 0)
        for y in range(36, end):
            if x < 18 or x > 46:
                c.s(x, y, 'hair_s' if x > 46 or y > 47 else 'hair')
    for x in (12, 15, 49, 52):
        for y in range(38, 49):
            c.s(x, y, 'hair_d')


def body(c):
    # cuerpo pequeño (chibi): sudadera de y=46 a 63
    for y in range(46, 64):
        half = 9 + (y - 46) // 2
        for x in range(HX - half, HX + half):
            col = 'hood_s' if x >= HX + half - 4 else ('hood_h' if x < HX - half + 2 else 'hood')
            c.s(x, y, col)
    c.ell(HX, 47, 9, 3, 'hood_s')               # capucha detrás del cuello
    c.rect(30, 44, 34, 47, 'skin_s')            # cuello
    c.ell(HX, 48.5, 3.5, 1.8, 'string')         # cuello de camiseta
    for y in range(49, 55):                     # cordones
        c.pts('string', (29, y), (35, y))
    c.pts('hood_s', (29, 55), (35, 55))


def laptop(c, typing=None):
    c.rect(20, 55, 44, 63, 'lap')
    c.rect(20, 55, 44, 55, 'lap_h')
    c.rect(42, 56, 44, 63, 'lap_s')
    c.pts('logo', (30, 58), (29, 59), (30, 60), (34, 58), (35, 59), (34, 60), (33, 57), (32, 59), (31, 61))
    c.ell(24, 59.5, 1.8, 1.8, 'st1')
    c.pts('heart', (38, 58), (40, 58), (37, 59), (38, 59), (39, 59), (40, 59), (41, 59), (38, 60), (39, 60), (40, 60), (39, 61))
    # manitas sobre el borde de la laptop
    left = right = 55
    if typing is not None:  # una mano arriba y otra abajo, alternando
        left, right = (54, 55) if typing % 2 == 0 else (55, 54)
    c.ell(23, left, 2.2, 1.6, 'skin', 'skin_s')
    c.ell(41, right, 2.2, 1.6, 'skin', 'skin_s')


def face(c):
    c.ell(HX, 31, 17, 15, 'skin', 'skin_s', 'skin_h')


def bangs(c):
    # parte superior del pelo + flequillo esponjoso en ondas
    c.ell(HX, HY - 2, 21, 17, 'hair', 'hair_s', 'hair_h', keep=lambda x, y: y <= 22)
    tips = [23, 25, 27, 26, 24, 22, 24, 27, 29, 27, 24, 22, 23, 26, 29, 30, 28, 25, 22, 24, 27, 29, 27, 24, 22, 23, 25, 27, 25, 23, 22, 21]
    for i, b in enumerate(tips):
        x = 16 + i
        for y in range(18, b + 1):
            c.s(x, y, 'hair_s' if y >= b - 1 else 'hair')
    # mechones laterales que enmarcan la cara
    for y in range(22, 44):
        for x in range(13, 17):
            c.s(x, y, 'hair_s' if x == 16 or y > 38 else 'hair')
        for x in range(48, 52):
            c.s(x, y, 'hair_s')
    c.pts('hair_d', (15, 30), (15, 34), (15, 38), (49, 29), (49, 33), (49, 37))
    # brillo en anillo
    for x in range(20, 32):
        c.s(x, 13 + (x - 20) // 6, 'hair_h')
    c.pts('hair_h', (22, 15), (25, 15), (28, 16))
    # líneas de mechón en el flequillo
    c.pts('hair_d', (21, 23), (21, 24), (27, 24), (27, 25), (33, 25), (33, 26), (38, 24), (38, 25), (43, 23))
    # sombra del flequillo sobre la frente
    for i, b in enumerate(tips):
        x = 16 + i
        if c.g(x, b + 1) in (P['skin'], P['skin_h']):
            c.s(x, b + 1, 'skin_s')
    # ahoge (mechón rebelde)
    c.pts('hair', (34, 6), (35, 5), (36, 4), (37, 4), (38, 5), (36, 6), (35, 7), (34, 8), (33, 9))
    c.pts('hair_s', (38, 6), (37, 7))
    # pinza en forma de estrella
    c.pts('clip', (44, 17), (43, 18), (44, 18), (45, 18), (42, 19), (43, 19), (44, 19), (45, 19), (46, 19), (43, 20), (45, 20))


EYES = (24, 40)  # centros x de cada ojo


def eyes(c, kind):
    for cx in EYES:
        if kind in ('open', 'wide'):
            top = 27 if kind == 'open' else 26
            bot = 38
            side = -1 if cx < 32 else 1  # lado exterior para el rabillo de pestaña
            # ojo grande y ovalado: iris casi completo, poco blanco (estilo moe)
            for y in range(top, bot + 1):
                for x in range(cx - 4, cx + 4):
                    corner = (y in (top, bot)) and x in (cx - 4, cx + 3)
                    if corner:
                        continue
                    c.s(x, y, 'white')
            for y in range(top + 1, bot + 1):
                for x in range(cx - 3, cx + 3):
                    if y == bot and x in (cx - 3, cx + 2):
                        continue
                    col = 'iris_t' if y < top + 4 else ('iris' if y < bot - 3 else 'iris_b')
                    c.s(x, y, col)
            c.rect(cx - 2, top + 3, cx + 1, top + 7, 'pupil')
            # brillos moe: uno grande arriba y uno chico abajo
            c.rect(cx - 3, top + 1, cx - 2, top + 3, 'white')
            c.s(cx - 1, top + 2, 'white')
            c.pts('white', (cx + 1, bot - 2), (cx + 2, bot - 3))
            # pestaña superior gruesa con rabillo hacia afuera
            c.rect(cx - 4, top - 1, cx + 3, top - 1, 'out')
            c.rect(cx - 3, top - 2, cx + 2, top - 2, 'out')
            ox = cx + 4 if side > 0 else cx - 5
            c.pts('out', (ox, top - 1), (ox + side, top - 2), (ox, top), (ox, top + 1))
            c.pts('skin_s', *[(x, bot + 1) for x in range(cx - 2, cx + 2)])
        elif kind == 'down':
            c.rect(cx - 3, 32, cx + 3, 35, 'white')
            c.rect(cx - 2, 33, cx + 2, 35, 'iris')
            c.rect(cx - 1, 34, cx + 1, 35, 'pupil')
            c.pts('white', (cx - 2, 33))
            c.rect(cx - 4, 31, cx + 3, 31, 'out')
            c.pts('out', (cx + 4, 30))
        elif kind == 'happy':
            for dx, dy in ((-3, 33), (-2, 32), (-1, 31), (0, 31), (1, 31), (2, 32), (3, 33)):
                c.s(cx + dx, dy, 'out')
        elif kind == 'closed':
            # parpadeo: línea curva con pestañas
            for dx, dy in ((-4, 33), (-3, 34), (-2, 34), (-1, 34), (0, 34), (1, 34), (2, 34), (3, 33)):
                c.s(cx + dx, dy, 'out')
            ox = cx + 4 if cx > 32 else cx - 5
            c.s(ox, 32, 'out')
        elif kind == 'x':
            for d in range(-3, 4):
                c.s(cx + d, 32 + d, 'out')
                c.s(cx + d, 32 - d, 'out')


def glasses(c):
    for cx in EYES:
        for y in range(24, 41):
            for x in range(cx - 8, cx + 9):
                dx, dy = (x + 0.5 - (cx + 0.5)) / 7.2, (y + 0.5 - 32.5) / 7.2
                d = dx * dx + dy * dy
                if 0.82 <= d <= 1.08:
                    c.s(x, y, 'frame')
        c.pts('glint', (cx + 4, 27), (cx + 5, 28), (cx + 3, 26))
    c.pts('frame', (31, 31), (32, 30), (33, 31))


def mouth(c, kind):
    m = {
        'cat': [(30, 41), (31, 42), (32, 41), (33, 42), (34, 41)],
        'small': [(31, 42), (32, 42), (33, 42)],
        'o': [(31, 41), (32, 41), (33, 41), (31, 42), (33, 42), (31, 43), (32, 43), (33, 43)],
        'open': [(29, 41), (30, 41), (31, 41), (32, 41), (33, 41), (34, 41), (35, 41), (30, 42), (34, 42), (31, 43), (32, 43), (33, 43)],
        'wobble': [(29, 43), (30, 42), (31, 43), (32, 42), (33, 43), (34, 42), (35, 43)],
    }[kind]
    c.pts('mouth', *m)
    if kind == 'open':
        c.pts('tongue', (31, 42), (32, 42), (33, 42))
    if kind == 'o':
        c.pts('tongue', (32, 42))


def blush(c, strong=False):
    for cx in (19, 45):
        c.rect(cx - 2, 40, cx + 2, 41, 'blush_l')
        c.pts('blush', (cx - 2, 40), (cx, 40), (cx + 2, 40)) if strong else c.pts('blush', (cx - 1, 41), (cx + 1, 41))


FRAMES = {'idle': 2, 'work': 3, 'ask': 2, 'done': 2, 'error': 2}


def spark(c, x, y, col):
    c.pts(col, (x, y - 2), (x, y - 1), (x - 2, y), (x - 1, y), (x, y), (x + 1, y), (x + 2, y), (x, y + 1), (x, y + 2))


def draw(state, frame=0):
    c = C()
    back_hair(c)
    body(c)
    face(c)
    bangs(c)
    eye = {'idle': 'open', 'work': 'down', 'ask': 'wide', 'done': 'happy', 'error': 'x'}[state]
    if state == 'idle' and frame == 1:
        eye = 'closed'
    eyes(c, eye)
    glasses(c)
    mouth(c, {'idle': 'cat', 'work': 'small', 'ask': 'o', 'done': 'open', 'error': 'wobble'}[state])
    blush(c, strong=state in ('done', 'ask'))
    laptop(c, typing=frame if state == 'work' else None)
    if state == 'ask':
        up = frame  # la mano y la burbuja suben un píxel en el cuadro 1
        c.ell(54, 47 - up, 3, 3.4, 'skin', 'skin_s')      # mano levantada
        c.rect(52, 50 - up, 56, 54, 'hood')
        c.ell(55, 12 - up, 7.5, 7.5, 'q')
        c.pts('white', *[(x, y - up) for x, y in ((53, 9), (54, 8), (55, 8), (56, 8), (57, 9), (57, 10),
                                                   (56, 11), (55, 12), (55, 13), (55, 15))])
    elif state == 'done':
        a = ((54, 10, 'spark'), (9, 16, 'spark2'), (57, 26, 'spark2'), (7, 30, 'heart'))
        b = ((56, 14, 'spark2'), (7, 12, 'spark'), (55, 30, 'heart'), (10, 27, 'spark2'))
        for x, y, col in (a if frame == 0 else b):
            spark(c, x, y, col)
    elif state == 'error':
        d = frame  # la gota resbala
        c.pts('sweat', *[(x, y + d) for x, y in ((52, 22), (51, 23), (52, 23), (53, 23), (50, 24), (51, 24),
                                                 (52, 24), (53, 24), (51, 25), (52, 25))])
        # espiral de mareo sobre la cabeza
        c.pts('out_soft', (44, 6), (45, 5), (46, 5), (47, 6), (47, 7), (46, 8), (45, 7))
    elif state == 'work':
        dots = ((12, 10), (14, 8), (16, 10))[: frame + 1]  # "." ".." "..."
        c.pts('logo', *dots)
    c.outline()
    return c


if __name__ == '__main__':
    import os
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    sprites = os.path.join(root, 'src', 'renderer', 'sprites')
    os.makedirs(sprites, exist_ok=True)
    k = 6
    cells = [(st, f) for st, n in FRAMES.items() for f in range(n)]
    sheet = Image.new('RGBA', (len(cells) * (W * k + 24) + 24, H * k + 48), (16, 16, 20, 255))
    for i, (st, f) in enumerate(cells):
        d = draw(st, f)
        d.img(1).save(os.path.join(sprites, f'{st}-{f}.png'))
        sheet.alpha_composite(d.img(k), (24 + i * (W * k + 24), 24))
    sheet.save(os.path.join(root, 'docs', 'mascota.png'))
    draw('idle').img(4).save(os.path.join(root, 'assets', 'icon.png'))
