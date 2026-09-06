# LAYRのデザイン原則（8個）

**正本は資料**: `株式会社LAYR/06_デザイン_CDO/成果物/20260816_LINE構築運用サービス資料_トンマナ正本.pdf`（全24ページ）。
以下の「なぜ」に書いたページ番号はこの資料のページ。色はページ画像から抽出した実測値。

サイト側の `株式会社LAYR/layr-hp/src/styles/style.css` は資料より前に作られており、**資料と食い違う箇所は資料が勝つ**。
優先順位は **河出さんの明示指示 > 資料 > そのプロジェクトの既存トークン**。ただし既存資産の一斉是正は未承認。指示のない範囲まで直しにいかない。

適用範囲はモードA（標準）。B（エディトリアル）・C（和風）・D（社内ツール）は各モードの定義が優先し、原則3・4・6・8だけを共通で守る。

---

## 原則1 — 色に役割を割り当てる。役割のない色を使わない

**なぜ**: 資料は8色使っているが、どれも1つの仕事しかしていない。グリーン=ブランドと肯定（P2の帯・P23のFAQ帯）、赤=単独の巨大数字（P2「9,600万人」・P16のNG番号）、黄=倍率バッジ（P2「約20倍」「約6倍」）、オレンジ=推奨1箇所（P14のリボン・P20の最上位列）、淡水色=情報の地（P11のタグ・P14の料金カード）。**同じ色が2つの意味を持つページが1枚もない**のが資料の強さ。「アクセントは1色」ではなく「役割は1色に1つ」。

**判定基準**: 使用色は下記6役から選ぶ。役割不明の色を1つでも足したら不合格。
グリーン `#00BF63` / 濃緑文字 `#008516` / 黄 `#F6CC01` / 赤 `#FF5757` / オレンジ `#E9A32F` / 淡水色 `#D6EEF1`。面の淡緑 `#DFF6EB` `#E7F8F0` は「薄い面」の1役として別勘定（`guidelines/design-system.md` §3-3 と同じ）。
グリーンの塗り面積は1ビューポートの12%以下（資料の帯・CTAの実測上限）。黄・赤・オレンジは**1ビューポートに各1箇所まで**。締め行や見出しの強調グリーンは**1語だけ**（P3「LINE」、P5「高品質×低コスト」）。

**守る書き方**:
```css
:root{
  --brand:#00BF63;        /* ブランド・肯定・CTA・帯 */
  --brand-ink:#008516;    /* 本文中の緑強調文字 */
  --emph-y:#F6CC01;       /* 倍率・比較の強調バッジ */
  --emph-r:#FF5757;       /* 単独の巨大数字 */
  --recommend:#E9A32F;    /* おすすめ1箇所のみ */
  --surface-blue:#D6EEF1; /* 情報の地・タグチップ */
}
.faq__q{background:var(--brand); color:#fff}
.plan--recommended .ribbon{background:var(--recommend)}
/* NG: .btn-sub{background:var(--emph-y)} ← 黄に「副ボタン」という2つ目の役割を持たせている */
```

**破ってよい場合**: グラフの系列色。ただし系列は3本まで、非強調系列は必ずグレー `#A6A6A6`（P2の棒グラフの型）。

---

## 原則2 — グラデはティール→ライトグリーンの1本だけ。角度と色を固定する

**なぜ**: 資料のグラデは全ページ通して `#0499AF → #77D55C` の1種類しかない。円形フローの枠線（P9・P10）、ラベル帯（P15〜P19・P21・P22）、番号バッジ（P3・P8）、矢印の三角（P8・P16）。**色と方向が固定されているから意匠として認識される**。旧スキルの「グラデ禁止」は誤り。禁止すべきは紫→青などのAI由来グラデであって、LAYR指定のグラデは正規の意匠。

**判定基準**: グラデーションの定義は `--grad` の1本のみ。角度は `90deg`（横）固定、円形要素だけ `135deg` を許す。CSSに現れるグラデ色数 = 2（`#0499AF` と `#77D55C`）。紫・青紫・ピンクを含むグラデの出現数 = **0**。

**守る書き方**:
```css
:root{
  --grad-a:#0499AF; --grad-b:#77D55C;
  --grad:linear-gradient(90deg, var(--grad-a) 0%, var(--grad-b) 100%);
}
.label-band{background:var(--grad); color:#fff; border-radius:999px;
  padding:14px 40px; letter-spacing:.18em; font-weight:700}
.badge-num{background:linear-gradient(135deg, var(--grad-a), var(--grad-b)); color:#fff}
/* 枠線にグラデを載せる時は border-image ではなく二重背景で */
.card--grad{border:2px solid transparent; border-radius:16px;
  background:linear-gradient(#fff,#fff) padding-box, var(--grad) border-box}
/* NG: linear-gradient(135deg,#667eea,#764ba2) ← AI由来の紫青。LAYRでは使わない */
```

**破ってよい場合**: 写真・イラストの内部。表紙の波形だけは淡緑 `#C1E392 → #B6DD75` の別グラデを使う（P1・P24専用）。

