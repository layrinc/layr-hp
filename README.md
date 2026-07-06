# LAYR コーポレートサイト（layr-hp）

株式会社LAYRの自社HP。ビルド不要の静的サイト（HTML/CSS/最小JS）。
打ち出し：**LINE構築・運用を軸にしたマーケティング支援会社**（LINE構築・運用マーケティング × 広告運用代行）。

作成日: 2026-07-06（参考構成: h-link-marketing.co.jp）

## 構成

```
layr-hp/
├── index.html          # トップページ
├── assets/style.css    # 共通スタイル（全ページ共有）
├── blog/
│   ├── index.html      # コラム一覧
│   └── posts/          # 記事（1記事=1HTML）
│       ├── line-block-rate.html
│       ├── ad-line-funnel.html
│       └── line-vs-mail.html
└── README.md
```

## ローカル確認

Claude Codeのpreviewで `layr-hp` を起動（python3 http.server / port 4181）。
手動なら: `cd layr-hp && python3 -m http.server 4181` → http://localhost:4181/

## 公開前の【要編集】チェックリスト

ページ内に赤い【要編集】マークと黄色い注意帯で明示してある。

- [ ] **実績数値（トップ「数字で見る」セクション）** — サンプル数値。実案件の数値へ差し替え
- [ ] **ヒーローのスマホ横の数値チップ3個**（友だち追加数+128%等） — 同じくサンプル数値
- [ ] **支援実績CASE 3件** — サンプル。実案件へ差し替え（クライアント名掲載は先方許可を取る）
- [ ] **会社概要: 所在地** — 登記住所を記載
- [ ] **会社概要: 設立年月**
- [ ] **代表写真** — `assets/photo.jpg` を置いて `index.html` のMESSAGEセクションを `<img>` に差し替え
- [ ] **CTAリンク** — 現在は全て `mailto:biz.oneservice@gmail.com`。LINE公式アカウントの友だち追加URLに差し替えると導線が強くなる（自社がLINE推しなので推奨）
- [ ] 代表挨拶・お約束の文面の最終確認（レイのドラフト）
- [ ] 掲載価格の確認（FAQ内: 構築30万円〜/月額5万円〜）
- [ ] 黄色い「【要編集】…」注意帯（`.draft-note`）を全て削除

## ブログ記事の追加手順

**通常運用はスキル経由を推奨**: Claude Codeで「コラム追加して：〇〇のテーマで」と言う（`/layr-hp-post`、正本 `.claude/skills/layr-hp-post/SKILL.md`）。執筆→一覧更新→確認→承認後デプロイまで一連で実行される。

手動でやる場合:

1. `blog/posts/` 内の既存記事をコピーして新しいファイル名にする（例: `20260801-new-topic.html`）
2. `<title>` / meta description / 日付 / カテゴリ / 本文を書き換える
3. `blog/index.html` の一覧に `.post-item` を1ブロック追加（新しい記事を一番上に）
4. トップ `index.html` のCOLUMNセクション（3枚カード）を最新3本に入れ替える

※ 記事を書くときは `01_コンテキスト_CEO/プロフィール・設定/brand-voice.md` の文体基準に従う（結論先出し・断定調・数値で語る）。

## 公開情報（2026-07-06 公開済み）

- **公開URL: https://layr-hp.vercel.app**
- Vercelプロジェクト: `ikkan-kawades-projects/layr-hp`（このフォルダに `.vercel/` でリンク済み・gitignore対象）
- 更新手順: ファイルを編集 → このフォルダで `npx vercel deploy --prod --yes`
- CSSを変更したら、全HTMLの `style.css?v=3` のバージョン番号を上げる（キャッシュ対策）
- 独自ドメインは未設定。取得する場合はVercelのプロジェクト設定から接続する（要承認）
- ※【要編集】マーカーが残ったまま公開中。実数値・会社情報が入り次第、差し替えて再デプロイする

## 既存メモとの関係

- 現在のサービス打ち出しは「LINE軸＋広告運用」。MEOは現在提供していないためHPに載せていない（2026-07-06 河出さん指示）
- 価格の根拠: `01_コンテキスト_CEO/事業ゴール・パッケージ戦略.md`（初期30〜50万/月額5〜15万）
