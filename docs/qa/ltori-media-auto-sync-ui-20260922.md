# メディア自動取得UI 検証記録

対象: `src/pages/tools/ltori-seo/media.astro`、`src/lib/media-manager/app.mjs`、新規 `src/lib/media-manager/server-analytics.mjs`、`src/styles/media-manager.css`。

## 実装確認

- 起動時に認証済みの同一オリジンAPIからサーバー実績を取得。ブラウザ側Google OAuthを開始しない。
- サーバーsnapshotはメモリ上で表示し、既存IndexedDBの企画・編集・CSV・手動履歴・JSONバックアップへ混ぜない。
- 表・CSVの表示対象は選択された取得元と期間。サーバー／このブラウザの履歴を選択肢で識別する。
- GA4とGSCの最終成功・最終試行・個別エラーを表示。サーバーjobだけが失敗した場合も、旧成功データを残して直近の失敗を表示する。
- 同期受付202では成功表示にしない。重複POSTを防ぎ、終了のreadbackを確認。100秒相当のpoll上限で終了未確認を表示する。
- サーバー認証未設定は「設定準備中」。実データを作らず、最後の成功snapshotがあれば維持する。
- 公開済み動的記事catalogを検証して一覧・紐づけ候補へ反映。公開停止した候補を最新一覧から外し、旧URLを編集中なら明示選択まで保存を拒否する。
- ラッコ等の市場検索ボリュームは自動取得対象ではない旨を検索需要画面に明記。

## 実行済み

- `node --test tests/media-manager-server.test.mjs tests/media-manager-app.test.mjs`：23件PASS（新規14件＋既存9件）。
- アプリとclient moduleの構文検査、`git diff --check`：PASS。
- 新CSS＋実際に参照する既存トークンを抽出した `/tmp/ltori-media-auto-sync-ui-gate.css` でLAYRデザインゲート：12項目PASS。

## 統合側で確認すること

- Astro buildと全体テスト、実画面1280／768／390幅、認証APIの実接続はroot担当。
- サーバーGoogle認証情報・Google権限はUIテストで検証していない。設定未完了を「自動取得成功」と報告しない。

## root統合検証（2026-09-22）

- 最終ビルド71ページ、全224テスト、デザイン回帰ゲート、Cloudflare dry-run：PASS。
- 独立レビュー46テストPASS。ジョブ全体の直近失敗が旧成功表示に隠れる指摘を修正し、失敗理由・時刻の表示を確認。
- localhost限定fixtureで1280 / 768 / 390の全画面を目視。375幅もDOM測定し、文書全体の横はみ出しなし。表は内部スクロール。
- 未設定は「設定準備中」・同期無効。一部取得失敗は「確認が必要」とソース別失敗理由を表示し、前回成功実績を保持。
- スクリーンショットは `media-auto-sync/`。すべて明示した架空テストデータであり、本番取得成功の証拠ではない。
- 実Googleサーバー連携は専用アカウント・権限・鍵保管の明示承認待ち。
