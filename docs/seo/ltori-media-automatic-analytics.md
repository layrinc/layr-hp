# メディア管理のサーバー自動取得

`/media/` は認証済みの `/api/seo/media/analytics` から、サーバーに保存した公開記事の実績を起動時に読み込む。個別のブラウザOAuth接続は任意の過去期間取得用として残す。

## 取得と表示

- 既存のSEO運用基盤を再利用する。Google同期はGitHub Actionsの既存maintenanceジョブを再利用し、毎日06:17（日本時間）に実行予定。実行時刻は遅れる場合がある。Cloudflare Cronや独立データベースは追加しない。
- GA4のPV・ユーザー・入口セッション・CTA・相談完了・資料請求完了、Search Consoleのページ実績・検索語句を取得する。
- 集計期間はUTCの3日前を末日とする28日間と、その前の28日間。最新の成功データをD1に保存する。週ごとの長期履歴保管ではない。
- メディアAPIは公開記事だけを返す。地域ページ、下書き、商談、原稿本文、認証情報は返さない。
- 失敗時は前回成功値を残し、最終試行・最終成功・ソース別エラー・ジョブ全体の失敗を表示する。同期の受付を成功扱いしない。
- 手動で取り込んだ企画・検索ボリューム・過去実績は従来のブラウザ保存を保持する。ラッコ等の市場検索ボリュームはこのGoogle同期では更新されない。

## 本番接続の初回設定

非秘密の取得対象は `wrangler.jsonc` の `SEO_GA4_PROPERTY_ID=550092764` と `SEO_GSC_SITE_URL=sc-domain:layr.co.jp`。既存D1 `layr-hp-seo-db` を明示IDで再利用する。

Googleのサーバー接続には、専用サービスアカウントへのGA4閲覧者権限とSearch Consoleの制限付き閲覧権限が必要。Google Cloudのプロジェクト管理者権限は付けない。サービスアカウントのJSON鍵はCloudflare Workerの `SEO_GOOGLE_SERVICE_ACCOUNT` Secretにのみ設定し、コード・ブラウザ・成果物へ含めない。

2026-09-22、ユーザー承認後に専用サービスアカウント `layr-seo-workspace-reader@lunar-linker-472010-f5.iam.gserviceaccount.com` を作成し、対象GA4に閲覧者、対象Search Consoleに制限付き権限を設定した。既存の `runAnalyticsSync` を使う読み取り専用の実API検証では両方とも成功。2026-08-23〜09-19のGA4ページ2行、GSCページ1行・検索語句0行を取得。公開メディア記事は双方0行だが、集計終了日が公開日09-20より前であり、PVや需要がゼロという意味ではない。この検証は一時メモリ上で実行し、本番DBには保存していない。

2026-09-22、ユーザーの保存委任を受け、Cloudflare Worker `layr-hp` の `SEO_GOOGLE_SERVICE_ACCOUNT` Secretへ専用鍵を保存済み。鍵の内容はコード・ログ・成果物に含めていない。本番の対象ID設定・メディア表示と定期実行の最終検証は、このPRの反映後に行う。

以前の本番ビルドはCloudflare Cron登録時に無料枠5件の上限へ達していたが、PR #44（main `4622a67`）で定期実行をGitHub Actionsへ移行済み。対象mainのCI、本番Workers Build、初回ジョブの成功を確認した。Cloudflare有料化や新しいD1は不要。移行前のCloudflare Cron定義へ戻さない。

メディアのAPIは、手動同期を含むanalyticsジョブと、GitHub側maintenanceの実行状態を別に返す。maintenanceにはサイト点検も含まれるため、その失敗をGoogleデータ取得失敗と断定しない。Googleの実取得成功はGA4・GSCそれぞれの最終成功で確認する。

初回設定後は管理画面の「今すぐ同期」を1回実行し、終了日時・GA4とGSCの個別成功・対象プロパティと期間を確認する。認証済み画面を開き直してもサーバー実績が読めることを検証する。
