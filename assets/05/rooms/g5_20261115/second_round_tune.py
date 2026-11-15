#!/usr/bin/env python3
"""Second-round visual QA corrective pass: narrow, cold-scene-only frame guards.
Runs AFTER second_round.py, against its images; does not regenerate other props.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageChops,ImageFilter
import numpy as np
import json,hashlib
R=Path(__file__).resolve().parent
ROOT=R.parents[3]
C=json.loads((R/'room_locations.json').read_text('utf-8'))
M=json.loads((R/'manifest.json').read_text('utf-8'))
ROOMS=['hearth_room','observation_room','kitchen_room','bedroom']
W,H=2560,1440

def save(im,room,name):
    im.save(R/room/name,'WEBP',lossless=True,method=5)

def candidates(room):
    # Loose frame envelopes; C['windows']['panesCanvasPolygons'] remains the
    # exact authoritative aperture. This guard removes *only* blue/cold remnants
    # lying between inner glass and pane polygons, without erasing warm woodwork.
    areas={
    'hearth_room':[
        [(0,65),(94,79),(95,876),(0,879)],
        [(145,90),(1229,290),(1229,882),(145,873)]],
    'observation_room':[
        [(707,200),(2515,25),(2515,836),(707,840)]],
    'kitchen_room':[
        [(1320,190),(2558,58),(2558,700),(1320,707)]],
    'bedroom':[
        [(1082,350),(1688,0),(2275,265),(2275,363)],
        [(1013,310),(2275,214),(2275,1030),(1013,1030)]]}
    mask=Image.new('L',(W,H),0);d=ImageDraw.Draw(mask)
    for pts in areas[room]:d.polygon(pts,fill=255)
    return np.asarray(mask)>0

def edge_guard(room,base,prior):
    a=np.asarray(base.convert('RGB')).astype('int16')
    r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
    # Snow-filled outdoor regions have blue-shifted RGB. Warm wooden beams,
    # bedside lamp, chair fabric and shelves fail these inequalities.
    cold=(b>r+5)&(b>g-3)&(g>r-8)&(b>61)
    # Bedroom sunlit white snow on right, gray-blue with only small blue surplus.
    if room=='bedroom':
        cold |= (b>r+1)&(g>r-8)&(b>86)&(r<192)
    guard=np.where(cold&candidates(room),255,0).astype('uint8')
    # Stabilize tiny gaps without eating into the wooden mullions.
    extra=Image.fromarray(guard,'L').filter(ImageFilter.MaxFilter(5))
    return ImageChops.lighter(prior,extra)

def fix_heater(base):
    # Day photo still had a white ember after the first selective warm-only pass.
    # Extinguish the *whole* glass center, including near-white flame pixels.
    a=np.asarray(base.convert('RGB')).copy()
    yy,xx=np.ogrid[:H,:W]
    core=((xx-2412)/44)**2+((yy-1044)/82)**2<1.0
    light=a.max(axis=2).astype('float32')
    hot=core&(light>88)
    ar=a.astype('float32')
    ar[hot]*=0.29
    a=np.uint8(np.clip(ar,0,255))
    return Image.fromarray(a,'RGB').convert('RGBA')

def richer_coat(im):
    arr=np.asarray(im.convert('RGBA')).copy()
    yy,xx=np.ogrid[:H,:W]
    # Painted fabric relief: gathered collar, center seam, sleeve folds,
    # cooler shadow in the creases and a light hitting the left shoulder.
    shade=(.93+.17*np.exp(-((xx-434)/31)**2)
           -.22*np.exp(-((xx-492)/11)**2)
           -.18*np.exp(-((xx-558)/12)**2)
           +.09*np.sin((xx+yy*.18)/15))
    for k in range(3):
        arr[:,:,k]=np.uint8(np.clip(arr[:,:,k]*shade,0,255))
    return Image.fromarray(arr,'RGBA').filter(ImageFilter.GaussianBlur(.38))

def make_previews(room):
    # Rebuild calm exterior AND interior using the corrected mask; bake nothing else.
    previous_mask=Image.open(R/room/'glass_mask.png').convert('L')
    scene=Image.open(R/room/'day_preview.webp').convert('RGBA')
    if room=='observation_room':scene=fix_heater(scene)
    fixed=edge_guard(room,scene,previous_mask)
    fixed.save(R/room/'glass_mask.png')
    original_interior=Image.open(R/room/'interior_rgba.webp').convert('RGBA')
    # Rebuild from composited day source to avoid lost pixels at old window edges.
    interior=scene.copy()
    interior.putalpha(ImageChops.subtract(Image.new('L',(W,H),255),fixed))
    save(interior,room,'interior_rgba.webp')
    outside=scene.copy();outside.putalpha(fixed)
    save(outside,room,'outside_winter_day_rgba.webp')
    night=Image.open(R/room/'outside_winter_night_rgba.webp').convert('RGBA')
    # Preserve original night pixels; fill newly opened glass with a darkened calm exterior.
    raw=np.asarray(scene.convert('RGB')).astype('float32')
    raw*=np.array([.38,.48,.66],dtype=np.float32)
    raw+=np.array([10,14,23],dtype=np.float32)
    rebuilt=Image.fromarray(np.uint8(np.clip(raw,0,255)),'RGB').convert('RGBA')
    olda=night.getchannel('A')
    missing=ImageChops.subtract(fixed,olda)
    rebuilt.putalpha(missing)
    night=Image.alpha_composite(night,rebuilt)
    night.putalpha(fixed)
    save(night,room,'outside_winter_night_rgba.webp')
    for n in ('snow','blizzard'):
        old=Image.open(R/room/('weather_'+n+'.webp')).convert('RGBA')
        old.putalpha(ImageChops.multiply(old.getchannel('A'),fixed))
        save(old,room,'weather_'+n+'.webp')
    preview=Image.alpha_composite(outside,interior)
    preview.convert('RGB').save(R/room/'day_preview.webp','WEBP',quality=92,method=5)
    M['sourceFiles'][room]['glassCoverage']=round(np.asarray(fixed,dtype=np.uint8).mean()/255,5)
    C['rooms'][room]['windows'][0]['frameLeakGuard']={
      'method':'inside-frame polygon envelopes + blue-scene-only residual classification',
      'mask':'glass_mask.png','maxExpansionPx':100,
      'purpose':'preserve warm wooden frames and foreground objects while clearing surviving exterior scenery'}
    return int((np.asarray(fixed)>np.asarray(previous_mask)).sum())

def create_proofs():
    # Render via the normal preview compositor without rerunning the full art renderer
    from second_round import render_layered
    out=ROOT/'设计'/'讨论记录'/'2026-11-15_四间第二轮执行图'
    out.mkdir(exist_ok=True,parents=True)
    for night in (False,True):
        sheet=Image.new('RGB',(1600,900))
        for k,room in enumerate(ROOMS):
            t=render_layered(room,actor=True,props=True,night=night).resize((800,450),Image.Resampling.LANCZOS)
            sheet.paste(t,((k%2)*800,(k//2)*450))
        sheet.save(out/('02_人物四间_夜间开灯.jpg' if night else '01_人物四间_白天.jpg'),quality=91,subsampling=0)
    proof=Image.new('RGB',(1600,900))
    for k,room in enumerate(ROOMS):
        t=render_layered(room,actor=False,props=False,magenta=True).resize((800,450),Image.Resampling.LANCZOS)
        proof.paste(t,((k%2)*800,(k//2)*450))
    proof.save(out/'03_窗洞品红底.jpg',quality=96,subsampling=0)
    frame=render_layered('bedroom',actor=True,props=True)
    frame.crop((450,670,1450,1200)).save(out/'05_卧室睡姿局部.jpg',quality=93)
    frame=render_layered('observation_room',actor=False,props=False)
    frame.crop((2210,820,2540,1220)).save(out/'04_暖炉熄火局部.png')

def main():
    # update coat first, but keep in independent layer
    coat=R/'kitchen_room/coat.webp'
    save(richer_coat(Image.open(coat)),'kitchen_room','coat.webp')
    enlarged={}
    for room in ROOMS:
        enlarged[room]=make_previews(room)
    C['rooms']['observation_room']['heater']['default']='unlit'
    (R/'room_locations.json').write_text(json.dumps(C,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    M['secondRound']['frameGuard']='extra hand-restricted cold-scene cleanup after photo QA'
    M['secondRound']['heater']='all luminous core pixels extinguished; independent on-state overlay'
    M['secondRound']['reviewStatus']='visual QA snapshots regenerated; native G5/manual painterly pass still pending'
    M['sourceFiles']['observation_room']['note']='light-source appearance extinguished from baseline'
    manifest_files=sorted(p for room in ROOMS for p in (R/room).iterdir() if p.is_file() and p.suffix in ('.webp','.png'))
    M['binary']=[{'file':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in manifest_files]
    (R/'manifest.json').write_text(json.dumps(M,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    create_proofs()
    print('EXTRA COLD FRINGE PIXELS:',enlarged)

if __name__=='__main__':main()
