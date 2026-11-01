# -*- coding: utf-8 -*-
"""小说 txt/epub → LRC + 静音MP3 转换核心（可配置参数）。
经验来源：NOVL 批量转换管线（50s/180行、段落完整性、引号归位、章节标题兜底）。
"""
import html
import math
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    import jieba
    jieba.setLogLevel(40)
except Exception:
    jieba = None  # ponytail: 无 jieba 时按硬切点断行

# ---- 引号/断句字符集 ----
OPEN_Q = "\u201c\u2018\"\u300c\u300e\uff62"          # “ ‘ " 「 『 ｢
CLOSE_Q = "\u201d\u2019\"\u300d\u300f\uff63"          # ” ’ " 」 』 ｣
SENT_PUNCT = set("。！？；!?;")
WRAP_PUNCT = set("，、：；")
CLOSE_BR = set("\u300d\u300f\uff63")
ASCII_Q = '"'

UUID_RE = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
JUNK_TITLE = re.compile(
    r"^(版权信息|版权页|目录|注释|译本序|译序|前言|序|简介|Contents?$|CONTENTS?$|"
    r"制作信息|彩插|彩页|附录|后记|封面|介绍|声明|免责|作家榜|名词释义|人物介绍)", re.I)
JUNK_CH = re.compile(r"^(版权信息|版权页|目录|注释|Landmarks?$|Table of Contents|导航)", re.I)
PROLOGUE = re.compile(r"^(序|前言|序章|写在前面的话|引言|Preface)", re.I)
ORD_PREFIX = re.compile(r"^\d+[．.˙·﹒﹑：:]+\s*")
# txt 章节标题行（行首识别，配合“行短且不以句末标点结尾”过滤）
CH_HEAD = re.compile(
    r"^\s*(序章|前言|楔子|终章|后记|尾声|"
    r"第[0-9一二三四五六七八九十百千〇零]{1,6}[章节回卷篇部])")

DEFAULTS = dict(lead=3.0, gap=0.25, tail=2.0, max_dur=50.0)


def max_lines_for(lead=3.0, gap=0.25, tail=2.0, max_dur=50.0, override=None):
    if override:
        return max(1, int(override))
    if gap <= 0:
        return 180
    return max(1, int((max_dur - lead - tail) / gap))


def _nkey(s):
    """自然排序：chapter2 < chapter10"""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", str(s))]


def read_text(path):
    """UTF-8 优先，失败回退 gb18030（中文 txt 常见编码），再不行 replace。"""
    b = Path(path).read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", errors="replace")


# ---- 章节标题 ----
def clean_title(m: re.Match) -> str:
    t = re.sub(r"<[^>]+>", "", m.group(0))
    t = html.unescape(t)
    if "part:number" in t:
        m2 = re.search(r"title\s*=\s*([^\s>]+)", t)
        if m2:
            t = m2.group(1)
    t = t.replace("\u00a0", " ").replace("\u3000", "")
    t = ORD_PREFIX.sub("", t)                      # 去掉源序号，文件名只留 “N 标题”
    t = re.sub(r'[<>:"/\\|?*]', "_", t)
    return re.sub(r"\s+", " ", t).strip()


