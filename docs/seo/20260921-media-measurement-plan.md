# エルトリメディアの問い合わせ計測

## design plan

- 対象: LtoriMedia.astro、contact.astro、document/[doc].astro、document/thanks.astro。
- モード: A コーポレート緑白。メディアは editorial、フォームは utilitarian。
- トークン正本: src/styles/style.css、src/data/theme.json、src/styles/ltori-media.css を確認済み。
- 既存と基準の差: 共通サイトの書体・フォーム装飾は既存資産として維持。スタイル差分を作らない。
- 色: 紙=--paper、本文=--text、補助=--muted、罫線=--line、リンク=--green-ink。サブ色・グラデを追加しない。
- 書体: 見出し・本文・英字は既存定義を継承。
- 型スケール: display=既存clamp(30px,5vw,52px)、h2=24px、h3=20px、lead/body=既存継承、sm/label=12px。サイズ変更なし。
- 余白: tight/group/block/section は既存の設定を維持。新しい余白を追加しない。
- レイアウト: 記事 → 既存CTA → 既存フォーム → 送信成功表示。
- signature: 既存の「集める・つながる／面接へ進む／体制を整える」の編集ナビを維持。
- 余白の谷: 記事本文と最終CTAの区切りを維持。
- 今回変えないもの: 色、書体、CSS、本文、料金、管理画面、公開対象記事。
- 自己審査: 今回は計測と送信判定の修正。新規の視覚表現は不要。

## 実装と確認の範囲

公開済みの記事から、相談フォームとエルトリ資料請求へ `source=media/記事ID` を渡す。一覧は `source=media`。フォームは公開記事から生成した許可リストに一致する値だけを受理し、受信メールとGA4に出典を残す。

資料請求はHTTP成功だけでなく応答の success を確認し、成功時だけ generate_lead を送る。サンクスページの直アクセス・再読込でリードを計上しない。相談と資料請求の method を区別し、氏名・メール・本文はGA4に渡さない。

テストは実フォーム処理の成功・失敗・重複送信・未知のsource・既存地域sourceを検証する。外部へのテストメールは送らない。表示確認は1280/768/390pxと既存ゲートで行う。
