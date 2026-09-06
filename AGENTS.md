# AGENTS.md — layr.co.jp（株式会社LAYR コーポレートサイト）

このリポジトリで作業するAI（Claude Code / Codex / ChatGPT など）と人の共通ルール。
**まずここを読む。** 細部は `docs/design-system/` を参照。

## 1. このサイト

| 項目 | 内容 |
|---|---|
| 本番URL | https://layr.co.jp/ |
| 会社 | 株式会社LAYR。LINE公式アカウントの構築・運用代行。2026年8月設立（実績構築中） |
| 技術 | Astro（静的サイト）。ブロック型CMS＝`src/data/page-home.json` を `src/components/Block.astro` が描画。記事は `src/content/blog/*.md` |
| ホスティング | Vercel。**GitHub連携で `main` にマージされると自動で本番公開される** |

## 2. ブランチと公開の流れ（全員共通）

```
作業ブランチ（feat/xxx）→ Pull Request → Vercelのプレビューで確認 → CI合格 → 河出が承認してマージ → 本番へ自動公開
```

- **`main` に直接 push しない**（保護ブランチ。PR必須）。
- **`vercel deploy` を手で打たない**。公開はマージによる自動デプロイだけ。
- PRには「何を・なぜ・どう確認したか」と、変更後のスクリーンショット（1280 / 768 / 390）を付ける。
- 1 PR = 1 目的。無関係な整理を混ぜない。

## 3. 必ず守ること

### 3-1. 事実・法律

1. **根拠のない数値・実績を書かない**（導入◯社・◯%改善など）。会社は設立直後。
2. **実在の企業のLINE画面・ロゴを装わない**。作例は架空名＋「作例」の明示。
3. **LINEヤフー社のロゴ・アイコン・認証バッジの意匠を使わない**。「LINE」は大文字で正しく書く。
4. **他社の画像・素材を使わない**。参考画像は構図を自前で組み直す。
5. サービス名・料金・会社情報は既存データ（`src/data/*.json`）からのみ引く。勝手に書き換えない。
6. 特定商取引法・プライバシーポリシー（`src/pages/tokushoho.astro` `privacy.astro`）の文面は河出の指示なしに変えない。

### 3-2. デザインシステム（正本 `docs/design-system/`）

- 色は `src/styles/style.css` の `:root` 変数だけ。**新しい16進カラーを追加しない**。
- 角丸は `--r-pill` / `--r-lg` / `--radius` から。文字は12px未満を作らない。本文コントラスト比4.5以上。
- `transition` には必ず `cubic-bezier(.4,0,.2,1)`。`:focus-visible` を壊さない。
- 影・中央揃え・文字サイズの種類を増やさない（既存の負債は是正未承認。触らない）。
- FVなど表示速度に効く場所に画像ファイルを足さない（現状はDOM+CSSで組んでいる）。

### 3-3. 触らない領域

- `src/content/blog/` の本文（記事は別の自動処理が書いている）
- `src/data/page-home.json` のヒーロー文言（h1・リード・CTA）
- 管理画面 `src/pages/admin*`

## 4. 作業前後の確認（PRを出す前に必ず）

```bash
npm install
npm run build                            # 全ページ生成されること
bash scripts/gate-regression.sh          # デザインゲートが基準値から悪化していないこと
npx serve dist -l 4321                   # 1280 / 768 / 390 で目視。横スクロールが出ないこと
```

`scripts/gate-regression.sh` は `docs/design-system/gate-baseline.txt` と比較し、**1項目でも悪化していれば失敗**する。既存のNG項目（G1/G2/G3/G7/G8）は基準値どおりなら合格。意図して基準値を更新する場合は理由をPRに書き、`gate-baseline.txt` も同じPRで更新する。

## 5. ファイルの地図

| 目的 | 場所 |
|---|---|
| トップの構成（ブロック順・文言） | `src/data/page-home.json` |
| ブロックの描画 | `src/components/Block.astro` |
| FVのスマホモック | `src/components/HeroDevice.astro` ＋ `src/styles/style.css` の「v28」セクション |
| サイト全体のCSS・トークン | `src/styles/style.css`（`:root` が正本） |
| 共通レイアウト・ヘッダー/フッター | `src/layouts/Base.astro` |
| 業種データ（トップの業種別・メディアの業種タブ） | `src/data/industries.json` |
| メディア一覧（業種別・課題別タブ） | `src/pages/media/index.astro` |
| 会社情報・連絡先 | `src/data/company.json` `src/data/settings.json` |
| 特商法の取引条件 | `src/data/tokushoho.json` |

## 6. 判断に迷ったら

想定される解釈を明記して着手し、PRの説明に判断理由を書く。本番に影響する判断（料金・法務・ブランド）は河出に確認する。