def get_chapters(path: Path, book_name: str = ""):
    """单个 html/xhtml：按 h1-h6 分区；无标题时用 <title>/首段章名/书名兜底。"""
    src = read_text(path)
    doc_title = ""
    mt = re.search(r"<title>(.*?)</title>", src, re.S | re.I)
    if mt:
        doc_title = clean_title(mt)
    heads = list(re.finditer(r"<h[1-6][^>]*>.*?</h[1-6]>", src, re.S))
    if not heads:
        body_clean = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", src)).strip()
        if doc_title and len(body_clean) >= 1000 and not JUNK_TITLE.match(doc_title.strip()):
            # 首段即章名（如“第一章：回信放在牛奶箱 １”）→ 用作标题，re.search 非 match
            plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", src[:3000]))).strip()
            m3 = re.search(r"(第[0-9一二三四五六七八九十百]+章[：:][^ 　]{2,20})(?:[ 　]+[0-9０-９]+)?", plain)
            if m3:
                return [(m3.group(1), src)]
            if UUID_RE.fullmatch(doc_title):       # calibre 占位 UUID 标题 → 书名兜底
                return [(book_name or doc_title, src)]
            return [(doc_title, src)]
        return []
    regions = [(clean_title(m), m.group(0), m.end()) for m in heads]
    dividers = []
    for i, (title, raw, bstart) in enumerate(regions):
        if i == 0:
            dividers.append(i)
        elif not re.fullmatch(r"\d+", title.strip()):   # 纯数字标题（1、2、3…）不当章节头
            end = regions[i + 1][2] if i + 1 < len(regions) else len(src)
            seg = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", src[bstart:end])).strip()
            if len(seg) >= 1000:
                dividers.append(i)
    if not dividers:
        return []
    out = []
    for k, idx in enumerate(dividers):
        raw, title = regions[idx][1], regions[idx][0]
        if "part:number" in raw:
            ht = html.unescape(re.sub(r"<[^>]+>", "", raw))
            m2 = re.search(r"title\s*=\s*([^/>]+)", ht)
            if m2:
                title = re.sub(r'[<>:"/\\|?*]', "_", m2.group(1).strip())
        if not title:
            title = doc_title
        bstart = regions[idx][2]
        end = regions[dividers[k + 1]][2] if k + 1 < len(dividers) else len(src)
        if JUNK_CH.match(title.strip()):
            continue
        body = src[bstart:end]
        seg = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", body)).strip()
        if not seg:
            if re.search(r"第[一二三四五六七八九十〇0-9]+部", title):
                out.append((title, ""))            # 分部扉页 → 空体信号
            continue
        if not title:
            title = book_name or "（无标题）"      # 无名章节也保留，不再静默丢弃
        out.append((title, body))
    return out


def find_chapters(book_dir: Path, book_name: str = "", log=print):
    """递归扫描 html/xhtml（排除封面），自然排序 → 章节列表 [(title, groups)]。"""
    files = [p for ext in ("*.html", "*.htm", "*.xhtml") for p in book_dir.rglob(ext)]
    files = [p for p in files if "titlepage" not in p.name and "cover" not in p.name]
    files = sorted(files, key=lambda p: _nkey(p.name))
    chapters, skipped = [], []
    cur_part = ""
    for f in files:
        chs = get_chapters(f, book_name or book_dir.name)
        if not chs:
            skipped.append(f.name)
            continue
        for title, body in chs:
            if not body:
                m = re.search(r"第[一二三四五六七八九十〇0-9]+部", title)
                cur_part = m.group(0) if m else ""   # 分部扉页信号
                continue
            if cur_part:
                title = f"{cur_part}·{title}"
            plines = flatten_paras(html_to_paragraphs(body))
            if plines:
                chapters.append((title, plines))
    if skipped:
        log(f"    跳过无标题文件: {', '.join(skipped)}")
    # 前言类章（序/前言/序章…）无论源文件顺序都移到最前（按位置移动，同名的也各自保留）
    is_front = [bool(PROLOGUE.match(ORD_PREFIX.sub("", c[0]).strip())) for c in chapters]
    if any(is_front):
        chapters = ([c for c, f in zip(chapters, is_front) if f]
                    + [c for c, f in zip(chapters, is_front) if not f])
        log(f"    前言前置: {sum(is_front)} 章")
    return chapters


def txt_chapters(text: str, book_name: str, split: bool = True):
    """txt → 章节。split=True 时按行首“第N章/序章/…”切章；找不到章名则整本一章。"""
    paras = [l.strip() for l in text.splitlines() if l.strip()]
    if not split:
        return [(book_name, flatten_paras(paras))] if paras else []
    chapters, cur, title = [], [], book_name
    for p in paras:
        is_head = (len(p) <= 40 and CH_HEAD.match(p)
                   and (not p or p[-1] not in SENT_PUNCT))
        if is_head:
            if cur:
                chapters.append((title, flatten_paras(cur)))
                cur = []
            title = p
        else:
            cur.append(p)
    if cur:
        chapters.append((title, flatten_paras(cur)))
    if len(chapters) <= 1:      # 没识别出章节结构 → 整本一章
        return [(book_name, flatten_paras(paras))]
    return chapters


