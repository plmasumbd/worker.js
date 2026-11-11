// ═══════════════════════════════════════════════════════════
const ADMIN_PASSWORD = "admin123";
const PAGE_SIZE = 20;
const CACHE_TTL = 5 * 60 * 1000;
const URL_SAFETY_MARGIN = 90 * 1000;

// ═══════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password", "Access-Control-Max-Age": "86400" } });
    }

    if (p === "/api/movies" && request.method === "GET") return listMovies(env, url);
    if (p === "/api/movies" && request.method === "POST") return addMovie(request, env);
    if (p === "/api/movies/update" && request.method === "POST") return updateMovie(request, env);
    if (p.startsWith("/api/movies/") && request.method === "DELETE") return deleteMovie(request, env, p);
    if (p === "/api/login" && request.method === "POST") return login(request);
    if (p === "/api/check-auth" && request.method === "GET") return checkAuth(request);
    if (p === "/api/ads" && request.method === "GET") return getAds(env);
    if (p === "/api/ads" && request.method === "POST") return saveAds(request, env);
    if (p === "/api/interval-link" && request.method === "GET") return getIntervalLink(env);
    if (p === "/api/interval-link" && request.method === "POST") return saveIntervalLink(request, env);
    if (p === "/api/movie" && request.method === "GET") return getSingleMovie(env, url);
    if (p === "/api/fetch-source" && request.method === "POST") return fetchSourceData(request);
    if (p === "/api/refresh-movie" && request.method === "POST") return refreshMovie(request, env);
    if (p === "/api/refresh-all" && request.method === "POST") return refreshAll(request, env);
    if (p === "/api/bulk-update-links" && request.method === "POST") return bulkUpdateLinks(request, env);
    if (p === "/api/silent-refresh" && request.method === "POST") return silentRefresh(request, env);
    if (p === "/api/auto-content" && request.method === "POST") return autoContent(request, env);
    if (p === "/api/movies/related" && request.method === "GET") return getRelatedMovies(env, url);
    if (p === "/api/movies/trending" && request.method === "GET") return getTrendingMovies(env);
    if (p === "/api/movies/track-view" && request.method === "POST") return trackView(request, env);
    if (p === "/api/debug-embed" && request.method === "GET") return debugEmbed(url);
    if (p === "/api/stream" && request.method === "GET") return streamVideo(request, env, url);

    if (p === "/") return html(homePage());
    if (p === "/admin") return html(adminPage());
    if (p === "/watch") return html(watchPage(url.searchParams.get("id")));

    return new Response("404", { status: 404 });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(autoRefreshAll(env)); }
};