---

## 原則3 — 値の種類を減らす。先に決めた集合からしか選ばない

**なぜ**: 資料24ページで角丸は3種（ピル999px / カード16px / チップ8px）、円は正円のみ。フォントサイズも見出し・小見出し・本文・注釈の4段しかない。**その場で決めた値が1つもない**。対してサイト側 `style.css` は font-size 49種・字間20種・影88宣言。デザインしているのではなく毎回決めている状態。

**判定基準**: 1プロジェクト内で font-size の数値リテラル ≤10 / border-radius ≤5 / letter-spacing ≤4 / box-shadow ≤8（ゲート G3・G6・G5・G1 と同値）。角丸の集合は 8 / 12 / 16 / 999px ＋円 `50%`。トークンを経由しない生の値が現れたら不合格。

**守る書き方**:
```css
:root{
  --fs-display:clamp(34px,4.6vw,60px); --fs-h2:clamp(26px,3vw,38px);
  --fs-h3:20px; --fs-lead:19px; --fs-body:17px; --fs-sm:15px; --fs-note:13px;
  --r-pill:999px; --r-card:16px; --r-chip:8px;
}
.sec__title{font-size:var(--fs-h2)}
.chip{border-radius:var(--r-chip); background:var(--surface-blue); font-size:var(--fs-sm)}
/* NG: .chip{border-radius:10px} ← 4種目の角丸を作った時点で破綻が始まる */
```

**破ってよい場合**: なし。

---

## 原則4 — 階層はサイズ・余白・色で作る。ウエイトは400/500/700の3値

**なぜ**: 資料の見出しは太く見えるが、これは**サイズ差**で作られている。P2のセクション番号「01」は見出しの約1.6倍、P14の価格「25」は単位「万円」の約3倍。Webで `font-weight:800/900` を指定しても Noto Sans JP に実グリフはなく、ブラウザの合成太字になる。「株式会社」「運用」のような画数の多い字が16px以下で黒い塊になる。
余白も同じ。資料はセクション上端の余白が下端より広く、カード群の上に必ず谷がある（P3・P5・P8）。

**判定基準**: 使用ウエイトは 400 / 500 / 700 の3値のみ。800・900 の出現数 = **0**。
連番とその隣の見出しのサイズ比 ≒ 1.6:1。価格の数字と単位のサイズ比 ≒ 3:1。
セクション上下paddingは非対称（上が広い、比 ≒ 1.6:1）。上下同値のセクション = 0。近接は4層に固定 — tight 6px / group 22px / block 56-96px / section 88-168px。中間値を作らない。

**守る書き方**:
```css
section{padding-block:clamp(88px,9.5vw,168px) clamp(56px,6vw,104px)}
.sec__num{font-size:clamp(44px,5.6vw,72px); font-weight:700; color:var(--brand); line-height:1}
.sec__title{font-size:var(--fs-h2); font-weight:700; color:#000}
.price__num{font-size:clamp(44px,6vw,76px); font-weight:700}
.price__unit{font-size:var(--fs-h3); font-weight:700}
/* NG: .sec__title{font-weight:900} ← 合成太字。日本語が潰れる */
/* NG: section{padding:80px 0} ← 上下同値は余白を設計していない証拠 */
```

**破ってよい場合**: 有料書体を導入し、実際に800のグリフを読み込んでいる時だけ。

---

## 原則5 — セクションは「連番＋縦罫＋見出し」で始め、「>> 締め行」で閉じる

**なぜ**: 資料の説得力は装飾ではなく**構造の反復**から出ている。P2〜P8・P14・P20・P23が同じ開き方（グリーンの特大連番 → グリーンの縦罫 → 黒の見出し）をし、P3・P4・P5・P6・P7が同じ閉じ方（`>>` の締め行、キーワードだけグリーン）をする。章の小見出しはグラデのラベル帯を左上に置く（P15〜P19・P21・P22）。工程はグラデ枠の正円を三角矢印でつなぐ（P9・P10）。**読者は4種類の型しか見せられていない**から迷わない。

**判定基準**: 1ページのセクションは全て同じ開き方をする。例外 = 0。
主要セクションには締め行を1本置く。締め行は1文・40字以内・強調グリーンは1語。
工程・手順の表現は「円形フロー（3〜4個）」か「番号付きカード」のどちらか一方に統一する。1ページで両方使わない。

**守る書き方**:
```css
.sec__head{display:flex; align-items:center; gap:24px; margin-bottom:clamp(40px,5vw,72px)}
.sec__num{color:var(--brand)}
.sec__rule{width:3px; align-self:stretch; background:var(--brand)}
.sec__close{font-size:var(--fs-h3); font-weight:700; color:#000; text-align:center;
  margin-top:clamp(48px,5vw,80px)}
.sec__close::before{content:">> "; color:#000}
.sec__close em{color:var(--brand); font-style:normal}
.flow{display:grid; grid-auto-flow:column; align-items:center; gap:0}
.flow__node{aspect-ratio:1; border-radius:50%; display:grid; place-items:center;
  border:6px solid transparent;
  background:linear-gradient(#fff,#fff) padding-box, var(--grad) border-box}
/* NG: セクションごとに開き方を変える。反復が消えると型が型に見えなくなる */
```

