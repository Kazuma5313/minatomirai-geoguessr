"""公開用の site/ フォルダを作る（GitHub Actions から呼ばれる）。

- 遊ぶのに必要なファイルだけを site/ にコピーする（tools/ などは公開しない）
- config.js は、環境変数（GitHub の Secrets）から値を差し込んで作り直す
  → APIキーはリポジトリに一度も入らない

環境変数:
  GOOGLE_MAPS_KEY    Google Maps Platform の APIキー（必須ではない。空なら写真＋国土地理院で動く）
  FIREBASE_CONFIG    Firebase の設定（JSON文字列）。App Check を使うとき
  APPCHECK_SITE_KEY  reCAPTCHA のサイトキー。App Check を使うとき
  APPCHECK_PROVIDER  'v3' または 'enterprise'（省略時 v3）
  APP_NAME           アプリ名（省略時 MM GUESSR）
"""
import json
import os
import shutil

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "site")
FILES = ["index.html", "style.css", "app.js", "map.js", "data.js", "CREDITS.md"]

shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
for f in FILES:
    shutil.copy(os.path.join(ROOT, f), OUT)
shutil.copytree(os.path.join(ROOT, "photos"), os.path.join(OUT, "photos"))

fb = os.environ.get("FIREBASE_CONFIG", "").strip()
cfg = {
    "appName": os.environ.get("APP_NAME", "").strip() or "MM GUESSR",
    "googleMapsKey": os.environ.get("GOOGLE_MAPS_KEY", "").strip(),
    "firebaseConfig": json.loads(fb) if fb else None,
    "appCheckSiteKey": os.environ.get("APPCHECK_SITE_KEY", "").strip(),
    "appCheckProvider": os.environ.get("APPCHECK_PROVIDER", "").strip() or "v3",
}
with open(os.path.join(OUT, "config.js"), "w") as f:
    f.write("window.MM_CONFIG = " + json.dumps(cfg, ensure_ascii=False) + ";\n")

print("site/ を作成しました",
      "| Googleキー:", "あり" if cfg["googleMapsKey"] else "なし",
      "| App Check:", "あり" if cfg["firebaseConfig"] and cfg["appCheckSiteKey"] else "なし")
