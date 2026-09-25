# IRページ（/ir/）と freee 連携

`/ir/` はLAYRの事業全体の売上高・営業利益を公開するページ。**株式会社LAYR と 代表の個人事業 の2つの freee 事業所を月ごとに合算**し（2026-09-26 河出さん決定）、暦年ごとに万円単位で表示する。事業所ごとの内訳は公開しない。

## 仕組み

| 部分 | 場所 | 内容 |
| --- | --- | --- |
| 公開ページ | `src/pages/ir.astro` | `/api/ir/summary` を読み込み、今月の売上高（速報）・今年の累計・月次グラフ2枚・数値表・過去の年を描く。noindex・サイトマップ除外。フッターの SITEMAP 末尾に「IR情報」 |
| 公開API | `worker/ir.mjs`（`GET /api/ir/summary`） | D1（`SEO_DB`）の `ir_company_monthly` を月ごとに合算し、万円単位にして返す。最終同期から3時間以上たっていれば、裏で freee から取り直す |
| 管理API | `worker/ir.mjs`（`/api/seo/ir/*`） | `seo.layr.co.jp`（Cloudflare Access＋河出さんのメールのみ）で freee 連携の承認（事業所ごと）・解除・手動更新・状態確認 |
| データ | D1 `ir_links`（事業所ごとの連携）/ `ir_company_monthly`（事業所×月）/ `ir_state`（同期のロック） | トークンは AES-GCM で暗号化して保存（鍵は secret `IR_TOKEN_KEY`）。円単位の金額は D1 にだけ置き、公開しない |

freee からは月ごとに試算表（損益計算書）を取り、期間の増減（期末−期首）を使う。当月は「速報」として表示する。

- 法人：「売上高」と「営業損益金額」
- 個人事業：「売上（収入）金額」と、売上 −「売上原価」−「経費」（青色申告特別控除の前）
- 区分が見つからない時は 0 にせず失敗として記録する（`lastError` に区分名が出る）
- 1回の同期で取る試算表は30か月分まで。初回で取り切れない分は、IRページが開かれるたびに続きを取る。取得済みの古い月は取り直さず、直近3か月だけ毎回取り直す

## 初回の設定（河出さんの作業）

1. **freee でアプリを作る**：freee アプリストアの開発者ページでアプリを新規作成する
   - コールバックURL：`https://seo.layr.co.jp/api/seo/ir/freee/callback`
   - 権限：会計の「参照」だけ（事業所・レポート）。書き込み権限は付けない
2. **Cloudflare に3つの secret を入れる**（Workers `layr-hp` → Settings → Variables and Secrets）
   - `FREEE_CLIENT_ID` … 1 で発行された Client ID
   - `FREEE_CLIENT_SECRET` … 1 で発行された Client Secret
   - `IR_TOKEN_KEY` … `openssl rand -base64 32` で作った値（トークン暗号化用。変えると再連携が必要）
3. **連携する（2回）**：`https://seo.layr.co.jp/api/seo/ir/freee/connect` を開き、freee で事業所を1つ選んで許可する。戻ってきた画面に事業所ごとの年合計が出るので、freee の損益計算書と見比べる。同じURLをもう一度開き、もう一方の事業所（個人事業／株式会社LAYR）も連携する
   - 外す時：`https://seo.layr.co.jp/api/seo/ir/freee/disconnect?company=<事業所ID>`（ID は `/api/seo/ir/status` の `companies`）。その事業所の数字も消える
4. **確かめる**：`https://layr.co.jp/ir/` に数字が出る。状態は `https://seo.layr.co.jp/api/seo/ir/status`、すぐ取り直すなら `https://seo.layr.co.jp/api/seo/ir/sync`

## 注意

- freee のリフレッシュトークンは1回限り。同期は D1 のロックで同時実行を防いでいる
- 連携が切れた・失敗した時も、公開ページは前回の数字を出し続ける。原因は `/api/seo/ir/status` の `lastError` に残る
- 出す項目を増やす（事業別の内訳など）時は、取引先の金額が推測されないかを先に確かめる
