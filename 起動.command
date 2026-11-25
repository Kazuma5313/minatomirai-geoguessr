#!/bin/bash
# MM GUESSR をローカルで起動する。ダブルクリックでブラウザが開きます。
# ※ Google のキーはアドレスごとに保存されるので、必ず localhost で開く（127.0.0.1 だと別扱いになる）
cd "$(dirname "$0")"
PORT=8812
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "すでに起動しています → http://localhost:$PORT/"
  open "http://localhost:$PORT/"
  exit 0
fi
( sleep 1; open "http://localhost:$PORT/" ) &
echo "MM GUESSR を起動しました → http://localhost:$PORT/  （終了は このウィンドウで Ctrl+C）"
exec python3 -m http.server $PORT --bind 127.0.0.1
