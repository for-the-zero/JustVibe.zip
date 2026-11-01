"""打包成单文件 exe。cmd 读 UTF-8 的 .bat 会按 GBK 误解码，所以构建逻辑放 Python 里。
    python 打包.py    →  dist\\小说转LRC.exe + dist\\bin\\ffmpeg.exe
ffmpeg 不塞进 exe（两个就 250MB），放 dist\\bin\\ 或 PATH 里 core.bin_path 都能找到。"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
FFMPEG = Path(r"D:\FFmpeg")
NAME = "小说转LRC"

cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
       "--onefile", "--windowed", "--name", NAME,
       "--collect-all", "jieba", "--collect-all", "tkinterdnd2",
       "--hidden-import", "core",
       str(HERE / "gui.py")]
print(" ".join(cmd[2:]))
if subprocess.call(cmd, cwd=HERE):
    raise SystemExit("打包失败")

bindir = HERE / "dist" / "bin"
if bindir.exists():
    shutil.rmtree(bindir)
bindir.mkdir(parents=True)
for exe in ("ffmpeg.exe", "ffprobe.exe"):
    if (FFMPEG / exe).exists():
        shutil.copy2(FFMPEG / exe, bindir)
print("完成：dist\\%s.exe （同目录 bin\\ 里是 ffmpeg）" % NAME)