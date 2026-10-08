# 把「逻各斯」发布成公开网站

> **不想注册任何账号？** 直接看下面「零注册方案」——一条命令给出一个临时公网网址，
> 你和用的人都不用注册。
>
> 想要一个**永久**网址（电脑不用开着），再看后面的 Cloudflare Pages / Netlify / GitHub Pages。

---

## 零注册方案：临时公网隧道

```bash
cd app
node scripts/share.mjs
```

它会：起本机服务 → 开一条 Cloudflare 快速隧道 → 打印一个
`https://xxxx.trycloudflare.com` 的网址和二维码。

- **你不需要注册**，用的人也不需要
- 因为走的是 **HTTPS**，手机端可以「添加到主屏幕」并**离线使用**
- **关掉窗口网址就失效**；网址随机但**不等于保密**，别公开贴
- 流量走你这台电脑，电脑得开着

`cloudflared` 已经下载在 `../.tools/bin/cloudflared`（Cloudflare 官方客户端，免费）。

---

> 生成物料：`cd app && node scripts/make-deploy.mjs`
> 产出：`deploy/`（站点目录）与 `logos-site.zip`（压缩包）

站点是**纯静态**的（HTML + JS + JSON + 音频），不需要服务器、不需要数据库、不需要后端。
学习进度存在**访问者自己的浏览器**里，所以：**没有账号系统、没有隐私数据落在你这边、也没有并发问题**。

---

## 一、推荐：Cloudflare Pages

**为什么选它**：免费、**流量不限**、支持单文件 25MB / 单次部署 2 万个文件（本项目约 1.6 万个，放得下）。

### 方式 A：命令行（推荐，1.6 万个文件用拖拽会卡死）

```bash
cd "<工作区>/逻各斯"
npx wrangler@latest pages deploy deploy --project-name greek-vocab
```

- 第一次运行会**打开浏览器让你登录 / 注册 Cloudflare**（免费账号，需要邮箱）
- 之后每次更新内容，重跑这条命令即可
- 部署完会打印一个网址，形如 `https://greek-vocab.pages.dev`

### 方式 B：网页拖拽

1. 打开 <https://dash.cloudflare.com/> → 注册 / 登录
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Upload assets**
3. 项目名填 `greek-vocab`
4. 把 `logos-site.zip` 传上去（比拖 1.6 万个散文件稳）

---

## 二、备选

### Netlify Drop
<https://app.netlify.com/drop> → 把 `deploy` 文件夹拖进去（需登录）。
免费额度：100GB/月流量。文件数很多时同样建议用 CLI：`npx netlify-cli deploy --dir=deploy --prod`。

### GitHub Pages
仓库里的软上限是 1GB、每月 100GB 流量，本项目约 190MB，可以放。

```bash
cd "<工作区>/逻各斯/deploy"
"<工作区>/tools/bin/git" init
"<工作区>/tools/bin/git" add -A
"<工作区>/tools/bin/git" commit -m "逻各斯 站点"
"<工作区>/tools/bin/git" remote add origin https://github.com/<你的用户名>/greek-vocab.git
"<工作区>/tools/bin/git" push -u origin main
```

然后在仓库 **Settings → Pages** 里选 `main` 分支根目录。
（`deploy/.nojekyll` 已经放好，避免 GitHub 用 Jekyll 处理而漏掉下划线开头的文件。）

> 注意：本机的 `/usr/bin/git` 是坏的 shim，**必须用 `tools/bin/git`**。

---

## 三、部署完请检查这几项

| 检查 | 期望结果 |
|---|---|
| 打开首页 | 能看到「学习 / 词书 / 我的」三个入口 |
| 四个板块 | 单词、语法、阅读、听力都能切 |
| 发音 | 点词条的喇叭有声音（音频是 `audio-tts/` 下的 m4a） |
| 手机上打开 | 布局自适应；**HTTPS 生效后可以「添加到主屏幕」并离线使用** |
| 断网 | 联网打开一次并到「我的 → 离线使用 → 缓存全部词表与发音」后，断网仍可用 |

