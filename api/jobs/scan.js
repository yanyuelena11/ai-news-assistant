const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const MAX_SOURCES = 5;
const MAX_JOBS_PER_SOURCE = 8;
const MAX_RESULTS = 5;

const EXTRACTION_PROMPT = [
  "Extract up to 8 job opportunities visibly listed on this exact page.",
  "Focus on actual job postings, not navigation or promotional content.",
  "For each job return factual visible values only: title, employer, location, direct job URL,",
  "date, employment type, short description, junior or graduate evidence, transferable skills,",
  "future-relevant technology/digital/data/policy/innovation signals, learning or training signals,",
  "and evidence that the role is senior. Use empty strings or arrays when evidence is unavailable.",
  "Every evidence array item must be a short exact quote copied from the page, not a paraphrase.",
  "Only return a direct job URL when that link is visibly present on the page.",
  "Do not infer unsupported facts and do not return more than 8 jobs.",
].join(" ");

const STRING_FIELDS = [
  "title",
  "employer",
  "location",
  "jobUrl",
  "postedDate",
  "employmentType",
  "description",
];
const ARRAY_FIELDS = [
  "juniorEvidence",
  "transferableSkills",
  "futureRelevantSignals",
  "learningSignals",
  "seniorityWarnings",
];

const jobProperties = Object.fromEntries([
  ...STRING_FIELDS.map((field) => [field, { type: "string" }]),
  ...ARRAY_FIELDS.map((field) => [field, {
    type: "array",
    items: { type: "string" },
    maxItems: 5,
  }]),
]);

const JOB_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      maxItems: MAX_JOBS_PER_SOURCE,
      items: {
        type: "object",
        properties: jobProperties,
        required: [...STRING_FIELDS, ...ARRAY_FIELDS],
        additionalProperties: false,
      },
    },
  },
  required: ["jobs"],
  additionalProperties: false,
};

const JUNIOR_PATTERN = /\b(junior|graduate|entry[ -]?level|trainee|intern(ship)?|assistant|associate|coordinator|analyst|apprentice|0\s*[–-]\s*2 years?|no (prior )?experience)\b/i;
const SENIOR_PATTERN = /\b(senior|lead|principal|head|director|executive|manager|5\+? years?|[5-9]\s*(or more|plus)? years?)\b/i;
const CHALLENGE_PATTERN = /checking your browser|verification (failed|expired)|cloudflare|captcha|access denied/i;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  ) {
    return true;
  }

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] >= 224
  );
}

function validateUrls(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Enter at least one public job-listing URL.");
  }
  if (value.length > MAX_SOURCES) {
    throw new Error("Enter no more than five job-listing URLs.");
  }

  const urls = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error("Remove empty URL entries before scanning.");
    }

    let url;
    try {
      url = new URL(entry.trim());
    } catch {
      throw new Error("Every job source must be a valid http:// or https:// URL.");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Every job source must use http:// or https://.");
    }
    if (url.username || url.password || isPrivateHostname(url.hostname)) {
      throw new Error("Job sources must be public webpages without credentials.");
    }
    return url;
  });

  return [...new Map(urls.map((url) => [url.href, url])).values()];
}

function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body);
  return {};
}

function cleanString(value, limit = 500) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, 220)).filter(Boolean))].slice(0, 5);
}

