#!/usr/bin/env python3
"""Second-round four-room art patch. Deterministic, keeps original room composition.
Requires pillow, numpy. Edits game assets in-place, generates visual evidence.
Source paintings remain upscaled; this is not a native 2560 handpainted G5 pass.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
import json, math, random, hashlib

R=Path(__file__).resolve().parent
ROOT=R.parents[3]
CANVAS=(2560,1440)
ROOMS=['hearth_room','observation_room','kitchen_room','bedroom']
C=json.loads((R/'room_locations.json').read_text(encoding='utf-8'))
M=json.loads((R/'manifest.json').read_text(encoding='utf-8'))
rng=random.Random(20261115)

def blank():
    return Image.new('RGBA',CANVAS,(0,0,0,0))
def save(im,room,name):
    im.convert('RGBA').save(R/room/name,format='WEBP',lossless=True,method=5)
def texture(im,seed=51,level=3):
    a=np.asarray(im.convert('RGBA')).copy()
    active=a[:,:,3]>0
    noise=np.random.default_rng(seed).normal(0,level,(1440,2560,1))
    a[:,:,:3]=np.clip(a[:,:,:3].astype(np.float32)+noise,0,255).astype('uint8')
    a[:,:,3][~active]=0
    return Image.fromarray(a,'RGBA')
def outlines(d,shape,color='#3c2b22',width=3):
    d.line(shape+[shape[0]],fill=color,width=width,joint='curve')

def draw_logs(level):
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    if level==0:return im
    x0,y0=2250,1150
    rows={1:1,2:2,3:3,4:4}[level]
    for row in range(rows):
        count=3 if row<3 else 2
        for i in range(count):
            sx=x0+i*80+(row%2)*13-10
            sy=y0-row*53-(i%2)*5
            ww=80+rng.randrange(-9,12);hh=43+rng.randrange(-5,5)
            # broken bark; each log lies slightly diagonal, round cut end at right
            polygon=[(sx,sy-hh+7),(sx+ww-18,sy-hh-2),(sx+ww,sy-hh+5),
                     (sx+ww+4,sy-6),(sx+8,sy+3)]
            d.polygon(polygon,fill=(95+row*4,57+row*4,35,249))
            for j in range(6):
                yy=sy-hh+10+j*6
                d.line([(sx+10,yy),(sx+ww-16,yy-3)],fill=(57+j*6,39+j*3,29,175),width=2)
            d.ellipse((sx+ww-30,sy-hh-5,sx+ww+9,sy+2),fill=(177,126,77,255),
                      outline=(61,44,33,250),width=4)
            for rad in (7,13):
                d.arc((sx+ww-10-rad,sy-hh//2-rad,sx+ww-10+rad,sy-hh//2+rad),
                      20,300,fill=(109,74,46,225),width=2)
            d.line([(sx+4,sy-hh+8),(sx+ww-18,sy-hh+2)],fill=(210,165,114,125),width=3)
    return texture(im,71+level,5)

def draw_flames(level):
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    # stove opening is x ~1810-2010, y ~774-910
    aperture=(1813,774,2028,941)
    d.rounded_rectangle(aperture,radius=34,fill=(41,31,24,36),outline=(248,177,86,115),width=5)
    d.ellipse((1834,886,2018,930),fill=(120,43,18,235))
    for i in range(24):
        x=1837+i*7
        y=902+rng.randrange(-8,9)
        col=rng.choice([(231,90,31,242),(255,164,51,248),(249,104,38,215)])
        d.ellipse((x,y,x+8,y+5),fill=col)
    if level=='ember':
        n=3;maxh=17
    elif level=='low':
        n=6;maxh=68
    else:
        n=10;maxh=116
    glow=blank();g=ImageDraw.Draw(glow,'RGBA')
    for i in range(n):
        cx=1853+i*(145/max(1,n-1))+rng.randrange(-9,10)
        by=908+rng.randrange(-6,6)
        ht=maxh*(.48+.48*rng.random())
        poly=[(cx-15,by),(cx-10,by-ht*.38),(cx+3,by-ht),
              (cx+1,by-ht*.42),(cx+19,by-ht*.18),(cx+14,by)]
        g.polygon(poly,fill=(248,85,20,160))
        d.polygon(poly,fill=(237,94,23,238))
        inner=[(cx-7,by),(cx-5,by-ht*.27),(cx+3,by-ht*.65),
               (cx+10,by-ht*.16),(cx+8,by)]
        d.polygon(inner,fill=(255,187,70,224))
        d.line([(cx+2,by-8),(cx+1,by-ht*.3)],fill=(255,230,137,220),width=3)
    im=Image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(17)),im)
    d=ImageDraw.Draw(im,'RGBA')
    for k in range(3):d.arc((1818-k*4,772-k*3,2021+k*4,934+k*4),185,350,
                             fill=(255,210,133,46),width=2)
    # firebox glass reflection, not a solid triangle
    d.line([(1846,794),(1897,782),(1911,790)],fill=(225,221,201,95),width=3)
    d.line([(1991,810),(2005,862)],fill=(228,215,181,65),width=4)
    return texture(im,30+len(level),3)

def woodframe(d,x0,y0,x1,y1):
    d.rectangle((x0,y0,x1,y1),fill=(111,65,35,245),outline=(54,33,23,240),width=5)
    d.line([(x0+3,y0+4),(x1-4,y0+4)],fill=(193,124,65,205),width=4)
    for k in (18,36):
        d.line([(x0+k,y0+8),(x0+k,y1-8)],fill=(152,89,46,120),width=2)

def build_kitchen():
    base=Image.open(R/'kitchen_room/day_preview.webp').convert('RGBA')
    d=ImageDraw.Draw(base,'RGBA')
    # Open, empty food storage rack: left of the long prep cabinet, not the coat hooks.
    # Fits existing empty lower cabinets but reads as four open shelf compartments.
    for y in (835,969,1095):
        woodframe(d,1167,y,1590,y+18)
    for x in (1167,1368,1590):
        woodframe(d,x,824,x+16,1108)
    for y in (854,986):
        for x0,x1 in ((1187,1358),(1388,1580)):
            d.rectangle((x0,y,x1,y+95),fill=(57,35,27,92))
            for t in range(6):
                d.line([(x0+t*27,y+5),(x0+t*27,y+92)],fill=(104,70,46,42),width=2)
    # A small wall-mounted hook by the actual front entrance (left door), distinct
    # from existing utility hooks near the covered rear walkway.
    d.line([(425,441),(509,441)],fill=(169,106,60,255),width=11)
    d.line([(425,447),(509,447)],fill=(64,39,27,210),width=3)
    for cx in (451,487):
        d.arc((cx-11,441,cx+9,473),5,177,fill=(45,38,34,255),width=5)
    return base

def draw_coat():
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    # Drooping olive parka on front-door hook (not the rear hallway).
    d.line([(470,454),(470,512)],fill=(73,57,42,230),width=4)
    shape=[(450,494),(426,512),(405,568),(387,725),(430,749),(456,687),
           (450,788),(536,796),(545,682),(570,756),(602,733),
           (580,568),(530,513),(504,495),(485,522),(470,530)]
    d.polygon(shape,fill=(61,83,65,247))
    outlines(d,shape,'#293b32',5)
    d.polygon([(450,496),(485,527),(469,562),(439,527)],fill=(109,110,84,245))
    d.polygon([(486,523),(509,494),(529,518),(512,550)],fill=(96,108,84,245))
    d.line([(482,564),(491,781)],fill=(37,54,41,240),width=7)
    for x in (427,543):
        d.line([(x,595),(x+9,745)],fill=(139,147,110,103),width=3)
        d.line([(x+12,601),(x+17,749)],fill=(25,50,40,175),width=4)
    for j in range(5):
        y=655+j*25
        d.arc((438,y,517,y+18),30,150,fill=(161,156,119,110),width=2)
    d.line([(438,764),(529,779)],fill=(29,39,34,170),width=4)
    return texture(im,202,5)

def draw_herbs():
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    for i,cx in enumerate([918,985,1060,1121]):
        stemtop=523+i%2*7
        d.line([(cx,stemtop-33),(cx,stemtop+14)],fill=(171,135,77,228),width=3)
        bunch=rng.randrange(6,9)
        d.ellipse((cx-15,stemtop+4,cx+15,stemtop+18),fill=(119,91,46,238))
        for j in range(bunch):
            off=(j-(bunch-1)/2)*8
            endy=stemtop+92+rng.randrange(-13,27)
            d.line([(cx,stemtop+11),(cx+off,endy)],fill=(100,99,60,230),width=2)
            for k in range(4):
                yy=stemtop+24+k*17+rng.randrange(-3,4)
                xx=cx+off*(yy-stemtop)/(endy-stemtop)
                g=(94+j*3,112+j*3,71,205)
                d.ellipse((xx-11,yy-5,xx+3,yy+6),fill=g)
                d.ellipse((xx,yy+1,xx+12,yy+8),fill=(126,122,71,191))
        d.line([(cx-10,stemtop+17),(cx+10,stemtop+17)],fill=(194,161,102,230),width=4)
    return texture(im,102,6)

def draw_stock(full):
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    slots=[(1246,943),(1432,941),(1240,1065),(1434,1065)]
    if not full: slots=slots[:2]
    for j,(x,y) in enumerate(slots):
        if j%3==0:
            # cloth grain sack, folds, tied neck
            shape=[(x-51,y-4),(x-60,y-56),(x-29,y-96),(x-12,y-92),
                   (x+6,y-96),(x+39,y-56),(x+44,y)]
            d.polygon(shape,fill=(168,145,103,245))
            outlines(d,shape,'#74563c',3)
            d.line([(x-20,y-78),(x+21,y-78)],fill=(111,82,55,220),width=6)
            for k in range(10):
                yy=y-64+k*6
                d.arc((x-45,yy,x+41,yy+29),190,330,fill=(208,180,130,78),width=2)
        elif j%3==1:
            # Woven willow basket
            d.ellipse((x-58,y-22,x+65,y+16),fill=(121,79,44,245),outline=(72,45,31,255),width=4)
            d.polygon([(x-52,y-28),(x+62,y-28),(x+47,y+14),(x-43,y+14)],fill=(173,120,69,250))
            for k in range(-38,51,16):
                d.line([(x+k,y-26),(x+k-8,y+12)],fill=(96,61,41,180),width=3)
            for yy in range(y-20,y+15,9):
                d.line([(x-46,yy),(x+47,yy)],fill=(233,174,103,185),width=3)
            d.arc((x-35,y-60,x+40,y+4),180,357,fill=(122,80,53,220),width=6)
        else:
            for ix in range(3 if full else 2):
                xx=x-50+ix*37
                d.rectangle((xx,y-60,xx+31,y+5),fill=(108+ix*19,112-ix*5,94,242),
                            outline=(55,64,55,255),width=3)
                d.ellipse((xx,y-67,xx+31,y-53),fill=(141,120,82,250))
                d.line([(xx+6,y-34),(xx+22,y-34)],fill=(192,181,147,180),width=3)
    if full:
        for xx,yy in ((1205,841),(1325,841),(1455,840),(1540,841)):
            d.ellipse((xx-22,yy-24,xx+20,yy+8),fill=(155,116,66,250),
                      outline=(88,55,34,250),width=3)
            d.arc((xx-9,yy-38,xx+14,yy-13),0,170,fill=(208,177,117,205),width=3)
    return texture(im,210+int(full),6)

def draw_books(full):
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    count=14 if full else 4
    for i in range(count):
        row=0 if i<7 else 1
        ix=i if row==0 else i-7
        x=363+ix*37+rng.randrange(-4,5)
        y=(823 if row==0 else 1035)
        h=rng.randrange(101,160)
        w=rng.randrange(23,36)
        col=rng.choice([(74,96,86,245),(113,66,57,247),(75,92,110,249),(142,113,78,245)])
        d.polygon([(x,y-h),(x+w,y-h+2),(x+w+2,y),(x-2,y)],fill=col)
        d.line([(x+4,y-h+2),(x+4,y-8)],fill=(229,207,162,145),width=3)
        d.line([(x+7,y-15),(x+w-5,y-15)],fill=(206,173,109,185),width=2)
        d.line([(x+7,y-h+19),(x+w-5,y-h+19)],fill=(201,169,118,185),width=3)
        if i%3==0:
            d.polygon([(x,y-h+13),(x+w,y-h+11),(x+w-2,y-h+35),(x,y-h+37)],
                      fill=(168,133,76,170))
    return texture(im,342+int(full),4)

def chair_occlusion(base):
    # The actual slatted chair from the base scene is in front of the writing pose.
    # Keep its lower spine/front woodwork rather than reintroducing the whole chair.
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    d.line([(1060,865),(1081,1121)],fill=(91,49,29,255),width=26)
    d.line([(1215,857),(1250,1146)],fill=(92,50,28,255),width=24)
    for i in range(5):
        xx=1085+i*27
        d.line([(xx,910),(xx+13,1110)],fill=(138,81,44,247),width=11)
        d.line([(xx-3,923),(xx+7,1104)],fill=(199,128,65,145),width=3)
    d.arc((1060,817,1237,913),175,356,fill=(90,50,32,255),width=17)
    d.arc((1064,823,1234,899),184,355,fill=(180,111,62,185),width=7)
    d.line([(1083,1101),(1250,1131)],fill=(82,45,31,250),width=20)
    return texture(im,419,4)

def heater_off(base):
    # Selectively extinguish baked flame in the real oil heater glass (bottom-right).
    ar=np.asarray(base.convert('RGB')).copy()
    x0,y0,x1,y1=2330,945,2486,1120
    a=ar[y0:y1,x0:x1].astype(np.float32)
    r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
    warm=(r>95)&(r>g*1.10)&(g>b*1.26)
    yy,xx=np.mgrid[y0:y1,x0:x1]
    region=((xx-2413)/70)**2+((yy-1035)/100)**2<1
    use=warm&region
    lum=(r*.299+g*.587+b*.114)
    # charcoal / unlit glass; metal stays painted
    new=np.stack([lum*.48,lum*.49,lum*.52],axis=2)
    a[use]=new[use]
    ar[y0:y1,x0:x1]=np.uint8(np.clip(a,0,255))
    return Image.fromarray(ar,'RGB').convert('RGBA')

def heater_on():
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    d.ellipse((2378,982,2445,1110),fill=(222,147,65,36))
    d.polygon([(2391,1082),(2401,1037),(2414,988),(2416,1048),(2432,1011),
               (2433,1078)],fill=(244,137,48,193))
    d.polygon([(2403,1080),(2411,1033),(2422,1079)],fill=(255,218,118,195))
    return im.filter(ImageFilter.GaussianBlur(2))

def sleep_fixes(base):
    path=R/'bedroom/actor_male_pose.webp'
    actor=Image.open(path).convert('RGBA')
    arr=np.asarray(actor).copy()
    yy,xx=np.ogrid[:1440,:2560]
    # Keep the head and slight shoulder against the left pillow; the rest of
    # the body belongs below the bedding rather than on its surface.
    shape=((xx-772)/238.0)**4+((yy-818)/122.0)**4
    retain=np.clip((1.15-shape)*4.5,0,1)
    arr[:,:,3]=(arr[:,:,3].astype(float)*retain).astype(np.uint8)
    Image.fromarray(arr,'RGBA').save(path,'WEBP',lossless=True,method=5)
    # Original handpainted blanket is returned on top of the hidden torso.
    # This is the *same source texture* rather than a generic striped polygon.
    mask=Image.new('L',CANVAS,0)
    d=ImageDraw.Draw(mask)
    d.polygon([(910,837),(1266,830),(1325,1104),(755,1170),
               (780,978),(860,893)],fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(3))
    occl=Image.new('RGBA',CANVAS,(0,0,0,0))
    occl.paste(base,(0,0),mask)
    save(occl,'bedroom','bed_front_occlusion.webp')

def reshape_polygons(room,polys):
    result=[]
    for i,p in enumerate(polys):
        minx=min(pt[0] for pt in p); maxx=max(pt[0] for pt in p)
        miny=min(pt[1] for pt in p); maxy=max(pt[1] for pt in p)
        new=[]
        for x,y in p:
            if room=='bedroom' and i>=2:
                x += (-20 if x==minx else 20 if x==maxx else 0)
                y += (-18 if y==miny else 18 if y==maxy else 0)
            else:
                dxr={'hearth_room':11,'observation_room':23,'kitchen_room':13,'bedroom':22}[room]
                dxl={'hearth_room':4,'observation_room':6,'kitchen_room':4,'bedroom':6}[room]
                bot={'hearth_room':28,'observation_room':30,'kitchen_room':23,'bedroom':29}[room]
                if x==maxx:x+=dxr
                if x==minx:x-=dxl
                if y>=maxy-32:y+=bot
                if y==miny:y-=5
            new.append([max(0,min(2560,x)),max(0,min(1440,y))])
        result.append(new)
    return result

def new_mask(room):
    panes=C['rooms'][room]['windows'][0]['panesCanvasPolygons']
    fixed=reshape_polygons(room,panes)
    C['rooms'][room]['windows'][0]['panesCanvasPolygons']=fixed
    im=Image.new('L',CANVAS,0);d=ImageDraw.Draw(im)
    for p in fixed:d.polygon([tuple(pt) for pt in p],fill=255)
    # small frame-side overlap removes 1-2 px light fringe
    im=im.filter(ImageFilter.MaxFilter(5))
    im.save(R/room/'glass_mask.png')
    M['sourceFiles'][room]['glassCoverage']=round(np.asarray(im,dtype=np.uint8).mean()/255,5)
    M['sourceFiles'][room]['glassPolygonsSourcePx']=[
        [[round(x*1672/2560),round(y*940/1440)] for x,y in poly] for poly in fixed]
    return im

def calm_scenery(base,mask,night=False):
    # Never draw snow into the base layer: window snow is a separate state.
    rgb=base.convert('RGB')
    rgb=rgb.filter(ImageFilter.MedianFilter(size=7))
    arr=np.asarray(rgb).astype(np.float32)
    # Snow line suppression: median estimate applied most strongly to sky;
    # keeps forest/snow-covered trees recognizable.
    med=np.asarray(rgb.filter(ImageFilter.MedianFilter(size=11))).astype(np.float32)
    yy=np.arange(1440,dtype=np.float32)[:,None,None]
    strength=np.where(yy<570,.76,.15)
    arr=arr*(1-strength)+med*strength
    if night:
        arr[:,:,0]*=.37;arr[:,:,1]*=.48;arr[:,:,2]*=.67
        arr+=np.array([10,14,23],dtype=np.float32)
    arr=np.uint8(np.clip(arr,0,255))
    out=Image.fromarray(arr,'RGB').convert('RGBA')
    out.putalpha(mask)
    return out

def snow_layer(mask,heavy=False):
    im=blank();d=ImageDraw.Draw(im,'RGBA')
    random_snow=random.Random(20261115+int(heavy))
    n=2450 if heavy else 550
    for i in range(n):
        x=random_snow.randrange(0,2560);y=random_snow.randrange(0,1440)
        w=random_snow.randint(2,4 if not heavy else 7)
        endx=x-int(w*1.4);endy=y+w*2
        d.line((x,y,endx,endy),fill=(224,240,255,random_snow.randint(50,140 if not heavy else 190)),
               width=1 if not heavy else random_snow.randint(1,3))
    if heavy:
        bands=blank();bd=ImageDraw.Draw(bands,'RGBA')
        for i in range(18):
            y=random_snow.randrange(0,1440)
            bd.line([(0,y),(2560,y-620)],fill=(224,234,252,random_snow.randrange(9,26)),width=random_snow.randrange(7,20))
        im=Image.alpha_composite(im,bands.filter(ImageFilter.GaussianBlur(15)))
    a=ImageChops.multiply(im.getchannel('A'),mask)
    im.putalpha(a)
    return im

def kitchen_spill(high=False):
    # Warmth pours from unseen hearth doorway LEFT at floor level.
    yy,xx=np.ogrid[:1440,:2560]
    radius=((xx+100)/780.0)**2+((yy-1120)/520.0)**2
    alpha=np.exp(-radius*1.55)*(120 if high else 58)
    # second broader bounced light, no rectangle edges
    alpha+=np.exp(-(((xx-120)/1200.0)**2+((yy-1270)/430.0)**2)*1.8)*(42 if high else 18)
    ar=np.zeros((1440,2560,4),dtype=np.uint8)
    ar[:,:,:3]=(255,157,82)
    ar[:,:,3]=np.clip(alpha,0,170).astype('uint8')
    return Image.fromarray(ar,'RGBA')

def slide_lamp(room,anchor):
    # Translate existing real lamp and its glow by their alpha bounding box
    for f in ('oil_lamp_body.webp','oil_lamp_glow.webp'):
        im=Image.open(R/room/f).convert('RGBA')
        bounds=im.getchannel('A').getbbox()
        if not bounds:continue
        cx=(bounds[0]+bounds[2])//2; cy=(bounds[1]+bounds[3])//2
        dx=anchor[0]-cx;dy=anchor[1]-cy
        shifted=blank();shifted.paste(im,(dx,dy),im)
        # preserve original transparency without alpha squaring
        shifted=Image.new('RGBA',CANVAS)
        shifted.paste(im,(dx,dy))
        save(shifted,room,f)

def preview_comp(room,base,outside):
    im=Image.alpha_composite(outside,base)
    im.save(R/room/'day_preview.webp','WEBP',lossless=False,quality=92,method=5)

def render_layered(room,actor=True,props=True,night=False,magenta=False):
    if magenta:
        im=Image.new('RGBA',CANVAS,(255,0,255,255))
    else:
        im=Image.open(R/room/('outside_winter_night_rgba.webp' if night else 'outside_winter_day_rgba.webp')).convert('RGBA')
    sequence=['interior_rgba.webp']
    if props:
        sequence+={
          'hearth_room':['woodpile_3.webp','armchair_blanket.webp','snack_plate.webp'],
          'observation_room':['books_few.webp','cup.webp','map.webp'],
          'kitchen_room':['stock_sparse.webp','herbs.webp','coat.webp'],
          'bedroom':[]
        }[room]
    if actor:
        sequence+=['actor_contact.webp','actor_male_pose.webp']
        if room=='bedroom':sequence+=['bed_front_occlusion.webp']
        if room=='observation_room':sequence+=['chair_front_occlusion.webp']
    if props and room=='bedroom':sequence+=['quilt_thick.webp']
    if night:
        sequence+=['night_ambient.webp','fire_spill_high.webp']
        if room=='hearth_room':sequence+=['fire_flame_high.webp']
    sequence+=['oil_lamp_body.webp']
    if night:sequence+=['oil_lamp_glow.webp']
    for name in sequence:
        path=R/room/name
        if path.exists():im=Image.alpha_composite(im,Image.open(path).convert('RGBA'))
    return im.convert('RGB')

def make_qa():
    out=ROOT/'设计'/'讨论记录'/'2026-11-15_四间第二轮执行图'
    out.mkdir(parents=True,exist_ok=True)
    for night in (False,True):
        im=Image.new('RGB',(1600,900),(8,18,24))
        for index,room in enumerate(ROOMS):
            rendered=render_layered(room,actor=True,props=True,night=night)
            tile=rendered.resize((800,450),Image.Resampling.LANCZOS)
            im.paste(tile,((index%2)*800,(index//2)*450))
        name='02_人物四间_夜间开灯.jpg' if night else '01_人物四间_白天.jpg'
        im.save(out/name,quality=89,subsampling=0)
    magenta=Image.new('RGB',(1600,900),(255,0,255))
    for index,room in enumerate(ROOMS):
        rendered=render_layered(room,actor=False,props=False,magenta=True)
        tile=rendered.resize((800,450),Image.Resampling.LANCZOS)
        magenta.paste(tile,((index%2)*800,(index//2)*450))
    magenta.save(out/'03_窗洞品红底.jpg',quality=93,subsampling=0)
    # screenshot-friendly closeups with full-size source fidelity
    heater=Image.open(R/'observation_room/day_preview.webp')
    heater.crop((2240,800,2550,1250)).save(out/'04_暖炉熄火局部.png')
    return out

def main():
    # retain original full-color scenes before changing images
    originals={r:Image.open(R/r/'day_preview.webp').convert('RGBA') for r in ROOMS}
    originals['kitchen_room']=build_kitchen()
    originals['observation_room']=heater_off(originals['observation_room'])
    save(draw_coat(),'kitchen_room','coat.webp')
    save(draw_herbs(),'kitchen_room','herbs.webp')
    for full,f in ((False,'stock_sparse.webp'),(True,'stock_full.webp')):
        save(draw_stock(full),'kitchen_room',f)
    for full,f in ((False,'books_few.webp'),(True,'books_many.webp')):
        save(draw_books(full),'observation_room',f)
    save(chair_occlusion(originals['observation_room']),'observation_room','chair_front_occlusion.webp')
    save(heater_on(),'observation_room','heater_flame_on.webp')
    for level in range(5):
        save(draw_logs(level),'hearth_room',f'woodpile_{level}.webp')
    for level in ('ember','low','high'):
        save(draw_flames(level),'hearth_room',f'fire_flame_{level}.webp')
    for strength,f in ((False,'fire_spill_low.webp'),(True,'fire_spill_high.webp')):
        save(kitchen_spill(strength),'kitchen_room',f)
    sleep_fixes(originals['bedroom'])
    slide_lamp('hearth_room',(1605,980))
    # Furniture is on indoor source before separating exterior and interior.
    for room in ROOMS:
        base=originals[room]
        mask=new_mask(room)
        alpha=ImageChops.subtract(Image.new('L',CANVAS,255),mask)
        interior=base.copy();interior.putalpha(alpha)
        save(interior,room,'interior_rgba.webp')
        day=calm_scenery(base,mask)
        night=calm_scenery(base,mask,night=True)
        save(day,room,'outside_winter_day_rgba.webp')
        save(night,room,'outside_winter_night_rgba.webp')
        save(snow_layer(mask),'%s'%room,'weather_snow.webp')
        save(snow_layer(mask,True),'%s'%room,'weather_blizzard.webp')
        preview_comp(room,interior,day)
    # Location semantics: pantry is NOT the hallway coat bench.
    C['locations']['shelf']['footAnchor']=[1228,1070]
    C['locations']['shelf']['standingHeightPx']=round(345+.28*1070)
    C['locations']['shelf']['facing']='toward_open_pantry_under_counter'
    C['locations']['door']['footAnchor']=[433,1090]
    C['locations']['door']['standingHeightPx']=round(345+.28*1090)
    C['locations']['door']['facing']='toward_front_exit_and_coat_hook'
    C['locations']['door']['notes']='Front entrance is far left; coat hook immediately at its right jamb. Rear corridor hooks are utility hooks only.'
    C['locations']['backdoor']['notes']='Rear central doorway is the one covered walkway opening to the springhouse, not the front entrance.'
    C['locations']['shelf']['notes']='Open food rack beneath the right-side long counter. Empty in the base; stocked by independent sparse/full layers.'
    C['locations']['desk']['occludedBy']=['desk_front_edge','chair_front_occlusion']
    C['rooms']['observation_room']['heater']={'default':'unlit','litOverlay':'heater_flame_on.webp','note':'no fuel on game start'}
    C['rooms']['observation_room']['actor']['frontOcclusion']='chair_front_occlusion.webp'
    C['rooms']['bedroom']['actor']['occlusion']='bed_front_occlusion.webp'
    C['rooms']['hearth_room']['lampAnchor']=[1605,980]
    C['rooms']['kitchen_room']['coatAnchor']=[470,655]
    C['rooms']['kitchen_room']['storageAnchor']=[1360,960]
    (R/'room_locations.json').write_text(json.dumps(C,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    M['reviewDoc']='2026-11-15_四间底图第二轮修改单_Claude.md'
    M['status']='SECOND_ROUND_GAMEPLAY_READY_VISUAL_QA_PENDING_NATIVE_G5'
    M['windowMatte']='redrawn enlarged inside-frame polygons with 2px safety overcut; magenta QA required'
    M['weather']['caveat']='Calm base median-cleaned; some larger baked streaks may remain; native redrawing needed for snow-free fine art.'
    M['weather']['calmRepaint']='median neighborhood 7/11 on original outside image with explicit 0-snow overlay'
    M['secondRound']={'windows':'new polygon masks and 2px safety',
                      'sleep':'face-and-shoulder mask; existing handpainted duvet restores foreground',
                      'observationChair':'chair_front_occlusion.webp',
                      'keroseneHeater':'unlit base plus heater_flame_on.webp',
                      'storage':'open wooden shelf beneath long kitchen cabinet',
                      'lamp':'hearth side table',
                      'fire':'three distinct curved-glow states',
                      'stock':'woven baskets and folded fabric sacks',
                      'calm':'median-cleaned baked snow; manual cleanup still recommended',
                      'nativeG5':'not passed; sources retain 1672x941 provenance'}
    for r in ROOMS:
        M['sourceFiles'][r]['files']=sorted({*M['sourceFiles'][r]['files'],*
          [p.name for p in (R/r).iterdir() if p.suffix.lower() in ('.webp','.png')]})
    # All binary asset integrity information is recomputed after changing pixels.
    paths=sorted(p for r in ROOMS for p in (R/r).iterdir() if p.is_file() and p.suffix in ('.webp','.png'))
    M['binary']=[{'file':str(p.relative_to(R)),'bytes':p.stat().st_size,
                  'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
    (R/'manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    evidence=make_qa()
    print('Generated room assets:',len(paths),'evidence at',evidence)
    print('window coverages:',{r:M['sourceFiles'][r]['glassCoverage'] for r in ROOMS})
    print('bed actor bbox:',Image.open(R/'bedroom/actor_male_pose.webp').getbbox())

if __name__=='__main__':main()
