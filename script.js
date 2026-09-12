const loadButton = document.querySelector("#load-news");
const filterInput = document.querySelector("#news-filter");
const message = document.querySelector("#news-message");
const articleList = document.querySelector("#article-list");
const deepReadPanel = document.querySelector("#deep-read-panel");
const deepReadContent = document.querySelector("#deep-read-content");
const explorerForm = document.querySelector("#explorer-form");
const explorerInput = document.querySelector("#explorer-url");
const explorerButton = document.querySelector("#scrape-page");
const explorerMessage = document.querySelector("#explorer-message");
const explorerResult = document.querySelector("#explorer-result");
const explorerResultContent = document.querySelector("#explorer-result-content");
const jobScoutForm = document.querySelector("#job-scout-form");
const jobSourceInputs = [...document.querySelectorAll(".job-source-input")];
const jobSourceStatuses = [...document.querySelectorAll("[data-source-status]")];
const scanJobsButton = document.querySelector("#scan-jobs");
const clearJobsButton = document.querySelector("#clear-jobs");
const jobScoutMessage = document.querySelector("#job-scout-message");
const jobResults = document.querySelector("#job-results");
const jobResultList = document.querySelector("#job-result-list");

let loadedArticles = [];
let activeDeepReadController = null;

function setMessage(text, type = "info") {
  message.textContent = text;
  message.dataset.type = type;
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function createEmptyState(title, description) {
  const state = document.createElement("div");
  state.className = "empty-state";

  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◎";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.textContent = description;

  state.append(icon, heading, copy);
  return state;
}

function createArticleCard(article) {
  const card = document.createElement("article");
  card.className = "article-card";

  const meta = document.createElement("div");
  meta.className = "article-meta";

  const source = document.createElement("span");
  source.className = "source-label";
  source.textContent = article.source;

  const date = document.createElement("time");
  date.className = "article-date";
  date.dateTime = article.publishedAt || "";
  date.textContent = formatDate(article.publishedAt);
  meta.append(source, date);

  const heading = document.createElement("h3");
  heading.textContent = article.title;

  const summary = document.createElement("p");
  summary.className = "article-summary";
  summary.textContent = article.summary || "No RSS summary was provided for this story.";

  const actions = document.createElement("div");
  actions.className = "article-actions";

  const originalLink = document.createElement("a");
  originalLink.className = "text-link";
  originalLink.href = article.url;
  originalLink.target = "_blank";
  originalLink.rel = "noopener noreferrer";
  originalLink.textContent = "Read Original Article ↗";

  const deepReadButton = document.createElement("button");
  deepReadButton.className = "deep-read-button";
  deepReadButton.type = "button";
  deepReadButton.textContent = "Deep Read";
  deepReadButton.addEventListener("click", () => runDeepRead(article));

  actions.append(originalLink, deepReadButton);
  card.append(meta, heading, summary, actions);
  return card;
}

function renderArticles() {
  const query = filterInput.value.trim().toLocaleLowerCase();
  const filtered = loadedArticles.filter((article) => {
    const searchable = `${article.title} ${article.summary}`.toLocaleLowerCase();
    return searchable.includes(query);
  });

  articleList.replaceChildren();

  if (filtered.length === 0) {
    const title = loadedArticles.length === 0 ? "No stories available" : "No matching stories";
    const copy = loadedArticles.length === 0
      ? "The feeds did not return any stories. Please try again."
      : "Try a broader keyword or clear the filter.";
    articleList.append(createEmptyState(title, copy));
    return;
  }

  articleList.append(...filtered.map(createArticleCard));
}

function setDeepReadButtonsDisabled(disabled) {
  document.querySelectorAll(".deep-read-button").forEach((button) => {
    button.disabled = disabled;
  });
}

function showDeepReadLoading(article) {
  deepReadPanel.hidden = false;
  deepReadPanel.setAttribute("aria-busy", "true");
  deepReadContent.replaceChildren();

  const heading = document.createElement("h3");
  heading.id = "deep-read-title";
  heading.textContent = `Retrieving “${article.title}”`;

  const copy = document.createElement("p");
  copy.className = "deep-read-meta";
  copy.textContent = "Firecrawl is preparing a cleaner reading excerpt…";

  deepReadContent.append(heading, copy);
  deepReadPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showDeepReadResult(result) {
  deepReadPanel.setAttribute("aria-busy", "false");
  deepReadContent.replaceChildren();

  const heading = document.createElement("h3");
  heading.id = "deep-read-title";
  heading.textContent = result.title;

  const meta = document.createElement("p");
  meta.className = "deep-read-meta";
  meta.textContent = result.domain;

  deepReadContent.append(heading, meta);

  if (result.description) {
    const description = document.createElement("p");
    description.className = "deep-read-description";
    description.textContent = result.description;
    deepReadContent.append(description);
  }

  const excerpt = document.createElement("div");
  excerpt.className = "deep-read-content";
  excerpt.textContent = result.content || "No readable page content was returned.";

  const originalLink = document.createElement("a");
  originalLink.className = "text-link";
  originalLink.href = result.url;
  originalLink.target = "_blank";
  originalLink.rel = "noopener noreferrer";
  originalLink.textContent = "Open Original Article ↗";

  deepReadContent.append(excerpt, originalLink);
}

function showDeepReadError(text) {
  deepReadPanel.hidden = false;
  deepReadPanel.setAttribute("aria-busy", "false");
  deepReadContent.replaceChildren();

  const heading = document.createElement("h3");
  heading.id = "deep-read-title";
  heading.textContent = "Deep Read could not finish";

  const copy = document.createElement("p");
  copy.className = "deep-read-description";
  copy.textContent = text;

  deepReadContent.append(heading, copy);
}

function setExplorerMessage(text, type = "info") {
  explorerMessage.textContent = text;
  explorerMessage.dataset.type = type;
}

function validateExplorerUrl(value) {
  if (!value.trim()) {
    throw new Error("Enter a webpage URL to explore.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete URL beginning with http:// or https://.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// or https:// webpage URLs are allowed.");
  }

  return url.href;
}

function showExplorerLoading(url) {
  explorerResult.hidden = false;
  explorerResult.setAttribute("aria-busy", "true");
  explorerResultContent.replaceChildren();

  const heading = document.createElement("h3");
  heading.id = "explorer-result-title";
  heading.textContent = `Retrieving ${new URL(url).hostname.replace(/^www\./, "")}`;

  const copy = document.createElement("p");
  copy.className = "deep-read-meta";
  copy.textContent = "Firecrawl is preparing a clean page excerpt…";

  explorerResultContent.append(heading, copy);
}

function showExplorerResult(result) {
  explorerResult.setAttribute("aria-busy", "false");
  explorerResultContent.replaceChildren();

  const heading = document.createElement("h3");
  heading.id = "explorer-result-title";
  heading.textContent = result.title;

  const domain = document.createElement("p");
  domain.className = "deep-read-meta";
  domain.textContent = result.domain;
  explorerResultContent.append(heading, domain);

  if (result.description) {
    const description = document.createElement("p");
    description.className = "deep-read-description";
    description.textContent = result.description;
    explorerResultContent.append(description);
  }

  const url = document.createElement("p");
  url.className = "result-url";
  url.textContent = result.url;

  const excerpt = document.createElement("div");
  excerpt.className = "deep-read-content";
  excerpt.textContent = result.content || "No readable page content was returned.";

  const originalLink = document.createElement("a");
  originalLink.className = "text-link";
  originalLink.href = result.url;
  originalLink.target = "_blank";
  originalLink.rel = "noopener noreferrer";
  originalLink.textContent = "Open Original Page ↗";

  explorerResultContent.append(url, excerpt, originalLink);
}

function showExplorerError(text) {
  explorerResult.hidden = false;
  explorerResult.setAttribute("aria-busy", "false");
  explorerResultContent.replaceChildren();

  const heading = document.createElement("h3");
  heading.id = "explorer-result-title";
  heading.textContent = "Web Explorer could not finish";

  const copy = document.createElement("p");
  copy.className = "deep-read-description";
  copy.textContent = text;
  explorerResultContent.append(heading, copy);
}

async function explorePage(event) {
  event.preventDefault();

  let url;
  try {
    url = validateExplorerUrl(explorerInput.value);
  } catch (error) {
    explorerResult.hidden = true;
    setExplorerMessage(error.message, "error");
    explorerInput.focus();
    return;
  }

  explorerButton.disabled = true;
  explorerButton.querySelector("span").textContent = "Scraping page…";
  explorerInput.disabled = true;
  setExplorerMessage("Retrieving this webpage with Firecrawl…");
  showExplorerLoading(url);

  try {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "The webpage could not be retrieved. Please try again.");
    }

    showExplorerResult(payload.page);
    setExplorerMessage("Page retrieved. The excerpt is limited to keep the result manageable.");
  } catch (error) {
    const text = error.message || "The webpage could not be retrieved. Please try again.";
    showExplorerError(text);
    setExplorerMessage(text, "error");
  } finally {
    explorerButton.disabled = false;
    explorerButton.querySelector("span").textContent = "Scrape Page";
    explorerInput.disabled = false;
  }
}

