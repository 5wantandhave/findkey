import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAVILY_API_URL = 'https://api.tavily.com/search';

// 关键字列表：可以根据需要自行调整 / 扩展
const KEYWORDS = [
  // 基础“公益站 / 公益 API”类
  'api 站',
  'API 站点',
  '公益站',
  'Claude Code 公益站',
  'api 公益站',
  'API 中转',
  '公益 API',
  '公益 api',
  'LINUX DO 公益',
  'L站 公益',
  "2026 公益 API",
  "sk- 免费 API",

  // // 技术协议 / 管理系统关键词
  // 'One API 公益',
  // 'New API 公益',

  // // 社区 / 阵地关键词
  // 'site:nodeseek.com API 公益',
  // 'site:v2ex.com 公益 API',
];

async function loadSitesFile(jsonPath) {
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.sites || !Array.isArray(data.sites)) {
      return { sites: [] };
    }
    return data;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { sites: [] };
    }
    if (err instanceof SyntaxError || err?.name === 'SyntaxError') {
      console.warn('sites.json 内容不是合法 JSON，将从空集合重新开始。');
      return { sites: [] };
    }
    throw err;
  }
}

async function saveSitesFile(jsonPath, data) {
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

// 噪音站点：视频等，直接跳过
function isNoiseHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes('bilibili.com') ||
      host.includes('youtube.com') ||
      host === 'youtu.be'
    );
  } catch {
    return false;
  }
}

// 参考页：论坛帖 / 周刊 / 聚合入口，用来深度挖掘外链站点
function isReferencePageHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /linux\.do|github\.com|nodeseek\.com|sharexbar\.com/.test(host);
  } catch {
    return false;
  }
}

async function searchWithTavily(keyword) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('环境变量 TAVILY_API_KEY 未设置');
  }

  const resp = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: keyword,
      // 对“公益 / free”相关关键词多抓一些结果
      max_results: /公益|free|免费/i.test(keyword) ? 16 : 8,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: true, // 需要原始内容，方便优质站点多看一点
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Tavily 请求失败: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.results ?? [];
}

// 提取更长一点的正文内容，优先使用 Tavily 的 raw_content，其次 content
function buildLongContent(raw) {
  // Tavily 在 include_raw_content=true 时，通常会返回 raw_content 字段
  const rawContent = (raw.raw_content || raw.content || '').toString();
  // 限制长度，避免 token 爆炸
  return rawContent.slice(0, 8000);
}

// 分析单个搜索结果，判断是否为“提供免费 / 公益 / 试用 AI API 服务的站点”
// 如果不相关，返回 null；如果相关，返回结构化信息（不含 firstSeenAt/lastUpdatedAt）
async function summarizeWithOpenAI(raw, keyword) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('环境变量 OPENAI_API_KEY 未设置');
  }

  // 这里支持中转站：
  // - OPENAI_BASE_URL 设置为你的 baseURL，例如 https://ai.td.ee
  // - OPENAI_MODEL 设置为你的模型名，例如 gpt-5.3-codex
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const longContent = buildLongContent(raw);

  const systemPrompt =
    '你是一个帮助整理“提供免费 / 公益 / 试用 AI API 接口的站点（公益站、中转站等）”的助手。仅根据给定的标题和内容，判断该页面是否是一个直接提供 AI 接口服务的网站（包括公益中转站、API 网关、平台官网、接口文档等），并且页面中提到免费、公益或明显强调免费额度 / 试用计划。页面如果只是教程、新闻、经验分享或纯导航列表，但自身不是接口服务提供者，可以视为不相关。';

  const userPrompt = `请分析下面网页的标题和内容，判断它是否属于以下情况之一：
1）该站点本身就是 AI 接口服务提供方（例如“XX API 公益站”“免费 AI 接口平台”“中转站”等），页面主要内容是接口介绍、文档或使用说明，并且提到免费/公益/试用/免费额度；
2）该页面是此类站点的首页、文档页或关于页，明确说明自己提供 AI API 服务，且有免费或公益相关描述。

如果页面只是教程、经验分享、资讯、新闻、周刊、论坛讨论，或者只是列出别的网站链接而自身不提供接口服务，请在 JSON 中标记为 notRelevant。

网页标题：${raw.title}

网页内容（可能是摘要或原文片段）：${longContent}

请用如下 JSON 结构回答（不要添加多余文字）：
{
  "title": "页面的简要标题（可重写，更清晰地表达用途）",
  "summary": "用 1-3 句简要说明该站点提供了什么 AI 接口服务，以及是否有免费/公益/试用相关信息。",
  "hasOfficialApiInfo": true/false,
  "hasFreeQuotaInfo": true/false,
  "hasIdeOrSdkInfo": true/false,
  "freeQuotaDesc": "如果有免费额度 / 公益用量 / 签到送额度等信息，请尽量用一两句话提取出来；如果没有，请留空字符串。",
  "tags": ["若干标签，如 公益站, AI 中转, 免费额度, 文档 等"],
  "notRelevant": true/false
}`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI 请求失败: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('OpenAI 返回内容为空或格式异常');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('解析 OpenAI 返回的 JSON 失败: ' + e.message + '\n原始内容: ' + content);
  }

  if (parsed.notRelevant) {
    // 正常不相关：返回 null，由调用方决定是否打印日志
    return null;
  }

  const cleanTags = Array.isArray(parsed.tags)
    ? parsed.tags
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0)
    : [];

  return {
    url: normalizeUrl(raw.url),
    title: String(parsed.title || raw.title || raw.url),
    summary: String(parsed.summary || ''),
    hasOfficialApiInfo: Boolean(parsed.hasOfficialApiInfo),
    hasFreeQuotaInfo: Boolean(parsed.hasFreeQuotaInfo),
    hasIdeOrSdkInfo: Boolean(parsed.hasIdeOrSdkInfo),
    tags: cleanTags,
    sourceKeywords: [keyword],
    freeQuotaDesc: String(parsed.freeQuotaDesc || ''),
  };
}

