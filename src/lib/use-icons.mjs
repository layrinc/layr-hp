/**
 * USE_ICONS — 業種別「使い方カード」用の小型図解セット（LAYRデザインシステム モードA）
 *
 * 仕様:
 *  - すべて viewBox="0 0 120 84"。width/height は持たない（CSSで伸縮させる）
 *  - 文字（<text>）を入れない。意味は形だけで伝える
 *  - 面はフラット。グラデ・影は使わない。線は round cap / round join、stroke-width 2〜2.6
 *  - 色は資料トンマナの直値のみ:
 *      #00BF63 グリーン（アクセント・1図に1〜2箇所）
 *      #D6EEF1 淡水色（面） / #E3ECEC 罫・非強調面 / #FFFFFF 白
 *      #333333 線・本文 / #8A9698 補助線
 *      #F6CC01 黄・#FF5757 赤（注目させる1点にのみ）
 *
 * 使い方:
 *   import { USE_ICONS } from '.../icons.mjs';
 *   <div class="use-fig" set:html={USE_ICONS.reserve} />
 *   CSS: .use-fig svg{display:block;width:100%;height:auto}
 */

export const USE_ICONS = {
  // 1. reserve — LINEから予約を受ける（カレンダー＋選ばれた日＋確定チェック）
  reserve: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="LINEから予約を受け付ける図"><path d="M32 8v9M68 8v9" stroke="#333333" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="18" y="14" width="64" height="56" rx="7" fill="#FFFFFF" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><path d="M18 21a7 7 0 0 1 7-7h50a7 7 0 0 1 7 7v9H18z" fill="#D6EEF1"/><path d="M18 30h64" stroke="#333333" stroke-width="2.4" stroke-linecap="round"/><g fill="#E3ECEC"><rect x="26" y="37" width="11" height="7" rx="2"/><rect x="45" y="37" width="11" height="7" rx="2"/><rect x="64" y="37" width="11" height="7" rx="2"/><rect x="26" y="48" width="11" height="7" rx="2"/><rect x="64" y="48" width="11" height="7" rx="2"/><rect x="26" y="59" width="11" height="7" rx="2"/></g><rect x="45" y="48" width="11" height="7" rx="2" fill="#00BF63"/><circle cx="88" cy="58" r="14" fill="#00BF63" stroke="#FFFFFF" stroke-width="3"/><path d="M82 58.5l4.5 4.5L95 53" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // 2. remind — 前日リマインドが自動で届く（吹き出し＋時計）
  remind: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="前日リマインドが自動で届く図"><path d="M24 14h40a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H36L26 66V54h-2a10 10 0 0 1-10-10V24a10 10 0 0 1 10-10z" fill="#D6EEF1"/><rect x="26" y="26" width="38" height="5" rx="2.5" fill="#FFFFFF"/><rect x="26" y="36" width="24" height="5" rx="2.5" fill="#FFFFFF"/><circle cx="92" cy="52" r="16" fill="#FFFFFF" stroke="#00BF63" stroke-width="2.5"/><path d="M92 42v10l7 4" stroke="#00BF63" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // 3. split — 相手を分けて送る（1つの元から3方向へ分岐・届く相手が違う）
  split: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="送る相手をグループごとに分ける図"><rect x="8" y="30" width="28" height="24" rx="7" fill="#FFFFFF" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><rect x="14" y="37" width="16" height="4" rx="2" fill="#D6EEF1"/><rect x="14" y="45" width="10" height="4" rx="2" fill="#D6EEF1"/><g stroke="#8A9698" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M36 42h14q8 0 8-8v-8q0-8 8-8h8"/><path d="M36 42h38"/><path d="M36 42h14q8 0 8 8v8q0 8 8 8h8"/><path d="M70 14l4 4-4 4M70 38l4 4-4 4M70 62l4 4-4 4"/></g><g fill="#00BF63"><circle cx="94" cy="11" r="5"/><path d="M85 27v-1a9 9 0 0 1 18 0v1z"/></g><g fill="#D6EEF1"><circle cx="94" cy="35" r="5"/><path d="M85 51v-1a9 9 0 0 1 18 0v1z"/></g><g fill="#E3ECEC"><circle cx="94" cy="59" r="5"/><path d="M85 75v-1a9 9 0 0 1 18 0v1z"/></g></svg>`,

  // 4. autoseq — 登録後に自動で順番に届く（時間軸の上に吹き出しが3つ）
  autoseq: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="登録後に自動で順番にメッセージが届く図"><path d="M12 66h94" stroke="#E3ECEC" stroke-width="3" stroke-linecap="round"/><path d="M100 61l5 5-5 5" stroke="#E3ECEC" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 26h14a7 7 0 0 1 7 7v8a7 7 0 0 1-7 7h-4l-4 9-4-9h-2a7 7 0 0 1-7-7v-8a7 7 0 0 1 7-7z" fill="#00BF63"/><rect x="16" y="32" width="16" height="3.6" rx="1.8" fill="#FFFFFF"/><rect x="16" y="39" width="10" height="3.6" rx="1.8" fill="#FFFFFF"/><path d="M51 26h14a7 7 0 0 1 7 7v8a7 7 0 0 1-7 7h-4l-4 9-4-9h-2a7 7 0 0 1-7-7v-8a7 7 0 0 1 7-7z" fill="#D6EEF1"/><rect x="50" y="32" width="16" height="3.6" rx="1.8" fill="#FFFFFF"/><rect x="50" y="39" width="10" height="3.6" rx="1.8" fill="#FFFFFF"/><path d="M85 26h14a7 7 0 0 1 7 7v8a7 7 0 0 1-7 7h-4l-4 9-4-9h-2a7 7 0 0 1-7-7v-8a7 7 0 0 1 7-7z" fill="#FFFFFF" stroke="#E3ECEC" stroke-width="2.2" stroke-linejoin="round"/><rect x="84" y="32" width="16" height="3.6" rx="1.8" fill="#E3ECEC"/><rect x="84" y="39" width="10" height="3.6" rx="1.8" fill="#E3ECEC"/><circle cx="24" cy="66" r="5" fill="#00BF63"/><circle cx="58" cy="66" r="5" fill="#FFFFFF" stroke="#8A9698" stroke-width="2.2"/><circle cx="92" cy="66" r="5" fill="#FFFFFF" stroke="#8A9698" stroke-width="2.2"/></svg>`,

  // 5. faq — よくある質問に自動で答える（質問の吹き出し→自動返信の吹き出し）
  faq: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="よくある質問に自動で答える図"><path d="M17 8h36a9 9 0 0 1 9 9v16a9 9 0 0 1-9 9H30L18 52V42h-1a9 9 0 0 1-9-9V17a9 9 0 0 1 9-9z" fill="#FFFFFF" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><path d="M29 19a6 6 0 1 1 6 6v3" stroke="#333333" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="35" cy="34" r="2.2" fill="#333333"/><rect x="58" y="44" width="52" height="30" rx="9" fill="#00BF63"/><path d="M96 73h9v9z" fill="#00BF63"/><rect x="66" y="53" width="34" height="4.6" rx="2.3" fill="#FFFFFF"/><rect x="66" y="62" width="22" height="4.6" rx="2.3" fill="#FFFFFF"/><circle cx="58" cy="42" r="12" fill="#FFFFFF"/><path d="M62 34l-8 11h5l-2 9 9-12h-5z" fill="#F6CC01"/></svg>`,

  // 6. menu — トーク画面の下に出るメニュー（スマホ枠＋2×3のボタン）
  menu: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="トーク画面の下に出るメニューの図"><rect x="34" y="4" width="52" height="76" rx="10" fill="#FFFFFF" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><rect x="52" y="9" width="16" height="3" rx="1.5" fill="#E3ECEC"/><rect x="41" y="19" width="22" height="8" rx="4" fill="#D6EEF1"/><rect x="57" y="31" width="22" height="8" rx="4" fill="#E3ECEC"/><path d="M39 46h42" stroke="#E3ECEC" stroke-width="2" stroke-linecap="round"/><g fill="#D6EEF1"><rect x="40" y="50" width="12" height="11" rx="3"/><rect x="68" y="50" width="12" height="11" rx="3"/><rect x="40" y="63" width="12" height="11" rx="3"/><rect x="54" y="63" width="12" height="11" rx="3"/><rect x="68" y="63" width="12" height="11" rx="3"/></g><rect x="54" y="50" width="12" height="11" rx="3" fill="#00BF63"/></svg>`,

  // 7. coupon — クーポン・回数券を配る（チケット型＋割引の印＋押印枠）
  coupon: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="クーポンや回数券を配る図"><path d="M20 22h52a6 6 0 0 0 12 0h16a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H84a6 6 0 0 0-12 0H20a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" fill="#D6EEF1" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><path d="M78 31v22" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4.5"/><circle cx="37" cy="34" r="5" stroke="#333333" stroke-width="2.4"/><circle cx="55" cy="50" r="5" stroke="#333333" stroke-width="2.4"/><path d="M33 55L59 29" stroke="#333333" stroke-width="2.5" stroke-linecap="round"/><circle cx="92" cy="32" r="4" fill="#00BF63"/><circle cx="92" cy="42" r="4" fill="#00BF63"/><circle cx="92" cy="52" r="4" fill="#FFFFFF"/></svg>`,

  // 8. doc — 資料や事例を届ける（書類＋ダウンロード）
  doc: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="資料や事例を届ける図"><path d="M26 8h34l16 16v44a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#FFFFFF" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><path d="M60 8v12a4 4 0 0 0 4 4h12z" fill="#D6EEF1"/><path d="M60 8v12a4 4 0 0 0 4 4h12" stroke="#333333" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><g fill="#E3ECEC"><rect x="32" y="34" width="32" height="4.5" rx="2.25"/><rect x="32" y="45" width="32" height="4.5" rx="2.25"/><rect x="32" y="56" width="20" height="4.5" rx="2.25"/></g><circle cx="92" cy="58" r="15" fill="#00BF63" stroke="#FFFFFF" stroke-width="3"/><path d="M92 50v15M85 58l7 7 7-7" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // 9. repeat — また来てもらう／再来訪（循環する矢印＋人）
  repeat: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="もう一度来店してもらう図"><g stroke="#00BF63" stroke-width="2.5" stroke-linecap="round"><path d="M36.4 34.1a23 23 0 0 1 43.2 0"/><path d="M79.6 49.9a23 23 0 0 1-43.2 0"/></g><g fill="#00BF63"><path d="M82 40.7l-7.6-4.7 10.4-3.8z"/><path d="M34 43.3l7.6 4.7-10.4 3.8z"/></g><circle cx="58" cy="35" r="7" fill="#D6EEF1"/><path d="M48 52v-2a10 10 0 0 1 20 0v2z" fill="#D6EEF1"/></svg>`,

  // 10. stock — 在庫・入荷・空き枠のお知らせ（棚＋ベル＋通知バッジ）
  stock: `<svg viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="在庫や空き枠のお知らせが届く図"><rect x="8" y="16" width="54" height="56" rx="5" fill="#FFFFFF" stroke="#333333" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 44h54" stroke="#333333" stroke-width="2.4" stroke-linecap="round"/><rect x="15" y="24" width="18" height="14" rx="2" fill="#D6EEF1"/><rect x="37" y="24" width="18" height="14" rx="2" fill="#00BF63"/><rect x="15" y="52" width="18" height="14" rx="2" fill="#D6EEF1"/><rect x="37" y="52" width="18" height="14" rx="2" stroke="#8A9698" stroke-width="2" stroke-dasharray="4 3.5" stroke-linejoin="round"/><path d="M88 22c-8 0-14.5 6.5-14.5 14.5V46l-5 8h39l-5-8v-9.5C102.5 28.5 96 22 88 22z" fill="#D6EEF1" stroke="#333333" stroke-width="2.2" stroke-linejoin="round"/><path d="M82 54a6 6 0 0 0 12 0" stroke="#333333" stroke-width="2.2" stroke-linecap="round"/><circle cx="88" cy="19" r="3" fill="#333333"/><circle cx="104" cy="26" r="9" fill="#FF5757" stroke="#FFFFFF" stroke-width="3"/></svg>`,
};

export default USE_ICONS;
