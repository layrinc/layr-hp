#!/usr/bin/env bash
# design-gate.sh — LAYRデザイン定量ゲート G1〜G10
#
# usage:
#   design-gate.sh <file.css|file.astro|file.html|dir>
#
# ディレクトリを渡すと *.css *.astro *.html を再帰で集め、
# プロジェクト全体を1つの集合として判定する（値の「種類」を数えるゲートがあるため）。
# node_modules / .git / dist / .astro / _archived は除外する。
#
# 閾値の正本: ../references/quality-gate.md
# 閾値を変える時は必ず両方そろえる。
#
# exit code: 0=PASS / 1=FAIL / 2=引数エラー
#
# 動作前提: macOS標準の bash 3.2 + BSD grep / sed / awk。GNU拡張を使わない。

set -u

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "usage: design-gate.sh <file.css|file.astro|file.html|dir>" >&2
  exit 2
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/design-gate.XXXXXX")" || exit 2
trap 'rm -rf "$WORKDIR"' EXIT
LIST="$WORKDIR/files.txt"
BUF="$WORKDIR/buf.txt"

if [ -d "$TARGET" ]; then
  find "$TARGET" \
    \( -name node_modules -o -name .git -o -name dist -o -name .astro -o -name _archived \) -prune \
    -o -type f \( -name '*.css' -o -name '*.astro' -o -name '*.html' \) -print \
    > "$LIST" 2>/dev/null
elif [ -f "$TARGET" ]; then
  printf '%s\n' "$TARGET" > "$LIST"
else
  echo "対象が見つからない: $TARGET" >&2
  exit 2
fi

FILES="$(wc -l < "$LIST" | tr -d ' ')"
if [ "$FILES" -eq 0 ]; then
  echo "対象ファイルが0件: $TARGET （*.css *.astro *.html のみ対象）" >&2
  exit 2
fi

: > "$BUF"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  cat "$f" >> "$BUF"
  printf '\n' >> "$BUF"
done < "$LIST"

# --- 計測ヘルパ -------------------------------------------------------------
# 出現数を数える
occ() { grep -oE "$1" "$BUF" 2>/dev/null | wc -l | tr -d ' '; }

# プロパティの値の「種類数」を数える
kinds() {
  grep -oE "$1:[^;}]*" "$BUF" 2>/dev/null \
    | sed "s/^$1:[[:space:]]*//" \
    | sed 's/[[:space:]]*$//' \
    | sed 's/[[:space:]][[:space:]]*/ /g' \
    | grep -v '^$' \
    | sort -u | wc -l | tr -d ' '
}

# --- 判定 -------------------------------------------------------------------
NG=0
CHECKED=0

chk() { # id label actual op limit
  _id="$1"; _label="$2"; _actual="$3"; _op="$4"; _limit="$5"
  _st="OK"
  case "$_op" in
    le) [ "$_actual" -gt "$_limit" ] && _st="NG" ;;
    ge) [ "$_actual" -lt "$_limit" ] && _st="NG" ;;
    eq) [ "$_actual" -ne "$_limit" ] && _st="NG" ;;
  esac
  case "$_op" in
    le) _sym="<=" ;;
    ge) _sym=">=" ;;
    eq) _sym="==" ;;
  esac
  if [ "$_st" = "NG" ]; then NG=$((NG + 1)); fi
  CHECKED=$((CHECKED + 1))
  printf "[%s] %-4s %7s  %s %-5s  %s\n" "$_st" "$_id" "$_actual" "$_sym" "$_limit" "$_label"
  return 0
}

# G1 box-shadow 宣言数（影で浮かせない。許容はモーダル/ドロップダウン/固定ヘッダーのみ）
# :root のトークン定義を除いたバッファ。
# 値の種類を数えるゲート(G3/G5/G6/G7)は「トークンを経由せず実数値を書いた箇所」を見るため、
# :root での定義そのものは対象から外す。
NOROOT="$(mktemp)"; trap 'rm -f "$BUF" "$NOROOT"' EXIT
awk '
  /:root/ { inroot = 1 }
  inroot  { if (index($0, "}") > 0) { inroot = 0 }; next }
          { print }
' "$BUF" > "$NOROOT" 2>/dev/null

G1="$(occ 'box-shadow[[:space:]]*:')"

# G2 text-align:center 出現数（中央揃えは H1 と最終CTA のみ）
G2="$(occ 'text-align[[:space:]]*:[[:space:]]*center')"

# G3 font-size の数値リテラル種類（型スケール7段に収める）
G3="$(grep -oE 'font-size[[:space:]]*:[^;}]*' "$NOROOT" 2>/dev/null \
      | grep -oE '[0-9][0-9.]*(px|rem)' | sort -u | wc -l | tr -d ' ')"

# G4 font-weight 800/900（実グリフが無い合成太字を使わない）
G4="$(occ 'font-weight[[:space:]]*:[[:space:]]*(800|900)')"

kinds_noroot(){ # $1=プロパティ名 — :root定義を除いた実数値の種類
  grep -oE "$1[[:space:]]*:[^;}]*" "$NOROOT" 2>/dev/null \
    | sed "s/$1[[:space:]]*:[[:space:]]*//" | grep -v 'var(' \
    | tr -d ' ' | sort -u | grep -c . | tr -d ' '
}

# G5 letter-spacing の値の種類
G5="$(kinds_noroot 'letter-spacing')"

# G6 border-radius の値の種類
#   除外: 0 / 50%（円） / %を含む有機形状 — 寸法トークンではなく「形の指定」
G6="$(grep -oE 'border-radius[[:space:]]*:[^;}]*' "$NOROOT" 2>/dev/null \
      | sed 's/border-radius[[:space:]]*:[[:space:]]*//' | grep -v 'var(' \
      | grep -v '%' | tr -d ' ' | grep -vE '^0$' | sort -u | grep -c . | tr -d ' ')"