CN_NUM = {"零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
          "六": 6, "七": 7, "八": 8, "九": 9}


def cn2int(s: str) -> int:
    """中文数字 → int（到千位够章节号用）：二百三十四 → 234。"""
    if s.isdigit():
        return int(s)
    got, unit = 0, 0
    for c in s:
        if c in CN_NUM:
            unit = CN_NUM[c]
        elif c in ("十", "百", "千"):
            got += (unit or 1) * {"十": 10, "百": 100, "千": 1000}[c]
            unit = 0
    return got + unit


def chapter_key(title: str):
    """章节排序键：序/前言最前(0) → 第N章按数字(1) → 其它(2) → 尾声/番外最后(3)。"""
    t = ORD_PREFIX.sub("", str(title)).strip()
    if PROLOGUE.match(t):
        return (0, _nkey(t))
    m = re.search(r"第\s*([0-9一二三四五六七八九十百千零〇]+)\s*[章节回卷篇]", t)
    if m:
        return (1, cn2int(m.group(1)), _nkey(t))
    if re.match(r"^(终章|后记|尾声|番外|完结|附录)", t):
        return (3, _nkey(t))
    return (2, _nkey(t))


def dir_chapters(folder, book_name=""):
    """txt 小说文件夹：一个 txt = 一个章节，按 chapter_key 排序（序章→第N章→尾声）。"""
    out = []
    for p in sorted(Path(folder).glob("*.txt"), key=lambda q: chapter_key(q.stem)):
        paras = [l.strip() for l in read_text(p).splitlines() if l.strip()]
        if paras and len(paras[0]) <= 40 and (paras[0] == p.stem.strip()
                                              or CH_HEAD.match(paras[0])):
            paras = paras[1:]                    # 首行就是章名，别在正文里重复一遍
        if paras:
            out.append((p.stem.strip(), flatten_paras(paras)))
    return out


def extract_epub(epub_path) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="lrc_epub_"))
    with zipfile.ZipFile(epub_path) as z:
        z.extractall(tmp)
    return tmp


# ---- HTML → 段落 ----
def html_to_paragraphs(body: str):
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    body = re.sub(r"</?(?:p|div|h[12]|blockquote|li)[^>]*>", "\n", body, flags=re.I)
    body = html.unescape(re.sub(r"<[^>]+>", "", body))
    return [t for seg in body.split("\n") if (t := re.sub(r"\s+", " ", seg).strip())]


def split_para(para: str):
    """段落 → 行列表（≤60 字断行，引号深度跟踪，断点处引号归位）。"""
    n = len(para)
    depth = [0] * (n + 1)
    d = 0
    for i, c in enumerate(para):
        depth[i] = d
        if c in OPEN_Q:
            d += 1
        elif c in CLOSE_Q and d > 0:
            d -= 1
    depth[n] = d

    def bad_next(k: int) -> bool:
        nxt = para[k] if k < n else ""
        return nxt in OPEN_Q or nxt in CLOSE_Q

    sents = set("。；") if "<" in para else SENT_PUNCT
    lines, i = [], 0
    while i < n:
        limit = min(i + 60, n)
        cut = None
        j = i
        while j < limit:
            if depth[j] == 0 and (para[j] in sents or para[j] == "\u2026"):
                k2 = j
                while k2 < n and (para[k2] in sents or para[k2] == "\u2026" or para[k2] in CLOSE_BR):
                    k2 += 1
                if not bad_next(k2):
                    cut = k2
                    break
            j += 1
        if cut is None and n > limit:                    # 回退：标点断点
            k = limit - 1
            while k > i + 10:
                if depth[k] == 0 and para[k] in WRAP_PUNCT and not bad_next(k + 1):
                    cut = k + 1
                    break
                k -= 1
        if cut is None and n > limit:                    # 再回退：jieba 词边界
            if jieba:
                words = jieba.lcut(para[i:limit])
                pos = limit
                for w in reversed(words):
                    pos -= len(w)
                    if pos > i + 10 and depth[pos] == 0 and not bad_next(pos):
                        cut = pos
                        break
        if cut is None:
            cut = limit
        if i < cut < n:                                  # 断点引号归位
            cb, ca = para[cut - 1], para[cut]
            if cb == ASCII_Q and depth[cut - 1] == 0:
                cut += 1
            elif cb in OPEN_Q and cb not in CLOSE_Q and cut - 1 > i:
                cut -= 1
            if cut < n:
                ca = para[cut]
                if ca == ASCII_Q and depth[cut] > 0:
                    cut -= 1
                elif ca in CLOSE_Q and ca not in OPEN_Q:
                    cut += 1
        lines.append(para[i:cut])
        i = cut
    merged = []
    for ln in lines:
        if len(ln) == 1 and ln in OPEN_Q + CLOSE_Q and merged:
            merged[-1] += ln
        else:
            merged.append(ln)
    # 行尾不留纯开头引号（ASCII " 歧义，排除）
    for idx in range(len(merged) - 1):
        ln = merged[idx]
        if len(ln) > 1 and ln[-1] in OPEN_Q and ln[-1] not in CLOSE_Q:
            merged[idx] = ln[:-1]
            merged[idx + 1] = ln[-1] + merged[idx + 1]
    return merged


