import json,urllib.request,urllib.parse,re,time,os,html
UA={"User-Agent":"mm-geo-game-dev/0.1 (personal project)"}
c=json.load(open("cands.json")); e=json.load(open("extra.json"))
# (source, idx, spot, difficulty 1-3)
P=[("landmark",12,"landmark",1),("landmark",14,"landmark",1),("landmark",13,"landmark",2),("landmark",4,"landmark",3),
("cosmo",4,"cosmo",1),("cosmo",10,"cosmo",1),("cosmo",14,"cosmo",2),("queens",4,"cosmo",1),
("redbrick",1,"redbrick",2),("redbrick",11,"redbrick",1),("redbrick",14,"redbrick",1),("redbrick",6,"redbrick",2),
("nipponmaru",5,"nipponmaru",1),("nipponmaru",12,"nipponmaru",1),("nipponmaru",14,"nipponmaru",1),("nipponmaru",3,"nipponmaru",2),
("kishamichi",10,"kishamichi",2),("kishamichi",11,"kishamichi",2),("kishamichi",15,"kishamichi",2),("kishamichi",12,"kishamichi",3),
("museum",0,"museum",2),("extra",15,"museum",2),
("grandmall",1,"grandmall",3),("grandmall",6,"grandmall",3),("grandmall",5,"grandmall",3),("extra",11,"grandmall",3),
("queens",0,"queens",2),("queens",12,"queens",3),
("cupnoodle",8,"interconti",2),("rinko",2,"interconti",2),("extra",9,"pacifico",2),
("extra",1,"pacifico",2),("extra",4,"pacifico",3),("extra",10,"pacifico",2),
("rinko",0,"rinko",3),("rinko",10,"rinko",3),
("cupnoodle",6,"megami",3),
("hammerhead",2,"hammerhead",1),("hammerhead",4,"hammerhead",2),("hammerhead",0,"hammerhead",2),
("unga",4,"worldporters",2),("worldporters",0,"aircabin",2),
("aircabin",0,"aircabin",2),("aircabin",1,"aircabin",2),("aircabin",8,"aircabin",1),
("sakuragicho",2,"sakuragicho",2),("sakuragicho",3,"sakuragicho",2),("sakuragicho",6,"sakuragicho",2),
("pukari",2,"pukari",3),("pukari",3,"pukari",3),
("bankoku",2,"bankoku",2),("bankoku",1,"bankoku",2),
("anpanman",3,"anpanman",2),("anpanman",6,"anpanman",2),
("karena",7,"karena",3),("karena",4,"karena",3),
("takashima",1,"takashima",3),("takashima",7,"takashima",3),
("jica",1,"jica",3),("jica",4,"marinewalk",3),
("dockyard",3,"dockyard",2),("dockyard",4,"dockyard",2),("dockyard",0,"dockyard",2),
("shinkochuo",1,"shinkochuo",2),("shinkochuo",2,"shinkochuo",3),
("circlewalk",9,"circlewalk",3),
("bayhotel",0,"bayhotel",3),("bayhotel",5,"bayhotel",2)]
def clean(s):
    s=re.sub(r"<[^>]+>","",s or ""); s=html.unescape(s).strip(); s=re.sub(r"\s+"," ",s)
    return s[:60] or "Unknown"
os.makedirs("photos",exist_ok=True); out=[]
for n,(src,i,spot,d) in enumerate(P):
    x=(e if src=="extra" else c[src])[i]
    fn=f"p{n:02d}.jpg"; dst="photos/"+fn
    if not os.path.exists(dst):
        for t in range(5):
            try:
                data=urllib.request.urlopen(urllib.request.Request(x["thumb"],headers=UA)).read(); open(dst,"wb").write(data); break
            except Exception as ex:
                print("retry",fn,ex); time.sleep(8*(t+1))
        time.sleep(1.2)
    if x.get("lat") is None:
        q=urllib.parse.urlencode(dict(action="query",titles=x["title"],prop="coordinates",coprimary="all",format="json"))
        for t in range(6):
            try:
                time.sleep(3); r=json.load(urllib.request.urlopen(urllib.request.Request("https://commons.wikimedia.org/w/api.php?"+q,headers=UA))); break
            except Exception as ex: print("429 wait"); time.sleep(20*(t+1))
        co=list(r["query"]["pages"].values())[0].get("coordinates",[])
        if not co: print("NOCOORD",fn,x["title"]); continue
        x["lat"],x["lng"]=co[0]["lat"],co[0]["lon"]; time.sleep(1)
    out.append(dict(id=fn[:-4],src=f"photos/{fn}",spot=spot,lat=round(x["lat"],6),lng=round(x["lng"],6),diff=d,
      author=clean(x["artist"]),license=x["lic"],page=x["page"]))
json.dump(out,open("photos.json","w"),ensure_ascii=False,indent=0)
print(len(out))
