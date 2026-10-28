# -*- coding: utf-8 -*-
"""
题库更新脚本

在 quiz-app 目录下运行，流程：
1. 从 MuMu 模拟器拉取最新题库数据库（沿用原有模拟器相关目录）
2. 导出 quiz-app 兼容的题库到 work/（data.js、img、icons、fonts）
3. 删除「本应有图片但找不到图片」的题目，并重算章节题数
4. 将 work 题库与 quiz-app/ 下所有题库（含 opt/）及图片做差分，
   新增题目与新增图片输出到 opt/YYYYMMDD-HHMMSS/
"""
import collections
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
import concurrent.futures as cf

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(BASE_DIR, 'work')
WORK_IMG = os.path.join(WORK, 'img')
OPT = os.path.join(BASE_DIR, 'opt')

# ---------- 模拟器相关目录（保持不变） ----------
ADB = os.environ.get('QUIZ_ADB', r'C:\Program Files\Netease\MuMuPlayer-12.0\shell\adb.exe')
SERIAL = '127.0.0.1:16384'
DEVICE_DB = '/data/data/com.dxjk.xw/databases/jkjlem.db'
LOCAL_DB = r'f:\daxiang\work\device\jkjlem_live.db'
ASSETS = r'f:\daxiang\work\assets'
ASSET_QUIZ = os.path.join(ASSETS, 'flutter_assets', 'assets', 'quiz')
CACHE = r'f:\daxiang\work\device\cdn'
CDN_MAP = r'f:\daxiang\work\device\cdn_map.txt'
CDN_BASE = 'https://dx-cdn.daxiangjd.com/dx/static/upload/'

IMG_EXT = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')


# ---------- 通用 ----------
def log(*args):
    print(*args, flush=True)


def load_data_js(path):
    with open(path, encoding='utf-8') as f:
        s = f.read()
    marker = 'window.QUIZ_DATA'
    i = s.find('=')
    if i < 0:
        raise ValueError('无效 data.js: ' + path)
    body = s[i + 1:].strip()
    if body.endswith(';'):
        body = body[:-1]
    return json.loads(body)


def write_data_js(path, payload):
    with open(path, 'w', encoding='utf-8') as f:
        f.write('window.QUIZ_DATA = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')


def write_diff_js(path, payload):
    """差分包数据：追加到 QUIZ_DIFF_PACKS，供 app.js 合并"""
    with open(path, 'w', encoding='utf-8') as f:
        f.write('(window.QUIZ_DIFF_PACKS = window.QUIZ_DIFF_PACKS || []).push(')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(');\n')


