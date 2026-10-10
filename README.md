<div align="center">

# ModelTrace-Worker

**完全运行在 Cloudflare Workers 边缘网络上的大语言模型主动指纹归因与识别工具**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?logo=node.js)](https://nodejs.org/)

<br />

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/spicakirakira/modeltrace-worker)

<p><em>点击上方按钮，一键将本项目克隆并部署到你自己的 Cloudflare 账户</em></p>

</div>

---

## 📖 简介

**ModelTrace-Worker** 是 [ModelTrace (xqy2006/ModelTrace)](https://github.com/xqy2006/ModelTrace) 的无服务器（Serverless）全功能移植版本。原项目依赖 Python、Flask 与 NumPy 运行，而本项目通过纯现代 JavaScript 与 Web 标准 API 进行了完全重写，无需任何云主机或 Python 环境，即可直接在全球边缘网络秒级运行。

### ✨ 核心特性

- ⚡ **零服务器免运维**：利用 Cloudflare Workers 全球边缘计算，冷启动极快，免费版额度即可轻松承载日常使用。
- 🖥️ **完整复刻原版 UI**：100% 保持原有网页布局与交互逻辑，包含模型测试工作区、指纹库管理工作区、测试进度条及诊断归因表。
- 📦 **内置完整 18 款模型指纹**：开箱即用，无需外部下载数据。在 Worker 模块中内置高倍压缩指纹库，按需流式解压至内存。
- 🎯 **数学算法完全对齐**：使用原生 JavaScript 复刻 Hellinger 相似度、有序四分区块数字特征、Jacobi SVD 干扰方向投影去噪及多查询温度校准算法，精度与原版 NumPy 结果完全一致（误差 $< 10^{-14}$）。
- 🔌 **双模式测试支持**：支持生成 3 次随机长整数挑战的手动测试，以及自动发起探针调用的 API 自动测试（支持 OpenAI 与 Anthropic 协议）。
- 🗄️ **指纹库在线管理**：支持切换查看 GPT / Claude 指纹库、在线新建指纹库、API 自动采样生成新指纹。支持内存存储或无缝绑定 Cloudflare KV 持久化。

---

## 🤖 内置模型指纹库

当前版本内置收录了以下 **18 款主流模型** 的稳健数字指纹：

| 家族 | 收录模型标识 (Model IDs) |
| :--- | :--- |
| **GPT 家族 (8 款)** | `gpt-5.4`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` |
| **Claude 家族 (10 款)** | `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` |

---

## 🚀 部署与使用

### 方式一：一键自动部署（推荐）

直接点击页面顶部的 **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/spicakirakira/modeltrace-worker)** 按钮。登录你的 Cloudflare 账户后，系统将自动 fork 仓库并完成在线构建与部署。

---

### 方式二：命令行手动部署

若你习惯使用终端本地开发与部署：

```bash
# 1. 克隆代码仓库
git clone https://github.com/spicakirakira/modeltrace-worker.git
cd modeltrace-worker

# 2. 安装依赖
npm install

# 3. 部署到 Cloudflare
npx wrangler deploy
```

部署成功后，命令行会输出专属访问链接：`https://modeltrace-worker.<你的子域>.workers.dev`。

---

### 本地调试与测试

- **启动本地预览**：
  ```bash
  npx wrangler dev
  ```
  在浏览器中打开 `http://localhost:8787` 即可实时预览。

- **运行自动化测试**：
  ```bash
  npm test
  ```
  内置完整的算法精度校验、Worker 端点及 API 探针测试。

---

<details>
<summary><b>⚙️ 高级配置：启用 KV 持久化存储（可选）</b></summary>
<br />

默认情况下，在线新建的自定义指纹库保存在当前 Worker 实例内存中。若需跨数据中心与重启永久保留：

1. 在终端创建 KV 命名空间：
   ```bash
   npx wrangler kv:namespace create MODELTRACE_KV
   ```
2. 打开 `wrangler.jsonc` 并填入生成的 `id`：
   ```jsonc
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "modeltrace-worker",
     "main": "src/index.js",
     "compatibility_date": "2024-09-23",
     "compatibility_flags": ["nodejs_compat"],
     "kv_namespaces": [
       {
         "binding": "MODELTRACE_KV",
         "id": "<你的 KV ID>"
       }
     ]
   }
   ```
3. 重新执行 `npx wrangler deploy` 即可完成绑定。

</details>

---

## 💡 使用指南

1. **手动测试**：
   - 进入 **模型测试 -> 手动测试**。
   - 点击“复制提示词”，依次将 3 次独立的数字挑战发送给待测模型。
   - 将模型完整输出粘贴到对应的文本框中，点击“计算归因概率”查看诊断报告与排名表。
2. **API 自动测试**：
   - 进入 **模型测试 -> API 自动测试**。
   - 填写 Base URL、模型名称、API Key 及可选的温度参数。
   - 点击“开始测试”，系统将自动发起采样并实时展示进度条与分析结果。
3. **指纹库管理**：
   - 进入 **指纹库管理**，可在顶栏自由切换 GPT / Claude 库查看模型特征。
   - 支持创建新库，并通过输入模型 API 进行 3~36 次回答自动化采样建库。

---

## 📁 目录结构

```text
modeltrace-worker/
├── src/
│   ├── index.js              # Cloudflare Worker 路由分发与 API 处理入口
│   ├── fingerprint.js        # 数字提取、特征工程与统一归因算法
│   ├── challenge-suite.js    # 随机挑战题目与建库测试套件
│   ├── bank-builder.js       # 指纹拟合、Jacobi SVD 干扰去噪与温度校准
│   ├── store.js              # 指纹库摘要管理与 KV / 内存状态存储
│   ├── enrollment.js         # API 探针请求与协议自动探测 (OpenAI / Anthropic)
│   ├── banks.js              # 内置指纹库加载与流式解压管理
│   ├── builtin-banks-data.js # 打包的内置指纹库 gzip base64 数据
│   ├── html-template.js      # 完整 Web UI HTML 页面模板
│   └── ui-assets.js          # 原始 CSS 样式与客户端交互逻辑
├── test/
│   ├── worker.test.js        # 核心算法与 Worker API 端点测试
│   └── probe.test.js         # API 探针自动化测试
├── LICENSE                   # 开源许可协议 (MIT License)
├── wrangler.jsonc            # Cloudflare Workers 配置文件
└── package.json              # 项目依赖与元数据
```

---

## 📜 开源协议与致谢

- 本项目采用 **[MIT License](LICENSE)** 开源。
- 核心算法、提示词设计与模型原始采集数据来源于 **[xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace)**，版权归原作者所有。
- 感谢 [hanlinwenyuan/hlwy-ai-checker](https://github.com/hanlinwenyuan/hlwy-ai-checker) 对语言模型随机数生成偏差研究的基础性贡献。
- 社区讨论与支持：[LINUX DO](https://linux.do/)

---

## ⚠️ 免责声明

1. 本工具测试结果仅供技术研究、对比及参考，**并非判断模型真伪的绝对性证据**。
2. 本工具属于**闭集归因测试**，仅在当前指纹库已收录的模型集合中寻找最接近的分布；若待测模型未收录于库中，归因结果可能不具有代表性。
3. 系统提示词可能改变模型的生成倾向，建议在纯净提示词或标准 API 环境下测试。
