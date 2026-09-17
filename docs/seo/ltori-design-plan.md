# エルトリ 全国集客ページ design plan

- 対象: `/service/ltori/area/` と地域・業種別の説明ページ。
- モード: A（LAYR既定のコーポレート緑白）。仕立て: editorial、エリア一覧のみ utilitarian。
- 読んだ正本: 本リポジトリ `AGENTS.md`、`src/styles/style.css`（末尾の再定義を含む）、`src/data/theme.json`、`src/data/service-ltori.json`、`docs/design-system/design-system.md`。CompanyBrainの `layr-design` / `layr-design-review` と tokens、design-plan も確認。
- 差異: スキルが参照する `references/deck-patterns.md` はローカルに存在しないため、tokens §2-7の11型一覧と本リポジトリのデザイン文書を使用。既存LPは独立した意匠を持つが、追加ページは指示されたモードAで統一。

## 色と書体

既存の `--paper`（背景）、`--text`（本文）、`--muted`（補助文）、`--line`（罫線）、`--green-dark`（文字・CTA）、`--tint-green`（面）を使用。新しいhex・グラデ・影は追加しない。見出し・数字・ナビは Noto Sans JP 700、本文400。価格は既存データから取得する。

## 型・余白

| 役割 | サイズ |
| --- | --- |
| display | clamp(32px, 4.2vw, 48px) |
| h2 | clamp(26px, 3.2vw, 32px) |
| h3 | 20px |
| lead | 20px |
| body | 16px |
| sm・label | 14px |

文字サイズは `--fs` の倍率に対応。近接6px、段落22px、ブロック56px、セクション上88〜168px/下56〜104px。角丸は `--radius` / `--r-lg` / `--r-pill` のみ。

## レイアウトとsignature

FVは左に検索意図を満たす見出し、右に「最初に整理すること」。地域の情報→採用にどう使うか→確認すること→料金と相談の順序。番号付きの説明行、料金比較表、FAQの型を使う。

signature: 地域の公的情報を引用した「採用の入口」と、自社で届ける「次の情報」を対にして、候補者との接点が続くことを見せる。

料金前に「まず募集条件を整理する」というチェックリストと広い余白を設ける。所在地名だけで終わらない、具体的な検討材料を主役にする。

## 今回変えないもの

既存LPのFV・価格・プラン・ブランド名、共通トークン、法律文書、ブログ、管理画面、DNS・本番設定。元LPへの追加は地域/業種ページへのテキスト導線のみ。

## 自己審査

地域ごとの観光紹介や汎用的な人口表で埋めず、求人媒体・職場見学・配信内容という採用に直接関係する判断材料で差をつける。問い合わせクリックを問い合わせ成立と数えない。ページ数を成果指標にしない。
