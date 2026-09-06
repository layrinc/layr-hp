#!/usr/bin/env bash
# デザインゲートの回帰チェック。
# docs/design-system/design-gate.sh を src/styles/style.css にかけ、
# docs/design-system/gate-baseline.txt（基準値）と項目ごとに比較する。
# 1項目でも悪化していれば非0で終了する（CIとPR前の手元確認で使う）。
#
# 「悪化」の定義（design-gate.sh の判定式に合わせる）:
#   上限型（<=, ==0 の項目）: 基準値より増えたら悪化
#   下限型（>=  の項目）    : 基準値より減ったら悪化
# 既存のNG項目は、基準値どおりであれば合格（是正は別途承認制）。
set -u
cd "$(dirname "$0")/.."

GATE="docs/design-system/design-gate.sh"
BASE="docs/design-system/gate-baseline.txt"
TARGET="src/styles/style.css"

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 2; }
[ -f "$BASE" ] || { echo "baseline not found: $BASE"; exit 2; }

# 現在値: "G1 90" の形で取り出す。判定記号も拾う（<=, ==, >=）
now=$(bash "$GATE" "$TARGET" 2>&1 | grep -E '^\[(OK|NG)\]' | awk '{print $2, $3, $4}')

fail=0
printf '%-5s %8s %8s  %s\n' "項目" "基準値" "現在値" "判定"
while read -r id cur op; do
  base=$(awk -v k="$id" '$1==k{print $2}' "$BASE")
  [ -z "$base" ] && { printf '%-5s %8s %8s  %s\n' "$id" "-" "$cur" "基準値なし（gate-baseline.txt に追加してください）"; fail=1; continue; }
  case "$op" in
    ">=") if [ "$cur" -lt "$base" ]; then v="悪化"; fail=1; else v="OK"; fi ;;
    *)    if [ "$cur" -gt "$base" ]; then v="悪化"; fail=1; else v="OK"; fi ;;
  esac
  printf '%-5s %8s %8s  %s\n' "$id" "$base" "$cur" "$v"
done <<< "$now"

echo
if [ "$fail" -ne 0 ]; then
  echo "NG: デザインゲートが基準値から悪化しています。新規追加分を見直すか、"
  echo "    意図した変更なら理由をPRに書いたうえで $BASE を同じPRで更新してください。"
  exit 1
fi
echo "OK: 基準値からの悪化なし"
