const assert = require("node:assert/strict");
const test = require("node:test");

const newsHandler = require("../api/news");
const scrapeHandler = require("../api/scrape");

function invoke(handler, request) {
  return new Promise((resolve) => {
    const headers = {};
    const response = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(body) {
        resolve({ status: this.statusCode, headers, body: JSON.parse(body) });
      },
    };
    handler(request, response);
  });
}

test("RSS parser normalizes an article and strips markup", () => {
  const xml = `
    <rss><channel><item>
      <guid>story-1</guid>
      <title>AI &amp; Science</title>
      <link>https://example.com/story</link>
      <pubDate>Fri, 12 Sep 2026 08:00:00 GMT</pubDate>
      <description><![CDATA[<p>A <strong>clear</strong> summary.</p>]]></description>
    </item></channel></rss>`;

  const article = newsHandler._test.parseFeed(xml, "Example")[0];
  assert.match(article.id, /^example-[a-f0-9]{16}$/);
  assert.deepEqual(article, {
    id: article.id,
    source: "Example",
    title: "AI & Science",
    url: "https://example.com/story",
    publishedAt: "2026-09-12T08:00:00.000Z",
    summary: "A clear summary.",
  });
});

test("scrape route rejects non-web and private URLs", async () => {
  const fileResult = await invoke(scrapeHandler, {
    method: "POST",
    body: { url: "file:///etc/passwd" },
  });
  const localResult = await invoke(scrapeHandler, {
    method: "POST",
    body: { url: "http://127.0.0.1/private" },
  });

  assert.equal(fileResult.status, 400);
  assert.equal(localResult.status, 400);
});

test("scrape route reports a missing server-side API key", async () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;

  const result = await invoke(scrapeHandler, {
    method: "POST",
    body: { url: "https://example.com/story" },
  });

  if (originalKey) process.env.FIRECRAWL_API_KEY = originalKey;
  assert.equal(result.status, 503);
  assert.match(result.body.error, /not configured/i);
});

test("scrape route normalizes and limits the Firecrawl response", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-secret";
  global.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    return {
      ok: true,
      async json() {
        return {
          success: true,
          data: {
            markdown: "A".repeat(5_100),
            metadata: {
              title: "A useful story",
              description: "A short description",
              sourceURL: "https://example.com/story",
            },
          },
        };
      },
    };
  };

  const result = await invoke(scrapeHandler, {
    method: "POST",
    body: { url: "https://example.com/story" },
  });

  global.fetch = originalFetch;
  if (originalKey) process.env.FIRECRAWL_API_KEY = originalKey;
  else delete process.env.FIRECRAWL_API_KEY;

  assert.equal(result.status, 200);
  assert.equal(result.body.page.title, "A useful story");
  assert.equal(result.body.page.domain, "example.com");
  assert.equal(result.body.page.content.length, 5_001);
  assert.doesNotMatch(JSON.stringify(result.body), /test-secret/);
});
