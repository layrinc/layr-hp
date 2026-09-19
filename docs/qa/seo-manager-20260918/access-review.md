# レビュー: SEO管理画面のAccess対応 / モードD / 2026-09-18

## 対象

ルート: `/workspace/scratch/e5ea19939436/layr-hp/`

- `src/pages/tools/ltori-seo/index.astro`, `migrate.astro`
- `src/styles/seo-manager.css`, `src/lib/seo-manager/session.mjs`
- `worker/index.mjs`, `worker/seo-access.mjs`

## 効いている点

- 既存の地域一覧を維持し、メールidentityとログアウトだけをヘッダーに追加した。
- 旧オリジンのIndexedDBからJSONを保存し、新オリジンで復元できる。元のデータは削除しない。
- ページ表示の前にWorkerで認証を検証する。クライアントのフラグやメールヘッダーだけでは管理HTMLを取得できない。

## 今回の差分

Blocker / Highなし。新しい色・書体・影は追加していない。移行画面は管理画面と同じNoto Sans JPを読み込む。公開LPの構造・文言・計測には変更なし。

## 検証結果

| 項目 | 結果 |
| --- | --- |
| Astro build | 56ページ（移行案内を1ページ追加） |
| node test | 31件成功。JWT署名、aud/issuer、期限、偽装ヘッダー、HTML/エンコード別名、別ホスト、公開LPの経路を含む |
| デザイン回帰ゲート | 基準値から悪化なし |
| Cloudflare dry-run | 成功。Worker 40.16 KiB / gzip 11.33 KiB |
| 管理画面 | 1280 / 768 / 390 / 1440 / 375pxを確認 |
| 移行案内 | 1280 / 768 / 390pxを確認 |
| 全8画面 | 横スクロールなし、h1各1つ、可視文字最小12px |
| ブラウザ動作 | 旧JSON書き出し、別ブラウザへの復元、認証期限切れ時の閉鎖、再認証後の保存データ保持を確認 |
| JavaScriptエラー | 0件 |
| Google接続 | 新しいOAuth生成元の案内を確認。実接続は未実施 |

ブラウザの認証応答はローカルのテスト用fixture。実際のCloudflareログイン画面を模倣・代替する実装は入れていない。画面の `operator@example.test` は検証用の表示値。

## 既存資産の現状

src全体のデザインゲートはG1=200 / G2=165 / G3=72 / G4=0 / G5=39 / G6=41 / G7=151 / G8=47 / G9=24 / G10=31 / G16=2 / G17=0。改修前から増加なし。既存の負債は今回変更していない。

管理CSS単体ではG1〜G10 / G16を通過。単体のG17=19は共通style.cssの変数を含まないためで、src全体ではG17=0。本文と操作は既存と同じ色の組み合わせを使用している。

## 本番前に残る確認

- Cloudflare側がセキュリティ検証で停止中。許可メール、Accessアプリ、Custom Domainは未設定・未検証。
- 実際のOTP発行、許可・不許可メールの結果、Cloudflareセッションのログアウトは切替時に確認する。
- Wrangler devは実行環境の `uv_interface_addresses` エラーで起動せず。dry-runとWorker単体テストを完了したが、ローカルWorkers HTTP配信の検証は未実施。
- DNS・Accessが未設定のままmainへマージすると旧管理画面が503となるため、Cloudflareの準備が終わるまでPRをマージしない。

画面・コード差分の判定: PASS。公開の判定: Cloudflare設定待ち。
