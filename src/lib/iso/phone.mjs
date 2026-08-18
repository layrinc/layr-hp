/** スマホ＋LINEトーク: 白い角丸台座の上に立つ大きなスマートフォン。画面はLINE風トーク＋リッチメニュー、脇に植栽。 */
export default `<svg viewBox="0 0 420 420" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="アイソメトリックの台座に立つスマートフォンとLINEトーク画面・リッチメニューのイラスト">

  <!-- ===== 台座の下の薄い楕円 ===== -->
  <ellipse cx="210" cy="399" rx="146" ry="13" fill="#E8EFF0"/>

  <!-- ===== 台座 側面（左＝最も暗い / 右＝中間） ===== -->
  <path d="M77 284 Q58 295 77 306 L191 372 L210 383 L210 398 L191 387 L77 321 Q58 310 77 299 Z" fill="#D8E3E5"/>
  <path d="M343 284 Q362 295 343 306 L229 372 L210 383 L210 398 L229 387 L343 321 Q362 310 343 299 Z" fill="#E8EFF0"/>

  <!-- ===== 台座 下端のティール帯 ===== -->
  <path d="M77 293 Q58 304 77 315 L191 381 Q210 392 229 381 L343 315 Q362 304 343 293 L343 298 Q362 309 343 320 L229 386 Q210 397 191 386 L77 320 Q58 309 77 298 Z" fill="#00BF63"/>

  <!-- ===== 台座 上面 ===== -->
  <path d="M229 218 L343 284 Q362 295 343 306 L229 372 Q210 383 191 372 L77 306 Q58 295 77 284 L191 218 Q210 207 229 218 Z" fill="#FFFFFF"/>
  <path d="M225 232 L327 291 Q343 300 327 309 L225 368 Q210 377 195 368 L93 309 Q77 300 93 291 L195 232 Q210 223 225 232 Z" fill="#F7FAFA"/>

  <!-- ===== スマートフォン 本体（背面スラブ／左側面＝最も暗い／上面＝中間） ===== -->
  <polygon points="137.88,98 227.94,46 227.94,256 137.88,308" fill="#1B2A2E"/>
  <polygon points="150,112 137.88,105 137.88,301 150,308" fill="#1B2A2E"/>
  <polygon points="156.06,101.5 143.94,94.5 221.88,49.5 234.0,56.5" fill="#2E4247"/>

  <!-- ===== スマートフォン 前面（等角の縦面：u=(0.866,-0.5) / v=(0,1)） ===== -->
  <g transform="matrix(0.866,-0.5,0,1,150,105)">

    <!-- 筐体ベゼル -->
    <rect x="0" y="0" width="104" height="210" rx="9" fill="#2E4247"/>

    <!-- 画面 -->
    <rect x="7" y="9" width="90" height="192" rx="4" fill="#FFFFFF"/>

    <!-- --- ヘッダーバー --- -->
    <rect x="7" y="9" width="90" height="21" rx="4" fill="#00BF63"/>
    <rect x="7" y="24" width="90" height="6" fill="#00BF63"/>
    <circle cx="20" cy="19.5" r="7.5" fill="#FFFFFF"/>
    <circle cx="20" cy="19.5" r="4" fill="#4FD48D"/>
    <rect x="32" y="14.6" width="34" height="4" rx="2" fill="#4FD48D"/>
    <rect x="32" y="21.6" width="22" height="3" rx="1.5" fill="#4FD48D"/>

    <!-- --- トーク領域 --- -->
    <rect x="7" y="30" width="90" height="116" fill="#E8EFF0"/>

    <!-- 相手の吹き出し 1 -->
    <circle cx="18" cy="45" r="7" fill="#D8E3E5"/>
    <polygon points="29,39 29,47 25,43" fill="#FFFFFF"/>
    <rect x="29" y="35" width="47" height="20" rx="5" fill="#FFFFFF"/>
    <rect x="33.5" y="40.5" width="36" height="3.4" rx="1.7" fill="#D8E3E5"/>
    <rect x="33.5" y="46.5" width="25" height="3.4" rx="1.7" fill="#D8E3E5"/>

    <!-- 自分の吹き出し 1 -->
    <polygon points="90,63 90,71 94,67" fill="#22C55E"/>
    <rect x="41" y="59" width="49" height="20" rx="5" fill="#22C55E"/>
    <rect x="45" y="64.5" width="39" height="3.4" rx="1.7" fill="#FFFFFF"/>
    <rect x="45" y="70.5" width="27" height="3.4" rx="1.7" fill="#FFFFFF"/>

    <!-- 相手の吹き出し 2 -->
    <circle cx="18" cy="93" r="7" fill="#D8E3E5"/>
    <polygon points="29,87 29,95 25,91" fill="#FFFFFF"/>
    <rect x="29" y="83" width="47" height="20" rx="5" fill="#FFFFFF"/>
    <rect x="33.5" y="88.5" width="36" height="3.4" rx="1.7" fill="#D8E3E5"/>
    <rect x="33.5" y="94.5" width="21" height="3.4" rx="1.7" fill="#D8E3E5"/>

    <!-- 自分の吹き出し 2 -->
    <polygon points="90,111 90,118 94,114.5" fill="#22C55E"/>
    <rect x="47" y="107" width="43" height="17" rx="5" fill="#22C55E"/>
    <rect x="51" y="111.5" width="33" height="3.4" rx="1.7" fill="#FFFFFF"/>
    <rect x="51" y="117" width="22" height="3.4" rx="1.7" fill="#FFFFFF"/>

    <!-- 相手の吹き出し 3 -->
    <circle cx="18" cy="136" r="7" fill="#D8E3E5"/>
    <polygon points="29,132 29,139 25,135.5" fill="#FFFFFF"/>
    <rect x="29" y="128" width="47" height="17" rx="5" fill="#FFFFFF"/>
    <rect x="33.5" y="132.5" width="34" height="3.4" rx="1.7" fill="#D8E3E5"/>
    <rect x="33.5" y="138" width="19" height="3.4" rx="1.7" fill="#D8E3E5"/>

    <!-- --- リッチメニュー（2行×3列） --- -->
    <rect x="7" y="146" width="90" height="55" rx="4" fill="#D8E3E5"/>
    <rect x="7" y="146" width="90" height="8" fill="#D8E3E5"/>

    <rect x="9" y="148" width="27.3" height="24.5" rx="2" fill="#F7FAFA"/>
    <rect x="16.65" y="154.25" width="12" height="6" rx="2" fill="#C7D5D7"/>
    <rect x="15.65" y="162.25" width="14" height="2.6" rx="1.3" fill="#C7D5D7"/>

    <rect x="37.7" y="148" width="27.3" height="24.5" rx="2" fill="#00BF63"/>
    <rect x="45.35" y="154.25" width="12" height="6" rx="2" fill="#FFFFFF"/>
    <rect x="44.35" y="162.25" width="14" height="2.6" rx="1.3" fill="#FFFFFF"/>

    <rect x="66.4" y="148" width="27.3" height="24.5" rx="2" fill="#F7FAFA"/>
    <rect x="74.05" y="154.25" width="12" height="6" rx="2" fill="#C7D5D7"/>
    <rect x="73.05" y="162.25" width="14" height="2.6" rx="1.3" fill="#C7D5D7"/>

    <rect x="9" y="174.5" width="27.3" height="24.5" rx="2" fill="#F7FAFA"/>
    <rect x="16.65" y="180.75" width="12" height="6" rx="2" fill="#C7D5D7"/>
    <rect x="15.65" y="188.75" width="14" height="2.6" rx="1.3" fill="#C7D5D7"/>

    <rect x="37.7" y="174.5" width="27.3" height="24.5" rx="2" fill="#F7FAFA"/>
    <rect x="45.35" y="180.75" width="12" height="6" rx="2" fill="#C7D5D7"/>
    <rect x="44.35" y="188.75" width="14" height="2.6" rx="1.3" fill="#C7D5D7"/>

    <rect x="66.4" y="174.5" width="27.3" height="24.5" rx="2" fill="#F7FAFA"/>
    <rect x="74.05" y="180.75" width="12" height="6" rx="2" fill="#C7D5D7"/>
    <rect x="73.05" y="188.75" width="14" height="2.6" rx="1.3" fill="#C7D5D7"/>

  </g>

  <!-- ===== 植栽（台座の右手前） ===== -->
  <ellipse cx="270" cy="308" rx="13" ry="6" fill="#E8EFF0"/>
  <circle cx="270" cy="294" r="15" fill="#16A34A"/>
  <circle cx="268.2" cy="292.2" r="13.6" fill="#22C55E"/>
  <circle cx="264.6" cy="288" r="4.6" fill="#4ADE80"/>

</svg>`;
