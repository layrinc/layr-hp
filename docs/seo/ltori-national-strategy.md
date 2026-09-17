# エルトリ 全国地域LP・検索集客の実装

更新: 2026-09-17。ユーザーの最新指示に従い、既存の `/service/ltori/` を共通テンプレートとして都道府県・市区町村ごとのLPを一括生成する。以前の少数地域ガイド・業種別ページ・30市制限の案は、この実装には適用しない。

## 実装するもの

- 既存LPの画像、配色、セクション順、活用シーン、料金、FAQ、問い合わせ導線を再利用する。
- 都道府県47ページと市区町村・行政区1,918ページ、合計1,965地域LPを同じビルドで生成する。別途、全国一覧1ページを持つ。
- `/service/ltori/area/mie/nabari/`、`/service/ltori/area/wakayama/hashimoto/` のように同じドメインのサブディレクトリを使う。
- 全国一覧から全ページへリンクし、都道府県LPから県内の全地域LPへ、市区町村LPから都道府県・全国一覧へリンクする。
- 政令指定都市と行政区の両方を含むため、1,918は自治体数ではなく地域レコード数。JISコードで同名地域を識別し、同一県内の同名町村は郡名・行政種別を使ってURLを区別する。

## Hリンクの再確認

2026-09-17に実ページHTMLとサイトマップを再取得。対象は全国一覧、三重県、名張市、和歌山県、橋本市。

| 観察した仕組み | エルトリでの実装 |
| --- | --- |
| サービスURL配下に地方・都道府県・市区町村を配置 | サービスURL配下に都道府県・市区町村を配置。地方は全国一覧内の区分として使用 |
| title・description・主見出し・本文内に地域名とサービス語を記載 | 地域名＋採用LINE構築・運用支援をtitle、description、H1、導入文、サービス見出し、FAQ、相談バナーに反映 |
| 共通の長いサービス説明・料金・問い合わせ導線を再利用 | 既存エルトリLPを `ServiceLanding.astro` に切り出し、全地域で同じコンポーネントを描画 |
| 都道府県から市区町村へ、地域ページから親ページへリンク | 全国一覧・都道府県LP・市区町村LPを相互に接続 |
| 各地域URLに自己参照canonical | Baseのcanonical、OG URL、地域別Service・パンくず構造化データを出力 |
| 自治体ごとの紹介文・他社紹介も一部に存在 | 本実装はエルトリの提供内容とオンライン対応を説明。他社の文章・素材や未確認の地域実績は転載しない |

取得したHリンクの固定ページサイトマップは2,131URL。そのうち対象サービスの地域配下は1,922URL（全国1、地方8、都道府県47、市区町村1,866）。1,908件のlastmodは2025-11-05だったが、これは更新日時であり、同日の新規作成・一括公開を証明する情報ではない。

この調査では順位、検索流入、問い合わせ数、本文の類似率は測定していない。ページ生成の仕組みは再現できるが、インデックス・順位・受注の成果は公開後のデータで評価する。

参照: [全国一覧](https://h-link-marketing.co.jp/service/seo-consulting/area/)、[名張市](https://h-link-marketing.co.jp/service/seo-consulting/area/kinki/mie/nabarishi/)、[橋本市](https://h-link-marketing.co.jp/service/seo-consulting/area/kinki/wakayama/hashimotoshi/)、[三重県](https://h-link-marketing.co.jp/service/seo-consulting/area/kinki/mie/)、[和歌山県](https://h-link-marketing.co.jp/service/seo-consulting/area/kinki/wakayama/)、[サイトマップ](https://h-link-marketing.co.jp/sitemap-posttype-page.xml)。

## 保守方法

| 内容 | 正本 |
| --- | --- |
| LPの構成・文章・共通UI | `src/components/ltori/ServiceLanding.astro` |
| サービス名・料金・プラン・FAQ | `src/data/service-ltori.json` |
| 都道府県 | `src/data/ltori-prefectures.json` |
| 全市区町村・行政区と固定URL | `src/data/ltori-area-routes.json` |
| 地域変数・URL・問い合わせ元の対応表 | `src/lib/ltori-seo.mjs` |
| 生成経路 | `src/pages/service/ltori/area/[...slug].astro` |
| 全地域のURL台帳 | `docs/seo/ltori-coverage.md` |

料金やサービス内容の変更は正本を1回更新し、ビルドで全LPに反映する。画像・CSS・JavaScriptも共通アセットとして使い、地域ごとに複製しない。本文は静的HTMLなのでJavaScriptが動作しなくても読める。

経路マスターはGeoloniaのABR由来データと国土地理院コードを照合。取得日と原典更新日を区別して保存し、富谷市の旧コードによる重複を除外した。元データ更新時に既存JISコードのURLを維持する。将来の合併等でURLを廃止する場合は同じ変更で後継URLへの転送を追加する。

通常の変更は `npm run build` → `node --test tests/ltori-seo.test.mjs` → `bash scripts/gate-regression.sh` → PRのCloudflareプレビューで確認する。全件が同一リリースの対象であり、少数都市だけを公開する制御はない。

## 公開と6〜12か月の運用

`AGENTS.md` の既存フローで、作業ブランチ→PR→Cloudflareプレビュー→CI→河出さんの承認・マージ→本番反映を行う。ページ公開と検索エンジンでの掲載は別の状態として記録する。

公開後はSearch Consoleでサイトマップ、クロール・インデックス、地域名を含む検索語、表示・クリックを確認する。権限・現状値はこの実装では未確認。既存GA4には地域識別子 `page_source` を付けたCTAイベント、フォーム成功時のみの `generate_lead` を送る。GA4側のカスタムディメンション設定は別途確認する。

各LPから問い合わせフォームへ地域名を引き継ぎ、通知・メール下書きに残す。任意のクエリ文字列はそのまま計測せず、既知の地域IDだけを受け付ける。CTAクリックは問い合わせ成立として数えない。

月次で表示・クリック・有効相談・商談・受注を確認し、反応のある地域ページには実際の相談から得たFAQや許諾済み事例を追加する。6〜12か月の長期施策として改善する。順位・インデックス率・問い合わせ数の保証や、未達時の一律終了条件は設けない。公開だけでなく、検索需要とページ内容の評価を継続する。

[Googleのスパムポリシー](https://developers.google.com/search/docs/essentials/spam-policies?hl=ja)には、検索目的の低価値な大量生成や誘導ページに関する基準がある。地域名の差し替えやページ数だけで評価されるとは扱わず、実際のサービス検討に使える内容と問い合わせ後の情報を継続更新する。
