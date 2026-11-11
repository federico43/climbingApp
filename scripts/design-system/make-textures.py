"""Renders the Paper Mint textures (docs/design-system.md §4).

  python3 scripts/design-system/make-textures.py

grain.png : tileable film grain, black/white specks on transparent (opacity set in code)
melt.png  : the blurred liquid gradient that drips out of the poster headline
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = "assets/images/paper"
rng = np.random.default_rng(7)

# ── Grain: a few octaves of tileable value noise + fine white noise ─────────
S = 220
def octave(cells):
    g = rng.random((cells, cells))
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255
n = 0.55 * rng.random((S, S)) + 0.25 * octave(110) + 0.2 * octave(55)
n = (n - n.mean()) / (n.std() * 3)  # ~[-1, 1]
n = np.clip(n, -1, 1)
rgba = np.zeros((S, S, 4), np.uint8)
rgba[..., :3] = np.where(n[..., None] > 0, 255, 0)
rgba[..., 3] = (np.abs(n) * 255).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(f"{OUT}/grain.png", optimize=True)

# ── Melt: two tall pills under the headline flowing into a wide pool ────────
SC = 2                      # @2x is plenty: it's all blur
W, H = 390 * SC, 460 * SC
MINT, BLUE, VIOLET = (95, 208, 138), (43, 60, 255), (122, 43, 216)

def blob(color, box, angle=0, radius=None, alpha=255):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x0, y0, x1, y1 = [v * SC for v in box]
    r = (radius if radius is not None else min(x1 - x0, y1 - y0) / SC / 2) * SC
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=color + (alpha,))
    if angle:
        layer = layer.rotate(angle, center=((x0 + x1) / 2, (y0 + y1) / 2), resample=Image.BICUBIC)
    return layer

melt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for layer in [
    blob(VIOLET, (40, 300, 360, 440), radius=70, alpha=200),   # pool, bottom
    blob(MINT,   (-30, 230, 230, 380), radius=75, alpha=235),  # pool, left
    blob(BLUE,   (170, 220, 430, 370), radius=75, alpha=235),  # pool, right
    blob(MINT,   (70, 40, 190, 340), angle=10, radius=60),     # drip pill
    blob(BLUE,   (200, 60, 320, 360), angle=-9, radius=60),    # drip pill
]:
    melt = Image.alpha_composite(melt, layer)
melt = melt.filter(ImageFilter.GaussianBlur(28 * SC))
# Fade the top edge so the melt starts softly just under the headline.
a = np.asarray(melt).copy()
ramp = np.clip(np.linspace(0, 1, H) / 0.12, 0, 1)
a[..., 3] = (a[..., 3] * ramp[:, None]).astype(np.uint8)
Image.fromarray(a, "RGBA").save(f"{OUT}/melt.png", optimize=True)
print("ok")
