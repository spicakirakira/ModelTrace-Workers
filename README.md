# ModelTrace-Worker

> 🚀 在 Cloudflare Workers 上完全运行的主动语言模型指纹归因与识别工具。
> 本项目基于 [xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace) 进行无服务器（Serverless）重构与全功能复刻。

---

## 🌟 为什么选择 ModelTrace-Worker？

原版 ModelTrace 是一个依赖 Python (Flask / NumPy) 本地运行或部署的工具。**ModelTrace-Worker** 将其核心算法与完整服务移植到了 **Cloudflare Workers** 边缘运行时：

- ⚡ **零服务器运维**：无需购买云主机、无需配置 Python / Docker 环境，免费一键部署到全球 CDN 边缘节点。
- 🖥️ **100% 保持原有 UI 与交互体验**：完整复刻原版双工作区（模型测试、指纹库管理）、三次长整数挑战手动测试、API 自动探针测试、实时调用进度条及可视化归因表格。
- 📦 **完整内置 18 个模型指纹库**：
  - **GPT 家族 (8 个)**：`gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`
  - **Claude 家族 (10 个)**：`claude-haiku-4-5-20251001`、`claude-sonnet-4-6`、`claude-sonnet-5`、`claude-opus-4-6`、`claude-opus-4-7`、`claude-opus-4-8`、`claude-opus-5`、`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`
- 🎯 **数学算法完全一致**：使用纯原生 JavaScript 实现 Hellinger 相似度、有序四分区块数字特征、Jacobi SVD 矩阵分解与环境去噪、多查询交叉验证温度校准。预测概率和模型排序与原版 NumPy 结果精度完全对齐（误差 $< 10^{-14}$）。
- 🗄️ **完整的指纹库管理**：支持切换查看 GPT / Claude 指纹库、在线新建指纹库、通过 API 自动采集探针并重构指纹库。支持内存模式或绑定 Cloudflare KV 持久化存储。

---

## 🚀 快速上手与部署

### 1. 部署到 Cloudflare Workers

确保已安装 [Node.js](https://nodejs.org/) (>= 18)：

```bash
# 1. 克隆代码仓库
git clone https://github.com/<你的用户名>/modeltrace-worker.git
cd modeltrace-worker

# 2. 安装依赖
npm install

# 3. 部署到 Cloudflare
npx wrangler deploy
```

部署完成后，命令行将输出形如 `https://modeltrace-worker.<你的子域>.workers.dev` 的访问链接，直接在浏览器中打开即可使用！

### 2. 本地调试预览

```bash
# 本地启动 Worker 模拟环境
npx wrangler dev
```
浏览器访问 `http://localhost:8787`。

### 3. 运行测试套件

```bash
npm test
```
自带完整的单元测试与端到端模拟测试（覆盖算法精度、API 端点、上游探针等）。

---

## ⚙️ 可选配置：启用 KV 持久化存储

默认情况下，自定义创建的指纹库运行在内存存储中。如果希望在线创建的新指纹库在实例重启或跨数据中心间永久保存：

1. 创建 KV 命名空间：
```bash
npx wrangler kv:namespace create MODELTRACE_KV
```

2. 在 `wrangler.jsonc` 中添加配置：
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

3. 重新执行 `npx wrangler deploy` 即可。

---

## 📖 使用说明

- **手动测试**：在“模型测试”页面中点击“复制提示词”，依次将三次不同的长整数生成挑战发送给同一个待测模型，将模型的完整输出分别粘贴到对应文本框中，点击“计算归因概率”。
- **API 自动测试**：填入待测模型的 Base URL、接口模型名、API Key 及温度（可选），点击“开始测试”。程序会自动以 OpenAI 或 Anthropic 协议发起探针，获取有效序列后自动完成归因。
- **指纹库管理**：在“指纹库管理”中可随时查看内置 GPT、Claude 模型的指纹分布，或创建新模型库并使用 API 进行自动化采样建库。

---

## 📂 项目结构

```text
modeltrace-worker/
├── src/
│   ├── index.js              # Cloudflare Worker 路由与 API 主入口
│   ├── fingerprint.js        # 稳健数字指纹提取与统一归因算法
│   ├── challenge-suite.js    # 随机挑战题目与建库测试套件
│   ├── bank-builder.js       # 指纹拟合、SVD 奇异值分解去噪与温度校准
│   ├── store.js              # 指纹库摘要管理与 KV / 内存状态存储
│   ├── enrollment.js         # 模型 API 探针请求与协议自动探测
│   ├── banks.js              # 内置指纹库加载与流式解压管理
│   ├── builtin-banks-data.js # 打包的内置指纹库 gzip base64 数据
│   ├── html-template.js      # 完整 Web UI HTML 页面渲染
│   └── ui-assets.js          # 原版 CSS 样式与客户端交互逻辑
├── test/
│   ├── worker.test.js        # 核心算法与 Worker API 端点测试
│   └── probe.test.js         # API 探针模拟测试
├── LICENSE                   # 开源许可协议 (MIT License)
├── wrangler.jsonc            # Cloudflare Workers 配置文件
└── package.json              # 项目配置
```

---

## 📄 开源协议与致谢

- 本项目基于 [MIT 许可证](LICENSE) 开源。
- 感谢原项目作者 **[xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace)** 提供的模型指纹采集数据、核心算法设计与 Web UI 构思。原项目版权归原作者所有。
- 感谢 [hanlinwenyuan/hlwy-ai-checker](https://github.com/hanlinwenyuan/hlwy-ai-checker) 为语言模型随机数字生成偏差研究提供的开创性工作。
- 社区交流：[LINUX DO](https://linux.do/)

---

## ⚠️ 声明

1. 测试结果仅供技术研究与参考，并非判断模型的绝对性证据。
2. 该工具为闭集归因工具，只对指纹库内已收录的模型进行相似度拟合；若待测模型不在指纹库中，得到任何候选结果都是有可能的。
3. 系统提示词可能严重影响模型的输出分布偏好（例如在 Claude Code 中得到的测试结果会存在偏差），建议在纯净对话或标准 API 环境下测试。
