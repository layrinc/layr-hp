# レビュー：スクールLP画像復帰・オレンジ / A既存例外 / 2026-09-26

## 効いている点

- アイソメラボ10種類を各1回配置。対応範囲の表示面積を拡大し、ピクトグラムではなく立体イラストが読める。
- LINEの緑を維持し、オレンジは既存下線・受講申込・支援後成果値に限定。
- img属性を除くHTMLは改修前と一致。サービスコピー、実績、料金、CTAは不変更。
- 画面上の素材紹介リンクなし。内部出典は保持。

## 差分の判定

Blocker/Highなし。小画面でSNSラベルと導線文字が重なった点は、SNS/受講申込ラベルを上方へ移動して解消。

## 検証

- npm run check成功：75ページビルド・共有CSS回帰ゲート悪化なし。
- school-lp.test.mjs 4件PASS：10素材、重複0、リンク非表示、オレンジ・緑CTA、フォームfail-closed。
- 1440/1280/768/390/375pxで横はみ出しなし、10画像すべてdecode成功、実行エラー0。
- メニュー・Escape・トップ復帰・メール下書き動作・JS無効時の送信防止PASS。メール送信なし。
- 文字orange-inkは白背景5.12:1、淡緑背景4.75:1。黒本文とorange下線は6.79:1。
- プレビュー：https://1124bc45-layr-hp.biz-oneservice.workers.dev/service/school/

## 既存資産の現状

通常意匠ゲートは7/12項目基準外のまま（影14、中央29、サイズ39、重み8、角丸17、hex17、border4）。
今回前後で全項目同値。既存参考LP再現のユーザー明示例外を維持し、一斉是正は行わない。
CVは既存のCTAクリック/メール下書き計測。未送信を成約・問い合わせ完了と誤計測しない。

## 素材出典（内部記録のみ）

| 使用箇所 | 既存ローカル素材 | 公式番号 |
| --- | --- | --- |
| FV | /images/journey/isome-line.svg | 05532 |
| 戦略 | /service/ltori/media/artwork/meeting.svg | 00585 |
| 構築 | /service/ai/isome/gears.svg | 92357 |
| 配信分析 | /service/ai/isome/paperless.svg | 16648 |
| 広告 | /images/journey/isome-ad.svg | 05869 |
| LP制作 | /images/journey/isome-lp.svg | 76003 |
| ディレクター | /service/ltori/media/artwork/team.svg | 41494 |
| LINE担当 | /service/ai/isome/dialogue.svg | 07969 |
| 広告制作担当 | /service/ltori/media/artwork/communication.svg | 17751 |
| 成果改善 | /images/journey/isome-success.svg | 01940 |

公式素材ページは https://isome-lab.com/isometric/{公式番号} 。著作権はISOME LAB。
利用規約/FAQを2026-09-26確認。企業サイト利用・クレジット省略可。画像は既存ローカルファイルをそのまま参照し、再加工・外部直リンクなし。

## 未実施

スマートフォン実機は未実施（ブラウザーの実画面サイズで検証）。

PASS
