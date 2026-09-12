const assert = require("node:assert/strict");
const test = require("node:test");

const newsHandler = require("../api/news");
const scrapeHandler = require("../api/scrape");
const jobsHandler = require("../api/jobs/scan");

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

test("job scan validates source count, schemes, private hosts, and duplicates", () => {
  assert.throws(() => jobsHandler._test.validateUrls([]), /at least one/i);
  assert.throws(
    () => jobsHandler._test.validateUrls(Array.from({ length: 6 }, (_, index) => `https://example${index}.com`)),
    /no more than five/i,
  );
  assert.throws(() => jobsHandler._test.validateUrls(["file:///jobs"]), /http:\/\//i);
  assert.throws(() => jobsHandler._test.validateUrls(["http://127.0.0.1/jobs"]), /public/i);
  assert.equal(
    jobsHandler._test.validateUrls(["https://example.com/jobs", "https://example.com/jobs"]).length,
    1,
  );
});

test("job ranking deprioritizes senior roles and returns exactly three reasons", () => {
  const source = new URL("https://jobs.example.com/search");
  const junior = jobsHandler._test.normalizeJob({
    title: "Graduate Data Analyst",
    employer: "Example Agency",
    description: "Graduate role with training in analysis and digital services.",
    juniorEvidence: ["The listing welcomes graduates."],
    transferableSkills: ["Data analysis", "Communication"],
    futureRelevantSignals: ["Digital services"],
    learningSignals: ["Formal training"],
    seniorityWarnings: [],
  }, source);
  const senior = jobsHandler._test.normalizeJob({
    title: "Senior Data Director",
    description: "Requires 8 years of experience.",
    juniorEvidence: [],
    transferableSkills: ["Leadership"],
    futureRelevantSignals: ["Data strategy"],
    learningSignals: [],
    seniorityWarnings: ["Eight years of experience required"],
  }, source);

  const ranked = jobsHandler._test.rankJobs([senior, junior]);
  assert.equal(ranked[0].title, "Graduate Data Analyst");
  assert.equal(ranked[0].reasons.length, 3);
  assert.deepEqual(ranked[0].reasons.map((reason) => reason.heading), [
    "Accessible start",
    "Skills you can build",
    "Career exposure",
  ]);
});

test("job extraction discards structured claims not grounded in scraped text", () => {
  const source = new URL("https://jobs.example.com/search");
  const page = "Graduate Research Assistant — Example University. Apply at /roles/graduate-research.";
  const grounded = jobsHandler._test.normalizeJob({
    title: "Graduate Research Assistant",
    employer: "Example University",
    jobUrl: "/roles/graduate-research",
    juniorEvidence: ["Graduate Research Assistant"],
    transferableSkills: ["Research"],
  }, source, page);
  const invented = jobsHandler._test.normalizeJob({
    title: "Junior Quantum Engineer",
    employer: "Imaginary Labs",
    juniorEvidence: ["No experience required"],
  }, source, page);

  assert.equal(grounded.title, "Graduate Research Assistant");
  assert.equal(grounded.employer, "Example University");
  assert.equal(grounded.jobUrl, "https://jobs.example.com/roles/graduate-research");
  assert.equal(grounded.transferableSkills.length, 1);
  assert.equal(invented, null);
});

test("job scan handles one source and the five-source limit", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-secret";
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      async json() {
        return { success: true, data: { markdown: "Jobs page", json: { jobs: [] } } };
      },
    };
  };

  const oneSource = await invoke(jobsHandler, {
    method: "POST",
    body: { urls: ["https://jobs1.example/search"] },
  });
  const fiveSources = await invoke(jobsHandler, {
    method: "POST",
    body: { urls: Array.from({ length: 5 }, (_, index) => `https://jobs${index + 1}.example/search`) },
  });

  global.fetch = originalFetch;
  if (originalKey) process.env.FIRECRAWL_API_KEY = originalKey;
  else delete process.env.FIRECRAWL_API_KEY;

  assert.equal(oneSource.status, 200);
  assert.equal(oneSource.body.sources.length, 1);
  assert.equal(fiveSources.status, 200);
  assert.equal(fiveSources.body.sources.length, 5);
  assert.equal(requestCount, 6);
});

test("job scan keeps successful sources when another source fails", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-secret";
  global.fetch = async (_endpoint, options) => {
    const request = JSON.parse(options.body);
    if (request.url.includes("broken.example")) return { ok: false, status: 403 };
    return {
      ok: true,
      async json() {
        return {
          success: true,
          data: {
            markdown: [
              "Junior Policy Analyst",
              "Public Service",
              "Remote",
              "/jobs/123",
              "2026-09-12",
              "Full time",
              "Entry-level analysis role with mentoring.",
              "Entry-level role",
              "Research",
              "Writing",
              "Digital policy",
              "Mentoring",
            ].join(" "),
            json: {
              jobs: [{
                title: "Junior Policy Analyst",
                employer: "Public Service",
                location: "Remote",
                jobUrl: "/jobs/123",
                postedDate: "2026-09-12",
                employmentType: "Full time",
                description: "Entry-level analysis role with mentoring.",
                juniorEvidence: ["Entry-level role"],
                transferableSkills: ["Research", "Writing"],
                futureRelevantSignals: ["Digital policy"],
                learningSignals: ["Mentoring"],
                seniorityWarnings: [],
              }],
            },
          },
        };
      },
    };
  };

  const result = await invoke(jobsHandler, {
    method: "POST",
    body: { urls: ["https://jobs.example/jobs", "https://broken.example/jobs"] },
  });

  global.fetch = originalFetch;
  if (originalKey) process.env.FIRECRAWL_API_KEY = originalKey;
  else delete process.env.FIRECRAWL_API_KEY;

  assert.equal(result.status, 200);
  assert.equal(result.body.jobs.length, 1);
  assert.equal(result.body.sources[0].status, "extracted");
  assert.equal(result.body.sources[1].status, "failed");
  assert.equal(result.body.jobs[0].jobUrl, "https://jobs.example/jobs/123");
  assert.doesNotMatch(JSON.stringify(result.body), /markdown/i);
  assert.doesNotMatch(JSON.stringify(result.body), /test-secret/);
});
