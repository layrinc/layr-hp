"""Import named coverage examples from Japan Post's official UTF-8 CSV.
Usage: python scripts/import-ltori-town-areas.py <utf_ken_all.csv> <source-date> <retrieval-date>
No network requests. Municipality pages and their established URLs are preserved.
"""
import csv
import hashlib
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_EXAMPLES = 16
NO_POSTAL_RECORD = {'01695', '01696', '01697', '01698', '01699', '01700'}
PREFERRED = {
    '24208': ['桔梗が丘１番町', '蔵持町原出', '鴻之台１番町', '平尾', '夏見', '赤目町長坂', '美旗町中１番', '百合が丘東１番町', 'つつじが丘北１番町', 'すずらん台東１番町', '梅が丘北１番町', '青蓮寺'],
    '30203': ['東家', '市脇', '橋本', '御幸辻', '三石台', 'あやの台', '紀ノ光台', '高野口町名倉', '隅田町下兵庫', '学文路', '神野々', '小峰台'],
}

def named_town(value):
    # These strings are postal instructions, not place names.
    if any(term in value for term in ('以下に掲載がない場合', '次に番地がくる場合', '一円')):
        return None
    # Parenthetical street-number/floor exceptions do not change the base town name.
    value = re.sub(r'（[^）]*）', '', value).strip()
    if not value or len(value) > 40 or re.search(r'[<>()（）]', value):
        return None
    return value

def import_areas(source, source_date, retrieved_at):
    for value in (source_date, retrieved_at):
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('Dates must be YYYY-MM-DD')
    master = json.loads((ROOT / 'src/data/ltori-area-routes.json').read_text())['areas']
    groups = json.loads((ROOT / 'src/data/ltori-prefectures.json').read_text())
    prefectures = {slug: name for group in groups for slug, name in group['prefectures']}
    content = Path(source).read_bytes()
    rows = list(csv.reader(io.StringIO(content.decode('utf-8-sig'))))
    by_code = defaultdict(list)
    for row in rows:
        if len(row) != 15 or not re.fullmatch(r'\d{5}', row[0]):
            raise ValueError('Unexpected Japan Post UTF-8 CSV format')
        by_code[row[0]].append(row)
    if len(rows) < 100000 or len(by_code) < 1800:
        raise ValueError('Incomplete national source')
    known_codes = {a['code'] for a in master}
    if set(by_code) - known_codes:
        raise ValueError('New municipality codes require route review: ' + str(sorted(set(by_code) - known_codes)))
    records = []
    for area in master:
        code = area['code']
        if code not in by_code:
            wards = [a for a in master if a['prefecture'] == area['prefecture'] and a['name'].startswith(area['name']) and a['name'] != area['name'] and a['name'].endswith('区')]
            if area['name'].endswith('市') and wards:
                records.append({'code': code, 'kind': 'wards', 'labels': [a['name'][len(area['name']):] for a in wards], 'wardCodes': [a['code'] for a in wards]})
            elif code in NO_POSTAL_RECORD:
                records.append({'code': code, 'kind': 'not-listed', 'labels': []})
            else:
                raise ValueError(f'Missing municipality: {code} {area["name"]}')
            continue
        if any(row[6] != prefectures[area['prefecture']] for row in by_code[code]):
            raise ValueError(f'Prefecture/code mismatch: {code}')
        labels = list(dict.fromkeys(name for row in by_code[code] if (name := named_town(row[8]))))
        for preferred in PREFERRED.get(code, []):
            if preferred not in labels:
                raise ValueError(f'Preferred town no longer in source: {code} {preferred}')
        # Spread examples through the source's reading order; no importance ranking implied.
        evenly_spaced = [labels[round(i * (len(labels)-1) / (MAX_EXAMPLES-1))] for i in range(MAX_EXAMPLES)] if len(labels) > MAX_EXAMPLES else labels
        examples = list(dict.fromkeys(PREFERRED.get(code, []) + evenly_spaced))[:MAX_EXAMPLES]
        records.append({'code': code, 'kind': 'towns' if labels else 'municipality', 'labels': examples, 'namedTownCount': len(labels)})
    metadata = {
        'source': '日本郵便 住所の郵便番号（1レコード1行・UTF-8形式）',
        'sourceUrl': 'https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html',
        'downloadUrl': 'https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip',
        'termsUrl': 'https://www.post.japanpost.jp/service/search/zipcode/download/readme.html',
        'sourceUpdatedAt': source_date, 'retrievedAt': retrieved_at,
        'csvSha256': hashlib.sha256(content).hexdigest(), 'sourceRows': len(rows),
        'selection': '町域表記の例を最大16件。重要度の順位ではない。郵便番号の注意書き・括弧内の番地/階数条件を除く。政令指定都市は全行政区を表示。',
        'note': '郵便番号の町域表記は公称町名を保証しない。町域データのない地域に架空の地名を補わない。',
    }
    output = ROOT / 'src/data/ltori-town-areas.json'
    output.write_text('{\n  "metadata": ' + json.dumps(metadata, ensure_ascii=False, indent=2).replace('\n', '\n  ') + ',\n  "areas": [\n' + ',\n'.join('    ' + json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in records) + '\n  ]\n}\n')
    print(json.dumps({'regions': len(records), 'kinds': {kind: sum(row['kind'] == kind for row in records) for kind in sorted({row['kind'] for row in records})}, 'exampleNames': sum(len(row['labels']) for row in records)}, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    import_areas(*sys.argv[1:])
