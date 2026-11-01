# -*- coding: utf-8 -*-
"""自检：断行/引号归位、均分、时间戳、章节切分。运行: python test_core.py"""
import tempfile
from pathlib import Path

import core


def test_split_quotes():
    para = '他说：“你好。”她答：“还行。”然后“就这样。”散了。'
    lines = core.split_para(para)
    assert "".join(lines) == para, "内容丢失"
    for ln in lines:
        assert not (len(ln) > 1 and ln[-1] in core.OPEN_Q and ln[-1] not in core.CLOSE_Q), ln
        assert not (len(ln) > 1 and ln[0] in core.CLOSE_Q and ln[0] not in core.OPEN_Q), ln


def test_cross_paragraph_opener():
    groups = core.flatten_paras(['开头说：“', '“好。”然后走了。'])
    flat = [x for g in groups for x in g]
    assert not flat[0].endswith("“"), flat
    assert flat[1].startswith("“") and flat[1].count("“") == 1, flat


def test_long_paragraph_no_stray_quotes():
    para = '“甲”说。' * 40
    lines = core.split_para(para)
    for ln in lines:
        assert not (len(ln) > 1 and ln[-1] in core.OPEN_Q and ln[-1] not in core.CLOSE_Q), ln
        assert not (len(ln) > 1 and ln[0] in core.CLOSE_Q and ln[0] not in core.OPEN_Q), ln


def test_partition():
    paras = [[f"行{i}"] for i in range(45)]
    segs = core.partition(paras, 20)
    assert sum(len(s) for s in segs) == 45
    assert all(len(s) <= 20 for s in segs), [len(s) for s in segs]
    big = core.partition([["x"] * 50], 20)          # 单段超限不拆
    assert len(big) == 1 and len(big[0]) == 50


def test_lrc_and_verify():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "a.lrc"
        core.write_lrc(p, ["第一行", "第二行", "第三行"], lead=3.0, gap=0.25)
        lines = p.read_text(encoding="utf-8").splitlines()
        assert lines[0].startswith("[00:03.000]") and lines[1].startswith("[00:03.250]")
        assert core.verify_file(p, check_audio=False) == []
        bad = Path(td) / "b.lrc"
        bad.write_text("[00:03.000]”开头就收\n[00:04.000]正常\n", encoding="utf-8")
        issues = core.verify_file(bad, check_audio=False)
        assert any("行首收引号" in i for i in issues), issues
        assert any("间距" in i for i in issues), issues


def test_txt_chapters():
    text = "序章\n开篇小段。\n第一章 打招呼\n你好。\n第二章 再见\n再见。"
    chs = core.txt_chapters(text, "测试书", split=True)
    assert [c[0] for c in chs] == ["序章", "第一章 打招呼", "第二章 再见"], chs
    assert len(core.txt_chapters(text, "测试书", split=False)) == 1
    plain = "只有正文没有章节标记。\n第二段。"
    assert len(core.txt_chapters(plain, "无章", split=True)) == 1


def test_max_lines():
    assert core.max_lines_for(3.0, 0.25, 2.0, 50.0) == 180
    assert core.max_lines_for(3.0, 0.25, 2.0, 50.0, override=300) == 300
    assert core.max_lines_for(3.0, 0.0, 2.0, 50.0) == 180


def test_epub_extract_and_split():
    """最小 epub：目录页应被跳过，序章前置，源序号被剥离。"""
    import zipfile
    with tempfile.TemporaryDirectory() as td:
        ep = Path(td) / "t.epub"
        with zipfile.ZipFile(ep, "w") as z:
            z.writestr("mimetype", "application/epub+zip")
            z.writestr("OEBPS/a.xhtml",
                       "<html><body><h1>12．第一章 起点</h1><p>" + "正文甲。" * 200 + "</p></body></html>")
            z.writestr("OEBPS/b.xhtml",
                       "<html><body><h1>序章</h1><p>" + "序章正文。" * 200 + "</p></body></html>")
            z.writestr("OEBPS/c.xhtml",
                       "<html><body><h1>目录</h1><p>" + "目录项。" * 300 + "</p></body></html>")
        d = core.extract_epub(ep)
        try:
            chs = core.find_chapters(d, "测试书", log=lambda s: None)
            titles = [t for t, _ in chs]
            assert titles == ["序章", "第一章 起点"], titles
        finally:
            import shutil
            shutil.rmtree(d, ignore_errors=True)


def test_chapter_key():
    assert core.chapter_key("序章")[0] == 0
    assert core.chapter_key("第一章")[0] == 1 and core.chapter_key("第一章")[1] == 1
    assert core.chapter_key("第234节")[1] == 234
    assert core.chapter_key("尾声")[0] == 3
    assert core.chapter_key("第一章")[1] < core.chapter_key("第二章")[1] < core.chapter_key("第十章")[1]
    assert core.chapter_key("第二章")[1] < core.chapter_key("第十章")[1]


def test_dir_chapters():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d) / "小说"
        root.mkdir()
        for name in ("第10章 风起.txt", "第2章 相遇.txt", "序章.txt", "尾声.txt"):
            (root / name).write_text(f"{name[:-4]}\n正文内容。\n", encoding="utf-8")
        (root / "第九章 缺十.txt").write_text("正文。\n", encoding="utf-8")
        chs = core.dir_chapters(root, "小说")
        titles = [t for t, _ in chs]
        assert titles == ["序章", "第2章 相遇", "第九章 缺十", "第10章 风起", "尾声"], titles
        flat = [x for g in chs[0][1] for x in g]
        assert flat == ["正文内容。"], flat        # 重复的标题行被丢掉


def test_same_title_chapters_not_merged():
    """同名/无名章节各自独立：按下标选择，转换不会把两章并成一章。"""
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "书.txt"
        src.write_text("第一章 甲\n甲正文。\n第一章 甲\n乙正文。\n", encoding="utf-8")
        chs = core.read_chapters(src)
        assert [t for t, _ in chs] == ["第一章 甲", "第一章 甲"], chs
        out = Path(td) / "out"
        seen = []
        st = core.convert_file(src, out, make_mp3=False, only=[1],
                               progress=lambda d, t: seen.append((d, t)),
                               log=lambda s: None)
        assert st["chapters"] == 1 and st["files"] == 1, st
        files = sorted((out / "书").glob("*.lrc"))
        assert [p.name for p in files] == ["1 第一章 甲.lrc"], files
        assert "乙正文" in files[0].read_text(encoding="utf-8")
        assert seen[0] == (0, 1) and seen[-1] == (1, 1), seen

        st2 = core.convert_file(src, out, make_mp3=False, log=lambda s: None)   # 不选 = 全部，仍两章
        assert st2["chapters"] == 2 and st2["files"] == 2, st2


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("ALL PASS")
