#!/usr/bin/env python3
"""Final constrained QA repair. Restore pre-overcut art then repair narrow panes.
Origin snapshot is the first checked/pushed renderer result f616505.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageChops,ImageFilter
import numpy as np,subprocess,io,hashlib,json
R=Path(__file__).resolve().parent
ROOT=R.parents[3]
W,H=2560,1440
BASE='f616505bd3a22e3dc982cbac45dd77d148308578'
ROOMS=['hearth_room','observation_room','kitchen_room','bedroom']
REPLACE=['glass_mask.png','interior_rgba.webp','outside_winter_day_rgba.webp',
         'outside_winter_night_rgba.webp','day_preview.webp',
         'weather_snow.webp','weather_blizzard.webp']
C=json.loads((R/'room_locations.json').read_text(encoding='utf-8'))
M=json.loads((R/'manifest.json').read_text(encoding='utf-8'))

def get_pre(room,name):
    path=f'assets/05/rooms/g5_20261115/{room}/{name}'
    return Image.open(io.BytesIO(subprocess.check_output(['git','show',f'{BASE}:{path}']))).copy()

def save(im,room,name):
    im.save(R/room/name,'WEBP',lossless=True,method=5)

def extra_mask(room,day,original):
    # Only exact narrow strips and the two actual triangular roof glasses.
    brush=Image.new('L',(W,H),0);d=ImageDraw.Draw(brush)
    paint={
    'hearth_room':[
        [(895,756),(1064,757),(1060,821),(895,820)],
        [(162,809),(711,809),(713,853),(163,853)]],
    'observation_room':[
        [(969,786),(2266,786),(2266,818),(969,818)],
        [(2210,73),(2262,70),(2262,800),(2210,800)]],
    'kitchen_room':[
        [(2275,128),(2345,119),(2348,675),(2275,675)],
        [(1597,214),(1665,213),(1665,671),(1597,671)],
        [(1325,644),(2540,630),(2540,675),(1325,675)]],
    'bedroom':[
        [(1095,342),(1705,4),(1705,310)],
        [(1730,5),(2262,275),(1730,307)],
        [(2121,245),(2260,224),(2260,1043),(2121,1043)],
        [(1299,939),(2152,920),(2250,1025),(1299,1005)]]}
    for p in paint[room]:d.polygon(p,fill=255)
    ar=np.asarray(day.convert('RGB')).astype('int16')
    r,g,b=ar[:,:,0],ar[:,:,1],ar[:,:,2]
    # Snow/sky blue guard on painted strip; leave the amber beams and cupboard wood.
    cold=(b>r+6)&(b>=g-3)&(g>r-11)&(b>75)
    guard=np.where(cold & (np.asarray(brush)>0),255,0).astype('uint8')
    # Anti-alias-free base polygon mask retained; *no* global dilation.
    merged=ImageChops.lighter(original,Image.fromarray(guard,'L'))
    return merged

def heater_unlit(base):
    # Inpaint the old flame from the existing dark stove glass, preserving cage detail.
    import cv2
    rgb=np.asarray(base.convert('RGB')).copy()
    y,x=np.ogrid[:H,:W]
    glass=(((x-2412)/64)**2+((y-1045)/104)**2<1)
    lum=(rgb[:,:,0].astype(float)*.25+rgb[:,:,1]*.6+rgb[:,:,2]*.15)
    warm=(rgb[:,:,0].astype('int16')>rgb[:,:,2].astype('int16')+28)
    glint=(lum>115)&glass
    mask=np.uint8((glint & (warm | (lum>160)))*255)
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
    out=cv2.inpaint(rgb,mask,7,cv2.INPAINT_TELEA)
    # Darken only residual inner flame, not the silhouette of the metal cage.
    return Image.fromarray(out,'RGB').convert('RGBA')

def repair_sleep():
    actor=Image.open(R/'bedroom/actor_male_pose.webp').convert('RGBA')
    ar=np.asarray(actor).copy()
    yy,xx=np.ogrid[:H,:W]
    fade=np.clip((954-xx)/90,0,1)*np.clip((960-yy)/55,0,1)
    ar[:,:,3]=np.uint8(ar[:,:,3]*fade)
    save(Image.fromarray(ar,'RGBA'),'bedroom','actor_male_pose.webp')
    # Pull plaid duvet down below the cheek, retaining cover on the upper body.
    path=R/'bedroom/quilt_thick.webp'
    quilt=Image.open(path).convert('RGBA')
    hole=Image.new('L',(W,H),0);d=ImageDraw.Draw(hole)
    d.ellipse((520,755,950,930),fill=255)
    # Feather to avoid a cutout around the pillow.
    hole=hole.filter(ImageFilter.GaussianBlur(24))
    newalpha=ImageChops.subtract(quilt.getchannel('A'),hole)
    quilt.putalpha(newalpha)
    save(quilt,'bedroom','quilt_thick.webp')

def rebuild(room):
    day=get_pre(room,'day_preview.webp').convert('RGBA')
    oldmask=get_pre(room,'glass_mask.png').convert('L')
    if room=='observation_room':day=heater_unlit(day)
    mask=extra_mask(room,day,oldmask)
    mask.save(R/room/'glass_mask.png')
    interior=day.copy()
    interior.putalpha(ImageChops.subtract(Image.new('L',(W,H),255),mask))
    save(interior,room,'interior_rgba.webp')
    outside=day.copy();outside.putalpha(mask)
    save(outside,room,'outside_winter_day_rgba.webp')
    previous_night=get_pre(room,'outside_winter_night_rgba.webp').convert('RGBA')
    rgb=np.asarray(day.convert('RGB')).astype('float32')
    rgb=rgb*np.array([.38,.48,.66],dtype=np.float32)+np.array([10,14,23],dtype=np.float32)
    newnight=Image.fromarray(np.uint8(np.clip(rgb,0,255)),'RGB').convert('RGBA')
    missing=ImageChops.subtract(mask,previous_night.getchannel('A'))
    newnight.putalpha(missing)
    night=Image.alpha_composite(previous_night,newnight)
    night.putalpha(mask)
    save(night,room,'outside_winter_night_rgba.webp')
    for weather in ('snow','blizzard'):
        prior=get_pre(room,'weather_'+weather+'.webp').convert('RGBA')
        prior.putalpha(ImageChops.multiply(prior.getchannel('A'),mask))
        save(prior,room,'weather_'+weather+'.webp')
    Image.alpha_composite(outside,interior).convert('RGB').save(
      R/room/'day_preview.webp','WEBP',quality=92,method=5)
    C['rooms'][room]['windows'][0]['frameLeakGuard']={
      'method':'hand-limited narrow pane strips, roof-triangle geometry, retain warm frame',
      'mask':'glass_mask.png','approvedGeometry':False}
    M['sourceFiles'][room]['glassCoverage']=round(float(np.asarray(mask).mean())/255,5)

def proofs():
    from second_round import render_layered
    out=ROOT/'设计'/'讨论记录'/'2026-11-15_四间第二轮执行图'
    for night in (False,True):
        sheet=Image.new('RGB',(1600,900))
        for i,room in enumerate(ROOMS):
            img=render_layered(room,True,True,night).resize((800,450),Image.Resampling.LANCZOS)
            sheet.paste(img,((i%2)*800,(i//2)*450))
        sheet.save(out/('02_人物四间_夜间开灯.jpg' if night else '01_人物四间_白天.jpg'),quality=92,subsampling=0)
    sheet=Image.new('RGB',(1600,900))
    for i,room in enumerate(ROOMS):
        img=render_layered(room,False,False,False,True).resize((800,450),Image.Resampling.LANCZOS)
        sheet.paste(img,((i%2)*800,(i//2)*450))
    sheet.save(out/'03_窗洞品红底.jpg',quality=96,subsampling=0)
    render_layered('bedroom',True,True).crop((450,670,1450,1200)).save(out/'05_卧室睡姿局部.jpg',quality=94)
    render_layered('observation_room',False,False).crop((2210,820,2540,1220)).save(out/'04_暖炉熄火局部.png')

def main():
    repair_sleep()
    for room in ROOMS:rebuild(room)
    M['secondRound']['frameGuard']='targeted correction from tested f616 base, no global cold-scene mask'
    M['secondRound']['sleep']='remove second sweater mound and soften quilt reveal around head'
    M['secondRound']['heater']='inpaint baked flame inside glass; separate lit overlay'
    M['secondRound']['humanArtReview']='needed: pane precision and props painterly textures are not G5 final'
    C['rooms']['observation_room']['heater']['default']='unlit'
    (R/'room_locations.json').write_text(json.dumps(C,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    paths=sorted(p for room in ROOMS for p in (R/room).iterdir()
                 if p.is_file() and p.suffix in ('.webp','.png'))
    M['binary']=[{'file':str(p.relative_to(R)),'bytes':p.stat().st_size,
                  'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
    (R/'manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    proofs()
    print('Repair done:',len(paths),'art assets; restored base',BASE)

if __name__=='__main__':main()
