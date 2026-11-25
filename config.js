/* 公開設定。
 * ★ このファイルにキーを書いて GitHub に push しないこと。
 *   公開するときは GitHub Actions（.github/workflows/deploy.yml）が、
 *   リポジトリの Secrets から値を差し込んだ config.js を作って配信する。
 *   手元で遊ぶときは、ゲームの設定画面でキーを入れればよい（そのブラウザの中だけに保存される）。
 */
window.MM_CONFIG = {
  // アプリ名（タイトル・ロゴ・結果コピーに使う）
  appName: 'MM GUESSR',
  // Google Maps Platform の APIキー（公開版では Actions が差し込む）
  googleMapsKey: '',
  // Firebase App Check（任意・推奨）。設定すると、このサイト以外からのキー利用を Google 側で拒否できる
  firebaseConfig: null,     // 例: { apiKey: '...', authDomain: '...', projectId: '...', appId: '...' }
  appCheckSiteKey: '',      // reCAPTCHA のサイトキー
  appCheckProvider: 'v3',   // 'v3'（reCAPTCHA v3）または 'enterprise'
};
