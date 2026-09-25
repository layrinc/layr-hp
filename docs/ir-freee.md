# IRページ（/ir/）と freee 連携

`/ir/` は株式会社LAYRの売上高・営業利益を公開するページ。数字は freee会計 から Worker が集計し、万円単位で表示する。

## 仕組み

| 部分 | 場所 | 内容 |
| --- | --- | --- |
| 公開ページ | `src/pages/ir.astro` | `/api/ir/summary` を読み込み、当期累計・月次グラフ2枚・数値表を描く。noindex・サイトマップ除外。フッターの SITEMAP 末尾に「IR情報」 |
| 公開API | `worker/ir.mjs`（`GET /api/ir/summary`） | D1（`SEO_DB`）の `ir_monthly` を万円単位にして返す。最終同期から3時間以上たっていれば、裏で freee から取り直す |
| 管理API | `worker/ir.mjs`（`/api/seo/ir/*`） | `seo.layr.co.jp`（Cloudflare Access＋河出さんのメールのみ）で freee 連携の承認・手動更新・状態確認 |
| データ | D1 `ir_state` / `ir_monthly` | トークンは AES-GCM で暗号化して保存（鍵は secret `IR_TOKEN_KEY`）。円単位の金額は D1 にだけ置き、公開しない |

freee からは月ごとに試算表（損益計算書）を取り、「売上高」と「営業損益金額」の期間の増減（期末−期首）を使う。当月は「速報」として表示する。

## 初回の設定（河出さんの作業）

1. **freee でアプリを作る**：freee アプリストアの開発者ページでアプリを新規作成する
   - コールバックURL：`https://seo.layr.co.jp/api/seo/ir/freee/callback`
   - 権限：会計の「参照」だけ（事業所・レポート）。書き込み権限は付けない
2. **Cloudflare に3つの secret を入れる**（Workers `layr-hp` → Settings → Variables and Secrets）
   - `FREEE_CLIENT_ID` … 1 で発行された Client ID
   - `FREEE_CLIENT_SECRET` … 1 で発行された Client Secret
   - `IR_TOKEN_KEY` … `openssl rand -base64 32` で作った値（トークン暗号化用。変えると再連携が必要）
3. **連携する**：`https://seo.layr.co.jp/api/seo/ir/freee/connect` を開き、freee で株式会社LAYRの事業所を選んで許可する。戻ってきた画面に「freeeと連携しました」と出れば完了
4. **確かめる**：`https://layr.co.jp/ir/` に数字が出る。状態は `https://seo.layr.co.jp/api/seo/ir/status`、すぐ取り直すなら `https://seo.layr.co.jp/api/seo/ir/sync`

## 注意

- freee のリフレッシュトークンは1回限り。同期は D1 のロックで同時実行を防いでいる
- 連携が切れた・失敗した時も、公開ページは前回の数字を出し続ける。原因は `/api/seo/ir/status` の `lastError` に残る
- 出す項目を増やす（事業別の内訳など）時は、取引先の金額が推測されないかを先に確かめる