def write_manifest():
    """刷新 opt/manifest.js：列出所有差分包及其图片"""
    packs = []
    if os.path.isdir(OPT):
        for name in sorted(os.listdir(OPT)):
            d = os.path.join(OPT, name)
            if not os.path.isdir(d) or not os.path.exists(os.path.join(d, 'data.js')):
                continue
            images = sorted(os.path.basename(p) for p in walk_images(d))
            packs.append({'dir': name, 'images': images})
    path = os.path.join(OPT, 'manifest.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('window.QUIZ_DIFF_MANIFEST = ')
        json.dump(packs, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
        f.write('(function () {\n')
        f.write('  var m = window.QUIZ_DIFF_MANIFEST || [];\n')
        f.write('  for (var i = 0; i < m.length; i++) {\n')
        f.write("    document.write('<script src=\"opt/' + m[i].dir + '/data.js\"><\\/script>');\n")
        f.write('  }\n')
        f.write('})();\n')
    log('差分清单:', path, '共', len(packs), '个包')


def build_zip(src_dir, zip_path):
    """把目录内的图片打包成 zip（根目录存放文件名，供 app.js 直接读取）"""
    if not os.path.isdir(src_dir):
        return 0
    files = sorted(walk_images(src_dir))
    if not files:
        return 0
    tmp = zip_path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_STORED) as z:
        for p in files:
            z.write(p, os.path.basename(p))
    os.replace(tmp, zip_path)
    return len(files)


def build_zips():
    """打包基础图片与各差分包图片"""
    n = build_zip(os.path.join(BASE_DIR, 'img'), os.path.join(BASE_DIR, 'img.zip'))
    log('基础图片包:', n, '张 →', os.path.join(BASE_DIR, 'img.zip'))
    if os.path.isdir(OPT):
        for name in sorted(os.listdir(OPT)):
            d = os.path.join(OPT, name)
            if not os.path.isdir(d):
                continue
            m = build_zip(os.path.join(d, 'img'), os.path.join(d, 'img.zip'))
            if m:
                log('差分图片包:', name, m, '张')


def norm_name(n):
    n = urllib.parse.unquote(n).replace(' ', '').lower()
    while n.endswith('.jpg.jpg'):
        n = n[:-4]
    return n


def is_img(name):
    return name.lower().endswith(IMG_EXT)


def walk_images(root, skip=None):
    for dirpath, dirnames, files in os.walk(root):
        if skip:
            dirnames[:] = [d for d in dirnames if os.path.join(dirpath, d) != skip]
        for f in files:
            if is_img(f):
                yield os.path.join(dirpath, f)


def build_index(root, skip=None):
    exact, fuzzy = {}, collections.defaultdict(list)
    if not os.path.isdir(root):
        return exact, fuzzy
    for p in walk_images(root, skip):
        f = os.path.basename(p)
        exact.setdefault(f.lower(), p)
        fuzzy[norm_name(f)].append(p)
    return exact, fuzzy


# ---------- 拉取数据库 ----------
def adb(args, timeout=120):
    return subprocess.run([ADB, '-s', SERIAL] + args, capture_output=True, timeout=timeout)


def pull_db():
    os.makedirs(os.path.dirname(LOCAL_DB), exist_ok=True)
    subprocess.run([ADB, 'connect', SERIAL], capture_output=True, timeout=30)
    remote_tmp = '/sdcard/jkjlem_update.db'
    adb(['shell', 'rm', '-f', remote_tmp])

    def copy_remote():
        r = adb(['shell', 'cp', DEVICE_DB, remote_tmp])
        if r.returncode == 0 and b'No such file' not in r.stderr:
            return True
        adb(['root'])
        time.sleep(3)
        subprocess.run([ADB, 'wait-for-device'], capture_output=True, timeout=60)
        r = adb(['shell', 'cp', DEVICE_DB, remote_tmp])
        return r.returncode == 0 and b'No such file' not in r.stderr

    def check_db():
        if not os.path.exists(LOCAL_DB):
            return 'missing', set()
        try:
            con = sqlite3.connect(LOCAL_DB)
            integrity = con.execute('pragma integrity_check').fetchone()[0]
            tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
            con.close()
            return integrity, tables
        except Exception as e:
            return 'ERR ' + str(e), set()

    integrity = tables = None
    for attempt in range(3):
        if copy_remote():
            adb(['pull', remote_tmp, LOCAL_DB], timeout=300)
        else:
            # 兜底：exec-out 直接读取
            r = adb(['exec-out', 'cat', DEVICE_DB], timeout=300)
            if r.returncode == 0 and r.stdout[:16] == b'SQLite format 3\x00':
                with open(LOCAL_DB, 'wb') as f:
                    f.write(r.stdout)
        integrity, tables = check_db()
        if integrity == 'ok':
            break
        log('数据库校验失败，重试...', attempt + 1, integrity)
        time.sleep(2)
    else:
        raise RuntimeError('无法从模拟器拉取有效题库数据库: ' + str(integrity))

    log('数据库完整性:', integrity)
    if integrity != 'ok':
        raise RuntimeError('数据库完整性校验失败: ' + integrity)
    for t in ('quiz', 'quizsort', 'light'):
        if t not in tables:
            raise RuntimeError('数据库缺少数据表: ' + t)


# ---------- 导出 ----------
def export_work():
    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK_IMG)
    os.makedirs(CACHE, exist_ok=True)

    con = sqlite3.connect(LOCAL_DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    chapters = {}
    for r in cur.execute('select sort_id, sort_name, exam_type from quizsort'):
        if r['sort_name'] and r['exam_type'] in (1, 4):
            chapters[r['sort_id']] = {'name': r['sort_name'], 'exam': int(r['exam_type']), 'count': 0}

    # 图片索引：APK 资源 -> 其他资源目录 -> 现有 quiz-app 图片 -> CDN 缓存
    asset_exact, asset_fuzzy = build_index(ASSET_QUIZ)
    root_exact, root_fuzzy = build_index(ASSETS)
    existing_exact, existing_fuzzy = build_index(BASE_DIR, skip=WORK)
    cache_exact, cache_fuzzy = build_index(CACHE)
    indexes = [(asset_exact, asset_fuzzy), (root_exact, root_fuzzy),
               (existing_exact, existing_fuzzy), (cache_exact, cache_fuzzy)]

    cdn_map = {}
    if os.path.exists(CDN_MAP):
        with open(CDN_MAP, encoding='utf-8') as f:
            for line in f:
                line = line.rstrip('\n')
                if '\t' in line:
                    n, u = line.split('\t', 1)
                    cdn_map[n] = u

    resolved = {}
    missing = set()

    def resolve(name):
        raw = (name or '').strip()
        if not raw or raw == '0':
            return ''
        base = os.path.basename(raw)
        if base in resolved:
            return base
        key = base.lower()
        for exact, fuzzy in indexes:
            p = exact.get(key)
            if p:
                resolved[base] = p
                return base
            hits = fuzzy.get(norm_name(base))
            if hits:
                resolved[base] = hits[0]
                return base
        missing.add(base)
        return base

    questions = []
    seen = set()
    rows = cur.execute("""
        select sub_Id, sort_Id, sub_Titles, infos, optA, optB, optC, optD, answer,
               sub_pic, sub_type, exam_type, dtjq, jqtp
        from quiz
        where exam_type in ('1','4') and sub_Titles is not null and sub_Titles != ''
        order by sort_Id, sub_Id
    """).fetchall()
    for r in rows:
        qid = r['sub_Id']
        if qid in seen:
            continue
        seen.add(qid)
        title = (r['sub_Titles'] or '').strip()
        answer = (r['answer'] or '').strip().upper()
        if not title or not answer:
            continue
        opts = [(r[k] or '').strip() for k in ('optA', 'optB', 'optC', 'optD')]
        questions.append({
            'i': qid,
            'c': r['sort_Id'],
            'x': int(r['exam_type']),
            'y': int(r['sub_type'] or 2),
            'q': title,
            'o': [o for o in opts if o],
            'a': answer,
            'e': (r['infos'] or '').strip(),
            'k': (r['dtjq'] or '').strip(),
            'p': resolve(r['sub_pic']),
            'j': resolve(r['jqtp']),
        })

    light_count = 0
    for r in cur.execute('select * from light order by sub_Id'):
        title = (r['sub_Titles'] or '').strip()
        answer = (r['answer'] or '').strip().upper()
        if not title or not answer:
            continue
        opts = [(r[k] or '').strip() for k in ('optA', 'optB', 'optC', 'optD')]
        questions.append({
            'i': r['sub_Id'], 'c': 11, 'x': 1, 'y': 2, 'q': title,
            'o': [o for o in opts if o], 'a': answer,
            'e': (r['infos'] or '').strip(), 'k': '',
            'p': resolve(r['jqtp']), 'j': '',
        })
        light_count += 1
    chapters[11] = {'name': '灯光模拟考试', 'exam': 1, 'count': light_count}
    con.close()

    # 下载缺失图片
    need = sorted(missing)
    log('素材与缓存中未找到的图片:', len(need))

    def download(name):
        urls = []
        if name in cdn_map:
            urls.append(cdn_map[name])
        urls.append(CDN_BASE + urllib.parse.quote(name, safe=''))
        if name.lower().endswith('.jpg.jpg'):
            stem = name[:-4]
            urls.append(CDN_BASE + urllib.parse.quote(stem, safe=''))
        dst = os.path.join(CACHE, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            return name, 'cached'
        last = 'err'
        for url in dict.fromkeys(urls):
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
            except Exception as e:
                last = 'err:' + str(e)[:40]
                continue
            if not data:
                last = 'empty'
                continue
            if not (data[:3] == b'\xff\xd8\xff' or data[:8] == b'\x89PNG\r\n\x1a\n'
                    or data[:4] == b'GIF8' or data[:4] == b'RIFF'):
                last = 'badtype'
                continue
            with open(dst, 'wb') as f:
                f.write(data)
            return name, 'ok'
        return name, last

    ok = cached = fail = 0
    with cf.ThreadPoolExecutor(max_workers=16) as ex:
        for name, st in ex.map(download, need):
            if st in ('ok', 'cached'):
                resolved[name] = os.path.join(CACHE, name)
                if st == 'ok':
                    ok += 1
                else:
                    cached += 1
            else:
                fail += 1
    log('图片下载成功:', ok, '命中缓存:', cached, '失败:', fail)

    # 复制图片
    copied = 0
    for base, src in resolved.items():
        dst = os.path.join(WORK_IMG, base)
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copy2(src, dst)
        copied += 1

    # 图标与字体
    for sub in ('icons', 'fonts'):
        s = os.path.join(BASE_DIR, sub)
        d = os.path.join(WORK, sub)
        os.makedirs(d, exist_ok=True)
        if os.path.isdir(s):
            for f in os.listdir(s):
                shutil.copy2(os.path.join(s, f), os.path.join(d, f))

    # 删除缺图题目
    files = set(os.listdir(WORK_IMG))

    def has_all_images(q):
        return all((not q[f]) or q[f] in files for f in ('p', 'j'))

    removed = [q for q in questions if not has_all_images(q)]
    kept = [q for q in questions if has_all_images(q)]
    log('删除缺图题目:', len(removed))

    calc = collections.Counter(q['c'] for q in kept)
    chapter_list = []
    for cid in sorted(chapters, key=lambda c: (chapters[c]['exam'], c)):
        cnt = calc[cid]
        if cnt == 0:
            continue
        chapter_list.append({'id': cid, 'name': chapters[cid]['name'],
                             'exam': chapters[cid]['exam'], 'count': cnt})

    order = {1: 0, 4: 1}
    kept.sort(key=lambda q: (order.get(q['x'], 2), q['c'], q['i']))
    payload = {'chapters': chapter_list, 'questions': kept}
    out = os.path.join(WORK, 'data.js')
    write_data_js(out, payload)

    log('导出题目:', len(kept), '章节:', len(chapter_list), '图片:', len(files))
    log('按科目:', dict(collections.Counter(q['x'] for q in kept)))
    log('按题型:', dict(collections.Counter(q['y'] for q in kept)))
    return payload


# ---------- 差分 ----------
def diff_and_write(work_payload):
    existing_ids = set()
    bank_paths = []
    for dirpath, dirnames, files in os.walk(BASE_DIR):
        dirnames[:] = [d for d in dirnames if os.path.join(dirpath, d) != WORK]
        if 'data.js' in files:
            bank_paths.append(os.path.join(dirpath, 'data.js'))
    for p in bank_paths:
        try:
            d = load_data_js(p)
        except Exception as e:
            log('跳过无法解析的题库:', p, e)
            continue
        for q in d.get('questions', []):
            existing_ids.add(q.get('i'))

    existing_imgs = {os.path.basename(p).lower()
                     for p in walk_images(BASE_DIR, skip=WORK)}

    new_qs = [q for q in work_payload['questions'] if q['i'] not in existing_ids]
    log('现有题库:', len(bank_paths), '个题库 /', len(existing_ids), '道题 /', len(existing_imgs), '张图片')
    log('对比新增题目:', len(new_qs))
    if not new_qs:
        log('没有新增题目，不生成 opt 目录')
        return None

    counts = collections.Counter(q['c'] for q in new_qs)
    chapters = []
    for c in work_payload['chapters']:
        if counts[c['id']] > 0:
            chapters.append({'id': c['id'], 'name': c['name'], 'exam': c['exam'],
                             'count': counts[c['id']]})
    # 按科目、章节排序
    chapters.sort(key=lambda c: (c['exam'], c['id']))

    stamp = time.strftime('%Y%m%d-%H%M%S')
    opt_dir = os.path.join(OPT, stamp)
    img_dir = os.path.join(opt_dir, 'img')
    os.makedirs(img_dir, exist_ok=True)

    new_imgs = set()
    copied = 0
    for q in new_qs:
        for f in ('p', 'j'):
            name = q[f]
            if not name:
                continue
            if name.lower() in existing_imgs:
                continue
            if name in new_imgs:
                continue
            src = os.path.join(WORK_IMG, name)
            if not os.path.exists(src):
                continue
            shutil.copy2(src, os.path.join(img_dir, name))
            new_imgs.add(name)
            copied += 1

    write_diff_js(os.path.join(opt_dir, 'data.js'),
                  {'chapters': chapters, 'questions': new_qs})
    log('新增章节:', len(chapters), '新增图片:', copied)
    log('差分输出:', opt_dir)
    return opt_dir


def main():
    log('== 拉取模拟器题库 ==')
    pull_db()
    log('== 导出到 work/ ==')
    payload = export_work()
    log('== 与现有题库差分 ==')
    diff_and_write(payload)
    log('== 刷新差分包清单 ==')
    write_manifest()
    log('== 打包图片 ZIP ==')
    build_zips()
    log('完成')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log('失败:', repr(e))
        sys.exit(1)