function setJobScoutMessage(text, type = "info") {
  jobScoutMessage.textContent = text;
  jobScoutMessage.dataset.type = type;
}

function setSourceStatus(index, text, status = "waiting") {
  const element = jobSourceStatuses[index];
  element.textContent = text;
  element.dataset.status = status;
}

function validateJobSourceUrls() {
  const values = jobSourceInputs.map((input) => input.value.trim());
  if (!values[0]) throw new Error("Job Source 1 is required.");

  const urls = values.filter(Boolean).map((value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Every job source must be a complete http:// or https:// URL.");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Every job source must use http:// or https://.");
    }
    return url.href;
  });

  return [...new Set(urls)];
}

function updateReturnedSourceStatuses(sources) {
  jobSourceInputs.forEach((input, index) => {
    if (!input.value.trim()) {
      setSourceStatus(index, "Waiting");
      return;
    }

    let normalized = input.value.trim();
    try {
      normalized = new URL(normalized).href;
    } catch {
      setSourceStatus(index, "Could not extract", "failed");
      return;
    }

    const source = sources.find((item) => item.url === normalized);
    if (source?.status === "extracted") setSourceStatus(index, "Extracted", "extracted");
    else if (source?.status === "no_jobs") setSourceStatus(index, "No jobs found", "no-jobs");
    else setSourceStatus(index, "Could not extract", "failed");
  });
}

