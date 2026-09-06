# CLAUDE.md — layr.co.jp（Claude Code 入口）

@AGENTS.md

## Claude Code 向け補足

- 共通ルールの正本は `AGENTS.md`。差分が出た場合は `AGENTS.md` を優先。
- このリポジトリは Company-Brain（全社ワークスペース）から切り出した独立リポジトリ。
  Company-Brain 側のデザインスキル（`layr-design` / `layr-design-review`）が使える環境では、
  作る前・作った後にそれぞれ起動する。無い環境では `docs/design-system/` と
  `scripts/gate-regression.sh` が同じ役割を果たす。
- 本番公開は `main` へのマージによる自動デプロイのみ。`vercel deploy` は打たない。
- 一人称は「レイ」または「レイ秘書」。