def flatten_paras(paras):
    """段落列表 → 段落组列表（每组=行列表）。段组间修引号：上段尾纯开引 → 移到下段行首。"""
    groups = [ln for p in paras if (ln := split_para(p))]
    for gi in range(len(groups) - 1):
        a, b = groups[gi], groups[gi + 1]
        while a and a[-1] and a[-1][-1] in OPEN_Q and a[-1][-1] not in CLOSE_Q:
            op = a[-1][-1]
            a[-1] = a[-1][:-1]
            if not (b and b[0].startswith(op)):
                b[0] = op + b[0]
            if not a[-1]:
                a.pop()
    return groups


def partition(paras_lines, max_lines):
    """段落均分到文件：超限切 k=ceil(总行/上限) 份，切点在段落边界且尽量等分；单段超限不拆。"""
    def cut(idxs):
        total = sum(len(paras_lines[i]) for i in idxs)
        if total <= max_lines or len(idxs) == 1:
            return [idxs]
        k = math.ceil(total / max_lines)
        ideal = total / k
        parts, cur, cum, m = [], [], 0, 1
        for idx in idxs:
            p = paras_lines[idx]
            if cur and m < k and cum + len(p) >= ideal * m:
                parts.append(cur)
                cur = []
                m += 1
            cur.append(idx)
            cum += len(p)
        if cur:
            parts.append(cur)
        out = []
        for sub in parts:
            out.extend(cut(sub))
        return out

    return [[ln for idx in idxs for ln in paras_lines[idx]]
            for idxs in cut(list(range(len(paras_lines))))]


# ---- 输出 ----
def fmt(t: float) -> str:
    return f"[{int(t) // 60:02d}:{t % 60:06.3f}]"


def write_lrc(path: Path, lines, lead=3.0, gap=0.25):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for i, ln in enumerate(lines):
            f.write(fmt(lead + gap * i) + ln + "\n")


def audio_dur(need: float) -> float:
    """ffmpeg 实际时长 ≥ -t 值；多留 0.2s 余量免探针（verify 会用 ffprobe 复核）。"""
    return math.ceil((need + 0.2) * 10) / 10


NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)   # 否则每转一个文件闪一次黑窗


def bin_path(name: str) -> str:
    """ffmpeg/ffprobe 查找顺序：exe 同级 → exe 同级 bin 目录 → PATH（打包后用户不必装环境变量）。"""
    here = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    for d in (here, here / "bin"):
        p = d / (name + ".exe")
        if p.exists():
            return str(p)
    return shutil.which(name) or name