// ═══════════════════════════════════════════════════════════
function getUrlExpiry(url) {
  if (!url) return 0;
  const s = String(url);
  let m;
  m = s.match(/[?&]secure=[^,&]+=+,\s*(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }
  m = s.match(/[?&]secure=[^,&]+,\s*(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }
  m = s.match(/[?&]secure=[^,&]+%2C(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }
  m = s.match(/[?&](?:expires|e|exp|valid|timestamp|ts|expire)=(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }
  m = s.match(/\/(\d{10,13})\//);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }
  return 0;
}
function isUrlExpired(url) {
  const exp = getUrlExpiry(url);
  if (exp === 0) return false;
  return Date.now() > (exp - URL_SAFETY_MARGIN);
}

// ═══════════════════════════════════════════════════════════
// 🎬 Stream — OPTIMIZED (old + refresh parallel)
// ═══════════════════════════════════════════════════════════
async function streamVideo(request, env, url) {
  const id = url.searchParams.get("id");
  if (!id) return new Response("ID required", { status: 400 });
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return new Response("Not found", { status: 404 });
  const movie = list[idx];
  let videoUrl = movie.contentUrl || "";
  const embedUrl = movie.embedUrl || "";
  const range = request.headers.get("Range");

  const makeHeaders = (ref) => {
    const h = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": ref || embedUrl || "",
      "Origin": (() => { try { return new URL(ref || embedUrl || videoUrl).origin; } catch (e) { return ""; } })(),
    };
    if (range) h["Range"] = range;
    return h;
  };

  const expired = isUrlExpired(videoUrl);
  const missing = !videoUrl;
  const needsRefresh = expired || missing;

  // ⚡ Parallel: try old + start refresh
  let oldPromise = null;
  if (videoUrl) oldPromise = fetch(videoUrl, { headers: makeHeaders(), redirect: "follow" }).catch(() => null);

  let refreshPromise = null;
  if (needsRefresh && embedUrl) refreshPromise = fetchFreshFromEmbed(embedUrl).catch(() => null);

  // ⚡ FAST PATH: Old URL works → return immediately, save refresh in background
  if (oldPromise) {
    const oldRes = await oldPromise;
    if (oldRes && (oldRes.ok || oldRes.status === 206)) {
      if (refreshPromise) {
        refreshPromise.then(fresh => {
          if (fresh && fresh.contentUrl && fresh.contentUrl !== videoUrl) {
            list[idx].contentUrl = fresh.contentUrl;
            list[idx].videoUrl = fresh.contentUrl;
            list[idx].lastRefresh = Date.now();
            list[idx].urlExpiry = getUrlExpiry(fresh.contentUrl);
            return env.MOVIES.put("movie_list", JSON.stringify(list));
          }
        }).catch(() => {});
      }
      return buildStreamResponse(oldRes, videoUrl);
    }
  }

  // ⚡ SLOW PATH: Old failed → try refreshed
  if (refreshPromise) {
    const fresh = await refreshPromise;
    if (fresh && fresh.contentUrl) {
      try {
        const up2 = await fetch(fresh.contentUrl, { headers: makeHeaders(fresh.contentUrl), redirect: "follow" });
        if (up2.ok || up2.status === 206) {
          list[idx].contentUrl = fresh.contentUrl;
          list[idx].videoUrl = fresh.contentUrl;
          list[idx].lastRefresh = Date.now();
          list[idx].urlExpiry = getUrlExpiry(fresh.contentUrl);
          await env.MOVIES.put("movie_list", JSON.stringify(list));
          return buildStreamResponse(up2, fresh.contentUrl);
        }
      } catch (e) {}
    }
  }

  if (needsRefresh) return new Response("Link expired", { status: 410, headers: { "Access-Control-Allow-Origin": "*" } });
  return new Response("Stream error", { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
}

function buildStreamResponse(upstream, videoUrl) {
  const newHeaders = new Headers();
  newHeaders.set("Content-Type", upstream.headers.get("Content-Type") || guessContentType(videoUrl));
  const cl = upstream.headers.get("Content-Length"); if (cl) newHeaders.set("Content-Length", cl);
  const cr = upstream.headers.get("Content-Range"); if (cr) newHeaders.set("Content-Range", cr);
  newHeaders.set("Accept-Ranges", "bytes");
  newHeaders.set("Cache-Control", "public, max-age=1800");
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Headers", "Range, Content-Type");
  newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: newHeaders });
}
function guessContentType(url) {
  const u = (url || "").toLowerCase();
  if (u.includes(".m3u8")) return "application/vnd.apple.mpegurl";
  if (u.includes(".ts")) return "video/mp2t";
  if (u.includes(".mp4")) return "video/mp4";
  if (u.includes(".webm")) return "video/webm";
  if (u.includes(".mkv")) return "video/x-matroska";
  return "video/mp4";
}

// ═══════════════════════════════════════════════════════════
// 🎯 Fetch Fresh — PARALLEL proxies
// ═══════════════════════════════════════════════════════════
async function fetchFreshFromEmbed(embedUrl) {
  const out = { contentUrl: "", title: "", thumbnail: "", views: 0, source: "" };
  const originRef = (() => { try { return new URL(embedUrl).origin + "/"; } catch (e) { return ""; } })();

  const isValid = (t) => t && t.length > 100 && (/setVideoUrl(?:High|Low)?\s*\(/i.test(t) || /https?:\/\/[^"'\s<>\\]+\.(?:mp4|m3u8)/i.test(t));

  const fetchers = [
    fetch("https://r.jina.ai/" + embedUrl, { headers: { "Accept": "text/plain", "X-Return-Format": "html", "User-Agent": "Mozilla/5.0" } }).then(r => r.ok ? r.text() : null).catch(() => null),
    fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(embedUrl)).then(r => r.ok ? r.text() : null).catch(() => null),
    fetch("https://corsproxy.io/?url=" + encodeURIComponent(embedUrl)).then(r => r.ok ? r.text() : null).catch(() => null),
    fetch(embedUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", "Referer": originRef, "Accept": "text/html,*/*" }, redirect: "follow" }).then(r => r.ok ? r.text() : null).catch(() => null),
  ];

  const validPromises = fetchers.map(p => p.then(t => {
    if (isValid(t)) return t;
    throw new Error("invalid");
  }));

  let text = await Promise.any(validPromises).catch(() => null);

  if (!text) {
    const all = await Promise.all(fetchers);
    text = all.find(t => t && t.length > 100) || null;
  }

  if (!text) return out;
  out.contentUrl = extractVideoUrl(text);
  out.source = "parallel";

  let m = text.match(/<title>([^<]+)<\/title>/i) || text.match(/"name"\s*:\s*"([^"]+)"/i);
  if (m) out.title = decodeHtml(m[1]).trim();
  m = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || text.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (m) out.thumbnail = decodeHtml(m[1]);
  return out;
}

function extractVideoUrl(text) {
  const clean = (u) => String(u || "").replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\u003f/g, "?").replace(/\\u002f/g, "/").replace(/&amp;/g, "&").replace(/\\/g, "").trim();
  const patterns = [
    /(?:html5player\.)?setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]/i,
    /(?:html5player\.)?setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]/i,
    /(?:html5player\.)?setVideoUrl\s*\(\s*['"]([^'"]+)['"]/i,
    /"contentUrl"\s*:\s*"([^"]+)"/i,
    /"videoUrl"\s*:\s*"([^"]+)"/i,
    /"file"\s*:\s*"([^"]+\.(?:mp4|m3u8|webm|mkv)[^"]*)"/i,
    /"src"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /(?:var|let|const)\s+\w+\s*=\s*['"](https?:\/\/[^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i,
    /<video[^>]*\ssrc\s*=\s*["']([^"']+)["']/i,
    /(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*[?&]secure=[^"'\s<>\\]+)/i,
    /(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*[?&]secure=[^"'\s<>\\]+)/i,
    /(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i,
    /(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/i,
    /(https?:\/\/[^"'\s<>\\]+[?&](?:secure|token|hash|sig|expires)=[^"'\s<>\\]+)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const url = clean(m[1]);
      if (/^(https?:)?\/\//i.test(url) || /^\/[^\s]+\.(mp4|m3u8)/i.test(url)) return url;
    }
  }
  return "";
}
function decodeHtml(s) { return String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " "); }

function deriveEmbedUrl(movie) {
  if (movie.embedUrl && /^https?:\/\//i.test(movie.embedUrl)) return movie.embedUrl;
  if (movie.videoUrl) {
    const m = String(movie.videoUrl).match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
    if (m) return m[1];
    if (/^https?:\/\//i.test(movie.videoUrl) && !/\.(mp4|m3u8)/i.test(movie.videoUrl)) return movie.videoUrl;
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
async function debugEmbed(url) {
  const embedUrl = url.searchParams.get("url");
  if (!embedUrl) return json({ error: "url param required" }, 400);
  const originRef = (() => { try { return new URL(embedUrl).origin + "/"; } catch (e) { return ""; } })();
  const result = { embedUrl, attempts: [] };
  const tryOne = async (label, fn) => {
    try {
      const text = await fn();
      if (!text) return result.attempts.push({ method: label, error: "empty" });
      result.attempts.push({ method: label, length: text.length, hasSetVideo: /setVideoUrl/i.test(text), hasMp4: /\.mp4/i.test(text), extracted: extractVideoUrl(text) || null });
    } catch (e) { result.attempts.push({ method: label, error: e.message }); }
  };
  await tryOne("jina", async () => { const r = await fetch("https://r.jina.ai/" + embedUrl, { headers: { "Accept": "text/plain", "X-Return-Format": "html" } }); return r.ok ? await r.text() : null; });
  await tryOne("allorigins", async () => { const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(embedUrl)); return r.ok ? await r.text() : null; });
  await tryOne("direct", async () => { const r = await fetch(embedUrl, { headers: { "User-Agent": "Mozilla/5.0", "Referer": originRef }, redirect: "follow" }); return r.ok ? await r.text() : null; });
  return json(result);
}

// ═══════════════════════════════════════════════════════════
async function refreshMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const idx = list.findIndex(m => m.id === b.id);
  if (idx === -1) return json({ error: "Not found" }, 404);
  const movie = list[idx];
  let contentUrl = "";
  let source = "";
  if (b.html && b.html.trim().length > 50) { contentUrl = extractVideoUrl(b.html); source = "html-paste"; }
  if (!contentUrl && b.videoUrl && /^https?:\/\//.test(b.videoUrl)) { contentUrl = b.videoUrl.trim(); source = "url-direct"; }
  if (!contentUrl) {
    const embedUrl = deriveEmbedUrl(movie);
    if (embedUrl) {
      try {
        const fresh = await fetchFreshFromEmbed(embedUrl);
        if (fresh.contentUrl) {
          contentUrl = fresh.contentUrl; source = fresh.source || "auto";
          if (fresh.title) list[idx].title = fresh.title;
          if (fresh.thumbnail) list[idx].thumbnail = fresh.thumbnail;
        }
      } catch (e) {}
    }
  }
  if (!contentUrl) return json({ error: "লিংক পাওয়া যায়নি" }, 502);
  list[idx].contentUrl = contentUrl;
  list[idx].videoUrl = contentUrl;
  list[idx].urlExpiry = getUrlExpiry(contentUrl);
  list[idx].lastRefresh = Date.now();
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true, movie: list[idx], source: source, contentUrl: contentUrl });
}

async function refreshAll(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  return json({ success: true, ...(await autoRefreshAll(env, true)) });
}

async function autoRefreshAll(env, verbose = false) {
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  let ok = 0, fail = 0, skipped = 0;
  const failures = [];
  for (let i = 0; i < list.length; i++) {
    const movie = list[i];
    const videoUrl = movie.contentUrl || "";
    const expired = isUrlExpired(videoUrl);
    const stale = (Date.now() - (movie.lastRefresh || 0)) > CACHE_TTL;
    if (!verbose && videoUrl && !expired && !stale) { skipped++; continue; }
    const embedUrl = deriveEmbedUrl(movie);
    if (!embedUrl) { fail++; if (verbose) failures.push({ id: movie.id, title: movie.title, reason: "no embedUrl" }); }
    else {
      try {
        const fresh = await fetchFreshFromEmbed(embedUrl);
        if (fresh.contentUrl) {
          movie.contentUrl = fresh.contentUrl;
          movie.videoUrl = fresh.contentUrl;
          movie.urlExpiry = getUrlExpiry(fresh.contentUrl);
          if (fresh.title) movie.title = fresh.title;
          if (fresh.thumbnail) movie.thumbnail = fresh.thumbnail;
          movie.lastRefresh = Date.now();
          ok++;
        } else { fail++; if (verbose) failures.push({ id: movie.id, title: movie.title, reason: "no URL" }); }
      } catch (e) { fail++; if (verbose) failures.push({ id: movie.id, title: movie.title, reason: e.message }); }
    }
    if ((i + 1) % 5 === 0 || i === list.length - 1) await env.MOVIES.put("movie_list", JSON.stringify(list));
    await new Promise(r => setTimeout(r, 1200));
  }
  return { ok, fail, skipped, failures };
}

async function bulkUpdateLinks(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.updates || !Array.isArray(b.updates)) return json({ error: "updates required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  let ok = 0, fail = 0;
  for (const upd of b.updates) {
    const idx = list.findIndex(m => m.id === upd.id);
    if (idx === -1) { fail++; continue; }
    let contentUrl = "";
    if (upd.html && upd.html.trim().length > 50) contentUrl = extractVideoUrl(upd.html);
    if (!contentUrl && upd.videoUrl && /^https?:\/\//.test(upd.videoUrl)) contentUrl = upd.videoUrl.trim();
    if (!contentUrl) { fail++; continue; }
    list[idx].contentUrl = contentUrl;
    list[idx].videoUrl = contentUrl;
    list[idx].urlExpiry = getUrlExpiry(contentUrl);
    list[idx].lastRefresh = Date.now();
    ok++;
  }
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true, ok, fail });
}

async function silentRefresh(request, env) {
  try {
    const b = await request.json();
    if (!b.id || !b.videoUrl) return json({ ok: false }, 400);
    const url = String(b.videoUrl).trim();
    if (!/^https?:\/\//i.test(url)) return json({ ok: false }, 400);
    if (url.length > 3000) return json({ ok: false }, 400);
    if (!/\.(mp4|m3u8|webm)/i.test(url) && !/[?&]secure=/i.test(url)) return json({ ok: false }, 400);
    const raw = await env.MOVIES.get("movie_list");
    const list = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(m => m.id === b.id);
    if (idx === -1) return json({ ok: false }, 404);
    const movie = list[idx];
    const now = Date.now();
    const expired = isUrlExpired(movie.contentUrl);
    const missing = !movie.contentUrl;
    const tooRecent = (now - (movie.lastRefresh || 0)) < 30000;
    if (!expired && !missing) return json({ ok: true, cached: true });
    if (tooRecent) return json({ ok: true, recent: true });
    list[idx].contentUrl = url;
    list[idx].videoUrl = url;
    list[idx].urlExpiry = getUrlExpiry(url);
    list[idx].lastRefresh = now;
    await env.MOVIES.put("movie_list", JSON.stringify(list));
    return json({ ok: true });
  } catch (e) { return json({ ok: false }, 500); }
}

async function autoContent(request, env) {
  try {
    const b = await request.json();
    if (!b.id) return json({ error: "ID required" }, 400);
    const raw = await env.MOVIES.get("movie_list");
    const list = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(m => m.id === b.id);
    if (idx === -1) return json({ error: "Not found" }, 404);
    const movie = list[idx];
    const force = b.forceRefresh === true;
    const now = Date.now();
    const expired = isUrlExpired(movie.contentUrl);
    const fresh = (now - (movie.lastRefresh || 0)) < CACHE_TTL;
    if (!force && movie.contentUrl && fresh && !expired) return json({ success: true, contentUrl: movie.contentUrl, cached: true });
    const embedUrl = deriveEmbedUrl(movie);
    if (!embedUrl) return json({ error: "No embedUrl" }, 400);
    const freshData = await fetchFreshFromEmbed(embedUrl);
    if (freshData.contentUrl) {
      list[idx].contentUrl = freshData.contentUrl;
      list[idx].videoUrl = freshData.contentUrl;
      list[idx].lastRefresh = now;
      list[idx].urlExpiry = getUrlExpiry(freshData.contentUrl);
      await env.MOVIES.put("movie_list", JSON.stringify(list));
      return json({ success: true, contentUrl: freshData.contentUrl });
    }
    if (movie.contentUrl && !expired) return json({ success: true, contentUrl: movie.contentUrl, stale: true });
    return json({ error: "লিংক পাওয়া যায়নি" }, 502);
  } catch (e) { return json({ error: e.message }, 500); }
}

async function fetchSourceData(request) {
  try {
    const body = await request.json();
    const targetUrl = body.url;
    if (!targetUrl) return json({ error: "URL required" }, 400);
    const fresh = await fetchFreshFromEmbed(targetUrl);
    let embedUrl = "";
    let text = "";
    try {
      const j = await fetch("https://r.jina.ai/" + targetUrl, { headers: { "Accept": "text/plain", "X-Return-Format": "html" } });
      if (j.ok) text = await j.text();
    } catch (e) {}
    const iframes = text.match(/<iframe[\s\S]*?>/gi) || [];
    for (let i = 0; i < iframes.length; i++) {
      const sm = iframes[i].match(/src\s*=\s*["']([^"']+)["']/i);
      if (sm && /embedframe|embed\/|player\//i.test(sm[1])) { embedUrl = sm[1]; break; }
    }
    if (embedUrl) embedUrl = embedUrl.replace(/&amp;/g, "&");
    let videoId = "";
    if (embedUrl) { const em = embedUrl.match(/\/([a-zA-Z0-9\-]+)\/?$/); if (em) videoId = em[1]; }
    if (!fresh.contentUrl && !embedUrl) return json({ error: "লিংক পাওয়া যায়নি" }, 400);
    return json({ success: true, data: { title: fresh.title, id: videoId, thumbnail: fresh.thumbnail, contentUrl: fresh.contentUrl, embedUrl: embedUrl, videoUrl: fresh.contentUrl || embedUrl } });
  } catch (err) { return json({ error: "Failed: " + err.message }, 500); }
}

function extractSrc(input) {
  if (!input) return "";
  const s = input.trim();
  const m1 = s.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i); if (m1) return m1[1];
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  const m2 = s.match(/https?:\/\/[^\s"'<>]+/i); if (m2) return m2[0];
  return s;
}
function autoThumb(url) {
  if (!url) return "";
  const yt = url.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return "https://img.youtube.com/vi/" + yt[1] + "/maxresdefault.jpg";
  return "";
}
function hashString(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function json(d, s) { return new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }); }
function html(s) { return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } }); }

async function listMovies(env, url) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();
  const seed = url.searchParams.get("seed") || "";
  const watchedParam = url.searchParams.get("watched") || "";
  const noShuffle = url.searchParams.get("noshuffle") === "1";
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const watchedSet = new Set(watchedParam.split(",").map(x => x.trim()).filter(Boolean));
  if (search) list = list.filter(m => m.title.toLowerCase().includes(search));
  if (!noShuffle) {
    const scored = list.map(m => ({ movie: m, watched: watchedSet.has(String(m.id)) ? 1 : 0, hash: hashString(String(m.id) + "|" + seed) }));
    scored.sort((a, b) => { if (a.watched !== b.watched) return a.watched - b.watched; if (a.hash !== b.hash) return a.hash - b.hash; return String(a.movie.id).localeCompare(String(b.movie.id)); });
    list = scored.map(x => x.movie);
  }
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  return json({ items: list.slice(start, start + PAGE_SIZE), page, totalPages: pages, total });
}

async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.title || (!b.videoUrl && !b.contentUrl && !b.embedUrl)) return json({ error: "Title ও URL দরকার" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const embedUrl = (b.embedUrl || extractSrc(b.videoUrl || "")).trim();
  const contentUrl = (b.contentUrl || "").trim();
  const vurl = contentUrl || embedUrl;
  const norm = (u) => { if (!u) return ""; try { const p = new URL(String(u)); return p.origin + p.pathname.replace(/\/+$/, ""); } catch (e) { return String(u).replace(/[?#].*$/, ""); } };
  for (const e of list) {
    if (b.videoId && e.id === b.videoId) return json({ error: "এই ভিডিও আগেই আছে!" }, 400);
    if (embedUrl && norm(e.embedUrl) === norm(embedUrl)) return json({ error: "এই ভিডিও আগেই আছে!" }, 400);
  }
  let thumb = (b.thumbnail || "").trim();
  if (!thumb) thumb = autoThumb(embedUrl || vurl);
  const movie = {
    id: b.videoId || crypto.randomUUID(),
    title: b.title.trim(), videoUrl: vurl.trim(), embedUrl: embedUrl.trim(), contentUrl: contentUrl.trim(),
    thumbnail: thumb, createdAt: Date.now(), lastRefresh: contentUrl ? Date.now() : 0,
    urlExpiry: getUrlExpiry(contentUrl), views: b.views || (Math.floor(Math.random() * 4500) + 500)
  };
  list.push(movie);
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true, movie });
}

async function updateMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const i = list.findIndex(m => m.id === b.id);
  if (i === -1) return json({ error: "Not found" }, 404);
  if (b.title) list[i].title = b.title.trim();
  if (b.videoUrl) list[i].embedUrl = extractSrc(b.videoUrl).trim();
  if (b.contentUrl !== undefined) {
    list[i].contentUrl = b.contentUrl;
    list[i].videoUrl = b.contentUrl || list[i].embedUrl;
    list[i].urlExpiry = getUrlExpiry(b.contentUrl);
    list[i].lastRefresh = Date.now();
  }
  if (b.embedUrl) list[i].embedUrl = b.embedUrl.trim();
  if (b.thumbnail) list[i].thumbnail = b.thumbnail.trim();
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true });
}

async function deleteMovie(request, env, path) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const id = decodeURIComponent(path.split("/").pop());
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  list = list.filter(m => m.id !== id);
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true });
}

async function login(request) { const b = await request.json(); if (b.password === ADMIN_PASSWORD) return json({ success: true, token: ADMIN_PASSWORD }); return json({ error: "ভুল পাসওয়ার্ড" }, 401); }
async function checkAuth(request) { const a = request.headers.get("X-Admin-Password"); if (a === ADMIN_PASSWORD) return json({ valid: true }); return json({ valid: false }, 401); }
async function getAds(env) { return json({ code: (await env.MOVIES.get("ads_code")) || "" }); }
async function saveAds(request, env) {
  if (request.headers.get("X-Admin-Password") !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("ads_code", b.code || "");
  return json({ success: true });
}
async function getIntervalLink(env) {
  return json({ url: (await env.MOVIES.get("interval_link")) || "", seconds: parseInt((await env.MOVIES.get("interval_seconds")) || "60"), firstDelay: parseInt((await env.MOVIES.get("interval_first_delay")) || "15") });
}
async function saveIntervalLink(request, env) {
  if (request.headers.get("X-Admin-Password") !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("interval_link", b.url || "");
  if (b.seconds !== undefined) await env.MOVIES.put("interval_seconds", String(b.seconds));
  if (b.firstDelay !== undefined) await env.MOVIES.put("interval_first_delay", String(b.firstDelay));
  return json({ success: true });
}

async function getSingleMovie(env, url) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const movie = list.find(m => m.id === id);
  if (!movie) return json({ error: "Not found" }, 404);
  return json({ success: true, movie });
}
async function getRelatedMovies(env, url) {
  const id = url.searchParams.get("id");
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const others = list.filter(m => m.id !== id);
  for (let m of others) if (!m.views) m.views = Math.floor(Math.random() * 4500) + 500;
  const shuffled = others.map(m => ({ m, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, 12).map(x => x.m);
  return json({ items: shuffled });
}
async function getTrendingMovies(env) {
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  for (let m of list) if (!m.views) m.views = Math.floor(Math.random() * 4500) + 500;
  const sorted = list.map(m => ({ m, score: (m.views || 0) + Math.random() * 500 })).sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.m);
  return json({ items: sorted });
}
async function trackView(request, env) {
  try {
    const b = await request.json();
    const raw = await env.MOVIES.get("movie_list");
    const list = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(m => m.id === b.id);
    if (idx === -1) return json({ error: "Not found" }, 404);
    if (!list[idx].views) list[idx].views = Math.floor(Math.random() * 4500) + 500;
    list[idx].views += Math.floor(Math.random() * 8) + 1;
    await env.MOVIES.put("movie_list", JSON.stringify(list));
    return json({ success: true, views: list[idx].views });
  } catch (e) { return json({ error: e.message }, 500); }
}

// ═══════════════════════════════════════════════════════════
// 🏠 Home Page — With HOVER PRE-SCRAPE
// ═══════════════════════════════════════════════════════════
function homePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdultMovie</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}
header{background:#1a1a1a;padding:15px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040;position:sticky;top:0;z-index:100;flex-wrap:wrap;gap:10px}
header a.logo{color:#ff0040;font-size:24px;font-weight:bold;text-decoration:none}
.search-box{flex:1;max-width:400px;display:flex;gap:5px}.search-box input{width:100%;padding:10px 15px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;outline:none}
.search-box button{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold}
.box{max-width:1300px;margin:0 auto;padding:30px 20px}.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.card{background:#1c1c1c;border-radius:10px;overflow:hidden;cursor:pointer;transition:.3s;position:relative;color:#eee}
.card:hover{transform:translateY(-5px);box-shadow:0 10px 25px rgba(255,0,64,.3)}
.thumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}
.play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;background:rgba(255,0,64,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}
.views-badge{position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,.75);color:#fff;font-size:11px;padding:3px 8px;border-radius:4px}
.watched-badge{position:absolute;top:6px;right:6px;background:#00c853;color:#000;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:10px}
.info{padding:12px}.info h3{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pager{display:flex;justify-content:center;gap:8px;margin-top:40px;flex-wrap:wrap}.pager button{padding:10px 16px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer}
.pager button.active{background:#ff0040;border-color:#ff0040}.pager button:disabled{opacity:.3}
.empty{text-align:center;padding:60px;color:#666;grid-column:1/-1}.ad{margin:20px 0;text-align:center;overflow:hidden}
</style></head><body>
<header><a href="/" class="logo">AdultMovie</a><div class="search-box"><input id="searchInput" placeholder="Search..." onkeypress="if(event.key==='Enter')triggerSearch()"><button onclick="triggerSearch()">Search</button></div></header>
<div class="box"><div class="ad" id="adTop"></div><div id="grid" class="grid"></div><div id="pager" class="pager"></div><div class="ad" id="adBot"></div></div>
<script>
var SEED=Math.random().toString(36).substring(2,12),P=1,S="";
function $(i){return document.getElementById(i)}
function getWatched(){try{return JSON.parse(localStorage.getItem("watched_ids")||"[]")}catch(e){return[]}}
function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
function triggerSearch(){S=$("searchInput").value.trim();P=1;load(1)}
function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s)}else{c.appendChild(n.cloneNode(true))}});sc.forEach(function(s){c.appendChild(s)})}
async function loadAds(){try{var r=await fetch("/api/ads");var d=await r.json();if(d.code&&d.code.trim()){injectAds("adTop",d.code);injectAds("adBot",d.code)}}catch(e){}}

function hiddenIframe(url){
  return new Promise(function(resolve){
    var ifr=document.createElement("iframe");
    ifr.style.cssText="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-9999";
    ifr.src=url;var done=false;
    var timer=setTimeout(function(){if(done)return;done=true;try{document.body.removeChild(ifr)}catch(e){};resolve(null)},2000);
    ifr.onload=function(){
      if(done)return;
      setTimeout(function(){
        try{
          var doc=ifr.contentDocument||ifr.contentWindow.document;
          if(!doc)throw new Error("no doc");
          var html=doc.documentElement.outerHTML;
          if(!html||html.length<100)throw new Error("empty");
          done=true;clearTimeout(timer);try{document.body.removeChild(ifr)}catch(e){};resolve(html)
        }catch(e){done=true;clearTimeout(timer);try{document.body.removeChild(ifr)}catch(e2){};resolve(null)}
      },800)
    };
    document.body.appendChild(ifr)
  })
}
function extractUrl(html){
  var pats=[/setVideoUrlHigh\\s*\\(\\s*['"]([^'"]+)['"]/i,/setVideoUrlLow\\s*\\(\\s*['"]([^'"]+)['"]/i,/setVideoUrl\\s*\\(\\s*['"]([^'"]+)['"]/i,/"contentUrl"\\s*:\\s*"([^"]+)"/i,/(https?:\\/\\/[^"'\\s<>]+\\.mp4[^"'\\s<>]*)/i,/(https?:\\/\\/[^"'\\s<>]+\\.m3u8[^"'\\s<>]*)/i];
  for(var i=0;i<pats.length;i++){var m=html.match(pats[i]);if(m&&m[1])return m[1].replace(/\\\\\\//g,"/").replace(/&amp;/g,"&").replace(/\\\\/g,"")}
  return ""
}
async function fetchHtmlBrowserClient(url){
  var ifrPromise=hiddenIframe(url);
  var proxies=[
    {pre:"https://api.allorigins.win/raw?url=",hdr:{}},
    {pre:"https://corsproxy.io/?url=",hdr:{}},
    {pre:"https://r.jina.ai/",hdr:{"Accept":"text/plain","X-Return-Format":"html"}}
  ];
  var proxyPromises=proxies.map(function(p){
    return fetch(p.pre+encodeURIComponent(url),{headers:p.hdr})
      .then(function(r){return r.ok?r.text():null})
      .then(function(t){return (t&&t.length>200&&(t.indexOf("setVideoUrl")>-1||t.indexOf(".mp4")>-1))?t:null})
      .catch(function(){return null});
  });
  var allPromises=[ifrPromise].concat(proxyPromises);
  return new Promise(function(resolve){
    var done=false;
    allPromises.forEach(function(p){
      p.then(function(h){
        if(done)return;
        if(h&&h.length>200&&(h.indexOf("setVideoUrl")>-1||h.indexOf(".mp4")>-1)){
          done=true;resolve(h);
        }
      }).catch(function(){});
    });
    setTimeout(function(){if(!done){done=true;resolve(null)}},4000);
  });
}
async function silentScrape(movie){
  if(!movie||!movie.embedUrl)return false;
  if(movie._scraping)return false;
  var needs=!movie.contentUrl||(movie.urlExpiry&&Date.now()>movie.urlExpiry-60000);
  if(!needs)return false;
  movie._scraping=true;
  try{
    var html=await fetchHtmlBrowserClient(movie.embedUrl);
    if(!html){movie._scraping=false;return false}
    var url=extractUrl(html);
    if(!url){movie._scraping=false;return false}
    var r=await fetch("/api/silent-refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:movie.id,videoUrl:url})});
    var d=await r.json();
    if(d&&d.ok){movie.contentUrl=url;movie.videoUrl=url;movie.urlExpiry=Date.now()+(5*60*1000)}
    movie._scraping=false;
    return d&&d.ok===true;
  }catch(e){movie._scraping=false;return false}
}
function bgScrape(movies){
  var c=movies.filter(function(m){if(!m.embedUrl)return false;if(!m.contentUrl)return true;if(m.urlExpiry&&Date.now()>m.urlExpiry-120000)return true;return false}).slice(0,3);
  c.forEach(function(mv,i){setTimeout(function(){silentScrape(mv)},3000+i*2000)})
}

async function load(p){
  P=p;
  var u="/api/movies?page="+p+"&seed="+encodeURIComponent(SEED);
  var w=getWatched().join(",");
  if(w)u+="&watched="+encodeURIComponent(w);
  if(S)u+="&search="+encodeURIComponent(S);
  try{
    var r=await fetch(u);
    var d=await r.json();
    var g=$("grid");
    g.innerHTML="";
    if(!d.items||!d.items.length){g.innerHTML='<div class="empty">No videos</div>';$("pager").innerHTML="";return}
    var ws={};getWatched().forEach(function(x){ws[String(x)]=1});
    d.items.forEach(function(m){
      var a=document.createElement("div");
      a.className="card";
      var s=m.thumbnail?"background-image:url('"+m.thumbnail+"')":"";
      var badge=ws[String(m.id)]?'<div class="watched-badge">✓ Watched</div>':"";
      var v=m.views||(Math.floor(Math.random()*4500)+500);
      a.innerHTML='<div class="thumb" style="'+s+'">'+badge+'<div class="views-badge">👁 '+fmt(v)+'</div><div class="play">▶</div></div><div class="info"><h3>'+esc(m.title)+'</h3></div>';
      a.onclick=function(){location.href="/watch?id="+m.id};
      // ⚡ PRE-SCRAPE on hover — silent, background
      var hovered=false;
      a.onmouseenter=function(){
        if(hovered)return;hovered=true;
        if(!m.contentUrl||(m.urlExpiry&&Date.now()>m.urlExpiry-120000)){
          silentScrape(m);
        }
      };
      // ⚡ PRE-SCRAPE on touch (mobile)
      a.ontouchstart=function(){
        if(hovered)return;hovered=true;
        if(!m.contentUrl||(m.urlExpiry&&Date.now()>m.urlExpiry-120000)){
          silentScrape(m);
        }
      };
      g.appendChild(a);
    });
    pager(d.page,d.totalPages);
    try{bgScrape(d.items)}catch(e){}
  }catch(e){$("grid").innerHTML='<div class="empty">Error</div>'}
}
function pager(c,t){var el=$("pager");el.innerHTML="";if(t<=1)return;var pv=document.createElement("button");pv.textContent="« Prev";pv.disabled=c===1;pv.onclick=function(){load(c-1)};el.appendChild(pv);var st=Math.max(1,c-2),en=Math.min(t,st+4);if(en-st<4)st=Math.max(1,en-4);for(var i=st;i<=en;i++){(function(i){var b=document.createElement("button");b.textContent=i;if(i===c)b.classList.add("active");b.onclick=function(){load(i)};el.appendChild(b)})(i)}var nx=document.createElement("button");nx.textContent="Next »";nx.disabled=c===t;nx.onclick=function(){load(c+1)};el.appendChild(nx)}
loadAds();load(1);
</script></body></html>`;
}

// ═══════════════════════════════════════════════════════════
// 🎬 Watch Page — FAST (cached ad, hover pre-scrape)
// ═══════════════════════════════════════════════════════════
function watchPage(id) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee}
header{background:#1a1a1a;padding:14px 24px;border-bottom:2px solid #ff0040;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}
header a.logo{color:#ff0040;font-size:22px;font-weight:bold;text-decoration:none}header a.back-btn{color:#eee;text-decoration:none;padding:8px 14px;background:#ff0040;border-radius:6px;font-size:14px}
.wrap{max-width:1000px;margin:24px auto;padding:0 16px}
.player-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-width:860px;margin:0 auto}
.player{width:100%;height:100%;position:relative}.player video{width:100%;height:100%;border:0;display:block;object-fit:contain;background:#000}
.loader-box{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10}
.spinner{width:50px;height:50px;border:5px solid rgba(255,0,64,.2);border-top-color:#ff0040;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:15px}
@keyframes spin{to{transform:rotate(360deg)}}.loader-text{color:#ff0040;font-size:14px;font-weight:bold;letter-spacing:1px;text-align:center;padding:0 20px}
.title{margin-top:18px;font-size:20px;font-weight:700;line-height:1.4}.meta{margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:#aaa;font-size:14px}
.meta .views{color:#ff9800;font-weight:600}.ad{margin:20px 0;text-align:center;overflow:hidden}
.section-title{margin:32px 0 16px;font-size:18px;font-weight:700;color:#fff;display:flex;align-items:center;gap:10px}
.section-title:before{content:"";width:4px;height:22px;background:#ff0040;border-radius:2px}
.related-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:30px}
.rcard{background:#1c1c1c;border-radius:8px;overflow:hidden;cursor:pointer;transition:.25s;color:#eee;text-decoration:none;display:block}
.rcard:hover{transform:translateY(-4px);box-shadow:0 8px 20px rgba(255,0,64,.3)}
.rthumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat}.rinfo{padding:10px}
.rinfo h4{font-size:13px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.rinfo .rviews{font-size:11px;color:#888;margin-top:4px}
.trending-side{display:grid;gap:12px;margin-bottom:30px}.tcard{display:flex;gap:12px;background:#1c1c1c;border-radius:8px;padding:8px;color:#eee;text-decoration:none}
.tcard:hover{background:#252525}.tthumb{width:120px;aspect-ratio:16/9;border-radius:6px;background:#333 center/cover no-repeat;flex-shrink:0;position:relative}
.tthumb .tnum{position:absolute;top:4px;left:4px;background:rgba(255,0,64,.9);color:#fff;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px}
.tinfo{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}.tinfo h4{font-size:14px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:4px}
.tinfo .tviews{font-size:12px;color:#888}
.video-error{display:none;position:absolute;inset:0;background:rgba(0,0,0,.9);z-index:15;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}
.video-error.show{display:flex}.video-error h3{color:#ff0040;font-size:18px;margin-bottom:10px}
.video-error p{color:#ccc;font-size:14px;margin-bottom:16px;max-width:400px}
.video-error button{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold}
.ad-overlay{position:absolute;inset:0;background:rgba(0,0,0,.95);z-index:99;display:none;flex-direction:column;align-items:center;justify-content:center}
.ad-overlay.show{display:flex}.ad-iframe-box{width:100%;height:100%;border:none;background:#fff;position:absolute;top:0;left:0;z-index:1}
.ad-controls{position:absolute;bottom:20px;right:20px;z-index:100;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.ad-timer{background:rgba(0,0,0,0.8);color:#fff;padding:8px 15px;border-radius:20px;font-size:14px;font-weight:bold;border:1px solid #555}
.ad-close{background:#ff0040;color:#fff;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:bold;border:none;cursor:pointer;display:none;box-shadow:0 4px 15px rgba(255,0,64,0.5)}
.ad-close.show{display:block}.ad-close:hover{background:#d10035}
.ad-skip{position:absolute;top:20px;right:20px;z-index:100;background:rgba(0,0,0,.7);color:#fff;padding:8px 16px;border-radius:6px;font-size:12px;border:1px solid #555;cursor:pointer;display:none}
.ad-skip.show{display:block}.ad-skip:hover{background:#333}
@media(max-width:768px){.title{font-size:16px}.related-grid{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<header><a href="/" class="logo">AdultMovie</a><a href="/" class="back-btn" onclick="if(history.length>1){event.preventDefault();history.back()}">← Home</a></header>
<div class="wrap">
<div class="player-wrap" id="playerWrap">
<div class="ad-overlay" id="adOverlay">
<button class="ad-skip" id="adSkipBtn" onclick="closeAd()">Skip Ad ▶</button>
<div class="ad-controls"><div class="ad-timer" id="adTimer">Loading...</div><button class="ad-close" id="adCloseBtn" onclick="closeAd()">✖ Close Ad & Play</button></div>
</div>
<div class="loader-box" id="loadingBox"><div class="spinner"></div><div class="loader-text" id="loaderText">Loading Video...</div></div>
<div class="player" id="pb" style="display:none;"></div>
<div class="video-error" id="videoError"><h3>⚠️ Video Not Loading</h3><p>Try reloading or pick another video.</p><button onclick="location.reload()">🔄 Reload</button></div>
</div>
<div class="title" id="t">Loading...</div>
<div class="meta" id="metaBar"></div>
<div class="ad" id="adBox"></div>
<div class="section-title">🎬 You May Also Like</div>
<div class="related-grid" id="relatedGrid"></div>
<div class="section-title">🔥 Trending Now</div>
<div class="trending-side" id="trendingList"></div>
</div>
<script>
function $(i){return document.getElementById(i)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}
function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}
function markWatched(id){try{var a=JSON.parse(localStorage.getItem("watched_ids")||"[]");var s=String(id);if(a.indexOf(s)===-1)a.push(s);if(a.length>500)a=a.slice(-500);localStorage.setItem("watched_ids",JSON.stringify(a))}catch(e){}}
function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s)}else{c.appendChild(n.cloneNode(true))}});sc.forEach(function(s){c.appendChild(s)})}
var id=new URLSearchParams(location.search).get("id");
var movieData=null,retryCount=0,maxRetries=3,adTimerInterval=null,adEndsAt=0,videoReady=false,videoEl=null,adClosed=false;

function hiddenIframe(url){
  return new Promise(function(resolve){
    var ifr=document.createElement("iframe");
    ifr.style.cssText="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-9999";
    ifr.src=url;var done=false;
    var timer=setTimeout(function(){if(done)return;done=true;try{document.body.removeChild(ifr)}catch(e){};resolve(null)},2000);
    ifr.onload=function(){
      if(done)return;
      setTimeout(function(){
        try{
          var doc=ifr.contentDocument||ifr.contentWindow.document;
          if(!doc)throw new Error("no doc");
          var html=doc.documentElement.outerHTML;
          if(!html||html.length<100)throw new Error("empty");
          done=true;clearTimeout(timer);try{document.body.removeChild(ifr)}catch(e){};resolve(html)
        }catch(e){done=true;clearTimeout(timer);try{document.body.removeChild(ifr)}catch(e2){};resolve(null)}
      },800)
    };
    document.body.appendChild(ifr)
  })
}
function extractUrl(html){
  var pats=[/setVideoUrlHigh\\s*\\(\\s*['"]([^'"]+)['"]/i,/setVideoUrlLow\\s*\\(\\s*['"]([^'"]+)['"]/i,/setVideoUrl\\s*\\(\\s*['"]([^'"]+)['"]/i,/"contentUrl"\\s*:\\s*"([^"]+)"/i,/(https?:\\/\\/[^"'\\s<>]+\\.mp4[^"'\\s<>]*)/i,/(https?:\\/\\/[^"'\\s<>]+\\.m3u8[^"'\\s<>]*)/i];
  for(var i=0;i<pats.length;i++){var m=html.match(pats[i]);if(m&&m[1])return m[1].replace(/\\\\\\//g,"/").replace(/&amp;/g,"&").replace(/\\\\/g,"")}
  return ""
}
async function fetchHtmlBrowserClient(url){
  var ifrPromise=hiddenIframe(url);
  var proxies=[
    {pre:"https://api.allorigins.win/raw?url=",hdr:{}},
    {pre:"https://corsproxy.io/?url=",hdr:{}},
    {pre:"https://r.jina.ai/",hdr:{"Accept":"text/plain","X-Return-Format":"html"}}
  ];
  var proxyPromises=proxies.map(function(p){
    return fetch(p.pre+encodeURIComponent(url),{headers:p.hdr})
      .then(function(r){return r.ok?r.text():null})
      .then(function(t){return (t&&t.length>200&&(t.indexOf("setVideoUrl")>-1||t.indexOf(".mp4")>-1))?t:null})
      .catch(function(){return null});
  });
  var allPromises=[ifrPromise].concat(proxyPromises);
  return new Promise(function(resolve){
    var done=false;
    allPromises.forEach(function(p){
      p.then(function(h){
        if(done)return;
        if(h&&h.length>200&&(h.indexOf("setVideoUrl")>-1||h.indexOf(".mp4")>-1)){
          done=true;resolve(h);
        }
      }).catch(function(){});
    });
    setTimeout(function(){if(!done){done=true;resolve(null)}},4000);
  });
}
async function silentScrape(movie){
  if(!movie||!movie.embedUrl)return false;
  var needs=!movie.contentUrl||(movie.urlExpiry&&Date.now()>movie.urlExpiry-60000);
  if(!needs)return false;
  try{
    var html=await fetchHtmlBrowserClient(movie.embedUrl);
    if(!html)return false;
    var url=extractUrl(html);
    if(!url)return false;
    var r=await fetch("/api/silent-refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:movie.id,videoUrl:url})});
    var d=await r.json();
    if(d&&d.ok){movie.contentUrl=url;movie.videoUrl=url;return true}
    return false;
  }catch(e){return false}
}

// ⚡ Ad config cache
var adConfigCache=null;
var adConfigTime=0;
async function getAdConfigFast(){
  var isAdmin=!!localStorage.getItem("admin_token");
  if(isAdmin)return null;
  var now=Date.now();
  if(adConfigCache!==null&&(now-adConfigTime)<300000)return adConfigCache;
  try{
    var r=await fetch("/api/interval-link");
    var d=await r.json();
    adConfigCache=d;
    adConfigTime=now;
    return d;
  }catch(e){return null}
}

function showAdWithContent(adUrl){
  var overlay=$("adOverlay");
  if(!overlay)return;
  overlay.classList.add("show");
  var ifr=document.createElement("iframe");
  ifr.className="ad-iframe-box";
  ifr.src=adUrl;
  ifr.scrolling="no";
  ifr.allow="autoplay; fullscreen";
  overlay.insertBefore(ifr,overlay.firstChild);
  var totalSecs=7;
  adEndsAt=Date.now()+totalSecs*1000;
  $("adTimer").style.display="";
  $("adTimer").textContent=totalSecs+"s";
  $("adCloseBtn").classList.remove("show");
  $("adSkipBtn").classList.remove("show");
  // ⚡ Show skip after 2s
  setTimeout(function(){
    if(!videoReady)$("adSkipBtn").classList.add("show");
  },4000);
  adTimerInterval=setInterval(function(){
    var left=Math.ceil((adEndsAt-Date.now())/1000);
    if(left<=0){
      clearInterval(adTimerInterval);
      if(videoReady){closeAd()}
      else{$("adTimer").textContent="Loading...";$("adSkipBtn").classList.add("show");$("adCloseBtn").classList.add("show")}
    }else{$("adTimer").textContent=left+"s"}
  },200);
}

function closeAd(){
  if(adClosed)return;
  adClosed=true;
  $("adOverlay").classList.remove("show");
  var ifr=$("adOverlay").querySelector("iframe");
  if(ifr)ifr.remove();
  if(adTimerInterval)clearInterval(adTimerInterval);
  if(videoEl)videoEl.play().catch(function(){});
}

async function loadData(){
  if(!id){$("t").textContent="No ID";return}
  // ⚡ Ad config + movie data in parallel
  getAdConfigFast().then(function(cfg){
    if(cfg&&cfg.url&&cfg.url.trim())showAdWithContent(cfg.url.trim());
  });
  try{
    var r=await fetch("/api/movie?id="+id);
    if(!r.ok)throw new Error("Not found");
    var d=await r.json();
    movieData=d.movie;
    document.title=movieData.title;
    $("t").textContent=movieData.title;
    renderMeta();
    markWatched(movieData.id);
    var needsScrape=!movieData.contentUrl;
    if(!needsScrape&&movieData.urlExpiry)needsScrape=Date.now()>(movieData.urlExpiry-60000);
    if(movieData.contentUrl&&!needsScrape){
      playVideo();
    } else {
      $("loadingBox").style.display="flex";
      $("loaderText").textContent="Loading video...";
      silentScrape(movieData).then(function(){playVideo()}).catch(function(){playVideo()});
    }
    loadRelated();
    loadTrending();
  }catch(e){
    $("t").textContent="Video Not Found";
    $("loadingBox").style.display="none";
    $("videoError").classList.add("show");
    $("adOverlay").classList.remove("show");
    var ifr2=$("adOverlay").querySelector("iframe");
    if(ifr2)ifr2.remove();
  }
}

function trackView(){if(!movieData)return;fetch("/api/movies/track-view",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:movieData.id})}).then(function(r){return r.json()}).then(function(d){if(d.success&&d.views){movieData.views=d.views;renderMeta()}}).catch(function(){})}
function renderMeta(){if(!movieData)return;$("metaBar").innerHTML='<span class="views">👁️ '+fmt(movieData.views||0)+' views</span>'}
async function loadRelated(){if(!id)return;try{var r=await fetch("/api/movies/related?id="+id);var d=await r.json();var g=$("relatedGrid");g.innerHTML="";if(!d.items||!d.items.length){g.innerHTML='<p style="color:#666">No related</p>';return}d.items.forEach(function(m){var a=document.createElement("a");a.className="rcard";a.href="/watch?id="+m.id;var s=m.thumbnail?"background-image:url('"+m.thumbnail+"')":"";a.innerHTML='<div class="rthumb" style="'+s+'"></div><div class="rinfo"><h4>'+esc(m.title)+'</h4><div class="rviews">👁 '+fmt(m.views||0)+'</div></div>';g.appendChild(a)})}catch(e){}}
async function loadTrending(){try{var r=await fetch("/api/movies/trending");var d=await r.json();var g=$("trendingList");g.innerHTML="";if(!d.items)return;d.items.forEach(function(m,i){var a=document.createElement("a");a.className="tcard";a.href="/watch?id="+m.id;var s=m.thumbnail?"background-image:url('"+m.thumbnail+"')":"";a.innerHTML='<div class="tthumb" style="'+s+'"><div class="tnum">#'+(i+1)+'</div></div><div class="tinfo"><h4>'+esc(m.title)+'</h4><div class="tviews">👁 '+fmt(m.views||0)+' views</div></div>';g.appendChild(a)})}catch(e){}}

async function playVideo(){
  if(!movieData)return;
  $("pb").style.display="block";
  $("videoError").classList.remove("show");
  $("loadingBox").style.display="flex";
  $("loaderText").textContent="Loading video...";
  retryCount=0;
  playContent("/api/stream?id="+encodeURIComponent(movieData.id)+"&t="+Date.now());
}

function playContent(url){
  var pb=$("pb");pb.innerHTML="";
  var v=document.createElement("video");
  v.src=url;v.controls=true;v.autoplay=false;v.playsInline=true;v.preload="auto";
  v.style.cssText="width:100%;height:100%;object-fit:contain;background:#000";
  videoEl=v;
  var finished=false;
  function finish(state){
    if(finished)return;finished=true;
    if(state==="ok"){
      $("loadingBox").style.display="none";
      videoReady=true;
      if(adClosed||!$("adOverlay").classList.contains("show")){
        v.play().catch(function(){});
      }
    }
    else if(state==="retry"){
      if(retryCount>=maxRetries){
        $("adOverlay").classList.remove("show");
        var ifr=$("adOverlay").querySelector("iframe");
        if(ifr)ifr.remove();
        if(movieData){
          silentScrape(movieData).then(function(ok){
            if(ok){showVideoError();setTimeout(function(){location.reload()},100)}
            else{showVideoError()}
          })
        }else{showVideoError()}
        return
      }
      retryCount++;
      $("loadingBox").style.display="flex";
      $("loaderText").textContent="Loading video...";
      setTimeout(function(){playContent("/api/stream?id="+encodeURIComponent(movieData.id)+"&t="+Date.now()+"&r="+retryCount)},800)
    }
    else{showVideoError()}
  }
  v.onerror=function(){finish("retry")};
  v.onloadeddata=function(){finish("ok")};
  v.oncanplay=function(){finish("ok")};
  setTimeout(function(){if(!finished&&v.readyState<2)finish("retry")},10000);
  pb.appendChild(v);trackView();
  try{fetch("/api/ads").then(function(r){return r.json()}).then(function(ad){if(ad.code&&ad.code.trim())injectAds("adBox",ad.code)})}catch(e){}
}

function showVideoError(){
  $("videoError").classList.add("show");
  $("loadingBox").style.display="none";
  $("adOverlay").classList.remove("show");
  var ifr=$("adOverlay").querySelector("iframe");
  if(ifr)ifr.remove();
}
loadData();
</script></body></html>`;
}

// ═══════════════════════════════════════════════════════════
// 🔐 Admin Page
// ═══════════════════════════════════════════════════════════
function adminPage() {
  const P = [];
  P.push('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>');
  P.push('<style>');
  P.push('*{margin:0;padding:0;box-sizing:border-box}');
  P.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}');
  P.push('header{background:#1a1a1a;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040}');
  P.push('header h1{color:#ff0040;font-size:22px}header a{color:#eee;text-decoration:none;padding:8px 14px;background:#333;border-radius:6px;font-size:14px}');
  P.push('.wrap{max-width:1000px;margin:30px auto;padding:0 20px}');
  P.push('.card{background:#1c1c1c;border-radius:12px;padding:24px;margin-bottom:20px}');
  P.push('.card h2{color:#ff0040;margin-bottom:16px;font-size:18px}');
  P.push('label{display:block;margin-top:12px;font-size:14px;color:#aaa}');
  P.push('input,textarea{width:100%;padding:12px;margin-top:6px;background:#111;border:1px solid #333;border-radius:6px;color:#eee;font-size:15px;font-family:inherit}');
  P.push('textarea{resize:vertical;min-height:100px;font-family:monospace;font-size:13px}');
  P.push('input:focus,textarea:focus{outline:none;border-color:#ff0040}');
  P.push('button.primary{background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:600;margin-top:20px;font-size:15px}');
  P.push('button.danger{background:#c00}button.small{padding:6px 12px;font-size:12px;margin:0}');
  P.push('.item{display:flex;justify-content:space-between;align-items:center;padding:12px;background:#111;border-radius:6px;margin-bottom:8px;gap:12px;flex-wrap:wrap}');
  P.push('.item .info{flex:1;min-width:200px;display:flex;gap:12px;align-items:center}');
  P.push('.item .mini{width:70px;height:44px;border-radius:4px;flex-shrink:0;background:#333 center/cover no-repeat}');
  P.push('.item h4{font-size:14px;word-break:break-word}.item .stats{font-size:12px;color:#888;margin-top:2px}');
  P.push('.acts{display:flex;gap:6px;flex-wrap:wrap}');
  P.push('.msg{padding:10px;border-radius:6px;margin-top:12px;display:none;line-height:1.6}');
  P.push('.msg.show{display:block}.msg.ok{background:#164d2c;color:#b6ffb6}.msg.err{background:#4d1616;color:#ffb6b6}');
  P.push('.hidden{display:none}#login{max-width:400px;margin:100px auto}');
  P.push('.hint{font-size:12px;color:#888;margin-top:4px;line-height:1.6}');
  P.push('.tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}');
  P.push('.tabs button{padding:10px 20px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}');
  P.push('.tabs button.active{background:#ff0040;border-color:#ff0040}');
  P.push('.paste-box{background:#1a2a3a;border:1px dashed #00c853;padding:15px;border-radius:8px;margin-bottom:20px}');
  P.push('.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}');
  P.push('.bm-display{background:#2a1a4a;border:2px dashed #9c27b0;padding:20px;border-radius:8px;margin:16px 0;text-align:center}');
  P.push('.bm-btn{display:inline-block;background:#9c27b0;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;cursor:grab;user-select:none}');
  P.push('.step{background:#111;padding:12px;border-radius:6px;margin:8px 0;border-left:3px solid #9c27b0;font-size:14px;line-height:1.6}');
  P.push('.step b{color:#9c27b0}');
  P.push('.toast{position:fixed;top:20px;right:20px;background:#00c853;color:#fff;padding:15px 20px;border-radius:8px;z-index:9999;font-weight:bold;box-shadow:0 4px 20px rgba(0,0,0,.5);display:none}');
  P.push('.toast.err{background:#c00}.toast.show{display:block}');
  P.push('@media(max-width:600px){.row{grid-template-columns:1fr}}');
  P.push('</style></head><body>');
  P.push('<header><h1>Admin Panel</h1><a href="/">Home</a></header>');
  P.push('<div class="toast" id="toast"></div>');
  P.push('<div class="wrap">');
  P.push('<div id="login" class="card"><h2>Login</h2><label>Password</label><input type="password" id="pwd"><button class="primary" id="loginBtn">Login</button><div id="lm" class="msg"></div></div>');
  P.push('<div id="content" class="hidden">');
  P.push('<div class="tabs">');
  P.push('<button id="t1" class="active" data-tab="m">🎬 Movies</button>');
  P.push('<button id="t2" data-tab="ad">📢 Ad</button>');
  P.push('<button id="t3" data-tab="il">⏱️ Interval</button>');
  P.push('<button id="t4" data-tab="bm">📌 Bookmarklet</button>');
  P.push('</div>');
  P.push('<div id="tm">');
  P.push('<div class="card paste-box"><h2 style="color:#00c853;margin-bottom:10px">📋 Paste View Source</h2><p class="hint" style="margin-bottom:10px;color:#aaddff">Video page → Ctrl+U → Ctrl+A → Ctrl+C → paste here</p><textarea id="viewSource" placeholder="Paste View Source here..." style="min-height:150px"></textarea><button class="primary" style="background:#00c853;margin-top:10px" id="parseSourceBtn">🔍 Extract & Fill</button><div id="psm" class="msg" style="margin-top:10px"></div></div>');
  P.push('<div class="card"><h2 id="ft">Add / Edit Movie</h2><input type="hidden" id="eid"><input type="hidden" id="videoIdField">');
  P.push('<label>Title</label><input type="text" id="title">');
  P.push('<label>Embed URL</label><input type="text" id="embedUrl">');
  P.push('<label>Content URL (video link)</label><input type="text" id="contentUrl">');
  P.push('<label>Thumbnail URL</label><input type="text" id="thumb">');
  P.push('<label>Video URL / Embed</label><textarea id="vurl"></textarea>');
  P.push('<button class="primary" id="sb">Add Movie</button><button class="primary hidden" style="background:#333" id="cb" type="button">Cancel</button><div id="am" class="msg"></div></div>');
  P.push('<div class="card"><h2>All Movies</h2><div id="list"></div></div>');
  P.push('</div>');
  P.push('<div id="tad" class="hidden"><div class="card"><h2>Ad Code</h2><textarea id="ads" style="min-height:200px" placeholder="Ad script / HTML"></textarea><button class="primary" id="adsSaveBtn">Save</button><div id="adm" class="msg"></div></div></div>');
  P.push('<div id="til" class="hidden"><div class="card">');
  P.push('<h2>⏱️ Interval Link</h2><p class="hint" style="color:#aaddff;margin-bottom:16px">Watch page-এ নির্দিষ্ট সময় পর link open</p>');
  P.push('<label>URL</label><input type="text" id="intervalLinkInput" placeholder="https://example.com">');
  P.push('<div class="row"><div><label>First Delay (sec)</label><input type="number" id="intervalFirstDelayInput" value="15" min="0"></div>');
  P.push('<div><label>Interval (sec)</label><input type="number" id="intervalSecondsInput" value="60" min="5"></div></div>');
  P.push('<button class="primary" id="intervalLinkSaveBtn">Save</button>');
  P.push('<div id="ilm" class="msg"></div>');
  P.push('</div></div>');
  P.push('<div id="tbm" class="hidden"><div class="card">');
  P.push('<h2>📌 Bookmarklet — IP Block Bypass</h2>');
  P.push('<p class="hint" style="color:#aaddff;margin-bottom:16px">Server থেকে embed site block হলে এই bookmarklet browser থেকে URL বের করে।</p>');
  P.push('<div class="step"><b>ধাপ ১:</b> নিচের বাটন <b>drag</b> করে bookmarks bar এ ফেলুন</div>');
  P.push('<div class="bm-display"><a id="bmDrag" href="#" class="bm-btn">🎬 Scrape Video URL</a><div class="hint" style="margin-top:8px">উপরে টেনে bookmarks bar এ ফেলুন</div></div>');
  P.push('<div class="step"><b>ধাপ ২:</b> যেকোনো embed page খুলুন</div>');
  P.push('<div class="step"><b>ধাপ ৩:</b> Bookmarks bar থেকে <b>🎬 Scrape Video URL</b> এ ক্লিক করুন</div>');
  P.push('<div class="step"><b>ধাপ ৪:</b> Video URL popup এ আসবে → Ctrl+C</div>');
  P.push('<div class="step"><b>ধাপ ৫:</b> Admin → Edit → Content URL paste → Update</div>');
  P.push('</div></div>');
  P.push('<button class="primary danger" id="logoutBtn">Logout</button>');
  P.push('</div></div>');

  P.push('<script>');
  P.push('var token=localStorage.getItem("admin_token")||"";');
  P.push('function $(i){return document.getElementById(i)}');
  P.push('function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}');
  P.push('function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}');
  P.push('function toast(msg,type){var t=$("toast");t.textContent=msg;t.className="toast show"+(type==="err"?" err":"");setTimeout(function(){t.classList.remove("show")},2500)}');

  P.push('function setupBookmarklet(){');
  P.push('  var bkm="javascript:(function(){try{var h=document.documentElement.innerHTML;var ps=[/setVideoUrlHigh\\\\s*\\\\(\\\\s*[\\x27\\"]([^\\x27\\"]+)/i,/setVideoUrlLow\\\\s*\\\\(\\\\s*[\\x27\\"]([^\\x27\\"]+)/i,/setVideoUrl\\\\s*\\\\(\\\\s*[\\x27\\"]([^\\x27\\"]+)/i,/\\"contentUrl\\"\\\\s*:\\\\s*\\"([^\\"]+)\\"/i,/(https?:\\\\/\\\\/[^\\"\\\\s<>]+\\\\.mp4[^\\"\\\\s<>]*)/i,/(https?:\\\\/\\\\/[^\\"\\\\s<>]+\\\\.m3u8[^\\"\\\\s<>]*)/i];var u=null;for(var i=0;i<ps.length;i++){var m=h.match(ps[i]);if(m&&m[1]){u=m[1].replace(/\\\\\\\\\\\\//g,\\"/\\").replace(/&amp;/g,\\"&\\").replace(/\\\\\\\\/g,\\"\\");break}}if(u){var w=window.open(\\"\\",\\"_blank\\",\\"width=700,height=250\\");w.document.write(\\"<html><body style=\\\\\\"background:#1c1c1c;color:#fff;font-family:monospace;padding:20px\\\\\\"><h3 style=\\\\\\"color:#00c853\\\\\\">✅ Video URL Found</h3><textarea style=\\\\\\"width:100%;height:120px;background:#000;color:#0f0;border:1px solid #333;padding:10px\\\\\\" onclick=\\\\\\"this.select()\\\\\\">\\"+u+\\"</textarea><p style=\\\\\\"color:#aaa;margin-top:10px\\\\\\">Click box + Ctrl+C</p></body></html>\\");w.document.close()}else{alert(\\"❌ No video URL found\\")}}catch(e){alert(\\"Error: \\"+e.message)}})();";');
  P.push('  var bm=$("bmDrag");if(bm)bm.href=bkm;');
  P.push('}');

  P.push('window.addEventListener("DOMContentLoaded",function(){');
  P.push(' $("loginBtn").onclick=doLogin;');
  P.push(' $("sb").onclick=saveMovie;');
  P.push(' $("cb").onclick=reset;');
  P.push(' $("logoutBtn").onclick=logout;');
  P.push(' $("adsSaveBtn").onclick=saveAds;');
  P.push(' $("intervalLinkSaveBtn").onclick=saveIntervalLink;');
  P.push(' $("parseSourceBtn").onclick=parseViewSource;');
  P.push(' document.querySelectorAll("[data-tab]").forEach(function(b){b.onclick=function(){tab(b.getAttribute("data-tab"))}});');
  P.push(' setupBookmarklet();');
  P.push(' if(token)verify().then(function(ok){if(ok)show()});');
  P.push('});');

  P.push('async function verify(){try{var r=await fetch("/api/check-auth",{headers:{"X-Admin-Password":token}});return r.ok}catch(e){return false}}');
  P.push('async function doLogin(){var pwd=$("pwd").value;var m=$("lm");try{var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});var d=await r.json();if(r.ok){token=d.token;localStorage.setItem("admin_token",token);show()}else{m.textContent=d.error||"Failed";m.className="msg err show"}}catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}}');
  P.push('function show(){$("login").classList.add("hidden");$("content").classList.remove("hidden");loadList();loadAds();loadIntervalLink()}');
  P.push('function logout(){localStorage.removeItem("admin_token");location.reload()}');
  P.push('function tab(n){');
  P.push(' ["tm","tad","til","tbm"].forEach(function(x){var e=$(x);if(e)e.classList.add("hidden")});');
  P.push(' ["t1","t2","t3","t4"].forEach(function(x){var e=$(x);if(e)e.classList.remove("active")});');
  P.push(' if(n==="m"){$("tm").classList.remove("hidden");$("t1").classList.add("active")}');
  P.push(' if(n==="ad"){$("tad").classList.remove("hidden");$("t2").classList.add("active")}');
  P.push(' if(n==="il"){$("til").classList.remove("hidden");$("t3").classList.add("active")}');
  P.push(' if(n==="bm"){$("tbm").classList.remove("hidden");$("t4").classList.add("active")}');
  P.push('}');
  P.push('function reset(){$("eid").value="";$("title").value="";$("vurl").value="";$("thumb").value="";$("videoIdField").value="";$("embedUrl").value="";$("contentUrl").value="";$("ft").textContent="Add / Edit Movie";$("sb").textContent="Add Movie";$("cb").classList.add("hidden")}');
  P.push('function parseViewSource(){');
  P.push('  var text=$("viewSource").value;var m=$("psm");');
  P.push('  if(!text||!text.trim()){m.textContent="Paste source first";m.className="msg err show";return}');
  P.push('  var found=[];var title="";');
  P.push('  var tm=text.match(/<title>([^<]+)<\\/title>/i);');
  P.push('  if(tm){title=tm[1].trim();found.push("Title")}');
  P.push('  var embedUrl="";');
  P.push('  var iframes=text.match(/<iframe[\\s\\S]*?>/gi)||[];');
  P.push('  for(var i=0;i<iframes.length;i++){var sm=iframes[i].match(/src\\s*=\\s*["\']([^"\']+)["\']/i);if(sm&&/embedframe|embed\\/|player\\//i.test(sm[1])){embedUrl=sm[1];break}}');
  P.push('  if(embedUrl){embedUrl=embedUrl.replace(/&amp;/g,"&");found.push("Embed URL")}');
  P.push('  var contentUrl="";');
  P.push('  var cm=text.match(/setVideoUrlHigh\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  P.push('  if(!cm)cm=text.match(/setVideoUrlLow\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  P.push('  if(!cm)cm=text.match(/setVideoUrl\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  P.push('  if(!cm)cm=text.match(/(https?:\\/\\/[^"\'\\s<>]+\\.mp4[^"\'\\s<>]*)/i);');
  P.push('  if(cm){contentUrl=cm[1].replace(/&amp;/g,"&").replace(/\\\\\\//g,"/");found.push("Content URL")}');
  P.push('  var thumb="";');
  P.push('  var thm=text.match(/"thumbnailUrl"\\s*:\\s*\\[\\s*"([^"]+)"/i)||text.match(/"thumbnailUrl"\\s*:\\s*"([^"]+)"/i);');
  P.push('  if(thm){thumb=thm[1].replace(/&amp;/g,"&");found.push("Thumbnail")}');
  P.push('  if(title)$("title").value=title;');
  P.push('  if(embedUrl)$("embedUrl").value=embedUrl;');
  P.push('  if(contentUrl)$("contentUrl").value=contentUrl;');
  P.push('  if(thumb)$("thumb").value=thumb;');
  P.push('  if(contentUrl)$("vurl").value=contentUrl;else if(embedUrl)$("vurl").value=embedUrl;');
  P.push('  if(embedUrl){var vm=embedUrl.match(/\\/([a-zA-Z0-9\\-]+)\\/?$/);if(vm)$("videoIdField").value=vm[1]}');
  P.push('  if(found.length){m.innerHTML="✅ Found: <b>"+found.join(", ")+"</b>";m.className="msg ok show";m.style.color="#b6ffb6"}');
  P.push('  else{m.innerHTML="❌ Nothing found";m.className="msg err show";m.style.color="#ffb6b6"}');
  P.push('}');
  P.push('async function saveMovie(){');
  P.push('  var eid=$("eid").value;var title=$("title").value.trim();var embedUrl=$("embedUrl").value.trim();');
  P.push('  var contentUrl=$("contentUrl").value.trim();var thumb=$("thumb").value.trim();');
  P.push('  var vurl=$("vurl").value.trim();var vid=$("videoIdField").value.trim();var m=$("am");');
  P.push('  if(!title||(!vurl&&!contentUrl&&!embedUrl)){m.textContent="Title ও URL দরকার";m.className="msg err show";return}');
  P.push('  var u=eid?"/api/movies/update":"/api/movies";');
  P.push('  var body={title:title,embedUrl:embedUrl,contentUrl:contentUrl,thumbnail:thumb,videoUrl:vurl};');
  P.push('  if(eid)body.id=eid;if(!eid&&vid)body.videoId=vid;');
  P.push('  try{var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify(body)});');
  P.push('    var d=await r.json();');
  P.push('    if(r.ok){m.textContent=eid?"Updated":"Added";m.className="msg ok show";reset();loadList();setTimeout(function(){m.classList.remove("show")},2500)}');
  P.push('    else{m.textContent=d.error||"Failed";m.className="msg err show"}');
  P.push('  }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}');
  P.push('}');
  P.push('async function refreshAllBtn(){if(!confirm("Server-side refresh?"))return;try{var r=await fetch("/api/refresh-all",{method:"POST",headers:{"X-Admin-Password":token}});var d=await r.json();if(r.ok){alert("OK: "+d.ok+"  Fail: "+d.fail)}else{alert(d.error)}}catch(e){alert(e.message)}loadList()}');

  P.push('async function loadList(){');
  P.push('  var pg=1,all=[];while(true){var r=await fetch("/api/movies?page="+pg+"&noshuffle=1");var d=await r.json();all=all.concat(d.items);if(pg>=d.totalPages)break;pg++}');
  P.push('  var el=$("list");');
  P.push('  if(!all.length){el.innerHTML=\'<p style="color:#666">No movies</p>\';return}');
  P.push('  el.innerHTML="";');
  P.push('  var hdr=document.createElement("div");');
  P.push('  hdr.style.cssText="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center";');
  P.push('  hdr.innerHTML=\'<div style="font-size:14px;color:#888;flex:1">Total: \'+all.length+\'</div>\';');
  P.push('  var bmBtn=document.createElement("button");bmBtn.className="primary small";bmBtn.style.cssText="background:#9c27b0;margin:0";bmBtn.textContent="📌 Bookmarklet";bmBtn.onclick=function(){tab("bm")};');
  P.push('  var autoBtn=document.createElement("button");autoBtn.className="primary small";autoBtn.style.cssText="background:#00c853;margin:0";autoBtn.textContent="🚀 Auto Scrape ALL";autoBtn.onclick=function(){autoScrapeAll(all)};');
  P.push('  var refAll=document.createElement("button");refAll.className="primary small";refAll.style.cssText="background:#ff9800;margin:0";refAll.textContent="🔄 Server Refresh";refAll.onclick=refreshAllBtn;');
  P.push('  hdr.appendChild(bmBtn);hdr.appendChild(autoBtn);hdr.appendChild(refAll);el.appendChild(hdr);');
  P.push('  all.forEach(function(mv){');
  P.push('    var s=mv.thumbnail?"background-image:url(\'"+mv.thumbnail+"\')":"";');
  P.push('    var expired=mv.urlExpiry&&Date.now()>mv.urlExpiry-60000;');
  P.push('    var hasC=mv.contentUrl?(expired?"🟡":"✅"):"⚠️";');
  P.push('    var noEmbed=!mv.embedUrl?" ❌Embed":"";');
  P.push('    var row=document.createElement("div");row.className="item";');
  P.push('    var info=document.createElement("div");info.className="info";');
  P.push('    info.innerHTML=\'<div class="mini" style="\'+s+\'"></div><div><h4>\'+esc(mv.title)+\' \'+hasC+noEmbed+\'</h4><div class="stats">👁 \'+fmt(mv.views||0)+\'</div></div>\';');
  P.push('    var acts=document.createElement("div");acts.className="acts";');
  P.push('    var sb=document.createElement("button");sb.className="primary small";sb.style.cssText="background:#00c853;margin:0";sb.textContent="🚀 Scrape";sb.onclick=function(){autoScrapeOne(mv,sb)};');
  P.push('    var cb=document.createElement("button");cb.className="primary small";cb.style.cssText="background:#9c27b0;margin:0";cb.textContent="📌 Open";cb.onclick=function(){openEmbed(mv)};');
  P.push('    var eb=document.createElement("button");eb.className="primary small";eb.style.cssText="margin:0";eb.textContent="Edit";eb.onclick=function(){editMovie(mv.id)};');
  P.push('    var db=document.createElement("button");db.className="primary small danger";db.style.cssText="margin:0";db.textContent="Del";db.onclick=function(){delMovie(mv.id)};');
  P.push('    acts.appendChild(sb);acts.appendChild(cb);acts.appendChild(eb);acts.appendChild(db);');
  P.push('    row.appendChild(info);row.appendChild(acts);el.appendChild(row);');
  P.push('  });');
  P.push('}');

  P.push('function openEmbed(mv){');
  P.push('  if(!mv.embedUrl){toast("❌ No embedUrl","err");return}');
  P.push('  navigator.clipboard.writeText(mv.embedUrl).then(function(){toast("✅ Copied!")}).catch(function(){prompt("Copy:",mv.embedUrl)});');
  P.push('  setTimeout(function(){window.open(mv.embedUrl,"_blank")},500);');
  P.push('}');

  P.push('async function autoScrapeOne(mv,btn){');
  P.push('  if(!mv.embedUrl){toast("❌ No embedUrl","err");return}');
  P.push('  var old=btn.textContent;btn.disabled=true;btn.textContent="⏳";');
  P.push('  try{');
  P.push('    var html=await fetchHtmlBrowser(mv.embedUrl);');
  P.push('    if(!html)throw new Error("empty");');
  P.push('    var vu=extractUrlFromHtml(html);');
  P.push('    if(!vu){btn.textContent="❌";toast("URL not found","err");setTimeout(function(){btn.textContent=old;btn.disabled=false},2000);return}');
  P.push('    var r=await fetch("/api/refresh-movie",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({id:mv.id,html:html})});');
  P.push('    var d=await r.json();');
  P.push('    if(d.success){btn.textContent="✓";btn.style.background="#4caf50";toast("✅ Saved!")}');
  P.push('    else{btn.textContent="❌";toast(d.error||"Failed","err")}');
  P.push('  }catch(e){btn.textContent="❌";toast(e.message,"err")}');
  P.push('  setTimeout(function(){btn.textContent=old;btn.disabled=false;btn.style.background="#00c853"},3000);');
  P.push('}');

  P.push('async function autoScrapeAll(movies){');
  P.push('  var expired=movies.filter(function(m){if(!m.embedUrl)return false;if(!m.contentUrl)return true;if(m.urlExpiry&&Date.now()>m.urlExpiry-300000)return true;return false});');
  P.push('  if(!expired.length){alert("কোনো expired নেই!");return}');
  P.push('  if(!confirm(expired.length+" টি scrape করবে?"))return;');
  P.push('  showProgressModal(expired.length);');
  P.push('  var success=0,failed=0,updates=[];');
  P.push('  for(var i=0;i<expired.length;i++){');
  P.push('    var mv=expired[i];updateProgress(i+1,expired.length,mv.title);');
  P.push('    try{');
  P.push('      var html=await fetchHtmlBrowser(mv.embedUrl);');
  P.push('      if(html){var vu=extractUrlFromHtml(html);if(vu){updates.push({id:mv.id,html:html});success++}else{failed++}}else{failed++}');
  P.push('    }catch(e){failed++}');
  P.push('    await sleep(800);');
  P.push('  }');
  P.push('  updateProgress(expired.length,expired.length,"Saving...");');
  P.push('  if(updates.length>0){try{await fetch("/api/bulk-update-links",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({updates:updates})})}catch(e){}}');
  P.push('  hideProgressModal();');
  P.push('  alert("✅ "+success+"  ❌ "+failed);');
  P.push('  loadList();');
  P.push('}');

  P.push('async function fetchHtmlBrowser(url){');
  P.push('  try{var h=await fetchViaIframe(url,5000);if(h&&h.length>200&&(h.indexOf("setVideoUrl")>-1||h.indexOf(".mp4")>-1))return h}catch(e){}');
  P.push('  var proxies=["https://api.allorigins.win/raw?url=","https://corsproxy.io/?url=","https://r.jina.ai/"];');
  P.push('  for(var i=0;i<proxies.length;i++){');
  P.push('    try{var r=await fetch(proxies[i]+encodeURIComponent(url),{headers:i===2?{"Accept":"text/plain","X-Return-Format":"html"}:{}});if(r.ok){var t=await r.text();if(t&&t.length>200)return t}}catch(e){}');
  P.push('  }');
  P.push('  throw new Error("All methods failed");');
  P.push('}');

  P.push('function fetchViaIframe(url,timeout){');
  P.push('  return new Promise(function(resolve,reject){');
  P.push('    var ifr=document.createElement("iframe");');
  P.push('    ifr.style.cssText="position:fixed;top:0;right:0;width:400px;height:300px;opacity:0.01;pointer-events:none;z-index:-1";');
  P.push('    ifr.src=url;var done=false;');
  P.push('    var timer=setTimeout(function(){if(done)return;done=true;reject(new Error("timeout"))},timeout);');
  P.push('    ifr.onload=function(){');
  P.push('      if(done)return;');
  P.push('      setTimeout(function(){try{var doc=ifr.contentDocument||ifr.contentWindow.document;if(!doc)throw new Error("no doc");var html=doc.documentElement.outerHTML;if(!html||html.length<100)throw new Error("empty");done=true;clearTimeout(timer);resolve(html)}catch(e){done=true;clearTimeout(timer);reject(e)}},1500);');
  P.push('    };');
  P.push('    document.body.appendChild(ifr);');
  P.push('  });');
  P.push('}');

  P.push('function extractUrlFromHtml(html){');
  P.push('  var pats=[/setVideoUrlHigh\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i,/setVideoUrlLow\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i,/setVideoUrl\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i,/"contentUrl"\\s*:\\s*"([^"]+)"/i,/(https?:\\/\\/[^"\'\\s<>]+\\/video_[^"\'\\s<>]+)/i,/(https?:\\/\\/[^"\'\\s<>]+\\.mp4[^"\'\\s<>]*)/i,/(https?:\\/\\/[^"\'\\s<>]+\\.m3u8[^"\'\\s<>]*)/i];');
  P.push('  for(var i=0;i<pats.length;i++){var m=html.match(pats[i]);if(m&&m[1])return m[1].replace(/\\\\\\//g,"/").replace(/&amp;/g,"&").replace(/\\\\/g,"")}');
  P.push('  return "";');
  P.push('}');

  P.push('function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}');
  P.push('var progressModal=null;');
  P.push('function showProgressModal(total){');
  P.push('  if(progressModal)return;');
  P.push('  progressModal=document.createElement("div");');
  P.push('  progressModal.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px";');
  P.push('  progressModal.innerHTML=\'<div style="background:#1c1c1c;border-radius:12px;padding:30px;max-width:500px;width:100%"><h2 style="color:#00c853;margin-bottom:16px">🚀 Auto Scraping</h2><div id="pmText" style="color:#aaa;margin-bottom:12px">Starting...</div><div style="background:#111;height:10px;border-radius:5px;overflow:hidden"><div id="pmBar" style="background:#00c853;height:100%;width:0%;transition:width .3s"></div></div><div id="pmStats" style="margin-top:12px;color:#888;font-size:13px"></div></div>\';');
  P.push('  document.body.appendChild(progressModal);');
  P.push('}');
  P.push('function updateProgress(cur,total,title){if(!progressModal)return;var pct=Math.round(cur/total*100);document.getElementById("pmText").textContent="("+cur+"/"+total+") "+title;document.getElementById("pmBar").style.width=pct+"%";document.getElementById("pmStats").textContent=pct+"%"};');
  P.push('function hideProgressModal(){if(progressModal){progressModal.remove();progressModal=null}}');
  P.push('async function editMovie(id){var pg=1,all=[];while(true){var r=await fetch("/api/movies?page="+pg+"&noshuffle=1");var d=await r.json();all=all.concat(d.items);if(pg>=d.totalPages)break;pg++}var mv=all.find(function(x){return x.id===id});if(!mv)return;$("eid").value=mv.id;$("title").value=mv.title;$("embedUrl").value=mv.embedUrl||"";$("contentUrl").value=mv.contentUrl||"";$("thumb").value=mv.thumbnail||"";$("vurl").value=mv.videoUrl||"";$("videoIdField").value="";$("ft").textContent="Edit Movie";$("sb").textContent="Update";$("cb").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"})}');
  P.push('async function delMovie(id){if(!confirm("Delete?"))return;var r=await fetch("/api/movies/"+encodeURIComponent(id),{method:"DELETE",headers:{"X-Admin-Password":token}});if(r.ok)loadList()}');
  P.push('async function loadAds(){var r=await fetch("/api/ads");var d=await r.json();$("ads").value=d.code||""}');
  P.push('async function saveAds(){var code=$("ads").value;var m=$("adm");var r=await fetch("/api/ads",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({code:code})});if(r.ok){m.textContent="Saved";m.className="msg ok show"}else{m.textContent="Failed";m.className="msg err show"}setTimeout(function(){m.classList.remove("show")},2500)}');
  P.push('async function loadIntervalLink(){try{var r=await fetch("/api/interval-link");var d=await r.json();$("intervalLinkInput").value=d.url||"";$("intervalSecondsInput").value=d.seconds||60;$("intervalFirstDelayInput").value=d.firstDelay||15}catch(e){}}');
  P.push('async function saveIntervalLink(){var u=$("intervalLinkInput").value.trim();var s=parseInt($("intervalSecondsInput").value)||60;var f=parseInt($("intervalFirstDelayInput").value)||15;var m=$("ilm");if(s<5){m.textContent="Min 5s";m.className="msg err show";return}try{var r=await fetch("/api/interval-link",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({url:u,seconds:s,firstDelay:f})});if(r.ok){m.textContent="✅ Saved";m.className="msg ok show"}else{m.textContent="Failed";m.className="msg err show"}}catch(e){m.textContent=e.message;m.className="msg err show"}setTimeout(function(){m.classList.remove("show")},3000)}');
  P.push('<\/script></body></html>');
  return P.join("\n");
}
