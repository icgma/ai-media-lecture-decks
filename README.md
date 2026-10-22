# ai-media-lecture-decks

AI 驱动传媒内容制作 · 16 讲离线课件（HTML）的加密托管站。

仓库里只有**密文**和**解密器**。没有口令，访客拿到的只是一张口令页和一堆
AES-GCM 密文；明文 HTML 不在本仓，也不在 git 历史里。

## 在线地址

https://icgma.github.io/ai-media-lecture-decks/

## 工作原理

1. `scripts/build.mjs` 读取本机交付目录里的 16 份 HTML。
2. 用口令经 PBKDF2-SHA256（210,000 次）派生一把主密钥，再对每份文件用
   独立的 AES-256-GCM IV 加密，输出 `docs/decks/wNN.bin`。
3. 目录清单（周次、字节数）同样加密为 `docs/decks/index.bin`，避免标题泄露。
4. `docs/` 提交并由 GitHub Pages 发布（Pages 只接受 `/` 或 `/docs`）；
   浏览器端 `site/js/app.js` 用同一口令派生密钥，解密后在新建标签页里渲染课件。

密钥只存在于当前标签页的 `sessionStorage`，关掉即失效。

## 本地构建

```bash
cp .env.example .env      # 填入 DECKS_PASSWORD
npm run build             # 生成 docs/
node scripts/verify.mjs   # 逐字节比对解密结果与原文件
npm run serve             # http://localhost:8080/
```

`scripts/build.mjs` 默认读取 `D:\STU\01-教学\教学教改\智慧课程建设\智慧树交付_AI驱动传媒制作\02_智能体授课\授课PPT_离线版`，
可用第二个参数或 `DECKS_SOURCE` 覆盖。

## 端到端验证

```bash
node scripts/e2e-check.mjs "<口令>"
```

用真实 Chrome（CDP）走完：口令页 → 错误口令被拒 → 正确口令解锁 →
点开 W01 → 确认 34 页课件渲染完成。

## 换口令

改 `.env` 里的 `DECKS_PASSWORD`，重新 `npm run build` 并提交 `docs/`。
旧密文随即失效。

## 边界

- GitHub Pages 无服务端鉴权，保护强度等于**口令强度 + 密文不下发**。
  口令一旦外泄，等于内容外泄，且无法撤销单次泄露——只能改口令重加密。
- 解密后的 HTML 在浏览器内存中，具备前端调试能力的人可在解锁后导出。
  这挡的是"拿到链接就能看"，不是"有权限的人抄走"。
- 仓库为 public（免费账号开 Pages 的前提），密文与解密器对全网可见。
