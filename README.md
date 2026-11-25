# MM GUESSR — みなとみらいジオゲッサー

景色を見て、横浜・みなとみらいのどこかを地図で当てるブラウザゲーム。答え合わせのたびにスポットの解説が出るので、遊ぶほど街に詳しくなる。

- テーマを選んで5問：**名所めぐり／みなとみらいの企業／デートスポット／ランダム**
- 1問最大5000点。15m以内は満点、250m離れるごとに約0.37倍
- 答え合わせに「まちガイド」：最寄り駅からの距離、近くのスポット、地区の成り立ち
- 出会ったスポットは「スポット図鑑」（35か所）に登録される
- ビルド不要の静的サイト（HTML / CSS / JavaScript のみ）

## 2つの遊び方

| | APIキーなし | Google Maps APIキーあり |
|---|---|---|
| 景色 | Wikimedia Commons の写真（76枚） | Google ストリートビュー（360°） |
| 地図 | 国土地理院 淡色地図 | Google マップ |
| ランダム | すべての写真から出題 | みなとみらいの道路をランダムに出題 |
| 移動ルール | — | 歩ける／見回すだけ／固定 |
| 3D地図 | — | 立体の街並みを回して見くらべ、そのままピンを立てられる |

キーは、手元では設定画面で入れる（そのブラウザの中だけに保存）。公開版では下の「GitHub Pages で公開する」の方法で差し込む。

## 手元で動かす

```bash
python3 -m http.server 8812
```

ブラウザで http://localhost:8812/ を開く。Mac なら `起動.command` をダブルクリックでもよい。

## GitHub Pages で公開する（APIキーをリポジトリに入れない）

キーは**リポジトリに一度も入れません**。`config.js` は空のまま push し、公開するときに GitHub Actions が Secrets の値を差し込んだ `config.js` を作って配信します（`.github/workflows/deploy.yml` → `tools/build_site.py`）。

1. このフォルダを GitHub リポジトリにして push する
2. Settings → Pages → Source を **GitHub Actions** にする
3. Settings → Secrets and variables → Actions に登録する

| 種類 | 名前 | 中身 |
|---|---|---|
| Secret | `GOOGLE_MAPS_KEY` | Google Maps Platform の APIキー |
| Secret | `FIREBASE_CONFIG` | （任意）Firebase の設定 JSON。App Check 用 |
| Secret | `APPCHECK_SITE_KEY` | （任意）reCAPTCHA のサイトキー。App Check 用 |
| Variable | `APP_NAME` | （任意）アプリ名 |

4. main に push すると公開される

### それでもキーは守りを固める

ブラウザで動く Google マップは、仕組み上キーをページに渡す必要があるので、公開ページを開いた人はキーを見られます（Google もこれを前提に、次の制限をかけるよう案内しています）。次の3つで「コピーされても使えない」状態にします。

1. **HTTPリファラー制限**：キーを使えるのを公開URL（`https://<ユーザー名>.github.io/<リポジトリ名>/*`）と手元確認用の `http://localhost:8812/*` だけにする
2. **API制限**：Maps JavaScript API（と 3D地図に必要な API）だけにする。1日の上限回数（割り当て）と予算アラートも設定する
3. **Firebase App Check**（推奨）：このサイトで reCAPTCHA の検証を通ったリクエスト以外を Google 側で拒否する。Firebase でアプリを登録し、reCAPTCHA のサイトキーを作って上の Secrets に入れる。動作を確認してから Firebase コンソールで「適用（enforce）」を ON にする

## カスタマイズ

| やりたいこと | 場所 |
|---|---|
| アプリ名を変える | Actions の Variable `APP_NAME`（手元では `config.js`） |
| 地区の解説・駅 | `tools/areas.json` → `python3 tools/make_data.py` |
| スポットの解説・テーマを直す／足す | `tools/spots.json` → `python3 tools/make_data.py` |
| 写真を足す | `photos/` に置き、`tools/photos.json` に撮影位置・スポット・難易度・作者・ライセンスを追記 → `python3 tools/make_data.py` |
| ランダム出題の範囲 | `app.js` の `MM_POLY` |
| 点数の付け方 | `app.js` の `scoreOf` |

`spots.json` の `themes` に `sights`（名所）・`biz`（企業）・`date`（デート）を入れると、そのテーマで出題される。`date` を付けたスポットには `date`（デートのひとこと）も書ける。

## ファイル構成

| ファイル | 中身 |
|---|---|
| `index.html` / `style.css` | 画面 |
| `app.js` | ゲーム進行・演出・図鑑・ストリートビュー |
| `map.js` | 地図の共通部品（Google マップ／国土地理院を切り替え） |
| `config.js` | 公開設定（アプリ名・キー・App Check）。リポジトリでは空のまま |
| `.github/workflows/deploy.yml` / `tools/build_site.py` | 公開時に Secrets からキーを差し込んで配信 |
| `data.js` | スポットと写真のデータ（自動生成） |
| `photos/` | 写真（1600px に縮小・圧縮済み） |
| `tools/` | データ生成スクリプトと元データ |
| `CREDITS.md` | 写真の作者・ライセンス一覧（自動生成） |

## クレジット

- 写真：Wikimedia Commons の各作者（CC BY / CC BY-SA / CC0 など）。一覧は [CREDITS.md](CREDITS.md)。ゲーム内でも答え合わせと図鑑に表示している
- 地図：国土地理院、Google マップ
- 地図ライブラリ：[Leaflet](https://leafletjs.com/)（BSD-2-Clause）

CC BY-SA の写真を含むので、写真を再配布・改変するときは各ライセンスの条件に従うこと。コード部分のライセンスは未設定（公開前に決める）。
