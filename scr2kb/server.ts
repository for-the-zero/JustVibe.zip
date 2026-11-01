/**
 * 手机触控映射电脑按键服务器
 */

import { spawn } from 'child_process';

// Python 键盘服务进程
let keyboardProcess: ReturnType<typeof spawn> | null = null;

/**
 * 启动 Python 键盘服务
 */
function startKeyboardService() {
  keyboardProcess = spawn('python', ['keyboard_service.py'], {
    stdio: 'inherit',
    shell: true
  });
  
  keyboardProcess.on('error', (err) => {
    console.error('键盘服务启动失败:', err);
  });
  
  console.log('⌨️  键盘服务已启动');
}

/**
 * 停止 Python 键盘服务
 */
function stopKeyboardService() {
  if (keyboardProcess) {
    keyboardProcess.kill();
    keyboardProcess = null;
    console.log('⌨️  键盘服务已停止');
  }
}

// 监听退出信号
process.on('exit', () => stopKeyboardService());
process.on('SIGINT', () => {
  stopKeyboardService();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopKeyboardService();
  process.exit(0);
});

// 启动键盘服务
startKeyboardService();

// 按键列表 - 字母顺序
const KEY_LIST: string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// 键盘服务地址
const KEYBOARD_SERVICE = 'http://127.0.0.1:3001';

// 存储当前活跃的触控点及其对应的按键
const activeTouches = new Map<number, string>();

// 下一个要分配的按键索引
let nextKeyIndex = 0;

/**
 * 发送按键事件到键盘服务
 */
async function sendKeyEvent(key: string, action: 'down' | 'up') {
  try {
    await fetch(KEYBOARD_SERVICE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, action })
    });
  } catch (e) {
    console.error('键盘服务连接失败:', e);
  }
}

/**
 * 获取下一个按键（轮流分配 A-Z）
 */
function getNextKey(): string {
  const key = KEY_LIST[nextKeyIndex % KEY_LIST.length];
  nextKeyIndex++;
  return key;
}

/**
 * 处理触控开始
 */
function handleTouchStart(touchId: number) {
  if (activeTouches.has(touchId)) return;
  
  const key = getNextKey();
  activeTouches.set(touchId, key);
  console.log(`[按下] ${key} (触控点 ${touchId})`);
  sendKeyEvent(key, 'down');
}

/**
 * 处理触控结束
 */
function handleTouchEnd(touchId: number) {
  const key = activeTouches.get(touchId);
  if (key) {
    console.log(`[释放] ${key} (触控点 ${touchId})`);
    sendKeyEvent(key, 'up');
    activeTouches.delete(touchId);
  }
}

// 创建 HTTP 服务器
const server = Bun.serve({
  port: 3000,
  
  async fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return undefined;
    }
    
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const file = Bun.file('public/index.html');
      return new Response(file);
    }
    
    return new Response('Not Found', { status: 404 });
  },
  
  websocket: {
    open(ws) {
      console.log('📱 手机已连接');
    },
    
    message(ws, message) {
      try {
        const data = JSON.parse(message as string);
        
        switch (data.type) {
          case 'touchstart':
            handleTouchStart(data.touchId);
            break;
          case 'touchend':
          case 'touchcancel':
            handleTouchEnd(data.touchId);
            break;
        }
      } catch (e) {
        console.error('处理消息错误:', e);
      }
    },
    
    close(ws) {
      console.log('📱 手机已断开');
      for (const [, key] of activeTouches) {
        sendKeyEvent(key, 'up');
      }
      activeTouches.clear();
    }
  }
});

console.log(`
╔════════════════════════════════════════════╗
║       手机触控映射电脑按键系统              ║
╠════════════════════════════════════════════╣
║  Web服务器: http://localhost:${server.port}              ║
║  可用按键: A-Z 字母轮流分配                 ║
╚════════════════════════════════════════════╝
`);

const { networkInterfaces } = require('os');
const nets = networkInterfaces();
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(`📱 手机请访问: http://${net.address}:${server.port}`);
    }
  }
}
