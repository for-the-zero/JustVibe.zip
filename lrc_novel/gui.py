import os
import queue
import sys
import threading
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, ttk

import core

try:                                    # 拖放支持，缺了也不影响其它功能
    from tkinterdnd2 import TkinterDnD, DND_FILES
except ImportError:                     # pragma: no cover
    TkinterDnD, DND_FILES = None, None

F = ("Microsoft YaHei UI", 9)
BOX = ("☐", "☑")            # 未选 / 已选


def _num(var, name, lo=0):
    try:
        v = float(var.get().strip())
    except ValueError:
        raise ValueError(f"{name} 必须是数字：{var.get()!r}")
    if v < lo:
        raise ValueError(f"{name} 不能小于 {lo}")
    return v


class App((TkinterDnD.Tk if TkinterDnD else tk.Tk)):
    def __init__(self):
        super().__init__()
        self.title("小说转 LRC")
        self.geometry("1000x700")
        ttk.Style(self).configure(".", font=F)          # ttk 控件统一字体
        self.q = queue.Queue()
        self.busy = False
        self.files: list[str] = []
        self.use: dict[str, bool] = {}                  # 路径 -> 是否要转换
        self.chaps: dict[str, list[str]] = {}          # 路径 -> 章节标题（含同名）
        self.pick: dict[str, list[bool]] = {}          # 路径 -> 每章是否勾选
        self.oids: dict[str, list[int]] = {}           # 路径 -> 每行对应的原始章节下标
        self.full: dict[str, list] = {}                # 路径 -> [(标题, 段落组)] 供预览
        self.cur = ""                                   # 当前右侧显示的文件

        self.out_dir = tk.StringVar(value=str(Path.home() / "Desktop"))
        self.book_name = tk.StringVar()
        self.mode = tk.StringVar(value="chapter")
        self.lead = tk.StringVar(value="3.0")
        self.gap = tk.StringVar(value="0.25")
        self.tail = tk.StringVar(value="2.0")
        self.max_dur = tk.StringVar(value="50.0")
        self.max_lines = tk.StringVar(value="0")
        self.mp3 = tk.BooleanVar(value=True)
        self.do_verify = tk.BooleanVar(value=True)
        self.status = tk.StringVar(value="就绪")

        self._build()
        self.after(100, self._poll)
        if DND_FILES:                    # 整个窗口都能接收拖放
            self.drop_target_register(DND_FILES)
            self.dnd_bind("<<Drop>>", self.on_drop)
        # pythonw 没有 stderr，回调里抛异常会静默消失（用户只看到"点了没反应"）。
        sys.excepthook = self._crash

    def _crash(self, exc_type, exc, tb):
        """Tk 回调异常 → 日志面板，别再无声消失。"""
        self.put("✗ 界面回调出错：" + "".join(
            traceback.format_exception(exc_type, exc, tb)).rstrip())
        try:
            self.status.set(f"出错：{exc}")
        except tk.TclError:
            pass

    # ---------- 界面 ----------
    def _build(self):
        pad = dict(padx=6, pady=3)
        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, padx=8, pady=(8, 4))

        left = ttk.LabelFrame(body, text=" 源文件（点一下勾选/取消） ")
        left.pack(side="left", fill="both", expand=True, padx=(0, 4))
        # 按钮先 pack(side="bottom")，否则会被 fill="both" 的列表框挤没
        btns = ttk.Frame(left)
        btns.pack(side="bottom", fill="x")
        for text, cmd in (("添加文件…", self.add_files), ("添加文件夹…", self.add_dir),
                          ("移除选中", self.remove_sel), ("清空", self.clear),
                          ("全选", lambda: self.mark_files(True)),
                          ("全不选", lambda: self.mark_files(False))):
            ttk.Button(btns, text=text, command=cmd).pack(side="left", **pad)
        self.flist = tk.Listbox(left, font=F, activestyle="none", exportselection=False)
        self.flist.pack(side="left", fill="both", expand=True, **pad)
        sb = ttk.Scrollbar(left, command=self.flist.yview)
        sb.pack(side="left", fill="y")
        self.flist.configure(yscrollcommand=sb.set)
        self.flist.bind("<<ListboxSelect>>", self.on_pick_file)
        self.flist.bind("<Button-1>", self.on_toggle_file)

        right = ttk.LabelFrame(body, text=" 章节（点一下勾选/取消） ")
        right.pack(side="left", fill="both", expand=True, padx=(4, 0))
        btns2 = ttk.Frame(right)
        btns2.pack(side="bottom", fill="x")
        for text, cmd in (("扫描章节", self.scan), ("全选", lambda: self.mark_all(True)),
                          ("全不选", lambda: self.mark_all(False)),
                          ("上移", lambda: self.move_chap(-1)), ("下移", lambda: self.move_chap(1))):
            ttk.Button(btns2, text=text, command=cmd).pack(side="left", **pad)
        find = ttk.Frame(right)
        find.pack(side="bottom", fill="x", padx=6, pady=(0, 4))
        ttk.Label(find, text="找章节").pack(side="left")
        self.q_chap = tk.StringVar()
        e = ttk.Entry(find, textvariable=self.q_chap)
        e.pack(side="left", fill="x", expand=True, padx=4)
        e.bind("<Return>", lambda _=None: self.jump_chap())
        e.bind("<Down>", lambda _=None: self.jump_chap())
        e.bind("<Escape>", lambda _=None: self.q_chap.set(""))
        self.clist = tk.Listbox(right, font=F, activestyle="none", exportselection=False)
        self.clist.pack(side="left", fill="both", expand=True, **pad)
        sb2 = ttk.Scrollbar(right, command=self.clist.yview)
        sb2.pack(side="left", fill="y")
        self.clist.configure(yscrollcommand=sb2.set)
        self.clist.bind("<Button-1>", self.on_toggle_chap)
        self.clist.bind("<<ListboxSelect>>", lambda _=None: self._show_preview())

        opt = ttk.LabelFrame(self, text=" 选项 ")
        opt.pack(fill="x", padx=8, pady=4)

        r1 = ttk.Frame(opt); r1.pack(fill="x", **pad)
        ttk.Label(r1, text="拆分").pack(side="left")
        ttk.Radiobutton(r1, text="按章节", variable=self.mode,
                        value="chapter").pack(side="left", padx=4)
        ttk.Radiobutton(r1, text="整本书", variable=self.mode,
                        value="whole").pack(side="left", padx=4)
        ttk.Label(r1, text="   书名（留空=用文件名，仅单本时有效）").pack(side="left")
        ttk.Entry(r1, textvariable=self.book_name, width=20).pack(side="left", padx=4)

        r2 = ttk.Frame(opt); r2.pack(fill="x", **pad)
        for text, var, w in (("前奏秒", self.lead, 7), ("每行秒", self.gap, 7),
                             ("尾音秒", self.tail, 7), ("单文件最长秒", self.max_dur, 7),
                             ("行数上限(0=自动)", self.max_lines, 7)):
            ttk.Label(r2, text=text).pack(side="left", padx=(0, 2))
            ttk.Entry(r2, textvariable=var, width=w).pack(side="left", padx=(0, 12))

        r3 = ttk.Frame(opt); r3.pack(fill="x", **pad)
        ttk.Checkbutton(r3, text="生成 MP3", variable=self.mp3).pack(side="left")
        ttk.Checkbutton(r3, text="转换后校验", variable=self.do_verify).pack(side="left", padx=8)
        ttk.Label(r3, text="输出目录").pack(side="left")
        ttk.Entry(r3, textvariable=self.out_dir).pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(r3, text="浏览…", command=self.pick_out).pack(side="left")
        ttk.Button(r3, text="打开", command=self.open_out).pack(side="left", padx=(4, 0))

        bar = ttk.Frame(self); bar.pack(fill="x", padx=8, pady=4)
        self.go = ttk.Button(bar, text="开始转换", command=self.start)
        self.go.pack(side="left")
        self.pb = ttk.Progressbar(bar, length=260, mode="determinate", maximum=100)
        self.pb.pack(side="left", padx=10)
        ttk.Label(bar, textvariable=self.status).pack(side="left", padx=10)

        # 预览和日志并排，各自一半，省出竖向空间
        low = ttk.Frame(self)
        low.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        pvbox = ttk.LabelFrame(low, text=" 章节内容预览 ")
        pvbox.pack(side="left", fill="both", expand=True, padx=(0, 4))
        self.pv = tk.Text(pvbox, height=9, font=F, wrap="char", state="disabled")
        self.pv.pack(side="left", fill="both", expand=True, padx=2, pady=2)
        sbp = ttk.Scrollbar(pvbox, command=self.pv.yview)
        sbp.pack(side="right", fill="y")
        self.pv.configure(yscrollcommand=sbp.set)

        lg = ttk.LabelFrame(low, text=" 日志 ")
        lg.pack(side="left", fill="both", expand=True, padx=(4, 0))
        self.log = tk.Text(lg, height=9, font=("Consolas", 9), state="disabled")
        self.log.pack(side="left", fill="both", expand=True, **pad)
        sb3 = ttk.Scrollbar(lg, command=self.log.yview)
        sb3.pack(side="right", fill="y")
        self.log.configure(yscrollcommand=sb3.set)

    # ---------- 源文件 ----------
    def add_files(self):
        # 没有 font 选项：Tk 8.6 的 tk_getOpenFile 不支持，传了直接 TclError。
        fs = filedialog.askopenfilenames(
            title="选择 txt / epub", parent=self,
            filetypes=[("小说", "*.txt *.epub"), ("文本", "*.txt"), ("epub", "*.epub")])
        self._add(fs)

    def add_dir(self):
        d = filedialog.askdirectory(title="选择文件夹", parent=self)
        if d:
            self._add([d])

    def on_drop(self, ev):
        """拖进来：文件直接加，文件夹按“纯 txt=一本书，否则只扫一层”处理。"""
        try:
            paths = self.tk.splitlist(ev.data)
        except tk.TclError:
            paths = [ev.data]
        self._add([str(p) for p in paths])

    @staticmethod
    def _expand(p: str):
        """目录 → 内容列表；纯 txt 目录返回 [目录本身]（一 txt 一章，当一本书）。"""
        d = Path(p)
        if not d.is_dir():
            return [p]
        txts = sorted(d.glob("*.txt"))          # 只看一层，不递归
        if txts and not list(d.glob("*.epub")):
            return [p]
        return [str(x) for x in txts] + [str(x) for x in sorted(d.glob("*.epub"))]

    def _flabel(self, p):
        kind = "［文件夹］" if Path(p).is_dir() else ""      # 纯 txt 目录=一本书
        return BOX[self.use.get(p, True)] + " " + kind + Path(p).name + "   —   " + p

    def _add(self, paths):
        have = set(self.files)
        for p0 in paths:
            p = str(Path(p0))
            if not Path(p).exists():
                continue
            for q in self._expand(p):
                if q not in have:
                    have.add(q)
                    self.files.append(q)
                    self.use[q] = True
                    self.flist.insert("end", self._flabel(q))
        if self.files and not self.cur:
            self.flist.selection_set(0)
            self._show_chaps(self.files[0])

    def on_toggle_file(self, ev):
        """点源文件 = 勾选/取消（顺带选中它，右侧显示章节）。"""
        i = self.flist.nearest(ev.y)
        if i >= self.flist.size():
            return
        p = self.files[i]
        self.use[p] = not self.use.get(p, True)
        self.flist.delete(i)
        self.flist.insert(i, self._flabel(p))          # 文字变了，得重画这一行
        self.flist.selection_set(i)
        self._show_chaps(p)

    def mark_files(self, on):
        for p in self.files:
            self.use[p] = on
        self._render_files()
        self.say(f"源文件{'全选' if on else '全不选'}")

    def _render_files(self):
        self.flist.delete(0, "end")
        for p in self.files:
            self.flist.insert("end", self._flabel(p))

    def remove_sel(self):
        for i in reversed(self.flist.curselection()):
            p = self.files[i]
            self.flist.delete(i)
            del self.files[i]
            self.use.pop(p, None)
            self.chaps.pop(p, None)
            self.pick.pop(p, None)
            self.oids.pop(p, None)
            self.full.pop(p, None)
        self.cur = ""
        self._show_chaps(self.cur)

    def clear(self):
        self.files.clear()
        self.use.clear()
        self.chaps.clear()
        self.pick.clear()
        self.oids.clear()
        self.full.clear()
        self.flist.delete(0, "end")
        self.cur = ""
        self._show_chaps("")

    def pick_out(self):
        d = filedialog.askdirectory(title="输出目录", parent=self)
        if d:
            self.out_dir.set(d)

    def open_out(self):
        p = Path(self.out_dir.get())
        if p.is_dir():
            os.startfile(p)
        else:
            self.say(f"目录不存在：{p}")

    # ---------- 章节勾选 ----------
    def on_pick_file(self, _=None):
        sel = self.flist.curselection()
        self._show_chaps(self.files[sel[0]] if sel else "")

    def _show_chaps(self, path):
        self.cur = path
        self.clist.delete(0, "end")
        if path and path not in self.chaps:
            self.status.set("这本书还没扫描，点【扫描章节】看目录")   # 空白区别让人干瞪眼
            self._show_preview()
            return
        marks = self.pick.get(path, [])
        for i, t in enumerate(self.chaps.get(path, [])):
            self.clist.insert("end", BOX[marks[i] if i < len(marks) else True] + " " + t)
        self._show_preview()

    def _show_preview(self):
        """选中哪章就显示哪章正文（扫描时已缓存，不再重新解析）。"""
        self.pv.configure(state="normal")
        self.pv.delete("1.0", "end")
        sel = self.clist.curselection()
        chs = self.full.get(self.cur, [])
        if sel and sel[0] < len(chs):
            title, groups = chs[sel[0]]
            self.pv.insert("1.0", title + "\n\n"
                           + "\n".join(ln for g in groups for ln in g))
        self.pv.configure(state="disabled")

    def jump_chap(self):
        """搜索框：跳到下一个匹配的章节（回车/↓ 继续，到底回绕）。"""
        key = self.q_chap.get().strip().lower()
        titles = self.chaps.get(self.cur, [])
        if not key:
            return
        if not titles:
            return self.say("先扫描章节再搜")
        n = len(titles)
        sel = self.clist.curselection()
        start = (sel[0] + 1) if sel else 0
        for k in range(n):
            i = (start + k) % n
            if key in titles[i].lower():
                self.clist.selection_clear(0, "end")
                self.clist.selection_set(i)
                self.clist.activate(i)
                self.clist.see(i)
                self._show_preview()
                self.status.set(f"第 {i + 1}/{n} 章：{titles[i]}")
                return
        self.say(f"没找到包含「{self.q_chap.get().strip()}」的章节")

    def on_toggle_chap(self, ev):
        i = self.clist.nearest(ev.y)
        if i >= self.clist.size() or not self.cur:
            return
        titles = self.chaps.get(self.cur, [])
        if i >= len(titles):
            return
        marks = self.pick.setdefault(self.cur, [True] * len(titles))
        marks[i] = not marks[i]
        self.clist.delete(i)
        self.clist.insert(i, BOX[marks[i]] + " " + titles[i])
        self.clist.selection_clear(0, "end")            # 让预览跟着点的那一行
        self.clist.selection_set(i)
        self._show_preview()

    def mark_all(self, on):
        if not self.cur:
            return
        titles = self.chaps.get(self.cur, [])
        self.pick[self.cur] = [on] * len(titles)
        self._show_chaps(self.cur)

    def move_chap(self, d):
        """上下移动选中章节；排序结果会按此顺序编号输出文件。"""
        if not self.cur or not self.chaps.get(self.cur):
            return
        sel = self.clist.curselection()
        if not sel:
            return
        i = sel[0]
        j = i + d
        titles = self.chaps[self.cur]
        if j < 0 or j >= len(titles):
            return
        titles[i], titles[j] = titles[j], titles[i]
        marks = self.pick.get(self.cur)
        if marks and len(marks) == len(titles):
            marks[i], marks[j] = marks[j], marks[i]
        oids = self.oids.get(self.cur)
        if oids and len(oids) == len(titles):
            oids[i], oids[j] = oids[j], oids[i]      # 下标跟着行一起走，否则转换会串章
        self._show_chaps(self.cur)
        self.clist.selection_set(j)
        self.clist.activate(j)          # 让键盘上下键能接着按
        self.clist.see(j)
        self._show_preview()

    def scan(self):
        sel = list(self.flist.curselection())
        paths = [self.files[i] for i in sel] or list(self.files)
        if not paths:
            return self.say("请先添加 txt 或 epub 文件")
        if self.busy:
            return self.say("正在转换中，先等它跑完")
        if not self.cur:
            self.cur = paths[0]          # 扫完要有人显示，不然右侧还是空的
        self.status.set("扫描章节中…")
        threading.Thread(target=self._scan_work, args=(paths,), daemon=True).start()

    def _scan_work(self, paths):
        for p in paths:
            self.put(f"── 扫描 {Path(p).name}")
            try:
                chs = core.read_chapters(p, log=lambda s: None)
            except Exception as e:
                self.put(f"  ✗ {e}")
                continue
            titles = [t for t, _ in chs]
            self.full[p] = chs
            self.chaps[p] = titles
            self.pick[p] = [True] * len(titles)
            self.oids[p] = list(range(len(titles)))
            self.put(f"  {len(titles)} 章：{titles[0] if titles else '（无）'}"
                     + (f" … {titles[-1]}" if len(titles) > 1 else ""))
            self.q.put(("scan", p))
        self.q.put(("scanned", None))

    # ---------- 转换 ----------
    def start(self):
        if not self.files:
            return self.say("请先添加 txt 或 epub 文件")
        try:
            opts = dict(lead=_num(self.lead, "前奏秒"), gap=_num(self.gap, "每行秒"),
                        tail=_num(self.tail, "尾音秒"), max_dur=_num(self.max_dur, "单文件最长秒"),
                        max_lines=int(self.max_lines.get().strip() or 0) or None)
        except ValueError as e:
            return self.say(str(e))
        if opts["gap"] <= 0:
            return self.say("每行秒必须大于 0")
        if len(self.files) > 1 and self.book_name.get().strip():
            return self.say("多本一起转时不能指定书名（各自用文件名）")
        jobs = []
        for p in self.files:
            if not self.use.get(p, True):
                continue
            only = None
            if p in self.chaps:
                marks = self.pick.get(p) or []
                oids = self.oids.get(p) or list(range(len(marks)))
                only = [oids[i] for i, on in enumerate(marks) if on]
                if not only:
                    self.put(f"跳过 {Path(p).name}（章节一个都没勾）")
                    continue
            jobs.append((p, only))
        if not jobs:
            return self.say("没有要转换的内容")
        try:
            out_root = Path(self.out_dir.get().strip() or ".").resolve()
            out_root.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return self.say(f"输出目录不可用：{e}")

        # Tk 变量只能在主线程读，全部在这里取好再交给工作线程
        cfg = dict(mode=self.mode.get(), book=self.book_name.get().strip(),
                   mp3=self.mp3.get(), verify=self.do_verify.get(),
                   out_root=str(out_root), single=len(jobs) == 1)
        self.go.configure(state="disabled")
        self.busy = True
        self.pb["value"] = 0
        self.status.set("转换中…")
        threading.Thread(target=self._work, args=(jobs, opts, cfg), daemon=True).start()

    def _work(self, jobs, opts, cfg):
        bad = 0
        n = len(jobs)
        for i, (f, only) in enumerate(jobs, 1):
            self.put(f"── [{i}/{n}] {Path(f).name}"
                     + (f"（{len(only)} 章）" if only else ""))

            def on_prog(done, total, _i=i):
                frac = done / total if total else 1.0
                self.q.put(("prog", ((_i - 1) + frac) / n * 100))

            try:
                st = core.convert_file(f, cfg["out_root"],
                                       book_name=cfg["book"] if cfg["single"] else "",
                                       mode=cfg["mode"], make_mp3=cfg["mp3"], only=only,
                                       progress=on_prog, log=self.put, **opts)
                if cfg["verify"]:
                    n, lines, issues = core.verify_dir(
                        Path(st["out"]), opts["lead"], opts["gap"], opts["tail"],
                        check_audio=cfg["mp3"], log=self.put)
                    if issues:
                        bad += 1
                        self.put(f"  ⚠ 校验发现 {issues} 处问题（见上）")
                    else:
                        self.put(f"  ✓ 校验通过 {n} 文件 / {lines} 行")
                self.put(f"  完成：{st['chapters']} 章 → {st['files']} 个文件 / {st['lines']} 行")
            except Exception as e:
                bad += 1
                self.put(f"  ✗ 失败：{e}")
                self.put(traceback.format_exc(limit=2).rstrip())
        self.q.put(("done", bad))

    # ---------- 输出 ----------
    def put(self, s):
        self.q.put(("log", s))

    def say(self, s):
        """所有提示都走状态栏 + 日志，不再弹窗。"""
        self.status.set(s)
        self.put("! " + s)

    def _poll(self):
        while True:
            try:
                kind, data = self.q.get_nowait()
            except queue.Empty:
                break
            try:
                self._handle(kind, data)
            except Exception:
                self.put("! 日志处理失败：" + traceback.format_exc(limit=2).rstrip())
        self.after(100, self._poll)

    def _handle(self, kind, data):
        if kind == "log":
            self.log.configure(state="normal")
            self.log.insert("end", data + "\n")
            self.log.see("end")
            self.log.configure(state="disabled")
        elif kind == "scan":
            if not self.cur:            # data 就是路径本身，不是元组
                self.cur = data
            if data == self.cur:
                self._show_chaps(data)
        elif kind == "scanned":
            n = sum(self.use.get(p, True) for p in self.files)
            self.status.set(f"扫描完成，共 {len(self.files)} 本，已勾选 {n} 本")
        elif kind == "prog":
            self.pb["value"] = data
        else:
            self.go.configure(state="normal")
            self.busy = False
            if not data:
                self.pb["value"] = 100
            self.status.set("全部完成" if not data else f"完成，但有 {data} 处失败/告警")


if __name__ == "__main__":
    App().mainloop()