function matchable(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function groundedString(value, pageText, limit) {
  const cleaned = cleanString(value, limit);
  if (!cleaned || !pageText) return cleaned;
  return matchable(pageText).includes(matchable(cleaned)) ? cleaned : "";
}

function groundedList(value, pageText, pattern) {
  return cleanList(value).filter((item) => {
    const appearsOnPage = !pageText || matchable(pageText).includes(matchable(item));
    return appearsOnPage && (!pattern || pattern.test(item));
  });
}

function safeJobUrl(value, sourceUrl, pageText = "") {
  if (!value) return "";
  try {
    const url = new URL(value, sourceUrl);
    const safe = ["http:", "https:"].includes(url.protocol) && !isPrivateHostname(url.hostname);
    const visiblyLinked = !pageText || pageText.includes(value) || pageText.includes(url.href);
    return safe && visiblyLinked ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeJob(value, sourceUrl, pageText = "") {
  const job = value && typeof value === "object" ? value : {};
  const title = groundedString(job.title, pageText, 180);
  if (!title) return null;

  return {
    title,
    employer: groundedString(job.employer, pageText, 160),
    location: groundedString(job.location, pageText, 160),
    jobUrl: safeJobUrl(job.jobUrl, sourceUrl, pageText),
    postedDate: groundedString(job.postedDate, pageText, 80),
    employmentType: groundedString(job.employmentType, pageText, 100),
    description: groundedString(job.description, pageText, 500),
    juniorEvidence: groundedList(job.juniorEvidence, pageText, JUNIOR_PATTERN),
    transferableSkills: groundedList(job.transferableSkills, pageText),
    futureRelevantSignals: groundedList(job.futureRelevantSignals, pageText),
    learningSignals: groundedList(job.learningSignals, pageText),
    seniorityWarnings: groundedList(job.seniorityWarnings, pageText, SENIOR_PATTERN),
    sourceDomain: sourceUrl.hostname.replace(/^www\./, ""),
    sourceUrl: sourceUrl.href,
  };
}

function dimensionScore(items) {
  if (items.length === 0) return 0;
  return Math.min(100, 50 + (items.length - 1) * 20);
}

function scoreJob(job) {
  const searchable = `${job.title} ${job.description}`;
  const hasJuniorTitle = JUNIOR_PATTERN.test(searchable);
  const hasSeniorTitle = SENIOR_PATTERN.test(searchable);
  const earlyCareer = job.juniorEvidence.length > 0 ? 100 : hasJuniorTitle ? 75 : 0;
  const seniorityPenalty = (hasSeniorTitle ? 65 : 0) + Math.min(35, job.seniorityWarnings.length * 20);
  const weighted =
    earlyCareer * 0.4 +
    dimensionScore(job.transferableSkills) * 0.3 +
    dimensionScore(job.futureRelevantSignals) * 0.2 +
    dimensionScore(job.learningSignals) * 0.1;
  return Math.max(0, Math.round(weighted - seniorityPenalty));
}

function explanation(job) {
  const accessible = job.juniorEvidence[0]
    || (JUNIOR_PATTERN.test(`${job.title} ${job.description}`)
      ? `The listing uses an early-career signal in “${job.title}”.`
      : "The listing does not state a clear early-career requirement; review it carefully.");
  const skills = job.transferableSkills.slice(0, 3).join(", ")
    || "No specific transferable skill was clearly extracted from this page.";
  const exposureSignals = [...job.futureRelevantSignals, ...job.learningSignals].slice(0, 3);
  const exposure = exposureSignals.join(", ")
    || "No specific future-relevant or learning exposure was clearly extracted.";

  return [
    { heading: "Accessible start", text: accessible },
    { heading: "Skills you can build", text: skills },
    { heading: "Career exposure", text: exposure },
  ];
}

function rankJobs(jobs) {
  const seen = new Set();
  return jobs
    .map((job) => ({ ...job, score: scoreJob(job) }))
    .filter((job) => {
      const hasEarlyCareerEvidence = job.juniorEvidence.length > 0
        || JUNIOR_PATTERN.test(`${job.title} ${job.description}`);
      const key = job.jobUrl || `${job.sourceDomain}|${job.title}|${job.employer}`.toLowerCase();
      if (!hasEarlyCareerEvidence || job.score === 0 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => second.score - first.score || first.title.localeCompare(second.title))
    .slice(0, MAX_RESULTS)
    .map((job) => ({ ...job, reasons: explanation(job) }));
}

function statusFor(url, status, message) {
  return {
    url: url.href,
    domain: url.hostname.replace(/^www\./, ""),
    status,
    message,
  };
}

async function extractSource(url, apiKey) {
  try {
    const firecrawlResponse = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url.href,
        formats: [
          "markdown",
          { type: "json", prompt: EXTRACTION_PROMPT, schema: JOB_SCHEMA },
        ],
        onlyMainContent: true,
        removeBase64Images: true,
        blockAds: true,
        timeout: 45_000,
      }),
      signal: AbortSignal.timeout(50_000),
    });

    if (!firecrawlResponse.ok) {
      return {
        jobs: [],
        source: statusFor(url, "failed", "This page could not be cleanly extracted. Try another public job page."),
      };
    }

    const payload = await firecrawlResponse.json();
    const markdown = typeof payload?.data?.markdown === "string" ? payload.data.markdown : "";
    if (!payload.success || !payload.data || CHALLENGE_PATTERN.test(markdown)) {
      return {
        jobs: [],
        source: statusFor(url, "failed", "This page could not be cleanly extracted. Try another public job page."),
      };
    }

    const extracted = Array.isArray(payload.data.json?.jobs)
      ? payload.data.json.jobs.slice(0, MAX_JOBS_PER_SOURCE)
      : [];
    const jobs = extracted.map((job) => normalizeJob(job, url, markdown)).filter(Boolean);
    if (jobs.length === 0) {
      return {
        jobs: [],
        source: statusFor(url, "no_jobs", "No usable job listings were found on this page."),
      };
    }

    return {
      jobs,
      source: statusFor(url, "extracted", `Extracted ${jobs.length} visible job${jobs.length === 1 ? "" : "s"}.`),
    };
  } catch {
    return {
      jobs: [],
      source: statusFor(url, "failed", "This page could not be cleanly extracted. Try another public job page."),
    };
  }
}

async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST to scan job-listing pages." });
  }

  let body;
  try {
    body = parseBody(request);
  } catch {
    return sendJson(response, 400, { error: "Send valid JSON containing a urls array." });
  }

  let urls;
  try {
    urls = validateUrls(body.urls);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      error: "Job scanning is not configured yet. Add FIRECRAWL_API_KEY on the server.",
    });
  }

  const results = await Promise.all(urls.map((url) => extractSource(url, apiKey)));
  const sources = results.map((result) => result.source);
  const jobs = rankJobs(results.flatMap((result) => result.jobs));

  if (sources.every((source) => source.status === "failed")) {
    return sendJson(response, 502, {
      error: "None of these pages could be cleanly extracted. Try another public job page.",
      sources,
      jobs: [],
    });
  }

  return sendJson(response, 200, { sources, jobs });
}

module.exports = handler;
module.exports._test = { explanation, normalizeJob, rankJobs, scoreJob, validateUrls };
