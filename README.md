# LAYR コーポレートサイト（layr-hp）

株式会社LAYRの自社HP。**Astro（静的サイト生成）＋ Sveltia CMS（管理画面）＋ SEO自動化** のモダン構成。
打ち出し：**LINE構築・運用を軸にしたマーケティング支援会社**（LINE構築・運用マーケ × 広告運用代行）。

- 公開URL: **https://layr.co.jp/**
- 管理画面: **https://layr.co.jp/admin/**
- リポジトリ: **layrinc/layr-hp**（独立リポジトリ）
- 開発・公開基盤: **Cloudflare Workers Static Assets**。会社サイト・会員サイト・社内ツールはCloudflareを標準とする。

移行日: 2026-07-07（旧・手書きHTML版 → Astro版）。デザイン参考: h-link-marketing.co.jp

---

## この構成でできること

| やりたいこと | 方法 |
|---|---|
| 記事を管理画面から書く | `/admin/` にログイン→フォーム投稿（WordPress的） |
| 記事をAIと書く | Claude Codeで「コラム追加して」（skill: `layr-hp-post`） |
| デザインを細かく調整 | `src/styles/style.css` と `src/layouts/Base.astro` を編集 |
| SEO | サイトマップ・構造化データ・OGP・canonicalが自動生成 |

記事を1本足すと、**トップのCOLUMN欄・コラム一覧・サイトマップに自動で反映**される（手動更新不要）。

---

## フォルダ構成

```
layr-hp/
├── src/
│   ├── pages/
│   │   ├── index.astro          # トップページ
│   │   └── blog/
│   │       ├── index.astro      # コラム一覧（自動生成）
│   │       └── [...slug].astro  # 記事テンプレート（自動生成）
│   ├── content/blog/            # ★記事の実体（1記事=1つの.md）
│   │   ├── line-block-rate.md
│   │   ├── ad-line-funnel.md
│   │   └── line-vs-mail.md
│   ├── layouts/Base.astro       # 全ページ共通の骨格（ヘッダー/フッター/SEO）
│   ├── styles/style.css         # ★デザインの正本（ここを編集）
│   └── content.config.ts        # 記事のデータ項目定義
├── public/
│   ├── admin/                   # 管理画面(Sveltia CMS)
│   │   ├── index.html
│   │   └── config.yml           # 管理画面のフォーム定義
│   ├── uploads/                 # 画像アップロード先
│   └── robots.txt
├── astro.config.mjs             # サイトURL・サイトマップ設定
├── wrangler.jsonc               # Cloudflare Workers配信設定
├── public/_redirects            # 旧URLの転送
├── docs/cloudflare-hosting.md    # Cloudflareの開発・公開手順
├── docs/管理画面の使い方.md      # ★河出さん向け・管理画面マニュアル
└── _archive_static_v1/          # 旧・手書きHTML版（退避。参照用）
```

---

## ローカル開発

```bash
cd layr-hp
npm ci             # lockfileから依存をインストール
npm run dev        # → http://localhost:4321
npm run build      # 本番ビルド（dist/ に出力）
npm run check      # ビルド＋デザイン回帰ゲート
npm run dev:cloudflare  # ローカルのWorkers環境で配信確認
```

※ このMacは pnpm が不調（[[nextjs-pnpm-corepack-workaround]]）。**npm を使う。**

---

## 記事の書き方（2通り）

### A. 管理画面から（WordPress的）
`docs/管理画面の使い方.md` を参照。`/admin/` でログイン→フォーム入力→保存。

### B. Claude Code（AIと）
「コラム追加して：〇〇のテーマで」。skill `layr-hp-post` が `src/content/blog/` に .md を作り、確認後デプロイまで実行。

### C. 手動
`src/content/blog/` に `.md` を新規作成。frontmatter（title/description/date/category/draft）＋本文。既存ファイルをコピーするのが早い。

---

## デザイン調整

- **全ページ共通の見た目** → `src/styles/style.css`（色・余白・フォント等の正本）
- **ヘッダー/フッター/SEOタグ** → `src/layouts/Base.astro`
- **トップの各セクション** → `src/pages/index.astro`
- 変更は `npm run dev` で即プレビュー反映（ホットリロード）。

---

## SEO（自動）

- `sitemap-index.xml` / `sitemap-0.xml`: ビルド時に全URLを自動生成
- 構造化データ(JSON-LD): トップ=Organization、記事=BlogPosting
- OGP・canonical・description: 各ページで自動出力（`Base.astro`）
- `robots.txt`: `/admin` を除外、サイトマップを明示
- 静的生成＝表示が速い（Core Web Vitals で有利）

公開先の正規URLは `https://layr.co.jp/`。独自ドメインの関連付けはCloudflare側で確認する。

---

## デプロイ

**Cloudflareでプレビューと本番公開を行う。** 設定の正本は `wrangler.jsonc`、手順は [Cloudflareでの開発・公開](docs/cloudflare-hosting.md)。

- 既存Worker `layr-hp` と `layr.co.jp` の関連付けを確認し、Workers Buildsを `layrinc/layr-hp` に接続する。
- 本番ブランチは `main`。PRのCI・表示確認・河出の承認後にマージする。
- Build command: `npm run check`。本番Deploy command: `npm run deploy:cloudflare`。非本番Deploy command: `npm run preview:cloudflare`。
- Cloudflare側の接続と初回デプロイが確認できるまでは、自動公開が有効とは扱わない。
- Vercelへの手動ワークフローは削除し、Git自動デプロイは `vercel.json` で停止する。既存プロジェクトの削除は行わない。

---

## 公開前の【要編集】チェックリスト

ページ内に赤い【要編集】マークで明示。

- [ ] **実績数値**（トップ「数字で見る」・ヒーローの数値チップ・CASE 3件）— サンプル。実数値へ
- [ ] **会社概要: 所在地・設立年月**
- [ ] **代表写真**（MESSAGEセクション。`public/uploads/` に画像を置き `index.astro` を修正）
- [ ] **CTAリンク** — 現在は全て `mailto:`。LINE友だち追加URLに差し替えると導線が強い
- [ ] 掲載価格の確認（FAQ: 構築30万円〜/月額5万円〜）
- [ ] 【要編集】注意帯（`.draft-note`）を全削除

---

## 関連

- サービス方針: [[layr-service-lineup]]（LINE軸＋広告。MEOは載せない）
- デザイン基準: [[design-preference-corporate-site]]
- 開発の進め方: [[web-dev-workflow-preference]]

## 資料請求フォーム（/document/）

- 右下ポップアップ（PC表示のみ）→ `/document/` の請求フォーム → 送信 → `/document/thanks/`
- 送信内容は **FormSubmit** 経由で `info@layr.co.jp` にメール着信（バックエンド不要・無料）
- **初回のみ**: 最初の送信後、FormSubmitから info@layr.co.jp に有効化メールが届くので、リンクを1回クリックして有効化する（それまでは着信しない）
- 資料PDF自体はまだ無い。当面は「送信→河出さんがメールで資料送付」の運用。PDFができたらサンクスページに直接DLリンクを付けられる
- 送信先を変えたい場合は管理画面「① 基本設定 → 問い合わせメールアドレス」を変更（フォームも連動）
