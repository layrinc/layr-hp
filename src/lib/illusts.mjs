/**
 * イラストブロック用のSVGライブラリ（フラット線画・テーマ変数追従）。
 * 既存の IllustWorry / IllustGrowth / IllustConsult と同じ画風:
 * 黒アウトライン(3.5) × var(--green) / var(--green-pale) / var(--deep) / 白。
 * 本番(Block.astro)とプレビュー(admin/preview.astro)の両方から使う。
 */
export const ILLUSTS = {
  // 🚀 ロケット: 成長・立ち上げ
  rocket: `<svg viewBox="0 0 480 340" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="打ち上がるロケットのイラスト">
    <path d="M60 300c40 6 80 6 120 0M320 306c30 5 60 5 90 0" stroke="var(--green-pale)" stroke-width="14" stroke-linecap="round"/>
    <g transform="rotate(-32 250 170)">
      <path d="M250 40c34 26 52 74 52 130l-52 22-52-22c0-56 18-104 52-130z" fill="#fff" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M250 40c14 11 25 26 33 44h-66c8-18 19-33 33-44z" fill="var(--green)" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
      <circle cx="250" cy="130" r="26" fill="var(--green-pale)" stroke="var(--black)" stroke-width="3.5"/>
      <circle cx="250" cy="130" r="13" fill="#fff" stroke="var(--black)" stroke-width="3"/>
      <path d="M198 170l-26 44 34-10M302 170l26 44-34-10" fill="var(--deep)" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M236 196h28l-14 52z" fill="var(--green)" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
    </g>
    <path d="M118 236c-18 8-30 24-34 48 24-4 40-16 48-34M92 180l-22-6M108 148l-14-14M382 96l22-8M368 64l12-16" stroke="var(--black)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="#fff"/>
    <path d="M404 180l5 12 12 5-12 5-5 12-5-12-12-5 12-5zM86 84l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="var(--green)" stroke="var(--black)" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,

  // 💬 スマホチャット: LINE配信・トーク
  chat: `<svg viewBox="0 0 480 340" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="スマホのトーク画面のイラスト">
    <rect x="164" y="24" width="152" height="292" rx="26" fill="#fff" stroke="var(--black)" stroke-width="3.5"/>
    <rect x="178" y="52" width="124" height="34" rx="10" fill="var(--green)"/>
    <circle cx="196" cy="69" r="9" fill="#fff"/>
    <rect x="212" y="63" width="70" height="6" rx="3" fill="#fff" opacity=".9"/>
    <rect x="178" y="100" width="86" height="40" rx="12" fill="var(--green-pale)" stroke="var(--black)" stroke-width="3"/>
    <rect x="216" y="152" width="86" height="34" rx="12" fill="var(--green)" stroke="var(--black)" stroke-width="3"/>
    <rect x="178" y="198" width="96" height="40" rx="12" fill="var(--green-pale)" stroke="var(--black)" stroke-width="3"/>
    <rect x="178" y="252" width="124" height="48" rx="10" fill="var(--deep)"/>
    <rect x="188" y="262" width="32" height="12" rx="4" fill="#fff" opacity=".85"/>
    <rect x="228" y="262" width="32" height="12" rx="4" fill="#fff" opacity=".85"/>
    <rect x="268" y="262" width="24" height="12" rx="4" fill="var(--green)"/>
    <rect x="188" y="280" width="46" height="12" rx="4" fill="#fff" opacity=".85"/>
    <rect x="242" y="280" width="50" height="12" rx="4" fill="#fff" opacity=".85"/>
    <path d="M96 120c0-26 22-46 50-46s50 20 50 46-22 46-50 46c-6 0-12-1-17-3l-21 11 4-20c-10-8-16-20-16-34z" fill="#fff" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round" transform="translate(-20 40)"/>
    <path d="M108 190h44M108 206h30" stroke="var(--green-dark)" stroke-width="5" stroke-linecap="round"/>
    <path d="M368 96c22 4 36 20 38 44-22-4-36-20-38-44z" fill="var(--green)" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M352 196l5 12 12 5-12 5-5 12-5-12-12-5 12-5zM120 60l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="#fff" stroke="var(--black)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M358 260c14 2 24 10 28 24-14-2-24-10-28-24z" fill="var(--green-pale)" stroke="var(--black)" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,

  // 📣 メガホン: 集客・告知
  megaphone: `<svg viewBox="0 0 480 340" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="メガホンで告知するイラスト">
    <path d="M96 194v-44c62-8 118-30 168-66v176c-50-36-106-58-168-66z" fill="var(--green)" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
    <rect x="52" y="142" width="48" height="60" rx="14" fill="var(--deep)" stroke="var(--black)" stroke-width="3.5"/>
    <path d="M264 84c8 24 12 50 12 88s-4 64-12 88" stroke="var(--black)" stroke-width="3.5" fill="#fff"/>
    <ellipse cx="266" cy="172" rx="14" ry="88" fill="#fff" stroke="var(--black)" stroke-width="3.5"/>
    <path d="M104 202l14 56c2 8 10 14 18 14h10c10 0 16-8 14-18l-12-50" fill="var(--green-pale)" stroke="var(--black)" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M318 120c18-8 34-18 46-30M322 172h56M318 224c18 8 34 18 46 30" stroke="var(--green-dark)" stroke-width="6" stroke-linecap="round"/>
    <path d="M398 76l5 12 12 5-12 5-5 12-5-12-12-5 12-5zM408 232l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="var(--green)" stroke="var(--black)" stroke-width="3" stroke-linejoin="round"/>
    <path d="M64 96l-18-10M56 244l-18 10" stroke="var(--black)" stroke-width="3.5" stroke-linecap="round"/>
  </svg>`,
};
