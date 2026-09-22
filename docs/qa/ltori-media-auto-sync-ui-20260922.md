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
- ユーザー承認後、専用Googleアカウントと対象GA4/GSCの閲覧権限を設定。既存サーバー取得関数の実API読み取りはGA4・GSCとも成功（2026-09-22 12:35 JST）。本番DB保存は未実施。
- Cloudflare Secretの保存完了。mainのPR #44により定期実行はGitHub Actionsへ移行済み（毎日06:17 JST、遅延の場合あり）。この変更を取り込み、メディア表示と定期実行状態を整合させる。詳細は `../seo/ltori-media-automatic-analytics.md`。

## PR #44統合後の最終検証

- mainのGitHub Actions定期処理を取り込み、毎日06:17 JSTの表示と実行履歴を整合。Cloudflareの追加Cron・有料化は行わない。
- 全261テストのうち259件PASS、localhost通信2件はsandboxのlisten制限が原因で初回失敗。権限を付けた再実行で2件ともPASS。
- 独立レビューで、古いschedulerのrunning履歴が手動同期を禁止する問題を修正。対象UI26テストと独立再確認17テストPASS。手動同期の重複制御はanalytics jobと既存サーバーロックが担当する。
- 71ページbuild・デザイン回帰ゲート・Cloudflare dry-run PASS。
