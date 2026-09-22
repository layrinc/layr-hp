/** Public, deterministic recruitment LINE planning aid. No personal data or ROI estimates. */
export const diagnosisPath = '/service/ltori/diagnosis/';

export const diagnosisQuestions = [
  { key: 'industry', title: '募集するお仕事に近い業種は？', choices: [
    ['manufacturing', '製造'], ['care', '介護・福祉'], ['logistics', '物流・運送'], ['construction', '建設・設備'], ['other', 'その他'],
  ] },
  { key: 'goal', title: '今後1年の採用予定人数は？', choices: [
    ['small', '1〜5名'], ['medium', '6〜20名'], ['large', '21名以上'], ['undecided', 'これから決める'],
  ] },
  { key: 'source', title: '現在、主にどこから応募が届きますか？', choices: [
    ['media', '求人媒体'], ['owned', '自社サイト・SNS'], ['referral', '紹介・人材紹介'], ['mixed', '複数の経路・まだ未定'],
  ] },
  { key: 'bottleneck', title: '最初に整えたいのは、どの工程ですか？', choices: [
    ['awareness', '応募前の企業理解・接点づくり'], ['contact', '応募後の返信・連絡'], ['schedule', '面接予約・当日の案内'], ['prejoin', '内定後・入社前のフォロー'],
  ] },
  { key: 'line', title: '採用でのLINE利用状況は？', choices: [
    ['new', 'まだ利用していない'], ['using', '利用していて、改善したい'], ['stalled', 'アカウントはあるが活用できていない'],
  ] },
];

const industryGuides = {
  manufacturing: { focus: '職種ごとの仕事内容、交替勤務の有無、職場見学の流れを分けて案内します。', topic: '担当する工程・勤務時間・職場見学', question: '製造のお仕事について、担当工程や勤務時間で気になることはありますか？' },
  care: { focus: '必要資格、勤務シフト、入職後の研修について、確認できる情報をまとめます。', topic: '必要資格・勤務シフト・入職後の研修', question: '必要資格や勤務シフト、入職後の研修について、確認したいことはありますか？' },
  logistics: { focus: '担当する配送、必要免許、勤務時間を職種別に示し、条件の確認につなげます。', topic: '配送内容・必要免許・勤務時間', question: '配送内容や必要な免許、勤務時間について、気になることを教えてください。' },
  construction: { focus: '担当する現場、必要資格、移動や勤務の条件を具体的に案内します。', topic: '現場での仕事内容・資格・勤務条件', question: '現場での仕事内容や必要資格、勤務条件について、確認したいことはありますか？' },
  other: { focus: '募集職種ごとに仕事内容、勤務条件、入社後のサポートを整理します。', topic: '仕事内容・勤務条件・入社後のサポート', question: '仕事内容や勤務条件、入社後のサポートについて、確認したいことはありますか？' },
};

const stageGuides = {
  awareness: {
    title: '応募前の疑問に答える、企業理解の導線から。',
    reason: 'すぐに応募を決められない方が、仕事内容を知り、質問できる接点を用意します。',
    flow: ['採用サイト・SNSで案内', '希望職種を確認', '仕事・職場の情報を配信', '質問・応募へ案内'],
    first: ['募集職種ごとに、応募前によく聞かれる質問を集める', '仕事内容・勤務条件を確認できる案内を準備する', 'LINEから質問・応募へ進める場所を一つずつ用意する'],
    metrics: ['LINEへの案内クリック', '職種別の情報閲覧・タップ', '応募・相談の完了'],
    timing: '友だち追加後の案内例',
    message: '友だち追加ありがとうございます。採用担当です。まずは興味のある職種をお選びください。仕事内容をご紹介します。気になることは、このトークからご質問いただけます。',
    buttons: ['仕事内容を見る', '採用担当に質問する'],
    guide: 'recruitment-flow',
  },
  contact: {
    title: '応募後の連絡を、担当者につながる流れへ。',
    reason: '受付の案内と個別対応を分け、応募者が次に何をすればよいか分かる状態をつくります。',
    flow: ['応募受付', '次の手順を案内', '希望職種・連絡希望を確認', '担当者が個別対応'],
    first: ['応募受付から担当者の返信までの手順を整理する', '受付メッセージに、返信の目安と次の手順を記載する', '個別回答が必要な内容の担当者と対応時間を決める'],
    metrics: ['応募受付数', '担当者の初回対応までの時間', '次の選考に進んだ件数'],
    timing: '応募受付後の案内例',
    message: 'ご応募ありがとうございます。採用担当です。今後の流れをご案内します。確認事項は担当者が順次お返事します。連絡を受け取りやすい時間帯や、先に確認したいことがあれば教えてください。',
    buttons: ['選考の流れを確認する', '質問・連絡希望を送る'],
    guide: 'follow-up',
  },
  schedule: {
    title: '面接の日程と当日の案内を、一つの流れに。',
    reason: '日程の確認、変更、当日の連絡先までをまとめて、候補者が迷わず連絡できるようにします。',
    flow: ['面接候補日を案内', '予約・日程確定', '前日までに詳細を案内', '変更・当日の連絡に対応'],
    first: ['予約方法と日程変更の窓口を決める', '場所・持ち物・連絡先を一つの案内にまとめる', '予約した方だけに案内が届く設定を確認する'],
    metrics: ['面接予約の完了数', '予約に対する面接実施率', '日程変更・キャンセルの連絡数'],
    timing: '面接前の案内例',
    message: 'ご予約いただいた面接のご案内です。日時・場所・持ち物は下のボタンからご確認いただけます。ご都合が変わった場合や、当日お困りの際は、このトークからお知らせください。',
    buttons: ['面接の詳細を見る', '日程変更・連絡をする'],
    guide: 'follow-up',
  },
  prejoin: {
    title: '内定後の確認事項を、相談できる接点へ。',
    reason: '入社までに必要な準備と、担当者へ相談できる場所を用意し、確認漏れを減らします。',
    flow: ['連絡方法を確認', '入社までの予定を案内', '準備・質問を確認', '初日の案内と個別フォロー'],
    first: ['入社までに必要な案内と手続きを一覧にする', '送る時期と、返信が必要な案内を整理する', '相談窓口を決め、未確認の方へ個別に連絡する'],
    metrics: ['案内への確認・返信数', '未完了の手続き件数', '入社予定者に対する入社者数'],
    timing: '入社前の案内例',
    message: '入社に向けた準備についてご案内します。初日の集合場所・持ち物と、事前に確認いただきたい内容をまとめました。気になることや準備で困っていることは、採用担当までご相談ください。',
    buttons: ['入社初日の案内を見る', '準備について相談する'],
    guide: 'follow-up',
  },
};

