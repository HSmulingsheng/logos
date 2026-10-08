# 授权说明

## 应用本体：GPL-3.0

本应用在浏览器内打包了 **[eSpeak-NG](https://github.com/espeak-ng/espeak-ng)**（经
[`@echogarden/espeak-ng-emscripten`](https://github.com/echogarden-project/espeak-ng-emscripten)
编译为 WebAssembly），用于**实时合成例句发音**。

eSpeak-NG 采用 **GPL-3.0**。把 GPL 程序随应用一起分发，会使**整个应用**受 GPL-3.0 约束。
因此本应用整体以 **GPL-3.0** 发布，全文见 [`LICENSE`](LICENSE)。

这意味着：你可以自由使用、修改、再分发，但**再分发时也必须以 GPL-3.0 提供源码**。

> 不想采用 GPL？把 `app/src/lib/flags.ts` 里的 `USE_TTS` 改成 `false` 重建即可——
> 例句发音会退回系统语音，应用不再包含任何 GPL 代码，其余功能不受影响。

**由 eSpeak 生成的音频（如 `public/audio-tts/` 下的词条发音）不受 GPL 传染**，
它们是程序的输出而非程序本身。

## ⚠️ 神经语音模型：CC-BY-NC 4.0（非商用）

例句朗读可选「高清」引擎，它内置
**[facebook/mms-tts-grc](https://huggingface.co/facebook/mms-tts-grc)**（Meta 的 MMS-TTS 古希腊语模型），
经 ONNX 转换后在浏览器内推理。

该模型采用 **CC-BY-NC 4.0（署名—非商业性使用）**：

* **非商业用途**（个人学习、教学、免费分享）——可以用，需署名；
* **商业用途**——**不可用**。若要商用，请把引擎切回「轻量」或换用其它许可的模型；
* 想彻底移除该模型：删掉 `app/public/mms-grc/` 与 `app/public/ort/`，
  并把 `app/src/lib/db.ts` 里 `speechEngine` 的默认值改回 `'espeak'`。

「轻量」引擎用的 eSpeak-NG 是 GPL-3.0（见上），与本模型无关。

## 古典阅读文本：Perseus，CC BY-SA 4.0

「学习 → 阅读 → 哲学 / 文学 / 历史」里的文本来自
**[Perseus Digital Library](https://www.perseus.tufts.edu/)** 的
[`PerseusDL/canonical-greekLit`](https://github.com/PerseusDL/canonical-greekLit) 仓库：

* **许可**：CC BY-SA 4.0（署名 + **相同方式共享**）；
* **署名**：每部作品的页面底部都会标出出处与许可；本文件与 README 亦列出；
* **相同方式共享的含义**：如果你再分发这些文本（或改写后的版本），
  需要以同样的 CC BY-SA 4.0 授权。这与应用代码的 GPL-3.0 是**两套独立的许可**，
  各自约束各自的部分；合并分发时两份条款都要遵守。

已收录 15 部（希腊语原文 + Perseus 英译对照）：

| 分类 | 作品 |
|---|---|
| 文学 | 荷马《伊利亚特》《奥德赛》、索福克勒斯《俄狄浦斯王》《安提戈涅》、欧里庇得斯《美狄亚》、赫西俄德《神谱》 |
| 历史 | 希罗多德《历史》、修昔底德《伯罗奔尼撒战争史》、色诺芬《远征记》《希腊史》 |
| 哲学 | 柏拉图《申辩篇》《欧悌甫戎篇》《克里同篇》《斐多篇》、亚里士多德《尼各马可伦理学》、爱比克泰德《手册》 |
| 宗教 | 新约 27 卷（SBLGNT 原文 + 和合本对照，许可情况见下表） |

获取与解析脚本：`tools/fetch_perseus.py`、`tools/build_reading.py`。
> 文本是**下载并解析**自 Perseus 的原始 TEI 文件，没有人工改写或编造。

## 本仓库不包含原 Anki 牌组的内容

词表来自一份第三方 Anki 牌组 `Ancient Greek Vocab`，**其授权状况未确认**，
因此以下内容**未随本仓库分发**（已写入 `.gitignore`）：

| 未分发的内容 | 说明 |
|---|---|
| `data/greek.json` | 牌组的词表与英文释义 |
| `data/lessons.json` | 30 本词书的切分（源自牌组结构） |
| `data/audio/` | 牌组自带的录音文件 |

要完整复现应用，需自备同名牌组。除此之外的数据都是由**开放许可的语料**生成的，
已随仓库提供：SBLGNT 新约（`corpus_nt.json`）、Smyth 语法（`smyth.json`，公有领域）、
SBLGNT / GLAUx 例句（`examples*.json`）。

## 内容与数据的授权（与应用代码分开）

| 内容 | 来源 | 许可 |
|---|---|---|
| 新约正文与词形标注 | MorphGNT / SBLGNT（James Tauber） | 正文 CC BY 4.0；形态标注 CC BY-SA 3.0 |
| 和合本中文译文 | eBible.org `cmu-cuv`（USFX） | 公有领域 |
| 古典语料例句 | GLAUx v2.1（Keersmaekers） | Zenodo 记录 CC BY 4.0；逐文本以 CC BY-SA 为主 |
| 参考语法与教材例句 | Smyth, *A Greek Grammar for Colleges*（American Book Co., 1920） | **公有领域**；TEI 数字版取自 [neelsmith/smyth](https://github.com/neelsmith/smyth) |
| Beta Code → Unicode | [beta-code](https://github.com/perseids-tools/beta-code-py)（perseids-tools） | MIT |
| 字体 | Gentium（SIL） | SIL Open Font License 1.1 |
| 调度算法 | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT |
| 语音引擎（轻量） | eSpeak-NG | **GPL-3.0**（见上） |
| 语音模型（高清） | Meta MMS-TTS `facebook/mms-tts-grc` | **CC-BY-NC 4.0（非商用）** |
| ONNX 推理运行时 | onnxruntime-web（微软） | MIT |
| 古典阅读文本 | Perseus Digital Library `canonical-greekLit` | **CC BY-SA 4.0（署名 + 相同方式共享）** |
| 词表与英文释义 | 原 Anki 共享牌组 | **授权状态未确认** |

「词表与英文释义」一条请在公开分发前自行确认，详见 [`DEPLOY.md`](DEPLOY.md)。
