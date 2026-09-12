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
