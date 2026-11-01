# wbpi-grpc worker

Cloudflare Workers 版 `grpc/`（wasm gRPC）实现。同一套 `.proto`、同一套请求头/帧格式，直接调 `grpc.biliapi.net`。

## 为什么不是直接跑 wasm

.NET 10 browser-wasm 依赖浏览器/Emscripten 运行时，workerd 跑不了（已实测）：
`dotnet.create()` 第一步读 `import.meta.url` 就崩（`Cannot read properties of undefined (reading 'indexOf')`），后面还会撞上动态 `import('./dotnet.runtime.js')`（Workers 只支持打包期静态 import）和 JS interop 里的 `new Function`（Workers 禁用）。

编解码因此换成 pbjs 生成的静态 JS（`src/proto.js`，无反射、无 `eval`）。传输层没变：仍是 HTTP/2 + `content-type: application/grpc` + 5 字节前缀帧 + `x-bili-metadata-bin`，就是真 gRPC。`bun test` 会把它和 `grpc-wasm` 编出来的 wasm 逐个字节对比，保证编码一致。

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/types` | 已注册的 protobuf 类型（换行分隔） |
| POST | `/encode?type=T` | body 为 JSON message，返回 base64 protobuf |
| POST | `/decode?type=T` | body 为 base64 protobuf，返回 JSON message |
| POST | `/rpc` | body `{path, req_type, request, reply_type}`，返回 `{messages, headers}` |
| GET | `/popular?idx=0` | `bilibili.app.show.v1.Popular/Index`，返回第一条 message |
| GET | `/view?aid=2` 或 `?bvid=BV...` | `bilibili.app.view.v1.View/View`，返回第一条 message |

JSON 字段名 camelCase / snake_case 都接受，输出为 camelCase（与 .NET `JsonFormatter` 默认一致，int64 为字符串，enum 为名字）。

```sh
curl 'http://127.0.0.1:8787/view?aid=2'
curl -X POST 'http://127.0.0.1:8787/rpc' -H 'content-type: application/json' \
  -d '{"path":"/bilibili.app.show.v1.Popular/Index","req_type":"bilibili.app.show.v1.PopularResultReq","request":{"idx":0},"reply_type":"bilibili.app.show.v1.PopularReply"}'
```

## 开发 / 部署

```sh
bun install
bun run gen     # 由 ../grpc-wasm/proto 重新生成 src/proto.js
bun test        # 与 wasm 编解码对拍（需要先 dotnet publish 出 grpc-wasm/.../AppBundle）
bun run dev
bun run deploy
```

## 已知限制

- Workers 的 `fetch()` 拿不到 HTTP/2 trailers：成功响应按「200 + 能解出 gRPC 帧」判定，错误只在服务端返回 trailers-only 响应（`grpc-status` 出现在响应头）时能读到。
- 没有搬 `src/wbpi.mjs` 的 gaia 指纹激活（`ExClimbWuzhi` + murmur3），只用 `finger/spi` 拿 buvid3/4，按 isolate 缓存；需要更强风控时可再补。
- 没有 WBI 签名 / 登录态转发，只覆盖 gRPC 这条线。