def make_audio(path: Path, dur: float):
    subprocess.run(
        [bin_path("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "anullsrc=r=11025:cl=mono",
         "-t", f"{dur}", "-b:a", "8k", "-ac", "1", "-ar", "11025", str(path)],
        check=True, creationflags=NO_WINDOW)


# ---- 主转换 ----
def book_of(path) -> str:
    """书名：文件名去掉 " (来源)" 后缀。扫描和转换必须用同一个，否则标题对不上。"""
    stem = Path(path).stem
    return stem.split(" (")[0].strip() or stem


def read_chapters(input_path, book_name="", mode="chapter", log=print):
    """只解析不输出，返回 [(章节标题, 段落组)]，供 convert_file 与界面预览共用。"""
    input_path = Path(input_path)
    # ponytail: epub 每次解析都新解一份到临时目录；重复扫描会留临时目录，需要时再缓存
    if input_path.is_dir():                 # txt 小说文件夹 = 一本书
        return dir_chapters(input_path, book_name or input_path.name)
    if input_path.suffix.lower() == ".epub":
        return find_chapters(extract_epub(input_path), book_name or book_of(input_path), log)
    return txt_chapters(read_text(input_path), book_name or book_of(input_path),
                        split=(mode == "chapter"))


def convert_file(input_path, out_root, *, book_name="", mode="chapter",
                 lead=3.0, gap=0.25, tail=2.0, max_dur=50.0, max_lines=None,
                 make_mp3=True, only=None, progress=None, log=print) -> dict:
    """单文件/文件夹转换。mode: chapter=按章节 / whole=整本书。
    only: None=全部；整数列表=按章节下标（0 起，顺序即编号顺序，同名/无名章节各自独立）；
          标题列表=按标题过滤（同名会一起选中，界面已改用下标）。
    progress: 可选回调 progress(已完成章数, 总章数)。返回统计 dict。"""
    input_path = Path(input_path)
    out_root = Path(out_root)
    if not book_name:
        book_name = book_of(input_path)
    if make_mp3 and not Path(bin_path("ffmpeg")).exists() and not shutil.which(bin_path("ffmpeg")):
        raise RuntimeError("未找到 ffmpeg，无法生成 MP3（可关闭“生成MP3”仅输出 LRC，"
                           "或把 ffmpeg.exe 放到程序同级的 bin\\ 目录）")
    ml = max_lines_for(lead, gap, tail, max_dur, max_lines)

    # 一律按章节读，下标才稳定；整本模式在选完章节后再合并
    chapters = read_chapters(input_path, book_name, "chapter", log)
    if only is not None:
        if all(isinstance(i, int) for i in only):    # 下标选择：同名章节不会串
            chapters = [chapters[i] for i in only if 0 <= i < len(chapters)]
        else:
            titles = set(only)
            chapters = [(t, g) for t, g in chapters if t in titles]
            if isinstance(only, (list, tuple)):      # 界面里手动排过序 → 照它的顺序编号
                idx = {t: i for i, t in enumerate(only)}
                chapters.sort(key=lambda c: idx[c[0]])
    if mode == "whole":
        groups = [g for _, gs in chapters for g in gs]
        chapters = [(book_name, groups)] if groups else []
    if not chapters:
        raise RuntimeError(f"未从 {input_path.name} 提取到任何章节")

    out = out_root / book_name
    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("*.lrc")) + list(out.glob("*.mp3")):
        old.unlink()                                  # 清掉旧产物，避免残留混序
    seq = nl = 0
    if progress:
        progress(0, len(chapters))
    for k, (title, groups) in enumerate(chapters, 1):
        for seg in partition(groups, ml):
            seq += 1
            nl += len(seg)
            need = lead + gap * len(seg) + tail
            base = f"{seq} {title}"
            write_lrc(out / f"{base}.lrc", seg, lead, gap)
            if make_mp3:
                make_audio(out / f"{base}.mp3", audio_dur(need))
        if progress:
            progress(k, len(chapters))
    log(f"  {book_name}: {len(chapters)} 章 → {seq} 个文件 / {nl} 行 → {out}")
    return dict(book=book_name, out=str(out), chapters=len(chapters),
                files=seq, lines=nl)


# ---- 校验（深度感知，避免 ASCII " 成对误报）----
TS = re.compile(r"^\[(\d+):(\d{2}\.\d{3})\](.*)$")


