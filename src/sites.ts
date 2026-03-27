export type SiteCategory = 'platform' | 'public_free' | 'reference';

export interface Site {
  url: string;
  title: string;
  summary: string;
  hasOfficialApiInfo: boolean;
  hasFreeQuotaInfo: boolean;
  hasIdeOrSdkInfo: boolean;
  tags: string[];
  sourceKeywords: string[];
  firstSeenAt: string; // ISO date string
  lastUpdatedAt: string; // ISO date string
  // 可选分类字段，由后端或前端推断：
  // - 'public_free': 公益 / 免费 API 公益站
  // - 'platform':    AI 接口平台 / 网关（不一定公益）
  // - 'reference':   论坛贴 / 周刊 / 聚合入口等
  category?: SiteCategory;
  // 可选字段：免费额度描述，由后端从摘要中提取
  freeQuotaDesc?: string;
}

interface SitesFile {
  sites: Site[];
  lastCollectedAt?: string;
}

export async function loadSites(): Promise<SitesFile> {
  const res = await fetch('/data/sites.json', { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load sites.json: ${res.status}`);
  }
  return (await res.json()) as SitesFile;
}
