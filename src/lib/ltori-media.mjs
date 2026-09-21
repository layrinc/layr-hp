export const mediaPath = '/service/ltori/media/';
export const articlePath = id => `${mediaPath}${id}/`;
export const mediaInfo = { name: 'エルトリ採用ノート', tagline: '採用LINEの実務メディア', aboutPath: `${mediaPath}about/`, contactPath: `${mediaPath}contact/` };
export const categoryPath = slug => `${mediaPath}category/${slug}/`;
// Official ISOME LAB SVGs, downloaded with its built-in brand-color control.
export const mediaArtwork = {
  overview: { image: '/service/ltori/media/artwork/team.svg', tone: 'green' },
  'recruitment-flow': { image: '/service/ltori/media/artwork/team.svg', tone: 'green' },
  'follow-up': { image: '/service/ltori/media/artwork/communication.svg', tone: 'green' },
  outsourcing: { image: '/service/ltori/media/artwork/meeting.svg', tone: 'green' },
};
export const articleVisuals = {
  'recruitment-funnel': { title: '応募につながる\n採用導線のつくり方', subtitle: '求人から応募への導線整理' },
  'interview-followup': { title: '応募後の連絡と\n面接案内の設計', subtitle: '連絡・予約・面接前の案内' },
  'recruitment-line-agency': { title: '採用LINEの\n外注先を選ぶには', subtitle: '支援内容と総額の比べ方' },
};
export const readingMinutes = post => Math.max(1, Math.ceil((post.body || '').replace(/\s|[#*`>]/g, '').length / 500));
export const topics = ['採用導線', '応募後フォロー', '外注・比較'];
export const isPublished = ({ data }, now = new Date()) => !data.draft && data.date <= now;

export const topicGuides = [
  { slug: 'recruitment-flow', category: topics[0], stage: '集める・つながる', question: '求人を出しても、応募につながらない。', description: '求人の閲覧から応募までを分けて、見直す工程を探します。', checkpoints: ['求人の入口', '応募前の疑問', 'LINEへの案内'], startId: 'recruitment-funnel', introduction: 'LINEへの登録を増やす前に、候補者がどこで求人を知り、何を確認してから応募するかを整理します。求人を見てもらう施策と、接点を得たあとの情報提供を分けて考えるカテゴリーです。', checks: ['求人の表示・閲覧・応募を同じ期間で確認する', '仕事内容や勤務条件について、候補者の疑問を洗い出す', 'LINEに登録すると何が分かるかを入口に明記する'] },
  { slug: 'follow-up', category: topics[1], stage: '面接へ進む', question: '応募はあるのに、連絡が途切れる。', description: '初回連絡・予約・面接前の案内を、候補者の目線で整理します。', checkpoints: ['初回連絡', '日程調整', '面接前の案内'], startId: 'interview-followup', introduction: '応募があったあと、候補者と採用担当者の双方が次の行動を把握できる連絡を考えます。返信がない理由を決めつけず、初回連絡の内容、日程調整、面接前の案内を順に確認するカテゴリーです。', checks: ['企業名・職種・担当者と次にお願いしたい行動を伝える', '予約確定と候補日の提示を区別する', '当日の案内と変更・キャンセル方法を用意する'] },
  { slug: 'outsourcing', category: topics[2], stage: '体制を整える', question: '何を任せて、何を社内に残す？', description: '費用と担当範囲を揃えて、自社に合う構築・運用体制を考えます。', checkpoints: ['支援範囲', '費用の内訳', '担当・引き継ぎ'], startId: 'recruitment-line-agency', introduction: '構築費の安さだけでなく、日常対応、ツール料金、社内に残る仕事まで含めて比較します。内製や外注を選ぶ前に、必要な支援と責任の分担を明らかにするためのカテゴリーです。', checks: ['初期構築・月額運用・ツール費を分ける', '個別返信や素材準備の担当を確認する', '管理権限と契約終了時の引き継ぎ範囲を確認する'] },
];

export const newestFirst = (a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id, 'ja');
export const displayDate = date => date.toISOString().slice(0, 10).replaceAll('-', '.');
