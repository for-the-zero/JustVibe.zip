"""
键盘模拟服务 - 使用 SendInput + 扫描码，兼容游戏
"""
import http.server
import json
import ctypes
from ctypes import wintypes
import sys

user32 = ctypes.windll.user32

# 常量
INPUT_KEYBOARD = 1
KEYEVENTF_SCANCODE = 0x0008
KEYEVENTF_KEYUP = 0x0002

# 扫描码 (完整 A-Z)
SCAN_CODES = {
    'A': 0x1E, 'B': 0x30, 'C': 0x2E, 'D': 0x20, 'E': 0x12,
    'F': 0x21, 'G': 0x22, 'H': 0x23, 'I': 0x17, 'J': 0x24,
    'K': 0x25, 'L': 0x26, 'M': 0x32, 'N': 0x31, 'O': 0x18,
    'P': 0x19, 'Q': 0x10, 'R': 0x13, 'S': 0x1F, 'T': 0x14,
    'U': 0x16, 'V': 0x2F, 'W': 0x11, 'X': 0x2D, 'Y': 0x15,
    'Z': 0x2C,
}

# 结构体定义
class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ('wVk', wintypes.WORD),
        ('wScan', wintypes.WORD),
        ('dwFlags', wintypes.DWORD),
        ('time', wintypes.DWORD),
        ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
    ]

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ('dx', wintypes.LONG),
        ('dy', wintypes.LONG),
        ('mouseData', wintypes.DWORD),
        ('dwFlags', wintypes.DWORD),
        ('time', wintypes.DWORD),
        ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong)),
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ('uMsg', wintypes.DWORD),
        ('wParamL', wintypes.WORD),
        ('wParamH', wintypes.WORD),
    ]

class INPUT_U(ctypes.Union):
    _fields_ = [
        ('mi', MOUSEINPUT),
        ('ki', KEYBDINPUT),
        ('hi', HARDWAREINPUT),
    ]

class INPUT(ctypes.Structure):
    _fields_ = [
        ('type', wintypes.DWORD),
        ('u', INPUT_U),
    ]

user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT

def send_input(scan_code, flags):
    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.u.ki.wVk = 0
    inp.u.ki.wScan = scan_code
    inp.u.ki.dwFlags = flags
    inp.u.ki.time = 0
    inp.u.ki.dwExtraInfo = None
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

def key_down(key):
    scan = SCAN_CODES.get(key.upper())
    if scan:
        send_input(scan, KEYEVENTF_SCANCODE)
        print(f"[按下] {key}")

def key_up(key):
    scan = SCAN_CODES.get(key.upper())
    if scan:
        send_input(scan, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP)
        print(f"[释放] {key}")

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode()
        
        try:
            data = json.loads(body)
            key = data.get('key', '').upper()
            action = data.get('action')
            
            if action == 'down':
                key_down(key)
            elif action == 'up':
                key_up(key)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:
            print(f"错误: {e}")
            self.send_response(500)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3001
    print(f"键盘服务启动在端口 {port}")
    server = http.server.HTTPServer(('127.0.0.1', port), Handler)
    server.serve_forever()