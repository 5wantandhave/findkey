# 公益 API 站点导航

> 少翻几个帖子，快点发现还能用的公益 AI API。

这个小项目做的事情很简单：

- 用 Tavily Search + OpenAI 兼容接口，定期从公开网页里挖「看起来有用」的 AI 接口站点；
- 把站点信息整理成一个 `sites.json`；
- 前端用一个表格页，帮你一页扫过这些入口，按关键词 / 标签 / 分类筛一筛。

🌐 **在线访问**: [FIND KEY](https://findkey.openjoy.asia)（如果对你有帮助，欢迎点个 ⭐ Star 支持一下！）
---

## 如何使用

### 本地运行

```bash
# 安装依赖
npm install

# 配置环境变量（根目录创建 .env）
# 参考 .env.example

# 采集最新站点数据
npm run collect

# 启动前端（http://localhost:5173/）
npm run dev
```

`.env` 里需要的核心变量：

```env
TAVILY_API_KEY=your_tavily_key_here
OPENAI_API_KEY=your_openai_like_key_here
# 可选：OPENAI_BASE_URL, OPENAI_MODEL
```

### 云端自动采集 + 托管

推荐的组合：**GitHub Actions 定时采集 + Cloudflare Pages 托前端**。

大致流程：

1. 在 GitHub 仓库里配置 Secrets：
   - `TAVILY_API_KEY`, `OPENAI_API_KEY` 等（用于采集数据）
   - **`PAT_TOKEN`**（⚠️ 重要：用于触发 Cloudflare Pages 自动部署）
2. 使用 `.github/workflows/github-actions-collect.yml`，每隔一段时间跑一次 `npm run collect`，如果 `public/data/sites.json` 变了就自动 commit + push；
3. 在 Cloudflare Pages 里：
   - 连接这个 GitHub 仓库；
   - Build 命令：`npm run build`；
   - 输出目录：`dist`；
4. Pages 每次看到新 commit 会自动重建前端，前端始终从最新的 `/data/sites.json` 读取数据。

#### 关于 PAT_TOKEN 的说明

由于 Cloudflare Pages 默认不会响应 GitHub Actions bot 的自动提交，需要使用 **Personal Access Token (PAT)** 来代替默认的 `GITHUB_TOKEN`。

**配置步骤：**
1. 访问 https://github.com/settings/tokens
2. 点击 **Generate new token (classic)**
3. 勾选 `repo` 权限
4. 生成并复制 token
5. 在你的仓库 → Settings → Secrets and variables → Actions 中，添加名为 `PAT_TOKEN` 的 secret


---

## 用到了哪些服务？

- **Tavily Search API**：按预设关键词检索「免费 / 公益 AI API / 公益站 / 中转站」相关网页；
- **OpenAI 兼容 Chat Completions API**：
  - 识别哪些页面是实际 API 提供方；
  - 从帖子 / 周刊 / 汇总贴中抽出真实的 API 站点；
  - 生成结构化字段（标题、简介、标签、免费额度描述等）；
- **GitHub Actions**：在云端定时执行采集脚本，更新 `public/data/sites.json`；
- **Cloudflare Pages（Free）**：托管打包后的前端静态页面。

---

## 免责声明 & 使用提醒

这个导航是一个偏个人 / 社区向的小项目，只是帮你更快看到「有哪些看起来有用的入口」，不是任何形式的背书或推荐。

使用时请注意：

1. **信息时效性**
   互联网更新很快，站点的免费额度、使用规则、可用性都可能随时变化。这里展示的信息只代表采集时的情况，使用前请以各站点的官方说明为准。

2. **安全与合规**
   请结合你所在地区的法律与合规要求使用这些服务。建议不要在第三方站点输入任何敏感或机密信息，一些平台可能会记录请求并用于日志分析或模型训练。

3. **一起珍惜公益资源**
   很多所谓「公益站」其实是站长自掏腰包在维护，更适合日常试用、功能体验或学习研究，不适合作为高强度刷量或商业代工的长期依赖，这样它们也能活得久一点。

4. **不要把公益服务当生产唯一依赖**
   公益 / 免费服务天然有不稳定性。如果是严肃业务或高并发场景，更推荐直接使用官方或云厂商的付费方案，把这里当成「逛逛看」的索引会更合适。

如果有不当收录或侵权，请在仓库里提 issue 或反馈，我们会尽量及时处理。

---

## 协议

本项目采用 [MIT License](LICENSE) 开源协议。
