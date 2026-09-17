# 日本郵便の郵便番号データ

`src/data/ltori-town-areas.json` は、日本郵便の「住所の郵便番号（1レコード1行、UTF-8形式）」から、町域表記の例を抽出・整形したデータです。

- 原典: https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html
- 説明・使用条件: https://www.post.japanpost.jp/service/search/zipcode/download/readme.html
- 原典更新: 2026-08-31。取得: 2026-09-18。

日本郵便は、郵便番号データについて著作権を主張せず、自由な配布を認める旨を上記の「使用・再配布・移植・改良について」で示しています。

郵便番号の町域表記は公称町名を保証するものではありません。町域名ではない注意書きを除き、括弧内の番地・階数等の条件を取り除いて例示しています。原典の保存・ハッシュはインポート処理とメタデータで確認できます。
