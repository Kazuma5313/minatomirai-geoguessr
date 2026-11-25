"""tools/spots.json・photos.json・areas.json から data.js と CREDITS.md を作る。

使い方: python3 tools/make_data.py
スポットや写真を足したら、これを実行してからブラウザを再読み込みする。
"""
import json
import os

os.chdir(os.path.join(os.path.dirname(__file__), ".."))
spots = json.load(open("tools/spots.json"))
photos = json.load(open("tools/photos.json"))
areas = json.load(open("tools/areas.json"))

# かんたんな整合チェック
ids = {s["id"] for s in spots}
assert len(ids) == len(spots), "スポットIDが重複しています"
for p in photos:
    assert p["spot"] in ids, f"{p['id']} のスポット {p['spot']} が spots.json にありません"
    assert os.path.exists(p["src"]), f"{p['src']} がありません"
for s in spots:
    assert s.get("themes"), f"{s['id']} に themes がありません"
    assert s["area"] in areas["areas"], f"{s['id']} の地区 {s['area']} が areas.json にありません"

with open("data.js", "w") as f:
    f.write("// 自動生成: tools/spots.json と tools/photos.json から（python3 tools/make_data.py）\n")
    f.write("window.MM_SPOTS=" + json.dumps(spots, ensure_ascii=False, indent=0) + ";\n")
    f.write("window.MM_PHOTOS=" + json.dumps(photos, ensure_ascii=False, indent=0) + ";\n")
    f.write("window.MM_AREAS=" + json.dumps(areas, ensure_ascii=False, indent=0) + ";\n")

names = {s["id"]: s["name"] for s in spots}
with open("CREDITS.md", "w") as f:
    f.write("# 写真・地図のクレジット\n\n")
    f.write("このファイルは `python3 tools/make_data.py` で自動生成しています。\n\n")
    f.write("## 写真（Wikimedia Commons）\n\n")
    f.write("写真は縮小・圧縮して使っています。各ライセンスの条件はリンク先を確認してください。\n\n")
    f.write("| ファイル | スポット | 作者 | ライセンス | 元ページ |\n|---|---|---|---|---|\n")
    for p in photos:
        author = p["author"].replace("|", "/")
        f.write(f"| {p['src']} | {names[p['spot']]} | {author} | {p['license']} | [Commons]({p['page']}) |\n")
    f.write("\n## 地図\n\n")
    f.write("- APIキーなし：[国土地理院 地理院タイル（淡色地図）](https://maps.gsi.go.jp/development/ichiran.html)\n")
    f.write("- APIキーあり：Google マップ / ストリートビュー（© Google）\n")

print("ok", len(spots), "spots /", len(photos), "photos")
