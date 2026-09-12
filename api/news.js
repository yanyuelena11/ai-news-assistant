const crypto = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");

const FEEDS = [
  { source: "WIRED", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  { source: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { source: "VentureBeat", url: "https://venturebeat.com/category/ai/feed/" },
];

const ITEMS_PER_SOURCE = 6;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: true,
  trimValues: true,
});

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === "object") {
    return textValue(value["#text"] ?? value.__cdata ?? value.href ?? "");
  }
  return "";
}

function decodeEntities(value) {
  const entities = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return entities[entity.toLowerCase()] ?? match;
  });
}

function cleanText(value) {
  return decodeEntities(textValue(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function itemLink(item) {
  if (typeof item.link === "string") return item.link;
  if (Array.isArray(item.link)) {
    const alternate = item.link.find((link) => link?.rel === "alternate") ?? item.link[0];
    return textValue(alternate);
  }
  return textValue(item.link);
}

function stableId(source, item, url, title, publishedAt) {
  const identity = textValue(item.guid ?? item.id) || url || `${title}-${publishedAt}`;
  const digest = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `${source.toLowerCase()}-${digest}`;
}

function normalizeDate(value) {
  const raw = textValue(value);
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function parseFeed(xml, source) {
  const document = parser.parse(xml);
  const rssItems = asArray(document?.rss?.channel?.item);
  const atomItems = asArray(document?.feed?.entry);
  const items = rssItems.length > 0 ? rssItems : atomItems;

  return items
    .slice(0, ITEMS_PER_SOURCE)
    .map((item) => {
      const title = cleanText(item.title) || "Untitled story";
      const url = itemLink(item);
      const publishedAt = normalizeDate(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]);
      const summary = cleanText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content);

      return {
        id: stableId(source, item, url, title, publishedAt),
        source,
        title,
        url,
        publishedAt,
        summary,
      };
    })
    .filter((article) => article.url.startsWith("http://") || article.url.startsWith("https://"));
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
      "User-Agent": "AI-News-Briefing/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`${feed.source} returned HTTP ${response.status}`);

  const articles = parseFeed(await response.text(), feed.source);
  if (articles.length === 0) throw new Error(`${feed.source} did not return readable stories`);
  return articles;
}

async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Use GET to load the latest news." });
  }

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const warnings = [];
  const articles = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") articles.push(...result.value);
    else warnings.push(`${FEEDS[index].source} is temporarily unavailable.`);
  });

  articles.sort((first, second) => {
    const firstDate = Date.parse(first.publishedAt) || 0;
    const secondDate = Date.parse(second.publishedAt) || 0;
    return secondDate - firstDate;
  });

  if (articles.length === 0) {
    return sendJson(response, 502, {
      error: "No news feeds are available right now. Please try again shortly.",
      warnings,
    });
  }

  response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  return sendJson(response, 200, { articles: articles.slice(0, 18), warnings });
}

module.exports = handler;
module.exports._test = { cleanText, parseFeed };