**破ってよい場合**: 表紙・裏表紙・事例ページ（P11・P12）。事例は「写真＋見出し＋本文＋タグチップ」の別の型に従う。

---

## 原則6 — 面は線と淡い塗りで分ける。影で浮かせない

**なぜ**: 資料のカードは3種類しかない。①白地＋グラデ2px枠＋角丸16px（P3・P8）、②白地＋極薄影（P4・P5）、③淡水色の塗り＋枠なし（P14）。**どれも浮いていない**。P4の影はほぼ視認できない濃度で、面の境界を示す以上の仕事をしていない。近くて濃い影が最も安く見える。

**判定基準**: `box-shadow` 宣言 ≤8（ゲートG1）。影を許すのは**モーダル／ドロップダウン／固定ヘッダー**の3用途と、上記②のカードのみ。②の影は不透明度 6% 以下・ぼかし 24px 以上（遠くて薄い）。
面の分離に使う**単色の `border-width` は 1px のみ**。グラデ枠は `border:2〜6px solid transparent` ＋ `padding-box`/`border-box` の二重背景で持つ（色を持たないのでゲートG8の対象外）。単色で2px以上を許すのは意匠の**見出し左の縦罫3px**と**Qバッジの白リング3px**だけ。
hover で `translateY` させない。

**守る書き方**:
```css
.card{background:#fff; border:1px solid #E5E5E5; border-radius:var(--r-card); box-shadow:none;
  transition:border-color .18s cubic-bezier(.2,.6,.2,1)}
.card:hover{border-color:#C9C9C9}          /* 浮かせず線を1段濃く */
.card--soft{border:0; box-shadow:0 10px 32px rgba(16,26,25,.05)}
.card--fill{background:var(--surface-blue); border:0}
.modal{box-shadow:0 12px 48px rgba(16,26,25,.10)}
/* NG: .card:hover{transform:translateY(-6px); box-shadow:0 4px 20px rgba(0,0,0,.12)} */
```

**破ってよい場合**: モードB・Cのハード影 `3px 3px 0`（ぼかし0なので浮遊にならない）。

---

## 原則7 — 中央揃えは決まった3つの型だけ。それ以外は左揃え

**なぜ**: 資料は一見センター寄りだが、中央にあるのは**締め行（P3〜P7）／ラベル帯ページの主見出し（P15〜P19・P21・P22）／円形フローのノードと直下の説明（P9・P10）**の3つだけ。本文・カード内テキスト・FAQ回答・料金の箇条書きは全て左揃え。読ませる文章を中央に置いているページは1枚もない。

**判定基準**: `text-align:center` は上記3型に限る。1ページの宣言数 ≤5。
中央揃えのテキストは3行以内。4行以上を中央に置いたら不合格。
等分3カラムが3連続したら1つを非等分（5:7など）に崩す。崩しは1ページ2〜3箇所まで。

**守る書き方**:
```css
.sec__close, .band-title, .flow__node, .flow__cap{text-align:center}
.card p, .faq__a, .plan ul, .case__body{text-align:left}
.grid-3{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px}
.split{display:grid; grid-template-columns:minmax(0,5fr) minmax(0,7fr); gap:clamp(32px,4vw,64px)}
/* 事例は必ず split。写真左・テキスト右（P11・P12の型） */
/* NG: .card p{text-align:center} ← 読ませる本文を中央に置かない */
```

**破ってよい場合**: 比較表のセル（P20は◯/− と短い文言なので中央）。ロゴ並び・数字の帯。

---

## 原則8 — 1ページに記憶に残る1つ（signature）を作り、それ以外は黙らせる

**なぜ**: 資料が装飾を使っているのはP1・P24の波形、P2の赤い9,600万人、P6の緑のパラレログラム帯、P14のオレンジリボン。**いずれも1ページに1つだけ**で、同じページの他要素は全て無装飾。装飾を散らすと総和ではなく相殺になる。演出過多そのものがAI臭の主因。

**判定基準**: design plan に `signature:` を1行で書けるか。**書けないなら着手しない**。
signature を置いたセクションでは、他の装飾（グラデ・バッジ・強調色・影）の追加を0にする。
同時に「1文しか置かないセクション」を1つ作る。上下padding 128px以上、1行24字以内。

**守る書き方**:
```css
.section--quiet{background:#fff; border:0; box-shadow:none}
.statement{padding-block:clamp(128px,15vw,240px); font-size:var(--fs-h2);
  font-weight:700; max-width:24ch; margin-inline:auto; text-align:center}
.signature{/* この1ブロックにだけ意匠を置く。クラス名で明示する */}
/* 資料由来の signature 候補: 表紙の緑波形 / 巨大数字の色付き円 / 緑パラレログラム帯 / 推奨リボン */
```

**破ってよい場合**: なし。signature を2つ作りたくなったら、片方を削って1つに集約する。