function createJobFact(label, value) {
  const item = document.createElement("span");
  const labelNode = document.createElement("strong");
  labelNode.textContent = `${label}: `;
  item.append(labelNode, value);
  return item;
}

function createJobCard(job, index) {
  const card = document.createElement("article");
  card.className = "job-card";

  const rank = document.createElement("span");
  rank.className = "job-rank";
  rank.textContent = `#${index + 1}`;

  const heading = document.createElement("h4");
  heading.textContent = job.title;

  const facts = document.createElement("div");
  facts.className = "job-facts";
  [
    ["Employer", job.employer],
    ["Location", job.location],
    ["Type", job.employmentType],
    ["Published", job.postedDate],
    ["Source", job.sourceDomain],
  ].filter(([, value]) => value).forEach(([label, value]) => {
    facts.append(createJobFact(label, value));
  });

  const reasons = document.createElement("ul");
  reasons.className = "job-reasons";
  job.reasons.slice(0, 3).forEach((reason) => {
    const item = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = `${reason.heading}: `;
    item.append(label, reason.text);
    reasons.append(item);
  });

  card.append(rank, heading, facts, reasons);

  if (job.jobUrl) {
    const link = document.createElement("a");
    link.className = "text-link";
    link.href = job.jobUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open Job Posting ↗";
    card.append(link);
  }

  return card;
}

function renderJobResults(jobs) {
  jobResults.hidden = false;
  jobResults.setAttribute("aria-busy", "false");
  jobResultList.replaceChildren();

  if (jobs.length === 0) {
    jobResultList.append(createEmptyState(
      "No qualifying junior roles found",
      "Try another public listing page with visible early-career opportunities.",
    ));
    return;
  }

  jobResultList.append(...jobs.slice(0, 5).map(createJobCard));
}

function clearJobScout() {
  jobScoutForm.reset();
  jobSourceStatuses.forEach((_, index) => setSourceStatus(index, "Waiting"));
  jobResults.hidden = true;
  jobResultList.replaceChildren();
  setJobScoutMessage("Exact pages only—no login, site-wide crawl, saved history, or applications.");
  jobSourceInputs[0].focus();
}

