#!/usr/bin/env python3
import json,hashlib
from pathlib import Path
from PIL import Image,ImageChops
root=Path(__file__).resolve().parent
m=json.loads((root/'manifest.json').read_text(encoding='utf8'))
assert m['canvas']==[2560,1440]
assert set(m['rooms'])=={'hearth_room','observation_room','kitchen_room','bedroom'}
assert m['resampledNotNativeBrushwork'] is True
for name,room in m['rooms'].items():
 p=root/name
 required=['interior_rgba.webp','outside_winter_day_rgba.webp','outside_winter_night_rgba.webp','glass_mask.png','night_ambient.webp','day_preview.webp']
 for file in required:assert (p/file).exists(),(name,file)
 inside=Image.open(p/'interior_rgba.webp').convert('RGBA')
 outside=Image.open(p/'outside_winter_day_rgba.webp').convert('RGBA')
 night=Image.open(p/'outside_winter_night_rgba.webp').convert('RGBA')
 mask=Image.open(p/'glass_mask.png').convert('L')
 assert inside.size==outside.size==night.size==mask.size==(2560,1440)
 assert inside.getchannel('A').getextrema()==(0,255)
 assert outside.getchannel('A').getextrema()==(0,255)
 assert .025<room['glass_coverage_ratio']<.5
 assert len(room['anchors_provisional'])>0
 print('PASS',name,room['glass_coverage_ratio'],'RGBA/WebP + mask + 2560x1440')
assert sum(len(r['display_slots']) for r in m['rooms'].values())==6
print('PASS all four-room layered game assets, six display slots; not native-G5 signoff')