const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const CONTENT_LIMIT = 5_000;

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

function validatePublicUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("A webpage URL is required.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid http:// or https:// webpage URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// or https:// webpage URLs are allowed.");
  }

  if (url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new Error("Enter a public webpage URL without credentials.");
  }

  return url;
}

function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body);
  return {};
}

function limitContent(value) {
  if (typeof value !== "string") return "";
  const content = value.trim();
  return content.length > CONTENT_LIMIT ? `${content.slice(0, CONTENT_LIMIT).trimEnd()}…` : content;
}

function firecrawlError(status) {
  if (status === 401 || status === 403) {
    return "Deep Read is not authorized. Check the server-side Firecrawl key.";
  }
  if (status === 402) return "Deep Read usage is unavailable for this Firecrawl account.";
  if (status === 429) return "Deep Read is busy right now. Please wait a moment and retry.";
  if (status >= 400 && status < 500) {
    return "Firecrawl could not read that webpage. You can still open the original article.";
  }
  return "Firecrawl is temporarily unavailable. Please try again.";
}

async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST to retrieve one webpage." });
  }

  let body;
  try {
    body = parseBody(request);
  } catch {
    return sendJson(response, 400, { error: "Send a valid JSON request with one URL." });
  }

  let requestedUrl;
  try {
    requestedUrl = validatePublicUrl(body.url);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      error: "Deep Read is not configured yet. Add FIRECRAWL_API_KEY on the server.",
    });
  }

  try {
    const firecrawlResponse = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: requestedUrl.href,
        formats: ["markdown"],
        onlyMainContent: true,
        onlyCleanContent: false,
        removeBase64Images: true,
        blockAds: true,
        timeout: 20_000,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!firecrawlResponse.ok) {
      return sendJson(response, firecrawlResponse.status, {
        error: firecrawlError(firecrawlResponse.status),
      });
    }

    const payload = await firecrawlResponse.json();
    if (!payload.success || !payload.data) {
      return sendJson(response, 502, {
        error: "Firecrawl did not return a readable page. Please try another article.",
      });
    }

    const metadata = payload.data.metadata ?? {};
    const resultUrl = metadata.sourceURL || metadata.url || requestedUrl.href;
    let domain = requestedUrl.hostname.replace(/^www\./, "");
    try {
      domain = new URL(resultUrl).hostname.replace(/^www\./, "");
    } catch {
      // Keep the already validated requested domain.
    }

    return sendJson(response, 200, {
      page: {
        title: metadata.title || domain,
        domain,
        url: resultUrl,
        description: metadata.description || "",
        content: limitContent(payload.data.markdown),
      },
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return sendJson(response, 502, {
      error: timedOut
        ? "Deep Read took too long. Please retry this article."
        : "Firecrawl is temporarily unavailable. Please try again.",
    });
  }
}

module.exports = handler;
module.exports._test = { isPrivateHostname, limitContent, validatePublicUrl };