# G7 :root 外の直値hex の種類（トークンを経由せず色を書いていないか）
#   除外: #fff / #ffffff（普遍色。トークン経由の意味が薄い）
G7="$(grep -oE '#[0-9a-fA-F]{3,8}' "$NOROOT" 2>/dev/null \
      | grep -viE '^#(fff|ffffff)$' | sort -u | wc -l | tr -d ' ')"

# G8 2px以上の単色border（太い枠を使わない）
#   除外1: transparent / #fff / white を含む宣言（グラデ枠の二重背景・Qバッジの白リング）
#   除外2: border-left/right/top/bottom の片側指定（見出し左の縦罫3px・CSS三角矢印）
#   数えるのは全周の単色 border / border-width が2px以上のものだけ。
G8="$(grep -oE 'border(-width)?[[:space:]]*:[^;}]*' "$BUF" 2>/dev/null \
      | grep -viE 'transparent|#fff([^0-9a-fA-F]|$)|#ffffff|white' \
      | grep -cE ':[[:space:]]*([2-9]|[1-9][0-9]+)(\.[0-9]+)?px' | tr -d ' ')"

# G9 easing未指定の transition（＝素の ease。全部 cubic-bezier 等を明示する）
#   除外: transition:none / inherit / initial / unset（easingを持てない指定）
G9="$(grep -oE 'transition[[:space:]]*:[^;}]*' "$BUF" 2>/dev/null \
      | grep -viE ':[[:space:]]*(none|inherit|initial|unset)' \
      | grep -cvE 'cubic-bezier|ease|linear|steps|var\(' | tr -d ' ')"

# G16 CSS変数の循環参照（--x:var(--x)）— その値が全ページで無効になる。ビルドは通るので機械で捕まえる
G16="$(awk '
  {
    line = $0
    while (match(line, /--[A-Za-z0-9_-]+[ \t]*:[ \t]*var\([ \t]*--[A-Za-z0-9_-]+/)) {
      seg = substr(line, RSTART, RLENGTH)
      split(seg, a, ":")
      def_name = a[1]; gsub(/[ \t]/, "", def_name)
      use_name = seg; sub(/.*var\([ \t]*/, "", use_name); gsub(/[ \t]/, "", use_name)
      if (def_name == use_name) hits[def_name] = 1
      line = substr(line, RSTART + RLENGTH)
    }
  }
  END { n = 0; for (k in hits) n++; print n }
' "$BUF" 2>/dev/null)"

# G17 参照しているのに定義が無いCSS変数（フォールバック無しの var(--x) は無効化される）
G17="$(awk '
  {
    line = $0
    while (match(line, /--[A-Za-z0-9_-]+[ \t]*:/)) {
      d = substr(line, RSTART, RLENGTH); gsub(/[ \t:]/, "", d); defined[d] = 1
      line = substr(line, RSTART + RLENGTH)
    }
    line = $0
    while (match(line, /var\([ \t]*--[A-Za-z0-9_-]+[ \t]*[,)]/)) {
      seg = substr(line, RSTART, RLENGTH)
      hasfb = (seg ~ /,$/)
      u = seg; sub(/var\([ \t]*/, "", u); gsub(/[ \t,)]/, "", u)
      if (hasfb) safe[u] = 1; else used[u] = 1
      line = substr(line, RSTART + RLENGTH)
    }
  }
  END { n = 0; for (k in used) if (!(k in defined) && !(k in safe)) n++; print n }
' "$BUF" 2>/dev/null)"

# G10 :focus-visible の定義数（キーボード操作の穴を作らない）
G10="$(occ 'focus-visible')"

# --- 出力 -------------------------------------------------------------------
echo "================================================================"
echo " LAYR design gate G1-G10"
echo " 対象   : $TARGET"
echo " ファイル: ${FILES}件"
echo "================================================================"
printf "%-5s %-4s %7s  %-8s %s\n" "判定" "ID" "現状" "閾値" "指標"
echo "----------------------------------------------------------------"

chk G1  "box-shadow 宣言数"                  "$G1"  le 8
chk G2  "text-align:center 出現数"           "$G2"  le 5
chk G3  "font-size 値の種類"                 "$G3"  le 10
chk G4  "font-weight 800/900 出現数"         "$G4"  eq 0
chk G5  "letter-spacing 値の種類"            "$G5"  le 4
chk G6  "border-radius 値の種類"             "$G6"  le 5
chk G7  ":root外の直値hex 種類"              "$G7"  le 5
chk G8  "単色border 2px以上 出現数"          "$G8"  eq 0
chk G9  "easing未指定 transition 数"         "$G9"  eq 0
chk G10 ":focus-visible 定義数"              "$G10" ge 1
chk G16 "CSS変数の循環参照"                   "$G16" eq 0
chk G17 "未定義のCSS変数参照"                 "$G17" eq 0

echo "----------------------------------------------------------------"
if [ "$NG" -eq 0 ]; then
  echo "PASS  ${CHECKED}項目 すべて基準内"
  echo
  echo "※ G11-G15（h1の個数 / 上下padding非対称 / reduced-motion / スクロール機構の統一 /"
  echo "   LPのCV計測）は機械判定しない。references/quality-gate.md の目視ゲートで確認する。"
  exit 0
else
  echo "FAIL  ${NG}/${CHECKED}項目 が基準外 — 直してから提出"
  echo
  echo "既存資産の是正は承認済み範囲でのみ行う。新規制作物は必ずPASSさせる。"
  exit 1
fi
