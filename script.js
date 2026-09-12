const loadButton = document.querySelector("#load-news");
const filterInput = document.querySelector("#news-filter");
const message = document.querySelector("#news-message");
const articleList = document.querySelector("#article-list");
const deepReadPanel = document.querySelector("#deep-read-panel");
const deepReadContent = document.querySelector("#deep-read-content");

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