def probe_dur(path: Path):
    try:
        out = subprocess.run(
            [bin_path("ffprobe"), "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True,
            creationflags=NO_WINDOW).stdout.strip()
        return float(out)
    except Exception:
        return None


def verify_file(lrc: Path, lead=3.0, gap=0.25, tail=2.0, check_audio=True):
    issues = []
    try:
        txt = lrc.read_text(encoding="utf-8").splitlines()
    except Exception as e:
        return [f"读取失败: {e}"]
    prev = None
    for i, line in enumerate(txt, 1):
        m = TS.match(line)
        if not m:
            issues.append(f"L{i}|格式错误")
            continue
        t = int(m.group(1)) * 60 + float(m.group(2))
        body = m.group(3)
        if i == 1 and abs(t - lead) > 0.001:
            issues.append(f"L{i}|首行≠前奏({t})")
        if prev is not None and abs(t - (prev + gap)) > 0.001:
            issues.append(f"L{i}|间距({prev:.3f}→{t:.3f})")
        prev = t
        if body:
            # 只查无歧义的 CJK 引号；ASCII " 成对会跨行，深度感知校验代价大 → 排除
            if body[0] in CLOSE_Q and body[0] not in OPEN_Q:
                issues.append(f"L{i}|行首收引号")
            if body[-1] in OPEN_Q and body[-1] not in CLOSE_Q:
                issues.append(f"L{i}|行尾开引号")
            if len(body) > 61:
                issues.append(f"L{i}|超长{len(body)}")
    if prev is None:
        issues.append("空文件")
    elif check_audio:
        mp3 = lrc.with_suffix(".mp3")
        if mp3.exists():
            dur = probe_dur(mp3)
            if dur is not None and dur < prev + tail - 0.01:
                issues.append(f"音频短({dur:.2f} < {prev + tail:.2f})")
        else:
            issues.append("缺mp3")
    return issues


def verify_dir(out_dir, lead=3.0, gap=0.25, tail=2.0, check_audio=True, log=print):
    """校验一本书的输出目录。返回 (文件数, 行数, 问题列表)。"""
    out_dir = Path(out_dir)
    lrcs = sorted(out_dir.glob("*.lrc"), key=lambda p: _nkey(p.name))
    total_lines = 0
    all_issues = []
    for lrc in lrcs:
        total_lines += len(lrc.read_text(encoding="utf-8").splitlines())
        for msg in verify_file(lrc, lead, gap, tail, check_audio):
            all_issues.append(f"{lrc.name}|{msg}")
    if all_issues:
        log(f"  校验: {len(lrcs)} 文件 / {total_lines} 行 / 问题 {len(all_issues)}")
        for s in all_issues[:20]:
            log(f"    ! {s}")
        if len(all_issues) > 20:
            log(f"    … 其余 {len(all_issues) - 20} 条省略")
    else:
        log(f"  校验: {len(lrcs)} 文件 / {total_lines} 行 / 0 问题 ✓")
    return len(lrcs), total_lines, all_issues


def cli():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    opts = dict(mode="chapter", make_mp3=True, do_verify=True, out=None)
    inputs = []
    it = iter(range(len(args)))
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--whole":
            opts["mode"] = "whole"
        elif a == "--no-mp3":
            opts["make_mp3"] = False
        elif a == "--no-verify":
            opts["do_verify"] = False
        elif a == "--out":
            i += 1
            opts["out"] = args[i]
        else:
            inputs.append(a)
        i += 1
    if not inputs:
        print("用法: python core.py <书.txt|书.epub>... [--out 目录] [--whole] [--no-mp3] [--no-verify]")
        return 1
    outs = []
    for p in inputs:
        out_root = Path(opts["out"]) if opts["out"] else Path(p).resolve().parent
        st = convert_file(p, out_root, mode=opts["mode"], make_mp3=opts["make_mp3"])
        if opts["do_verify"]:
            verify_dir(st["out"], check_audio=opts["make_mp3"])
        outs.append(st)
    print(f"完成 {len(outs)} 本，共 {sum(s['files'] for s in outs)} 个文件 / {sum(s['lines'] for s in outs)} 行")
    return 0


if __name__ == "__main__":
    raise SystemExit(cli())