// 针对 linux.do / GitHub / nodeseek / sharexbar 等“入口页”，
// 从帖子 / 周刊内容中提取真正的 API 站点
async function extractSitesFromReferencePage(raw, keyword) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('环境变量 OPENAI_API_KEY 未设置');
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const longContent = buildLongContent(raw);

  const systemPrompt =
    '你是一个帮助从论坛帖子、周刊文章或聚合页中，提取实际“提供免费 / 公益 / 试用 AI API 接口服务站点”的助手。' +
    '你只关心那些真正提供 API 服务的网站（公益站、中转站、API 网关、平台官网、接口文档等），并且页面中有免费、公益或免费额度 / 试用计划等信息。' +
    '忽略纯讨论、新闻、经验分享或只是简单贴出别的链接却没有免费 / 公益说明的内容。';

  const userPrompt = `下面是一个论坛帖子、周刊文章或聚合页面的标题和内容。请从中找出所有满足以下条件的网站：

1）该网站本身是 AI 接口服务提供方（包括公益中转站、API 网关、平台官网、接口文档等）；
2）文字中提到免费 / 公益 / 试用 / 免费额度等信息；

只考虑真正提供 API 服务的站点，不要返回教程、博客、仅托管代码的开源项目等。

原始页面 URL: ${raw.url}
原始页面标题: ${raw.title}

原始页面内容（可能是摘要或原文片段）:
${longContent}

请严格按照下面的 JSON 结构返回（不要添加多余文字）：
{
  "sites": [
    {
      "url": "https://...",
      "title": "网站的简要标题（可重写，更清晰地表达用途）",
      "summary": "用 1-3 句简要说明该站点提供了什么 AI 接口服务，以及是否有免费/公益/试用相关信息。",
      "hasOfficialApiInfo": true/false,
      "hasFreeQuotaInfo": true/false,
      "hasIdeOrSdkInfo": true/false,
      "freeQuotaDesc": "如果有免费额度 / 公益用量 / 签到送额度等信息，请尽量用一两句话提取出来；如果没有，请留空字符串。",
      "tags": ["若干标签，如 公益站, AI 中转, 免费额度, 文档 等"]
    }
  ]
}`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 700,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI(参考页提取) 请求失败: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('OpenAI(参考页提取) 返回内容为空或格式异常');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('解析 OpenAI(参考页提取) 返回的 JSON 失败: ' + e.message + '\n原始内容: ' + content);
  }

  const rawSites = Array.isArray(parsed.sites) ? parsed.sites : [];
  return rawSites
    .map((item) => {
      const cleanTags = Array.isArray(item.tags)
        ? item.tags
            .map((t) => String(t).trim())
            .filter((t) => t.length > 0)
        : [];

      return {
        url: String(item.url || '').trim(),
        title: String(item.title || item.url || '').trim(),
        summary: String(item.summary || ''),
        hasOfficialApiInfo: Boolean(item.hasOfficialApiInfo),
        hasFreeQuotaInfo: Boolean(item.hasFreeQuotaInfo),
        hasIdeOrSdkInfo: Boolean(item.hasIdeOrSdkInfo),
        freeQuotaDesc: String(item.freeQuotaDesc || ''),
        tags: cleanTags,
      };
    })
    .filter((s) => s.url);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.join(__dirname, '..');
  const jsonPath = path.join(projectRoot, 'public', 'data', 'sites.json');

  const sitesFile = await loadSitesFile(jsonPath);
  const byUrl = new Map();
  for (const s of sitesFile.sites) {
    byUrl.set(normalizeUrl(s.url), s);
  }

  const now = new Date().toISOString();
  let addedCount = 0;

  for (const keyword of KEYWORDS) {
    console.log(`***** 使用 Tavily 搜索关键字: ${keyword} *****`);
    let results = [];
    try {
      results = await searchWithTavily(keyword);
    } catch (e) {
      console.error('Tavily 搜索失败:', e);
      continue;
    }

    for (const r of results) {
      const normalized = normalizeUrl(r.url);
      if (!normalized.startsWith('http')) continue;

      // 噪音站点（视频等）直接跳过，避免浪费配额
      if (isNoiseHost(normalized)) {
        console.log('噪音站点，跳过:', normalized);
        continue;
      }

      const existing = byUrl.get(normalized);
      if (existing) {
        const mergedKeywords = Array.from(
          new Set([...(existing.sourceKeywords || []), keyword]),
        );
        existing.sourceKeywords = mergedKeywords;
        existing.lastUpdatedAt = now;
        byUrl.set(normalized, existing);
        continue;
      }

      console.log('新站点，尝试分析:', normalized);
      try {
        const summarized = await summarizeWithOpenAI(r, keyword);

        if (!summarized) {
          // 第一轮判定“不是自己提供 API 服务”
          // 如果是 linux.do / GitHub / nodeseek / sharexbar 这类参考页，再尝试从内容里提取真实 API 站点
          if (isReferencePageHost(normalized)) {
            console.log('参考页，尝试从内容中提取实际 API 站点:', normalized);
            try {
              const extractedSites = await extractSitesFromReferencePage(r, keyword);
              if (!extractedSites.length) {
                console.log('参考页未提取到实际 API 站点，跳过:', normalized);
                continue;
              }

              for (const extracted of extractedSites) {
                const innerUrl = normalizeUrl(extracted.url);
                if (!innerUrl.startsWith('http')) continue;

                const existingInner = byUrl.get(innerUrl);
                if (existingInner) {
                  const mergedKeywordsInner = Array.from(
                    new Set([...(existingInner.sourceKeywords || []), keyword]),
                  );
                  existingInner.sourceKeywords = mergedKeywordsInner;
                  existingInner.lastUpdatedAt = now;
                  byUrl.set(innerUrl, existingInner);
                  continue;
                }

                const siteFromRef = {
                  ...extracted,
                  sourceKeywords: [keyword],
                  firstSeenAt: now,
                  lastUpdatedAt: now,
                };
                byUrl.set(innerUrl, siteFromRef);
                addedCount++;
              }
            } catch (e) {
              console.warn('从参考页提取站点失败，跳过:', normalized, '\n原因:', e);
            }
          } else {
            console.log('页面被判定为不相关，跳过:', normalized);
          }
          continue;
        }

        // summarized 非空：说明这个页面本身就是 API 提供方
        const site = {
          ...summarized,
          firstSeenAt: now,
          lastUpdatedAt: now,
        };
        byUrl.set(normalized, site);
        addedCount++;
      } catch (e) {
        console.warn('分析站点失败，跳过:', normalized, '\n原因:', e);
      }
    }
  }

  const sortedSites = Array.from(byUrl.values()).sort((a, b) => {
    return String(a.firstSeenAt || '').localeCompare(String(b.firstSeenAt || ''));
  });

  const finishedAt = new Date().toISOString();

  await saveSitesFile(jsonPath, { sites: sortedSites, lastCollectedAt: finishedAt });

  console.log(`完成。本次新增 ${addedCount} 条记录，总计 ${sortedSites.length} 条。`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
