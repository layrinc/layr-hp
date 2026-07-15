/**
 * 記事Markdown用のWPテーマ風装飾記法（remark-directiveの変換層）。
 * LPのブロックと同じCSSクラス（blk-ico / blk-box / blk-cap / blk-speech / mk-g）に変換するので、
 * 記事とトップページで装飾の見た目が完全に揃う。
 *
 * 使える記法:
 *   :::point{title="ここがポイント"} … :::   💡ポイント（緑）
 *   :::warn / :::memo / :::check              ⚠️注意 / 📝メモ / ✅チェック
 *   :::box{title="タイトル" style="green"}    枠ボックス（plain / green / warn）
 *   :::cap{title="タイトル" color="green"}    キャプションボックス（green / dark / red / gray）
 *   :::speech{name="レイ" side="left" color="gray" avatar="/uploads/x.png"}  吹き出し
 *   ==テキスト==                               緑マーカー
 */
import { visit } from 'unist-util-visit';

const ICO = { point: '💡', warn: '⚠️', memo: '📝', check: '✅' };

// hName で任意タグに差し替えられる汎用ラッパー（blockquoteはchildrenをflowとして処理するため土台に使う）
const el = (tag, cls, children = [], props = {}) => ({
  type: 'blockquote',
  data: { hName: tag, hProperties: { className: cls, ...props } },
  children,
});
const textEl = (tag, cls, value, props = {}) => el(tag, cls, [{ type: 'text', value }], props);

export default function remarkBlocks() {
  return (tree) => {
    // ---- ==テキスト== → 緑マーカー ----
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index == null) return;
      const parts = node.value.split(/==([^=\n]+)==/g);
      if (parts.length < 3) return;
      const out = [];
      parts.forEach((v, i) => {
        if (i % 2 === 0) { if (v) out.push({ type: 'text', value: v }); }
        else out.push({ type: 'emphasis', data: { hName: 'mark', hProperties: { className: ['mk-g'] } }, children: [{ type: 'text', value: v }] });
      });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });

    // ---- :::ディレクティブ → 装飾ブロック ----
    visit(tree, 'containerDirective', (node) => {
      const a = node.attributes || {};
      const kids = node.children;

      if (ICO[node.name]) {
        node.data = { hName: 'div', hProperties: { className: ['blk-ico', `is-${node.name}`] } };
        const inner = [];
        if (a.title) inner.push(textEl('p', ['blk-ico-title'], a.title));
        inner.push(el('div', ['blk-rich'], kids));
        node.children = [
          textEl('span', ['blk-ico-badge'], ICO[node.name], { ariaHidden: 'true' }),
          el('div', ['blk-ico-inner'], inner),
        ];
        return;
      }
      if (node.name === 'box') {
        node.data = { hName: 'div', hProperties: { className: ['blk-box', `is-${a.style || 'green'}`] } };
        node.children = [...(a.title ? [textEl('p', ['blk-box-title'], a.title)] : []), ...kids];
        return;
      }
      if (node.name === 'cap') {
        node.data = { hName: 'div', hProperties: { className: ['blk-cap', `is-${a.color || 'green'}`] } };
        node.children = [
          textEl('p', ['blk-cap-title'], a.title || 'POINT'),
          el('div', ['blk-cap-body', 'blk-rich'], kids),
        ];
        return;
      }
      if (node.name === 'speech') {
        const side = a.side === 'right' ? 'right' : 'left';
        const color = a.color === 'green' ? 'green' : 'gray';
        node.data = { hName: 'div', hProperties: { className: ['blk-speech', `is-${side}`, `is-${color}`] } };
        const face = [];
        if (a.avatar) face.push(el('img', [], [], { src: a.avatar, alt: a.name || '' }));
        else face.push(textEl('span', ['noimg'], '🙂', { ariaHidden: 'true' }));
        if (a.name) face.push(textEl('p', ['blk-speech-name'], a.name));
        node.children = [
          el('div', ['blk-speech-face'], face),
          el('div', ['blk-speech-bubble', 'blk-rich'], kids),
        ];
      }
    });
  };
}
