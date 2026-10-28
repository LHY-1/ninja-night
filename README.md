# 忍者之夜 · 公网版

在局域网版（见 main 分支）基础上支持公网联机：家人朋友不在同一 WiFi 也能玩。规则、操作与局域网版完全一致。

## 相比局域网版的差异

- 服务端双栈监听（IPv6 + IPv4）
- 新增 `/api/lan`：门户自动探测主机局域网地址（含 JSONP 兼容 Safari 的私网探测）
- 新增 CORS / OPTIONS 预检应答，允许公网页面探测私网线路
- 门户自动选路：**局域网 → 直连快线 → 隧道** 四级切换，玩家只需记住一个入口

## 公网部署思路（三选一或组合）

1. **Cloudflare Tunnel（推荐，免费）**
   - `cloudflared tunnel create <名字>` 建隧道
   - 配置 ingress 把你的域名指向 `http://localhost:7788`
   - `cloudflared tunnel route dns <名字> <你的域名>`
2. **直连快线（有公网 IPv6 时）**
   - DNS 加一条 AAAA 记录指向主机 IPv6（地址会变，配个 DDNS 定时更新）
   - 防火墙放行 7788 端口
   - 在 `public/index.html` 顶部 `DIRECT` 填入你的直连域名，门户会自动探测并切换
3. **云服务器**
   - 整个目录拷上去 `node server.js` 即可

## 运行

```bash
node server.js      # 同局域网版
```

## 说明

- 本仓库不含任何真实域名、IP 与密钥，`DIRECT` 与隧道目标均为占位符
- 服务端零 npm 依赖
- 房间状态在内存中，重启即清空
- 游戏无用户系统，公网部署请自行评估暴露风险
