"""Builds the Sol logo files from the same geometry as the Eclipse Ignition reveal.
   python3 brand/make-icons.py
   Writes icons/logo.svg (header mark), icons/icon.svg (app icon),
   icons/favicon.svg (crescent only) and renders the PNG sizes with macOS qlmanage/sips."""
import math, os, subprocess, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")

# --- geometry (identical to brand/sol-eclipse-reveal.html final frame) ---
RS, S = 150, 0.6
CX, CY = 806, 296                            # crescent (sun) centre
MX, MY = CX + S * 0.48 * RS, CY + S * -0.31 * RS  # moon centre
R = RS * S                                   # 90
STROKES = [
    "M 902 420 C 894 388, 842 374, 800 390 C 754 408, 746 462, 790 492 C 836 524, 902 548, 904 612 "
    "C 906 672, 838 712, 770 706 C 726 702, 704 676, 716 650",
    "M 1000 618 C 980 602, 946 610, 940 646 C 934 684, 962 706, 988 698 C 1014 690, 1024 656, 1012 630 "
    "C 1004 614, 988 616, 996 630 C 1008 648, 1040 652, 1066 640 C 1110 620, 1160 520, 1166 450 "
    "C 1170 400, 1150 380, 1136 396 C 1116 420, 1112 520, 1116 600 C 1120 670, 1140 704, 1176 702 "
    "C 1206 700, 1228 684, 1246 668",
    "M 704 752 C 860 772, 1110 764, 1296 716",
]
SLANT = "translate(960 700) skewX(-11) translate(-960 -700)"

DEFS = f"""
  <linearGradient id="solBrand" x1="640" y1="0" x2="1340" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ff3d5e"/><stop offset=".38" stop-color="#ffb199"/>
    <stop offset=".6" stop-color="#ff6a4d"/><stop offset="1" stop-color="#ff9a3c"/>
  </linearGradient>
  <linearGradient id="solGold" x1="{CX-R}" y1="{CY-R}" x2="{CX+R}" y2="{CY+R}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffe9cc"/><stop offset=".5" stop-color="#ffbe8f"/><stop offset="1" stop-color="#ff8a45"/>
  </linearGradient>
  <mask id="solMoon" maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080">
    <rect width="1920" height="1080" fill="#fff"/><circle cx="{MX:.2f}" cy="{MY:.2f}" r="{R}" fill="#000"/>
  </mask>"""


def crescent():
    return f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#solGold)" mask="url(#solMoon)"/>'


def signature(width, underline=True):
    paths = STROKES if underline else STROKES[:2]
    return (f'<g fill="none" stroke="url(#solBrand)" stroke-width="{width}" stroke-linecap="round" '
            f'stroke-linejoin="round" transform="{SLANT}">' + "".join(f'<path d="{d}"/>' for d in paths) + "</g>")


def write(name, svg):
    with open(os.path.join(ICONS, name), "w") as f:
        f.write(svg)


# header mark: transparent, tight crop, thicker pen so it stays crisp at ~50px
write("logo.svg", f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="676 196 636 596" role="img" aria-label="Sol">
<defs>{DEFS}</defs>
{crescent()}
{signature(17)}
</svg>
""")

# app icon: obsidian square with a crimson glow, mark centred inside the maskable safe zone
write("icon.svg", f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="560 76 880 880">
<defs>{DEFS}
  <radialGradient id="solBg" cx="1000" cy="500" r="620" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#3a0716"/><stop offset=".55" stop-color="#15070c"/><stop offset="1" stop-color="#070508"/>
  </radialGradient>
  <filter id="solGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect x="560" y="76" width="880" height="880" fill="url(#solBg)"/>
<g filter="url(#solGlow)" opacity=".55">{crescent()}{signature(26)}</g>
{crescent()}
{signature(24)}
</svg>
""")

# maskable app icon (Android crops it to a circle/squircle): same art, more breathing room
icon = open(os.path.join(ICONS, "icon.svg")).read()
write("icon-maskable.svg", icon.replace('viewBox="560 76 880 880"', 'viewBox="450 -34 1100 1100"')
      .replace('<rect x="560" y="76" width="880" height="880"', '<rect x="450" y="-34" width="1100" height="1100"'))

# favicon: the crescent alone reads at 16-32px
write("favicon.svg", f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{CX-R-8} {CY-R-8} {2*R+16} {2*R+16}">
<defs>{DEFS}</defs>
{crescent()}
</svg>
""")

# PNGs (macOS: QuickLook renders SVG, sips resizes)
tmp = tempfile.mkdtemp()
subprocess.run(["qlmanage", "-t", "-s", "1024", "-o", tmp, os.path.join(ICONS, "icon.svg")], capture_output=True)
big = os.path.join(tmp, "icon.svg.png")
subprocess.run(["qlmanage", "-t", "-s", "1024", "-o", tmp, os.path.join(ICONS, "icon-maskable.svg")], capture_output=True)
subprocess.run(["sips", "-z", "512", "512", os.path.join(tmp, "icon-maskable.svg.png"), "--out", os.path.join(ICONS, "icon-maskable-512.png")], capture_output=True)
for size in (512, 192, 180):
    subprocess.run(["sips", "-z", str(size), str(size), big, "--out", os.path.join(ICONS, f"icon-{size}.png")], capture_output=True)

# favicon PNG on a dark rounded tile so it shows on light browser tabs too
fav_tile = os.path.join(tmp, "fav.svg")
with open(fav_tile, "w") as f:
    f.write(f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{CX-R-24} {CY-R-24} {2*R+48} {2*R+48}">
<defs>{DEFS}</defs><rect x="{CX-R-24}" y="{CY-R-24}" width="{2*R+48}" height="{2*R+48}" rx="44" fill="#070508"/>{crescent()}</svg>""")
subprocess.run(["qlmanage", "-t", "-s", "256", "-o", tmp, fav_tile], capture_output=True)
subprocess.run(["sips", "-z", "32", "32", os.path.join(tmp, "fav.svg.png"), "--out", os.path.join(ICONS, "favicon-32.png")], capture_output=True)
shutil.rmtree(tmp)
print("icons written:", sorted(os.listdir(ICONS)))
