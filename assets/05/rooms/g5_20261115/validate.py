#!/usr/bin/env python3
"""G5 provisional asset consistency/geometry contract; requires Pillow."""
from pathlib import Path
from PIL import Image
import json,hashlib
R=Path(__file__).resolve().parent
m=json.loads((R/'manifest.json').read_text(encoding='utf8'))
c=json.loads((R/'room_locations.json').read_text(encoding='utf8'))
rooms=['hearth_room','observation_room','kitchen_room','bedroom']
assert list(c['rooms'])==rooms, 'room order changed'
assert c['canvas']==[2560,1440]
assert c['architecture']['defaultSelectedRoom']=='observation_room'
assert c['architecture']['kitchenBackDoorAndCoveredWalkwaySameOpening'] is True
assert len([x for rm in c['rooms'].values() for x in rm['displaySlots']])==6
assert len([x for x in c['locations'].values() if x['room'] is not None])==16
assert len(m['binary'])>=76,'missing binary layers'
for b in m['binary']:
 p=R/b['file'];assert p.exists(),f'missing {p}'
 assert p.stat().st_size==b['bytes'],p
 assert hashlib.sha256(p.read_bytes()).hexdigest()==b['sha256'],f'sha mismatch: {p}'
for room in rooms:
 folder=R/room
 for name in ['interior_rgba.webp','outside_winter_day_rgba.webp','outside_winter_night_rgba.webp','glass_mask.png','day_preview.webp','night_ambient.webp','fire_spill_low.webp','fire_spill_high.webp','weather_snow.webp','weather_blizzard.webp','oil_lamp_body.webp','oil_lamp_glow.webp','actor_male_pose.webp','actor_contact.webp']:
  p=folder/name;assert p.exists(),p
  im=Image.open(p);assert im.size==(2560,1440),p
 im=Image.open(folder/'interior_rgba.webp').convert('RGBA');mask=Image.open(folder/'glass_mask.png').convert('L')
 a=im.getchannel('A')
 # corner is solid wall, carpet and armchair textiles may not become transparent
 for sample in [(200,1320),(1180,1340),(2440,1220)]:
  if mask.getpixel(sample)<3:assert a.getpixel(sample)>248,(room,sample)
 assert min(a.getextrema())==0,room
 assert max(a.getextrema())==255,room
 for n in ['snow','blizzard']:
  w=Image.open(folder/f'weather_{n}.webp').convert('RGBA')
  for x,y in [(200,1320),(1160,1300),(2400,1300)]:
   if mask.getpixel((x,y))<3:assert w.getpixel((x,y))[3]<5,(room,n,x,y)
 assert c['rooms'][room]['actor']['pose'] in ['sitRead','sitWrite','standWork','sleep']
assert c['locations']['springhouse']['room'] is None
assert c['locations']['cellar']['room'] is None
assert (R/'bedroom/bed_front_occlusion.webp').exists()
assert (R/'hearth_room/fire_flame_high.webp').exists()
print('PASS: 4 scenes / 2560×1440 / SHA / alpha glass / local lights / unified weather / 6 displays / 16 interior locations / 4 poses')
