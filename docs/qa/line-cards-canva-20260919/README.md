# Canva画像差し替えレビュー / モードA / 2026-09-19

## 対象と差分

以下はすべて `/Users/kawadeikkan/Desktop/Company-Brain/株式会社LAYR/.worktrees/codex-document-materials-refresh` 配下。

- `src/components/LineSupportScreen.astro`: 架空HTML画面から、ユーザー指定Canvaの画像表示へ変更。
- `src/components/LineSupportCards.astro`: 画像メタデータ、拡大リンク、資料掲載例の注記。
- `src/styles/line-support.css`: 模擬UI用CSSを除去し、縦横比維持の画像表示を追加。
- `src/data/page-home.json`: 6点の画像・代替テキスト・寸法を追加。
- `src/pages/service/line.astro`: 共通の画像付きカード型を使用。
- `public/images/line-support/`: Canvaのスクリーンショットから切り出した6 PNG。
- `tests/line-support.test.mjs`: 画像実体・寸法・両ページへの反映・拡大リンクを検証。

既存カード／FAQ改修は先行変更として維持。今回はCanvaの画像反映が対象で、FAQ・CTA・料金・共通テーマの変更なし。トークン正本は本作業ツリーの `src/styles/style.css` と既存テーマ設定。Canva資料の出典は `docs/design-system/20260919-line-cards-canva-sources.md`。

## 効いている点

- 全体設計図・配信例・回答フォーム・レポートが、対応する6業務と直接結びついている。
- キャプションと注記で「資料掲載例」を明示。顧客の実データや成果保証と混同させない。
- 白地と既存の緑白トークンを維持。画像は全体表示し、本文と拡大リンクを詳細領域にまとめた。
- 共通データ・共通コンポーネントからトップとLINEページを描画し、画像の二重管理を避けた。

## 検証結果

| 対象 | 結果 |
| --- | --- |
| build | PASS、57ページ |
| 自動テスト | PASS、7テスト。6 PNGの存在・寸法、alt、遅延読込、リンク、FAQ整合性を含む |
| 共通CSS回帰ゲート | PASS、悪化なし |
| 差分CSS＋既存:rootのデザインゲート | PASS、12項目 |
| 2ページ × 1440 / 1280 / 768 / 390 / 375px | 横はみ出し0、3 / 3 / 2 / 1 / 1列 |
| 画像 | 両ページとも6点読込成功、親幅以内、object-fit:contain |
| カード操作 | クリックで開き、Enterで閉じる |
| 拡大リンク | 別タブに641×380の全体導線画像が開くことを実操作確認 |
| タップ領域 | 拡大リンク高さ44px |
| 新規文字コントラスト | キャプション9.17:1、拡大リンク5.36:1、注記8.62:1 |
| h1 | 各ページ1つ |
| JSなしの表示 | 静的HTMLで全6画像・拡大リンクとnative detailsを確認 |
| ページ由来のJSエラー | 0（ブラウザ拡張由来のSentryエラー1件は対象外） |
| git diff --check | PASS |

### 定量ゲート

影0、中央揃え2、font-size値9種、800/900ウエイト0、直値hex0、2px以上の単色border0、未指定easing0、focus-visible2、変数循環0・未定義0。継承トークンは実際の共通CSSの:rootを結合して検査し、検査用の仮トークンは追加していない。

上下余白は非対称、reduced-motion対応あり、新規のスクロール演出なし。拡大リンクは資料画像を見るための補助リンクで、新規CVではない。

## Blocker / High / Medium / Nit

今回の画像差分に該当なし。

## 既存資産の現状・未実施

- 元のCanva図版はサービス資料の制作例。小さい本文をカード内で全文読ませる用途ではなく、細部は拡大リンクで確認する。
- FAQのカテゴリ／キー操作は先行改修のQAで確認済み。今回はFAQを変更せず、自動回帰テストのみ再実行。
- JSを無効化した実ブラウザ検証は未実施。SSRの静的検証で代替。
- 既存のサイト全体のCSS負債やLINE LPの統計表現・CV計測は今回の変更対象外。
- 本番公開・push・外部フォーム送信は未実施。Canva本体も未変更。

PASS
