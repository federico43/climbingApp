import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
src = sys.argv[1]; out = sys.argv[2]
cuts = {
 "Archivo-ExtraCondensedBlack": (62, 900, "ExtraCondensed Black"),
 "Archivo-CondensedBlack": (75, 900, "Condensed Black"),
 "Archivo-SemiBold": (100, 600, "SemiBold"),
 "Archivo-Bold": (100, 700, "Bold"),
 "Archivo-ExtraBold": (100, 800, "ExtraBold"),
}
for name, (wd, wg, style) in cuts.items():
    f = TTFont(src)
    inst = instancer.instantiateVariableFont(f, {"wdth": wd, "wght": wg})
    n = inst["name"]
    fam = name  # unique family per cut so iOS/Android never merge them
    for rec in list(n.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 25):
            n.removeNames(nameID=rec.nameID)
    n.setName(fam, 1, 3, 1, 0x409); n.setName("Regular", 2, 3, 1, 0x409)
    n.setName(fam, 3, 3, 1, 0x409); n.setName(fam, 4, 3, 1, 0x409); n.setName(fam, 6, 3, 1, 0x409)
    n.setName(fam, 1, 1, 0, 0); n.setName("Regular", 2, 1, 0, 0); n.setName(fam, 4, 1, 0, 0); n.setName(fam, 6, 1, 0, 0)
    inst["OS/2"].usWeightClass = wg
    inst.flavor = None
    inst.save(f"{out}/{name}.ttf")
    print(name)
