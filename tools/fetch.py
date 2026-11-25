import json,urllib.request,urllib.error,urllib.parse,time
UA={"User-Agent":"mm-geo-game-dev/0.1 (personal project)"}
API="https://commons.wikimedia.org/w/api.php?"
import os
def get(p):
    p.update(format="json")
    for t in range(6):
        try:
            time.sleep(1.5)
            return json.load(urllib.request.urlopen(urllib.request.Request(API+urllib.parse.urlencode(p),headers=UA)))
        except urllib.error.HTTPError as e:
            if e.code!=429: raise
            time.sleep(10*(t+1))
    raise SystemExit("429")
spots=json.load(open("spots0.json"));res=json.load(open("cands.json")) if os.path.exists("cands.json") else {}
for sid,lat,lng in spots:
    if sid in res: continue
    g=get(dict(action="query",list="geosearch",gscoord=f"{lat}|{lng}",gsradius=130,gsnamespace=6,gslimit=60))
    items=g["query"]["geosearch"]; ids=[str(i["pageid"]) for i in items]; dist={str(i["pageid"]):i["dist"] for i in items}
    cands=[]
    for k in range(0,len(ids),40):
        r=get(dict(action="query",pageids="|".join(ids[k:k+40]),prop="imageinfo|coordinates",iiprop="url|size|mime|extmetadata",iiurlwidth=1600))
        for pid,pg in r["query"]["pages"].items():
            ii=pg.get("imageinfo",[{}])[0]
            if ii.get("mime")!="image/jpeg" or ii.get("width",0)<1400 or ii["width"]<ii["height"]*1.25: continue
            em=ii.get("extmetadata",{})
            c=(pg.get("coordinates") or [{}])[0]
            cands.append(dict(title=pg["title"],thumb=ii.get("thumburl"),page=ii.get("descriptionurl"),w=ii["width"],h=ii["height"],dist=dist[pid],lat=c.get("lat"),lng=c.get("lon"),
              artist=em.get("Artist",{}).get("value",""),lic=em.get("LicenseShortName",{}).get("value",""),date=em.get("DateTimeOriginal",{}).get("value","")[:10]))
    cands.sort(key=lambda x:x["dist"]); res[sid]=cands[:16]; print(sid,len(items),len(cands),flush=True); json.dump(res,open("cands.json","w"),ensure_ascii=False,indent=1)
json.dump(res,open("cands.json","w"),ensure_ascii=False,indent=1)
