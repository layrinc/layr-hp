# SEO管理画面のドメインとメール認証

## 構成と現在の状態

実装先は既存Worker `layr-hp`。新規Worker・別のDNSゾーンは作成しない。管理URLは `https://seo.layr.co.jp/` を予定する。依頼文の `layer.co.jp` は現行の公式ドメイン `layr.co.jp` の誤記と解釈し、外部設定前にこの前提を明示した。

この文書は切替手順であり、Cloudflareでの設定完了を示さない。2026-09-18時点ではCloudflareダッシュボードがセキュリティ検証で停止し、CLIも未認証。許可するメールアドレス、Accessのチームドメイン・AUDは未確認。コードを準備しても、メール送信・ログイン・独自ドメインの実動作を完了したとは扱わない。

## 運用者の使い方

1. 管理URLを開き、Cloudflare Accessの画面に許可されたメールアドレスを入力する。
2. 届いたワンタイムコードでログインする。メールのコードはチャットやソースコードに貼らない。
3. 管理画面右上に認証済みメールアドレスが表示される。終了時は「ログアウト」を押す。
4. Googleデータを見る場合は「アクセス・問い合わせ」から別途Googleに接続する。Cloudflareの認証だけではGA4・Search Consoleの権限は付かない。

Cloudflare Accessは入口を保護する。編集内容・CSV実績は現在もブラウザのIndexedDBに保存するため、別端末へ自動同期されない。ログアウトしてもローカルデータは削除しない。共有端末はブラウザプロファイルを分ける。

### 旧URLからの移行

1. 以前のブラウザ・プロファイルで `https://layr.co.jp/tools/ltori-seo/` を開く。同じAccessアプリの許可メールで認証する。
2. 移行案内で「移行用JSONを保存」。旧データは削除されない。
3. 専用URLの「実績・入出力」→「バックアップ・復元」でファイルを選び、件数を確認して復元する。
4. Google OAuthクライアントの承認済みJavaScript生成元へ `https://seo.layr.co.jp` を追加する。数値の取得対象は引き続き `layr.co.jp`。クライアントID・プロパティIDの設定とGoogle認証は新しいオリジンでやり直す。

## Cloudflare設定（実設定を確認してから実行）

1. 対象アカウント `970414d67575a1afb2eb889748741af7` の既存 `layr-hp` と `layr.co.jp` ゾーンが正しいことを確認。`seo.layr.co.jp` に既存DNS・サービスがないか確認し、競合があれば上書きしない。
2. Zero Trustの既存組織・チームドメインを確認。新規組織や有料契約を無断で作らない。
3. Integrations → Identity providersで **One-time PIN** を利用する。既存設定があれば再利用する。
4. Self-hostedアプリ「LAYR SEO Workspace」を作成するか、目的の一致する既存アプリを更新する。公開ホストに以下を設定する。同じアプリにまとめ、AUDを共有する。

   | ホスト | パス |
   | --- | --- |
   | `seo.layr.co.jp` | 全パス |
   | `layr.co.jp` | `/tools/ltori-seo*` |
   | `www.layr.co.jp` | `/tools/ltori-seo*`（既存のwww転送も確認） |

5. Allowポリシーは利用者が指定した**個別メールアドレス**のみ。Everyone、全メールドメイン、Bypassは設定しない。認証方法はOne-time PINのみ。セッションは24時間を初期案とし、既存運用と合わせる。既存のパス優先ポリシー・別アプリが保護を上書きしないことも確認する。
6. アプリのAUDとチームドメインを既存WorkerのSecretとして設定する。値はリポジトリ・公開PRへ記録しない。

   | Secret | 形式 |
   | --- | --- |
   | `SEO_ACCESS_TEAM_DOMAIN` | `https://組織名.cloudflareaccess.com`（末尾スラッシュなし） |
   | `SEO_ACCESS_AUD` | Accessアプリの64文字のAUD |

7. 下記検証済みPRを既存のGit連携で本番反映する。Secretなしでは管理パスは503で閉じる。公開LPは引き続き配信される。
8. Accessポリシーを先に有効にした上で、既存Workerの Settings → Domains & Routes → Add → Custom Domainに `seo.layr.co.jp` を追加する。既存の `layr.co.jp` の関連付けは維持する。`wrangler.jsonc` のroutes配列で既存ドメインを上書きしない。
9. 許可メールのログイン・不許可メールの拒否・ログアウト・期限切れを実環境で確認して切替完了とする。

OTPコードの発行・宛先制限はCloudflareが担当する。WorkerはAccess JWTの署名・issuer・audience・有効期限・メールidentityを再検証する。認証ヘッダーが付いているだけでは許可しない。

## 経路と検証

- `seo.layr.co.jp/` は検証後に既存管理HTMLを配信。管理用JS/CSSへのアクセスも認証後に配信する。
- 旧管理パスは検証後に移行案内。旧URLのHTML別名やエンコードされたパスも先に認証対象と判定する。
- workers.dev / preview / 他ホストの管理パスは、有効なJWTを送っても403。preview側で認証を無効にするフラグは設けない。
- 専用ホストで公開LP・サイトマップを配信しない。公開LPの確認リンクは `https://layr.co.jp` へ向ける。
- 認証・移行ページ・session APIはno-store / noindex / frame禁止。認証の設定不足、署名失敗、公開鍵取得失敗時は管理画面を返さない。
- ページにデータを入れる前にsession APIで認証を確認。開いたままの画面も60秒ごと・フォーカス復帰時に確認し、期限切れ時は画面を閉じて再認証を案内する。
- 既存の公開HTML・問い合わせ処理・GA設定は維持。`run_worker_first: true` により静的ページもWorker経由となるため、公開後はWorkerのリクエスト数・エラー率・料金区分を確認する。

## ローカル確認

```bash
npm run build
node --test tests/ltori-seo.test.mjs tests/seo-manager.test.mjs tests/ltori-analytics.test.mjs tests/seo-access.test.mjs
bash scripts/gate-regression.sh
npm run check:cloudflare
```

認証ユニットテストは実際に生成したRSA鍵と署名で検証する。ブラウザ画面のローカル確認に使うsession応答はテストの模擬値であり、本番メール認証の検証とは分けて報告する。

## 一次資料

- [CloudflareのOTP認証](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Access JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Self-hostedアプリ](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [静的アセットより先にWorkerを実行する設定](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
