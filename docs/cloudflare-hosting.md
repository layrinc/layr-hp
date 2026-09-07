# Cloudflareでの開発・公開

2026-09-07の河出の指定により、公式サイトの開発・公開基盤はCloudflareとする。
この文書は目標とする設定と手順であり、Cloudflare側の設定完了を示すものではない。

## 対象

| 項目 | 設定 |
| --- | --- |
| リポジトリ | `layrinc/layr-hp` |
| サイト | `https://layr.co.jp/` |
| 配信方式 | Astroの静的ビルドをWorkers Static Assetsで配信 |
| Worker名 | `layr-hp`（既存 `wrangler.jsonc`） |
| アカウントID | `970414d67575a1afb2eb889748741af7`（既存設定と河出提示URLが一致） |
| ビルド出力 | `dist/` |
| Node.js | 22 |

まずCloudflareのWorkers & Pagesで既存の `layr-hp` と `layr.co.jp` の関連付けを確認する。
同名Workerの作成、DNS・ドメインの付け替え、既存サービスの削除は、設定を調べずに実行しない。

## ローカル開発と検証

```bash
npm ci
npm run dev                 # Astroで画面を編集
npm run check               # 全ページのビルドと既存デザイン回帰ゲート
npm run check:cloudflare    # アップロードせずにWrangler設定を検証
npm run dev:cloudflare      # ビルドし、ローカルのWorkers環境で配信
```

Wranglerは開発依存とlockfileに固定する。開発用の `.wrangler/` と `.dev.vars*` はコミットしない。
Wranglerのローカル配信で、旧URLの転送・末尾スラッシュ・404を確認する。
PRには1280 / 768 / 390pxのスクリーンショットと回帰ゲートの結果を付ける。

## Workers BuildsのGit連携

既存Workerの **Settings → Builds** で `layrinc/layr-hp` を接続する。
既存の連携がある場合は先にその設定を確認し、二重の公開経路を作らない。

| 項目 | 値 |
| --- | --- |
| Root directory | リポジトリのルート |
| Production branch | `main` |
| Build command | `npm run check` |
| Deploy command | `npm run deploy:cloudflare` |
| Non-production branch deploy command | `npm run preview:cloudflare` |
| Non-production branch builds | 有効 |

`deploy:cloudflare` は `wrangler deploy` で本番を更新する。
`preview:cloudflare` は `wrangler versions upload` で新しいバージョンをアップロードする。
両コマンドは先にビルド済みの `dist/` を使う。ローカルでの本番公開には河出の承認が必要。
プレビューURLの有効化とアクセス制限は既存の設定を確認し、閲覧制限を無断で解除しない。

本番公開はPRのCI・表示確認・河出の承認後に行う。初回はGit連携の成功と `layr.co.jp` への反映まで確認する。
Wrangler設定だけで独自ドメインの関連付けやGit連携が完了するわけではない。

## URLの互換性

- `public/_redirects` をビルド時に `dist/` へコピーし、`/service-line` と `/blog` 以下の旧URLを308転送する。
- 末尾スラッシュは既存の `assets.html_handling: auto-trailing-slash` を使う。
- 見つからないページは既存の `assets.not_found_handling: 404-page` を使う。
- `www.layr.co.jp` → `layr.co.jp` のホスト単位の転送はWorkersの `_redirects` では扱えない。Cloudflareゾーンの既存Redirect Ruleを確認し、パス・クエリを保った恒久転送を設定する。既存ルールがあれば重複追加しない。ドメインがこのWorkerへ向いていることも確認する。

## Vercelの扱い

Vercelへの手動デプロイワークフローは削除した。`vercel.json` の `git.deploymentEnabled: false` で、この設定を含むコミットからのGit自動デプロイを停止する。
既存Vercelプロジェクト・既存デプロイの削除や、ダッシュボード側のGit連携解除はこの変更には含めない。
画像変更のPR #2はこの設定を含まないため、Cloudflare設定のマージ後に最新mainを取り込んでから検証・公開する。

## 公式資料

- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [Vercel Git自動デプロイの停止](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments)