**HTTPS 是个额外好处**：Service Worker 只在安全上下文生效，所以部署到 Pages 之后，
手机端终于能装成 PWA 并离线使用 —— 这是 `http://192.168.x.x` 局域网访问做不到的。

---

## 四、署名与授权（发布时请保留）

> ⚠️ **两条重要授权限制**：
>
> 1. 应用内置 **eSpeak-NG（GPL-3.0）** → **整个应用需以 GPL-3.0 发布并提供源码**。
>    不想采用 GPL，把 `app/src/lib/flags.ts` 的 `USE_TTS` 改成 `false` 重新构建即可。
> 2. 高清语音模型 **Meta MMS-TTS 是 CC-BY-NC 4.0（非商用）** →
>    **本应用不可用于商业用途**，除非删掉 `app/public/mms-grc/` 并把默认引擎改回 `espeak`。
>
> 详见 [`NOTICE.md`](NOTICE.md)。


应用内「我的 → 关于」已经写了来源，公开部署时请**不要删掉**，或者在你自己的页面里补充说明：

| 内容 | 来源 | 许可 |
|---|---|---|
| 新约例句、词形变化、中希对照 | MorphGNT / SBLGNT（James Tauber） | 正文 CC BY 4.0；形态标注 CC BY-SA 3.0 |
| 和合本中文译文 | eBible.org `cmu-cuv`（USFX） | 公有领域 |
| 古典语料例句 | GLAUx v2.1（Keersmaekers） | Zenodo 记录 CC BY 4.0；逐文本以 CC BY-SA 为主 |
| **参考语法与教材例句** | Smyth, *A Greek Grammar for Colleges*（American Book Co., 1920） | **公有领域**；TEI 数字版取自 neelsmith/smyth |
| Beta Code → Unicode | beta-code（perseids-tools） | MIT |
| 字体 | Gentium（SIL） | SIL Open Font License 1.1 |
| 发音音频（词条） | eSpeak-NG 的 `grk/grc` 语音，构建期生成 | 工具本身 GPL-3.0，**其生成的音频不受传染** |
| **例句发音（轻量）** | eSpeak-NG 编译为 WebAssembly，**浏览器内实时合成** | **GPL-3.0：随应用分发 → 应用整体需以 GPL-3.0 发布并提供源码** |
| **例句发音（高清）** | Meta MMS-TTS `facebook/mms-tts-grc`，ONNX 浏览器内推理 | **CC-BY-NC 4.0：非商用**；ONNX Runtime 为 MIT |
| 调度算法 | ts-fsrs | MIT |
| 词表与英文释义 | 原 Anki 共享牌组 | **授权状态未确认** |

**重要 —— 关于词表**：`make-deploy.mjs` 已经把音频**全部换成自生成版本**，
不再分发来源不明的原牌组录音。但**词表和英文释义本身**仍来自那个 Anki 共享牌组，
我调研时没能找到它的授权声明。如果你要公开长期发布，建议：
- 到 <https://ankiweb.net/shared/info/1617577639> 看看作者是否写了授权；
- 或联系作者取得许可；
- 或把它当作「个人学习工具」在小范围分享，不做公开推广。

我没有替你判断这一条 —— 这是你的决定。

---

## 五、更新内容后怎么重新发布

```bash
cd app
node scripts/make-deploy.mjs                      # 重新生成 deploy/ 与 zip
npx wrangler@latest pages deploy ../deploy --project-name greek-vocab
```

`make-deploy.mjs` 会自动：
1. 用「全部自生成音频」重建数据
2. 构建前端并处理 PWA（Service Worker + 预缓存清单 + CSP）
3. 拷出站点目录并**剔除原牌组录音**
4. 写入 `_headers`（缓存策略）、`.nojekyll`、`robots.txt`
5. 打 zip
6. 把本地版数据恢复成「原录音优先」（所以你本机和桌面 App 听感不变）

---

## 六、只想给几个人用？

那就**不用部署**：本机的 `启动逻各斯.command` 默认监听所有网卡，
终端会打印局域网地址和二维码，同一个 Wi-Fi 下的人扫码即可。
缺点是必须同一网络、且你的电脑得开着。