async function scanJobs(event) {
  event.preventDefault();

  let urls;
  try {
    urls = validateJobSourceUrls();
  } catch (error) {
    setJobScoutMessage(error.message, "error");
    jobSourceInputs.find((input) => !input.value.trim())?.focus();
    return;
  }

  jobResults.hidden = false;
  jobResults.setAttribute("aria-busy", "true");
  jobResultList.replaceChildren(createEmptyState(
    "Scanning public job pages",
    "Firecrawl is extracting visible listings and comparing early-career evidence…",
  ));
  jobSourceInputs.forEach((input, index) => {
    setSourceStatus(index, input.value.trim() ? "Scanning" : "Waiting", input.value.trim() ? "scanning" : "waiting");
    input.disabled = true;
  });
  scanJobsButton.disabled = true;
  clearJobsButton.disabled = true;
  scanJobsButton.querySelector("span").textContent = "Comparing opportunities…";
  setJobScoutMessage(`Scanning ${urls.length} unique public source${urls.length === 1 ? "" : "s"}…`);

  try {
    const response = await fetch("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const payload = await response.json().catch(() => ({}));
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    updateReturnedSourceStatuses(sources);

    if (!response.ok) {
      throw new Error(payload.error || "The job pages could not be compared. Please try again.");
    }

    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    renderJobResults(jobs);
    const successful = sources.filter((source) => source.status === "extracted").length;
    setJobScoutMessage(
      jobs.length > 0
        ? `Ranked ${jobs.length} junior opportunit${jobs.length === 1 ? "y" : "ies"} from ${successful} successful source${successful === 1 ? "" : "s"}.`
        : "No qualifying junior opportunities were found. Try another public job page.",
      jobs.length > 0 ? "info" : "warning",
    );
  } catch (error) {
    jobResults.hidden = true;
    setJobScoutMessage(error.message || "The job pages could not be compared. Please try again.", "error");
  } finally {
    jobSourceInputs.forEach((input) => { input.disabled = false; });
    scanJobsButton.disabled = false;
    clearJobsButton.disabled = false;
    scanJobsButton.querySelector("span").textContent = "Find Junior Opportunities";
  }
}

async function runDeepRead(article) {
  activeDeepReadController?.abort();
  activeDeepReadController = new AbortController();
  showDeepReadLoading(article);
  setDeepReadButtonsDisabled(true);

  try {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: article.url }),
      signal: activeDeepReadController.signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "The page could not be retrieved. Please try again.");
    }

    showDeepReadResult(payload.page);
  } catch (error) {
    if (error.name !== "AbortError") {
      showDeepReadError(error.message || "The page could not be retrieved. Please try again.");
    }
  } finally {
    setDeepReadButtonsDisabled(false);
  }
}

async function loadLatestNews() {
  loadButton.disabled = true;
  loadButton.querySelector("span").textContent = "Scanning RSS feeds…";
  filterInput.disabled = true;
  setMessage("Contacting WIRED, TechCrunch, and VentureBeat…");

  try {
    const response = await fetch("/api/news");
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "The news feeds could not be loaded. Please try again.");
    }

    loadedArticles = Array.isArray(payload.articles) ? payload.articles : [];
    filterInput.disabled = loadedArticles.length === 0;
    renderArticles();

    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    if (warnings.length > 0) {
      setMessage(`Loaded ${loadedArticles.length} stories. ${warnings.join(" ")}`, "warning");
    } else {
      setMessage(`Loaded ${loadedArticles.length} stories from all three sources.`);
    }
  } catch (error) {
    loadedArticles = [];
    renderArticles();
    setMessage(error.message || "The news feeds could not be loaded. Please try again.", "error");
  } finally {
    loadButton.disabled = false;
    loadButton.querySelector("span").textContent = "Refresh Latest News";
  }
}

loadButton.addEventListener("click", loadLatestNews);
filterInput.addEventListener("input", renderArticles);
explorerForm.addEventListener("submit", explorePage);
jobScoutForm.addEventListener("submit", scanJobs);
clearJobsButton.addEventListener("click", clearJobScout);