function validAnswers(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const answers = {};
  for (const question of diagnosisQuestions) {
    const value = input[question.key];
    if (typeof value !== 'string' || !question.choices.some(([key]) => key === value)) return null;
    answers[question.key] = value;
  }
  return answers;
}

export function diagnosisCode(input) {
  const answers = validAnswers(input);
  return answers ? diagnosisQuestions.map(question => answers[question.key]).join('.') : '';
}

export function diagnosisFromCode(code) {
  if (typeof code !== 'string' || code.length > 120) return null;
  const values = code.split('.');
  if (values.length !== diagnosisQuestions.length) return null;
  return validAnswers(Object.fromEntries(diagnosisQuestions.map((question, index) => [question.key, values[index]])));
}

export function createDiagnosis(input) {
  const answers = validAnswers(input);
  if (!answers) return null;
  const stage = stageGuides[answers.bottleneck];
  const industry = industryGuides[answers.industry];
  const sourceAdvice = {
    media: '求人媒体からLINEへの案内は、媒体で認められた範囲で設置します。応募情報の転記と重複連絡を避ける運用も確認します。',
    owned: '採用サイト・SNSごとにLINEへの入口を分け、どの案内から応募につながったかを確認できるようにします。',
    referral: '紹介元との役割を確認し、本人が希望する連絡方法で案内します。紹介元と自社からの連絡が重ならないよう整理します。',
    mixed: 'まず一つの募集職種・応募経路で運用を整理し、対応できることを確認してから他の入口へ広げます。',
  }[answers.source];
  const scaleAdvice = {
    small: '少人数の採用では、自動化を増やしすぎず、受付案内と担当者の個別対応から始めます。',
    medium: '職種ごとの案内と担当者への引き継ぎを分け、複数の応募者にも同じ基準で対応できるようにします。',
    large: '職種・拠点・選考段階の管理方法を決め、既存の採用管理システムとの役割分担を確認します。',
    undecided: '募集する職種と採用時期を決め、一つの採用フローで必要な連絡を整理するところから始めます。',
  }[answers.goal];
  const setupAdvice = {
    new: '採用専用アカウントの利用範囲と、担当者が返信する時間を決めてから構築します。',
    using: '現在の配信・タグ・応募導線を確認し、既存の候補者への案内が重複しないよう改善します。',
    stalled: '既存の登録者へ連絡できる範囲、古い案内や動かないリンクを確認してから運用を再開します。',
  }[answers.line];
  return {
    answers, code: diagnosisCode(answers), ...stage, industry: industry.focus,
    topic: industry.topic, question: industry.question,
    preparation: [sourceAdvice, scaleAdvice, setupAdvice],
    labels: diagnosisQuestions.map(question => ({ question: question.title, answer: question.choices.find(([key]) => key === answers[question.key])[1] })),
  };
}

/** URL codes are a fixed vocabulary; never put user-entered text in contact URLs or analytics. */
export function diagnosisSummary(input) {
  const result = createDiagnosis(input);
  if (!result) return '';
  return ['【採用LINE活用診断】', ...result.labels.map(item => `${item.question} ${item.answer}`), `最初に整える導線：${result.title}`, `業種に合わせた準備：${result.industry}`, 'この診断結果をもとに、採用LINEの活用について相談したいです。'].join('\n');
}

export function safeDiagnosisSource(value) {
  if (typeof value !== 'string' || value.length > 120) return 'diagnosis';
  return /^(?:diagnosis|media|media\/[a-z0-9]+(?:-[a-z0-9]+)*|area|area\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)$/.test(value) ? value : 'diagnosis';
}

export function diagnosisContactHref(input, source = 'diagnosis') {
  const code = diagnosisCode(input);
  if (!code) return '';
  const params = new URLSearchParams({service: 'ltori', source: safeDiagnosisSource(source), diagnosis: code});
  return `/contact/?${params}`;
}
