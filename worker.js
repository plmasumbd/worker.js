const ADMIN_PASSWORD = "admin123";
const PAGE_SIZE = 20;
const CACHE_TTL = 5 * 60 * 1000;
const URL_SAFETY_MARGIN = 90 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

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

  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRefreshAll(env));
  }
};

// ================= URL EXPIRY (STRONG) =================
function getUrlExpiry(url) {
  if (!url) return 0;
  const s = String(url);
  let m;

  // secure=xxx==,1234567890  (double = padding + comma) ⭐ আপনার FORMAT
  m = s.match(/[?&]secure=[^,&]+=+,\s*(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }

  // secure=xxx,1234567890
  m = s.match(/[?&]secure=[^,&]+,\s*(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }

  // secure=xxx%2C1234567890
  m = s.match(/[?&]secure=[^,&]+%2C(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }

  // expires / e / exp / ts / valid
  m = s.match(/[?&](?:expires|e|exp|valid|timestamp|ts|expire)=(\d{10,13})/i);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }

  // path এ timestamp
  m = s.match(/\/(\d{10,13})\//);
  if (m) { const t = parseInt(m[1], 10); return t < 1e12 ? t * 1000 : t; }

  return 0;
}

function isUrlExpired(url) {
  const exp = getUrlExpiry(url);
  if (exp === 0) return false;
  return Date.now() > (exp - URL_SAFETY_MARGIN);
}

// ================= STREAM PROXY =================
async function streamVideo(request, env, url) {
  const id = url.searchParams.get("id");
  if (!id) return new Response("ID required", { status: 400 });

  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return new Response("Not found", { status: 404 });

  const movie = list[idx];
  let videoUrl = movie.contentUrl || "";
  let needRefresh = !videoUrl || isUrlExpired(videoUrl);

  if (needRefresh) {
    const embedUrl = movie.embedUrl || deriveEmbedUrl(movie);
    if (embedUrl) {
      try {
        const fresh = await fetchFreshFromEmbed(embedUrl);
        if (fresh.contentUrl) {
          videoUrl = fresh.contentUrl;
          list[idx].contentUrl = fresh.contentUrl;
          list[idx].videoUrl = fresh.contentUrl;
          list[idx].lastRefresh = Date.now();
          list[idx].urlExpiry = getUrlExpiry(fresh.contentUrl);
          await env.MOVIES.put("movie_list", JSON.stringify(list));
        }
      } catch (e) {}
    }
    if (!videoUrl) return new Response("No video available", { status: 404 });
  }

  const range = request.headers.get("Range");
  const makeHeaders = () => {
    const h = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": movie.embedUrl || "https://expmle.com/",
      "Origin": (() => {
        try { return new URL(movie.embedUrl || videoUrl).origin; } catch (e) { return "https://expmle.com"; }
      })(),
    };
    if (range) h["Range"] = range;
    return h;
  };

  const tryFetch = async (u) => {
    try { return await fetch(u, { headers: makeHeaders(), redirect: "follow" }); }
    catch (e) { return null; }
  };

  let upstream = await tryFetch(videoUrl);

  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    const embedUrl = movie.embedUrl || deriveEmbedUrl(movie);
    if (embedUrl) {
      try {
        const fresh = await fetchFreshFromEmbed(embedUrl);
        if (fresh.contentUrl && fresh.contentUrl !== videoUrl) {
          list[idx].contentUrl = fresh.contentUrl;
          list[idx].videoUrl = fresh.contentUrl;
          list[idx].lastRefresh = Date.now();
          list[idx].urlExpiry = getUrlExpiry(fresh.contentUrl);
          await env.MOVIES.put("movie_list", JSON.stringify(list));
          videoUrl = fresh.contentUrl;
          upstream = await tryFetch(videoUrl);
        }
      } catch (e) {}
    }
    if (!upstream || (!upstream.ok && upstream.status !== 206)) {
      return new Response("Stream unavailable", { status: upstream ? upstream.status : 502 });
    }
  }

  return buildStreamResponse(upstream, videoUrl);
}

function buildStreamResponse(upstream, videoUrl) {
  const newHeaders = new Headers();
  newHeaders.set("Content-Type", upstream.headers.get("Content-Type") || guessContentType(videoUrl));
  const cl = upstream.headers.get("Content-Length");
  if (cl) newHeaders.set("Content-Length", cl);
  const cr = upstream.headers.get("Content-Range");
  if (cr) newHeaders.set("Content-Range", cr);
  newHeaders.set("Accept-Ranges", "bytes");
  newHeaders.set("Cache-Control", "public, max-age=1800");
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Headers", "Range, Content-Type");
  newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: newHeaders,
  });
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

// ================= AUTO-CONTENT =================
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

    if (!force && movie.contentUrl && fresh && !expired) {
      return json({ success: true, contentUrl: movie.contentUrl, cached: true });
    }

    const embedUrl = movie.embedUrl || deriveEmbedUrl(movie);
    if (!embedUrl) {
      if (movie.contentUrl && !expired) return json({ success: true, contentUrl: movie.contentUrl, cached: true, stale: true });
      return json({ error: "No embedUrl" }, 400);
    }

    const freshData = await fetchFreshFromEmbed(embedUrl);
    if (freshData.contentUrl) {
      list[idx].contentUrl = freshData.contentUrl;
      list[idx].videoUrl = freshData.contentUrl;
      list[idx].lastRefresh = now;
      list[idx].urlExpiry = getUrlExpiry(freshData.contentUrl);
      if (freshData.title) list[idx].title = freshData.title;
      if (freshData.thumbnail) list[idx].thumbnail = freshData.thumbnail;
      await env.MOVIES.put("movie_list", JSON.stringify(list));
      return json({ success: true, contentUrl: freshData.contentUrl, cached: false, expiry: list[idx].urlExpiry });
    }

    if (movie.contentUrl && !expired) return json({ success: true, contentUrl: movie.contentUrl, cached: true, stale: true });
    return json({ error: "লিংক পাওয়া যায়নি" }, 502);
  } catch (e) { return json({ error: e.message }, 500); }
}

// ================= DEBUG =================
async function debugEmbed(url) {
  const embedUrl = url.searchParams.get("url");
  if (!embedUrl) return json({ error: "url param দরকার" }, 400);
  const result = { embedUrl, attempts: [] };

  const tryOne = async (label, fn) => {
    try {
      const text = await fn();
      if (!text) return result.attempts.push({ method: label, error: "empty" });
      const svH = text.match(/(?:html5player\.)?setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]/i);
      result.attempts.push({
        method: label, length: text.length,
        foundSetVideoUrlHigh: svH ? svH[1] : null,
        hasSetVideo: /setVideoUrl/i.test(text),
        hasHtml5player: /html5player/i.test(text),
        hasSecure: /secure=/i.test(text),
        hasMp4: /\.mp4/i.test(text),
        extracted: extractVideoUrl(text) || null,
        expiry: getUrlExpiry(extractVideoUrl(text)),
        preview: text.slice(0, 800),
        around: (() => { const i = text.search(/setVideoUrl/i); return i === -1 ? "" : text.slice(Math.max(0, i - 100), i + 400); })()
      });
    } catch (e) { result.attempts.push({ method: label, error: e.message }); }
  };

  await tryOne("jina-html", async () => {
    const r = await fetch("https://r.jina.ai/" + embedUrl, { headers: { "Accept": "text/plain", "X-Return-Format": "html", "User-Agent": "Mozilla/5.0" } });
    return r.ok ? await r.text() : null;
  });
  await tryOne("jina-text", async () => {
    const r = await fetch("https://r.jina.ai/" + embedUrl, { headers: { "Accept": "text/plain", "X-Return-Format": "text", "User-Agent": "Mozilla/5.0" } });
    return r.ok ? await r.text() : null;
  });
  await tryOne("allorigins", async () => {
    const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(embedUrl));
    return r.ok ? await r.text() : null;
  });
  await tryOne("corsproxy", async () => {
    const r = await fetch("https://corsproxy.io/?url=" + encodeURIComponent(embedUrl));
    return r.ok ? await r.text() : null;
  });
  await tryOne("direct", async () => {
    const r = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Referer": "https://expmle.com/",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
      }, redirect: "follow"
    });
    return r.ok ? await r.text() : null;
  });

  return json(result);
}

// ================= REFRESH SINGLE =================
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
  const embedUrl = movie.embedUrl || deriveEmbedUrl(movie);
  if (!embedUrl) return json({ error: "embedUrl নেই" }, 400);
  try {
    const fresh = await fetchFreshFromEmbed(embedUrl);
    if (!fresh.contentUrl) return json({ error: "লিংক পাওয়া যায়নি", debug: fresh }, 502);
    list[idx].contentUrl = fresh.contentUrl;
    list[idx].videoUrl = fresh.contentUrl;
    list[idx].urlExpiry = getUrlExpiry(fresh.contentUrl);
    if (fresh.title) list[idx].title = fresh.title;
    if (fresh.thumbnail) list[idx].thumbnail = fresh.thumbnail;
    if (fresh.views) list[idx].views = fresh.views;
    list[idx].lastRefresh = Date.now();
    await env.MOVIES.put("movie_list", JSON.stringify(list));
    return json({ success: true, movie: list[idx] });
  } catch (e) { return json({ error: e.message }, 500); }
}

// ================= REFRESH ALL =================
async function refreshAll(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const result = await autoRefreshAll(env, true);
  return json({ success: true, ...result });
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

    const embedUrl = movie.embedUrl || deriveEmbedUrl(movie);
    if (!embedUrl) {
      fail++;
      if (verbose) failures.push({ id: movie.id, title: movie.title, reason: "no embedUrl" });
    } else {
      try {
        const fresh = await fetchFreshFromEmbed(embedUrl);
        if (fresh.contentUrl) {
          movie.contentUrl = fresh.contentUrl;
          movie.videoUrl = fresh.contentUrl;
          movie.urlExpiry = getUrlExpiry(fresh.contentUrl);
          if (fresh.title) movie.title = fresh.title;
          if (fresh.thumbnail) movie.thumbnail = fresh.thumbnail;
          if (fresh.views) movie.views = fresh.views;
          movie.lastRefresh = Date.now();
          ok++;
        } else {
          fail++;
          if (verbose) failures.push({ id: movie.id, title: movie.title, reason: "no video URL" });
        }
      } catch (e) {
        fail++;
        if (verbose) failures.push({ id: movie.id, title: movie.title, reason: e.message });
      }
    }
    if ((i + 1) % 5 === 0 || i === list.length - 1) {
      await env.MOVIES.put("movie_list", JSON.stringify(list));
    }
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
  }
  return { ok, fail, skipped, failures };
}

// ================= FETCH FRESH (STRONG) =================
async function fetchFreshFromEmbed(embedUrl) {
  const out = { contentUrl: "", title: "", thumbnail: "", views: 0, source: "" };
  let text = "";

  // ⭐ অনেক নমনীয় validation — শুধু setVideoUrl বা mp4/m3u8 থাকলেই accept
  const isValid = (t) => {
    if (!t || t.length < 100) return false;
    if (/setVideoUrl(?:High|Low)?\s*\(/i.test(t)) return true;
    if (/https?:\/\/[^"'\s<>\\]+\.(?:mp4|m3u8)/i.test(t)) return true;
    if (/["'](?:file|contentUrl|videoUrl|src|source)["']\s*:\s*["'][^"']+\.(?:mp4|m3u8)/i.test(t)) return true;
    if (/"contentUrl"\s*:/i.test(t)) return true;
    return false;
  };

  const tryText = async (fn, label) => {
    try {
      const t = await fn();
      if (isValid(t)) { text = t; out.source = label; return true; }
    } catch (e) {}
    return false;
  };

  // ১. jina HTML — সবচেয়ে reliable
  if (!text) await tryText(async () => {
    const r = await fetch("https://r.jina.ai/" + embedUrl, {
      headers: {
        "Accept": "text/plain",
        "X-Return-Format": "html",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
      }
    });
    return r.ok ? await r.text() : null;
  }, "jina-html");

  // ২. jina text
  if (!text) await tryText(async () => {
    const r = await fetch("https://r.jina.ai/" + embedUrl, {
      headers: {
        "Accept": "text/plain",
        "X-Return-Format": "text",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
      }
    });
    return r.ok ? await r.text() : null;
  }, "jina-text");

  // ৩. allorigins
  if (!text) await tryText(async () => {
    const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(embedUrl));
    return r.ok ? await r.text() : null;
  }, "allorigins");

  // ৪. corsproxy
  if (!text) await tryText(async () => {
    const r = await fetch("https://corsproxy.io/?url=" + encodeURIComponent(embedUrl));
    return r.ok ? await r.text() : null;
  }, "corsproxy");

  // ৫. direct
  if (!text) await tryText(async () => {
    const r = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Referer": "https://expmle.com/",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow"
    });
    return r.ok ? await r.text() : null;
  }, "direct");

  if (!text) return out;

  // ⭐ Video URL extract
  out.contentUrl = extractVideoUrl(text);

  // Title
  let m = text.match(/<title>([^<]+)<\/title>/i) ||
          text.match(/"name"\s*:\s*"([^"]+)"/i) ||
          text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (m) out.title = decodeHtml(m[1]).trim();

  // Thumbnail
  m = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) ||
      text.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i) ||
      text.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i) ||
      text.match(/"poster"\s*:\s*"([^"]+)"/i);
  if (m) out.thumbnail = decodeHtml(m[1]);

  // Views
  m = text.match(/"userInteractionCount"\s*:\s*"?(\d+)"?/i) ||
      text.match(/(\d[\d,]+)\s*views/i);
  if (m) out.views = parseInt(m[1].replace(/,/g, ""), 10) || 0;

  return out;
}

// ================= UNIVERSAL EXTRACTOR =================
function extractVideoUrl(text) {
  const clean = (u) => String(u || "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003f/g, "?")
    .replace(/\\u002f/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\/g, "")
    .trim();

  const patterns = [
    // ⭐ আপনার exact format — setVideoUrlHigh
    /(?:html5player\.)?setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]/i,
    /(?:html5player\.)?setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]/i,
    /(?:html5player\.)?setVideoUrl\s*\(\s*['"]([^'"]+)['"]/i,

    // JSON properties
    /"contentUrl"\s*:\s*"([^"]+)"/i,
    /"videoUrl"\s*:\s*"([^"]+)"/i,
    /"video_url"\s*:\s*"([^"]+)"/i,
    /"file"\s*:\s*"([^"]+\.(?:mp4|m3u8|webm|mkv)[^"]*)"/i,
    /"src"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /"url"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /"source"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,

    // JS variables
    /(?:var|let|const)\s+(?:videoUrl|video_url|file|source|stream|hls|mp4|url|src|player_src|videoSrc|media_url|stream_url)\s*=\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i,
    /(?:var|let|const)\s+\w+\s*=\s*['"](https?:\/\/[^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i,

    // JW Player / Video.js
    /\.setup\s*\(\s*\{[^}]*["']?(?:file|src|sources)["']?\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)/i,
    /sources\s*:\s*\[\s*\{[^}]*["']?(?:file|src)["']?\s*:\s*["']([^"']+)/i,
    /\.src\s*\(\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i,

    // HTML
    /<video[^>]*\ssrc\s*=\s*["']([^"']+)["']/i,
    /<source[^>]*\ssrc\s*=\s*["']([^"']+)["']/i,
    /data-(?:src|video|file|url|source)\s*=\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,

    // ⭐ Direct URL with secure= (আপনার format)
    /(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*[?&]secure=[^"'\s<>\\]+)/i,
    /(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*[?&]secure=[^"'\s<>\\]+)/i,

    // Fallback direct
    /(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i,
    /(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/i,

    // Signed URL
    /(https?:\/\/[^"'\s<>\\]+[?&](?:secure|token|hash|sig|signature|expires)=[^"'\s<>\\]+)/i,
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

function decodeHtml(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function deriveEmbedUrl(movie) {
  if (movie.embedUrl && /^https?:\/\//i.test(movie.embedUrl)) return movie.embedUrl;
  if (movie.sourceUrl && /^https?:\/\//i.test(movie.sourceUrl)) return movie.sourceUrl;
  if (movie.videoUrl) {
    const m = String(movie.videoUrl).match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
    if (m) return m[1];
    if (/embedframe/i.test(movie.videoUrl) && /^https?:\/\//i.test(movie.videoUrl)) return movie.videoUrl;
  }
  if (movie.id && /^[a-z0-9\-]+$/i.test(String(movie.id))) return "https://expmle.com/embedframe/" + movie.id;
  return "";
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
    if (!text) {
      try {
        const p = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl));
        if (p.ok) text = await p.text();
      } catch (e) {}
    }
    const iframes = text.match(/<iframe[\s\S]*?>/gi) || [];
    for (let i = 0; i < iframes.length; i++) {
      const tag = iframes[i];
      if (!/embedframe/i.test(tag) && i > 0) continue;
      const sm = tag.match(/src\s*=\s*["']([^"']+)["']/i);
      if (sm) { embedUrl = sm[1]; break; }
    }
    if (!embedUrl) { const d = text.match(/https?:\/\/[^"'\s<>]*embedframe\/[a-zA-Z0-9\-]+/i); if (d) embedUrl = d[0]; }
    if (embedUrl) embedUrl = embedUrl.replace(/&amp;/g, "&");
    let videoId = "";
    if (embedUrl) { const em = embedUrl.match(/embedframe\/([a-zA-Z0-9\-]+)/); if (em) videoId = em[1]; }

    if (!fresh.contentUrl && !embedUrl) return json({ error: "লিংক পাওয়া যায়নি" }, 400);

    return json({
      success: true,
      data: {
        title: fresh.title || "",
        id: videoId,
        thumbnail: fresh.thumbnail || "",
        contentUrl: fresh.contentUrl || "",
        embedUrl: embedUrl || "",
        views: fresh.views || 0,
        videoUrl: fresh.contentUrl || embedUrl
      }
    });
  } catch (err) { return json({ error: "Scraping failed: " + err.message }, 500); }
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
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function json(d, s) {
  return new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
function html(s) { return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } }); }

// ================= LIST =================
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
    const scored = list.map(m => {
      const baseHash = hashString(String(m.id) + "|" + seed);
      const isWatched = watchedSet.has(String(m.id));
      return { movie: m, watched: isWatched ? 1 : 0, hash: baseHash };
    });
    scored.sort((a, b) => {
      if (a.watched !== b.watched) return a.watched - b.watched;
      if (a.hash !== b.hash) return a.hash - b.hash;
      return String(a.movie.id).localeCompare(String(b.movie.id));
    });
    list = scored.map(x => x.movie);
  }
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  return json({ items: list.slice(start, start + PAGE_SIZE), page, totalPages: pages, total });
}

// ================= ADD =================
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

  const normalizeUrl = (u) => {
    if (!u) return "";
    let s = String(u).trim().toLowerCase();
    const em = s.match(/embedframe\/([a-z0-9\-]+)/i);
    if (em) return "embedframe:" + em[1].toLowerCase();
    try {
      const parsed = new URL(s);
      return parsed.origin.toLowerCase() + parsed.pathname.replace(/\/+$/, "").toLowerCase();
    } catch (e) {
      return s.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    }
  };

  const newEmbedKey = normalizeUrl(embedUrl);
  const newVideoId = (b.videoId || "").trim();
  const newContentKey = normalizeUrl(contentUrl);

  for (const existing of list) {
    if (newVideoId && existing.id === newVideoId) return json({ error: "এই ভিডিও আগেই আছে! (Video ID মিলেছে)" }, 400);
    if (newEmbedKey && normalizeUrl(existing.embedUrl) === newEmbedKey) return json({ error: "এই ভিডিও আগেই আছে! (Embed URL মিলেছে)" }, 400);
    if (newContentKey && existing.contentUrl && normalizeUrl(existing.contentUrl) === newContentKey) return json({ error: "এই ভিডিও আগেই আছে! (Content URL মিলেছে)" }, 400);
  }

  let thumb = (b.thumbnail || "").trim();
  if (!thumb) thumb = autoThumb(embedUrl || vurl);
  const movie = {
    id: b.videoId || crypto.randomUUID(),
    title: b.title.trim(),
    videoUrl: vurl.trim(),
    embedUrl: embedUrl.trim(),
    contentUrl: contentUrl.trim(),
    thumbnail: thumb,
    createdAt: Date.now(),
    lastRefresh: contentUrl ? Date.now() : 0,
    urlExpiry: getUrlExpiry(contentUrl),
    views: b.views || (Math.floor(Math.random() * 4500) + 500)
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

// ================= AUTH =================
async function login(request) {
  const b = await request.json();
  if (b.password === ADMIN_PASSWORD) return json({ success: true, token: ADMIN_PASSWORD });
  return json({ error: "ভুল পাসওয়ার্ড" }, 401);
}
async function checkAuth(request) {
  const a = request.headers.get("X-Admin-Password");
  if (a === ADMIN_PASSWORD) return json({ valid: true });
  return json({ valid: false }, 401);
}

// ================= ADS =================
async function getAds(env) { const raw = await env.MOVIES.get("ads_code"); return json({ code: raw || "" }); }
async function saveAds(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("ads_code", b.code || "");
  return json({ success: true });
}

// ================= INTERVAL LINK =================
async function getIntervalLink(env) {
  const raw = await env.MOVIES.get("interval_link");
  const secs = await env.MOVIES.get("interval_seconds");
  const first = await env.MOVIES.get("interval_first_delay");
  return json({ url: raw || "", seconds: parseInt(secs || "60"), firstDelay: parseInt(first || "15") });
}
async function saveIntervalLink(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("interval_link", b.url || "");
  if (b.seconds !== undefined) await env.MOVIES.put("interval_seconds", String(b.seconds));
  if (b.firstDelay !== undefined) await env.MOVIES.put("interval_first_delay", String(b.firstDelay));
  return json({ success: true });
}

// ================= SINGLE / RELATED / TRENDING / VIEW =================
async function getSingleMovie(env, url) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const movie = list.find(m => m.id === id);
  if (!movie) return json({ error: "Not found" }, 404);
  return json({ success: true, movie });
}
async function getRelatedMovies(env, url) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const others = list.filter(m => m.id !== id);
  for (let m of others) if (!m.views) m.views = Math.floor(Math.random() * 4500) + 500;
  const shuffled = others.map(m => ({ m, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, 12).map(x => x.m);
  return json({ items: shuffled });
}
async function getTrendingMovies(env) {
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  for (let m of list) if (!m.views) m.views = Math.floor(Math.random() * 4500) + 500;
  const sorted = list.map(m => ({ m, score: (m.views || 0) + Math.random() * 500 })).sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.m);
  return json({ items: sorted });
}
async function trackView(request, env) {
  try {
    const body = await request.json();
    const id = body.id;
    if (!id) return json({ error: "ID required" }, 400);
    const raw = await env.MOVIES.get("movie_list");
    let list = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(m => m.id === id);
    if (idx === -1) return json({ error: "Not found" }, 404);
    if (!list[idx].views) list[idx].views = Math.floor(Math.random() * 4500) + 500;
    list[idx].views += Math.floor(Math.random() * 8) + 1;
    await env.MOVIES.put("movie_list", JSON.stringify(list));
    return json({ success: true, views: list[idx].views });
  } catch (e) { return json({ error: e.message }, 500); }
}

// ================= HOME PAGE =================
function homePage() {
  const p = [];
  p.push('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdultMovie</title>');
  p.push('<style>');
  p.push('*{margin:0;padding:0;box-sizing:border-box}');
  p.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}');
  p.push('header{background:#1a1a1a;padding:15px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040;position:sticky;top:0;z-index:100;flex-wrap:wrap;gap:10px}');
  p.push('header a.logo{color:#ff0040;font-size:24px;font-weight:bold;text-decoration:none}');
  p.push('.search-box{flex:1;max-width:400px;display:flex;gap:5px}');
  p.push('.search-box input{width:100%;padding:10px 15px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;outline:none}');
  p.push('.search-box button{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold}');
  p.push('.box{max-width:1300px;margin:0 auto;padding:30px 20px}');
  p.push('.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}');
  p.push('.card{background:#1c1c1c;border-radius:10px;overflow:hidden;cursor:pointer;transition:.3s;position:relative;color:#eee}');
  p.push('.card:hover{transform:translateY(-5px);box-shadow:0 10px 25px rgba(255,0,64,.3)}');
  p.push('.thumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}');
  p.push('.play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;background:rgba(255,0,64,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}');
  p.push('.views-badge{position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,.75);color:#fff;font-size:11px;padding:3px 8px;border-radius:4px}');
  p.push('.watched-badge{position:absolute;top:6px;right:6px;background:#00c853;color:#000;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:10px}');
  p.push('.info{padding:12px}.info h3{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
  p.push('.pager{display:flex;justify-content:center;gap:8px;margin-top:40px;flex-wrap:wrap}');
  p.push('.pager button{padding:10px 16px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer}');
  p.push('.pager button.active{background:#ff0040;border-color:#ff0040}');
  p.push('.pager button:disabled{opacity:.3;cursor:not-allowed}');
  p.push('.empty{text-align:center;padding:60px;color:#666;grid-column:1/-1}');
  p.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  p.push('</style></head><body>');
  p.push('<header><a href="/" class="logo">AdultMovie</a><div class="search-box"><input id="searchInput" placeholder="Search..." onkeypress="if(event.key===\'Enter\')triggerSearch()"><button onclick="triggerSearch()">Search</button></div></header>');
  p.push('<div class="box"><div class="ad" id="adTop"></div><div id="grid" class="grid"></div><div id="pager" class="pager"></div><div class="ad" id="adBot"></div></div>');
  p.push('<script>');
  p.push('var SEED=Math.random().toString(36).substring(2,12),P=1,S="";');
  p.push('function $(i){return document.getElementById(i)}');
  p.push('function getWatched(){try{return JSON.parse(localStorage.getItem("watched_ids")||"[]")}catch(e){return[]}}');
  p.push('function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}');
  p.push('function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}');
  p.push('function triggerSearch(){S=$("searchInput").value.trim();P=1;load(1)}');
  p.push('function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s)}else{c.appendChild(n.cloneNode(true))}});sc.forEach(function(s){c.appendChild(s)})}');
  p.push('async function loadAds(){try{var r=await fetch("/api/ads");var d=await r.json();if(d.code&&d.code.trim()){injectAds("adTop",d.code);injectAds("adBot",d.code)}}catch(e){}}');
  p.push('async function load(p){P=p;var u="/api/movies?page="+p+"&seed="+encodeURIComponent(SEED);var w=getWatched().join(",");if(w)u+="&watched="+encodeURIComponent(w);if(S)u+="&search="+encodeURIComponent(S);try{var r=await fetch(u);var d=await r.json();var g=$("grid");g.innerHTML="";if(!d.items||!d.items.length){g.innerHTML=\'<div class="empty">No videos</div>\';$("pager").innerHTML="";return}var ws={};getWatched().forEach(function(x){ws[String(x)]=1});d.items.forEach(function(m){var a=document.createElement("div");a.className="card";var s=m.thumbnail?"background-image:url(\'"+m.thumbnail+"\')":"";var badge=ws[String(m.id)]?\'<div class="watched-badge">✓ Watched</div>\':"";var v=m.views||(Math.floor(Math.random()*4500)+500);a.innerHTML=\'<div class="thumb" style="\'+s+\'">\'+badge+\'<div class="views-badge">👁 \'+fmt(v)+\'</div><div class="play">▶</div></div><div class="info"><h3>\'+esc(m.title)+\'</h3></div>\';a.onclick=function(){location.href="/watch?id="+m.id};g.appendChild(a)});pager(d.page,d.totalPages)}catch(e){$("grid").innerHTML=\'<div class="empty">Error</div>\'}}');
  p.push('function pager(c,t){var el=$("pager");el.innerHTML="";if(t<=1)return;var pv=document.createElement("button");pv.textContent="« Prev";pv.disabled=c===1;pv.onclick=function(){load(c-1)};el.appendChild(pv);var st=Math.max(1,c-2),en=Math.min(t,st+4);if(en-st<4)st=Math.max(1,en-4);for(var i=st;i<=en;i++){(function(i){var b=document.createElement("button");b.textContent=i;if(i===c)b.classList.add("active");b.onclick=function(){load(i)};el.appendChild(b)})(i)}var nx=document.createElement("button");nx.textContent="Next »";nx.disabled=c===t;nx.onclick=function(){load(c+1)};el.appendChild(nx)}');
  p.push('loadAds();load(1);');
  p.push('<\/script></body></html>');
  return p.join("\n");
}

// ================= WATCH PAGE =================
function watchPage(id) {
  const p = [];
  p.push('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch</title>');
  p.push('<style>');
  p.push('*{margin:0;padding:0;box-sizing:border-box}');
  p.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee}');
  p.push('header{background:#1a1a1a;padding:14px 24px;border-bottom:2px solid #ff0040;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}');
  p.push('header a.logo{color:#ff0040;font-size:22px;font-weight:bold;text-decoration:none}');
  p.push('header a.back-btn{color:#eee;text-decoration:none;padding:8px 14px;background:#ff0040;border-radius:6px;font-size:14px}');
  p.push('.wrap{max-width:1000px;margin:24px auto;padding:0 16px}');
  p.push('.player-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-width:860px;margin:0 auto}');
  p.push('.player{width:100%;height:100%;position:relative}');
  p.push('.player video{width:100%;height:100%;border:0;display:block;object-fit:contain;background:#000}');
  p.push('.loader-box{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10}');
  p.push('.spinner{width:50px;height:50px;border:5px solid rgba(255,0,64,.2);border-top-color:#ff0040;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:15px}');
  p.push('@keyframes spin{to{transform:rotate(360deg)}}');
  p.push('.loader-text{color:#ff0040;font-size:14px;font-weight:bold;letter-spacing:1px;text-align:center;padding:0 20px}');
  p.push('.title{margin-top:18px;font-size:20px;font-weight:700;line-height:1.4}');
  p.push('.meta{margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:#aaa;font-size:14px}');
  p.push('.meta .views{color:#ff9800;font-weight:600}');
  p.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  p.push('.section-title{margin:32px 0 16px;font-size:18px;font-weight:700;color:#fff;display:flex;align-items:center;gap:10px}');
  p.push('.section-title:before{content:"";width:4px;height:22px;background:#ff0040;border-radius:2px}');
  p.push('.related-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:30px}');
  p.push('.rcard{background:#1c1c1c;border-radius:8px;overflow:hidden;cursor:pointer;transition:.25s;color:#eee;text-decoration:none;display:block}');
  p.push('.rcard:hover{transform:translateY(-4px);box-shadow:0 8px 20px rgba(255,0,64,.3)}');
  p.push('.rthumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat}');
  p.push('.rinfo{padding:10px}');
  p.push('.rinfo h4{font-size:13px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}');
  p.push('.rinfo .rviews{font-size:11px;color:#888;margin-top:4px}');
  p.push('.trending-side{display:grid;gap:12px;grid-template-columns:1fr;margin-bottom:30px}');
  p.push('.tcard{display:flex;gap:12px;background:#1c1c1c;border-radius:8px;padding:8px;color:#eee;text-decoration:none}');
  p.push('.tcard:hover{background:#252525}');
  p.push('.tthumb{width:120px;aspect-ratio:16/9;border-radius:6px;background:#333 center/cover no-repeat;flex-shrink:0;position:relative}');
  p.push('.tthumb .tnum{position:absolute;top:4px;left:4px;background:rgba(255,0,64,.9);color:#fff;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px}');
  p.push('.tinfo{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}');
  p.push('.tinfo h4{font-size:14px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:4px}');
  p.push('.tinfo .tviews{font-size:12px;color:#888}');
  p.push('.video-error{display:none;position:absolute;inset:0;background:rgba(0,0,0,.9);z-index:15;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}');
  p.push('.video-error.show{display:flex}');
  p.push('.video-error h3{color:#ff0040;font-size:18px;margin-bottom:10px}');
  p.push('.video-error p{color:#ccc;font-size:14px;margin-bottom:16px;max-width:400px}');
  p.push('.video-error button{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold}');
  p.push('.ad-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:99;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center}');
  p.push('.ad-overlay.show{display:flex}');
  p.push('.ad-iframe-box{width:100%;height:100%;border:none;background:#fff}');
  p.push('.ad-controls{position:absolute;bottom:20px;right:20px;z-index:100;display:flex;flex-direction:column;align-items:flex-end;gap:10px}');
  p.push('.ad-timer{background:rgba(0,0,0,0.8);color:#fff;padding:8px 15px;border-radius:20px;font-size:14px;font-weight:bold;border:1px solid #555}');
  p.push('.ad-close{background:#ff0040;color:#fff;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:bold;border:none;cursor:pointer;display:none;box-shadow:0 4px 15px rgba(255,0,64,0.5);transition:0.2s}');
  p.push('.ad-close.show{display:block}');
  p.push('.ad-close:hover{background:#d10035}');
  p.push('@media(max-width:768px){.title{font-size:16px}.related-grid{grid-template-columns:repeat(2,1fr)}.wrap{padding:0 12px}}');
  p.push('</style></head><body>');
  p.push('<header><a href="/" class="logo">AdultMovie</a><a href="/" class="back-btn">← Home</a></header>');
  p.push('<div class="wrap">');
  p.push('<div class="player-wrap" id="playerWrap">');
  p.push('  <div class="ad-overlay" id="adOverlay">');
  p.push('    <iframe id="adIframe" class="ad-iframe-box" src="about:blank" scrolling="no" allow="autoplay; fullscreen"></iframe>');
  p.push('    <div class="ad-controls">');
  p.push('      <div class="ad-timer" id="adTimer">Ad closes in 6s</div>');
  p.push('      <button class="ad-close" id="adCloseBtn" onclick="closeAd()">✖ Close Ad & Play</button>');
  p.push('    </div>');
  p.push('  </div>');
  p.push('  <div class="loader-box" id="loadingBox"><div class="spinner"></div><div class="loader-text" id="loaderText">Loading Video...</div></div>');
  p.push('  <div class="player" id="pb" style="display:none;"></div>');
  p.push('  <div class="video-error" id="videoError"><h3>⚠️ Video Not Loading</h3><p>Try again or pick another video below.</p><button onclick="location.reload()">🔄 Reload</button></div>');
  p.push('</div>');
  p.push('<div class="title" id="t">Loading...</div>');
  p.push('<div class="meta" id="metaBar"></div>');
  p.push('<div class="ad" id="adBox"></div>');
  p.push('<div class="section-title">🎬 You May Also Like</div>');
  p.push('<div class="related-grid" id="relatedGrid"></div>');
  p.push('<div class="section-title">🔥 Trending Now</div>');
  p.push('<div class="trending-side" id="trendingList"></div>');
  p.push('</div>');
  p.push('<script>');
  p.push('function $(i){return document.getElementById(i)}');
  p.push('function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}');
  p.push('function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}');
  p.push('function markWatched(id){try{var a=JSON.parse(localStorage.getItem("watched_ids")||"[]");var s=String(id);if(a.indexOf(s)===-1)a.push(s);if(a.length>500)a=a.slice(-500);localStorage.setItem("watched_ids",JSON.stringify(a))}catch(e){}}');
  p.push('function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s)}else{c.appendChild(n.cloneNode(true))}});sc.forEach(function(s){c.appendChild(s)})}');
  p.push('var id=new URLSearchParams(location.search).get("id");');
  p.push('var movieData=null;');
  p.push('var retryCount=0;');
  p.push('var maxRetries=4;');
  p.push('var adTimerInterval=null;');
  p.push('async function initAdOverlay(){');
  p.push('  var isAdmin=localStorage.getItem("admin_token");');
  p.push('  if(isAdmin){return;}');
  p.push('  try{');
  p.push('    var r=await fetch("/api/interval-link");');
  p.push('    var d=await r.json();');
  p.push('    if(d.url && d.url.trim()){');
  p.push('      $("adIframe").src=d.url.trim();');
  p.push('      $("adOverlay").classList.add("show");');
  p.push('      var v=document.querySelector("video");');
  p.push('      if(v) v.pause();');
  p.push('      var timeLeft=6;');
  p.push('      $("adTimer").textContent="Ad closes in "+timeLeft+"s";');
  p.push('      adTimerInterval=setInterval(function(){');
  p.push('        timeLeft--;');
  p.push('        $("adTimer").textContent="Ad closes in "+timeLeft+"s";');
  p.push('        if(timeLeft<=0){clearInterval(adTimerInterval);$("adTimer").style.display="none";$("adCloseBtn").classList.add("show");}');
  p.push('      },1000);');
  p.push('    }');
  p.push('  }catch(e){}');
  p.push('}');
  p.push('function closeAd(){$("adOverlay").classList.remove("show");$("adIframe").src="about:blank";var v=document.querySelector("video");if(v)v.play();}');
  p.push('async function loadData(){if(!id){$("t").textContent="No ID";return}try{var r=await fetch("/api/movie?id="+id);if(!r.ok)throw new Error("Not found");var d=await r.json();movieData=d.movie;document.title=movieData.title;$("t").textContent=movieData.title;renderMeta();markWatched(movieData.id);playVideo();loadRelated();loadTrending()}catch(e){$("t").textContent="Video Not Found";$("loadingBox").style.display="none";$("videoError").classList.add("show")}}');
  p.push('function trackView(){if(!movieData)return;fetch("/api/movies/track-view",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:movieData.id})}).then(function(r){return r.json()}).then(function(d){if(d.success&&d.views){movieData.views=d.views;renderMeta()}}).catch(function(){})}');
  p.push('function renderMeta(){if(!movieData)return;var v=movieData.views||0;$("metaBar").innerHTML=\'<span class="views">👁️ \'+fmt(v)+\' views</span>\'}');
  p.push('async function loadRelated(){if(!id)return;try{var r=await fetch("/api/movies/related?id="+id);var d=await r.json();var g=$("relatedGrid");g.innerHTML="";if(!d.items||!d.items.length){g.innerHTML=\'<p style="color:#666">No related</p>\';return}d.items.forEach(function(m){var a=document.createElement("a");a.className="rcard";a.href="/watch?id="+m.id;var s=m.thumbnail?"background-image:url(\'"+m.thumbnail+"\')":"";var v=m.views||0;a.innerHTML=\'<div class="rthumb" style="\'+s+\'"></div><div class="rinfo"><h4>\'+esc(m.title)+\'</h4><div class="rviews">👁 \'+fmt(v)+\'</div></div>\';g.appendChild(a)})}catch(e){}}');
  p.push('async function loadTrending(){try{var r=await fetch("/api/movies/trending");var d=await r.json();var g=$("trendingList");g.innerHTML="";if(!d.items)return;d.items.forEach(function(m,i){var a=document.createElement("a");a.className="tcard";a.href="/watch?id="+m.id;var s=m.thumbnail?"background-image:url(\'"+m.thumbnail+"\')":"";var v=m.views||0;a.innerHTML=\'<div class="tthumb" style="\'+s+\'"><div class="tnum">#\'+(i+1)+\'</div></div><div class="tinfo"><h4>\'+esc(m.title)+\'</h4><div class="tviews">👁 \'+fmt(v)+\' views</div></div>\';g.appendChild(a)})}catch(e){}}');
  p.push('async function playVideo(){');
  p.push('  if(!movieData)return;');
  p.push('  $("pb").style.display="block";');
  p.push('  $("videoError").classList.remove("show");');
  p.push('  $("loadingBox").style.display="flex";');
  p.push('  $("loaderText").textContent="Loading video...";');
  p.push('  retryCount=0;');
  p.push('  var streamUrl="/api/stream?id="+encodeURIComponent(movieData.id)+"&t="+Date.now();');
  p.push('  playContent(streamUrl);');
  p.push('}');
  p.push('function playContent(url){');
  p.push('  var pb=$("pb");');
  p.push('  pb.innerHTML="";');
  p.push('  var v=document.createElement("video");');
  p.push('  v.src=url;v.controls=true;v.autoplay=true;v.playsInline=true;v.preload="auto";v.setAttribute("playsinline","");');
  p.push('  v.style.cssText="width:100%;height:100%;object-fit:contain;background:#000";');
  p.push('  var loaded=false;');
  p.push('  v.onloadeddata=function(){loaded=true;$("loadingBox").style.display="none";};');
  p.push('  v.oncanplay=function(){loaded=true;$("loadingBox").style.display="none";};');
  p.push('  v.onerror=function(){');
  p.push('    if(retryCount>=maxRetries){showVideoError();return;}');
  p.push('    retryCount++;');
  p.push('    $("loadingBox").style.display="flex";');
  p.push('    $("loaderText").textContent="Refreshing link... ("+retryCount+"/"+maxRetries+")";');
  p.push('    setTimeout(function(){');
  p.push('      var newUrl="/api/stream?id="+encodeURIComponent(movieData.id)+"&t="+Date.now()+"&r="+retryCount;');
  p.push('      playContent(newUrl);');
  p.push('    },1500+retryCount*500);');
  p.push('  };');
  p.push('  setTimeout(function(){if(!loaded&&v.readyState<2){if(retryCount>=maxRetries){showVideoError();}else{v.onerror();}}},25000);');
  p.push('  pb.appendChild(v);');
  p.push('  trackView();');
  p.push('  try{fetch("/api/ads").then(function(r){return r.json()}).then(function(ad){if(ad.code&&ad.code.trim())injectAds("adBox",ad.code)})}catch(e){}');
  p.push('  initAdOverlay();');
  p.push('}');
  p.push('function showVideoError(){$("videoError").classList.add("show");$("loadingBox").style.display="none"}');
  p.push('loadData();');
  p.push('<\/script></body></html>');
  return p.join("\n");
}

// ================= ADMIN PAGE =================
function adminPage() {
  const p = [];
  p.push('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>');
  p.push('<style>');
  p.push('*{margin:0;padding:0;box-sizing:border-box}');
  p.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}');
  p.push('header{background:#1a1a1a;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040}');
  p.push('header h1{color:#ff0040;font-size:22px}');
  p.push('header a{color:#eee;text-decoration:none;padding:8px 14px;background:#333;border-radius:6px;font-size:14px}');
  p.push('.wrap{max-width:900px;margin:30px auto;padding:0 20px}');
  p.push('.card{background:#1c1c1c;border-radius:12px;padding:24px;margin-bottom:20px}');
  p.push('.card h2{color:#ff0040;margin-bottom:16px;font-size:18px}');
  p.push('label{display:block;margin-top:12px;font-size:14px;color:#aaa}');
  p.push('input,textarea{width:100%;padding:12px;margin-top:6px;background:#111;border:1px solid #333;border-radius:6px;color:#eee;font-size:15px;font-family:inherit}');
  p.push('textarea{resize:vertical;min-height:100px;font-family:monospace;font-size:13px}');
  p.push('input:focus,textarea:focus{outline:none;border-color:#ff0040}');
  p.push('button.primary{background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:600;margin-top:20px;font-size:15px}');
  p.push('button.danger{background:#c00}');
  p.push('button.small{padding:6px 12px;font-size:12px;margin:0}');
  p.push('.item{display:flex;justify-content:space-between;align-items:center;padding:12px;background:#111;border-radius:6px;margin-bottom:8px;gap:12px;flex-wrap:wrap}');
  p.push('.item .info{flex:1;min-width:200px;display:flex;gap:12px;align-items:center}');
  p.push('.item .mini{width:70px;height:44px;border-radius:4px;flex-shrink:0;background:#333 center/cover no-repeat}');
  p.push('.item h4{font-size:14px;word-break:break-word}');
  p.push('.item .stats{font-size:12px;color:#888;margin-top:2px}');
  p.push('.acts{display:flex;gap:6px;flex-wrap:wrap}');
  p.push('.msg{padding:10px;border-radius:6px;margin-top:12px;display:none;line-height:1.6}');
  p.push('.msg.show{display:block}');
  p.push('.msg.ok{background:#164d2c;color:#b6ffb6}');
  p.push('.msg.err{background:#4d1616;color:#ffb6b6}');
  p.push('.hidden{display:none}');
  p.push('#login{max-width:400px;margin:100px auto}');
  p.push('.hint{font-size:12px;color:#888;margin-top:4px;line-height:1.6}');
  p.push('.tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}');
  p.push('.tabs button{padding:10px 20px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}');
  p.push('.tabs button.active{background:#ff0040;border-color:#ff0040}');
  p.push('.paste-box{background:#1a2a3a;border:1px dashed #00c853;padding:15px;border-radius:8px;margin-bottom:20px}');
  p.push('.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}');
  p.push('@media(max-width:600px){.row{grid-template-columns:1fr}}');
  p.push('</style></head><body>');
  p.push('<header><h1>Admin Panel</h1><a href="/">Home</a></header>');
  p.push('<div class="wrap">');
  p.push('<div id="login" class="card"><h2>Login</h2><label>Password</label><input type="password" id="pwd"><button class="primary" id="loginBtn">Login</button><div id="lm" class="msg"></div></div>');
  p.push('<div id="content" class="hidden">');
  p.push('<div class="tabs">');
  p.push('<button id="t1" class="active" data-tab="m">🎬 Movies</button>');
  p.push('<button id="t2" data-tab="ad">📢 Ad Code</button>');
  p.push('<button id="t3" data-tab="il">⏱️ Interval Link</button>');
  p.push('</div>');
  p.push('<div id="tm">');
  p.push('<div class="card paste-box"><h2 style="color:#00c853;margin-bottom:10px">📋 Paste View Source</h2><p class="hint" style="margin-bottom:10px;color:#aaddff">ভিডিও পেজ → Ctrl+U → Ctrl+A → Ctrl+C → এখানে পেস্ট → Extract</p><textarea id="viewSource" placeholder="এখানে পুরো View Source কোড পেস্ট করুন..." style="min-height:150px"></textarea><button class="primary" style="background:#00c853;margin-top:10px" id="parseSourceBtn">🔍 Extract & Fill</button><div id="psm" class="msg" style="margin-top:10px"></div></div>');
  p.push('<div class="card"><h2 id="ft">Add / Edit Movie</h2><input type="hidden" id="eid"><input type="hidden" id="videoIdField">');
  p.push('<label>Title</label><input type="text" id="title">');
  p.push('<label>Embed URL (embedframe/xxx)</label><input type="text" id="embedUrl">');
  p.push('<label>Content URL (video link, auto-refresh)</label><input type="text" id="contentUrl">');
  p.push('<label>Thumbnail URL</label><input type="text" id="thumb">');
  p.push('<label>Video URL / Embed</label><textarea id="vurl"></textarea>');
  p.push('<button class="primary" id="sb">Add Movie</button><button class="primary hidden" style="background:#333" id="cb" type="button">Cancel</button><div id="am" class="msg"></div></div>');
  p.push('<div class="card"><h2>All Movies</h2><div id="list"></div></div></div>');
  p.push('<div id="tad" class="hidden"><div class="card"><h2>Ad Code</h2><textarea id="ads" style="min-height:200px" placeholder="Ad script / HTML এখানে পেস্ট করুন"></textarea><button class="primary" id="adsSaveBtn">Save</button><div id="adm" class="msg"></div></div></div>');
  p.push('<div id="til" class="hidden">');
  p.push('<div class="card">');
  p.push('<h2>⏱️ Interval Link Settings</h2>');
  p.push('<p class="hint" style="margin-bottom:16px;color:#aaddff">Watch page-এ নির্দিষ্ট সময় পর পর এই link open হবে</p>');
  p.push('<label>URL (যে link open হবে)</label>');
  p.push('<input type="text" id="intervalLinkInput" placeholder="https://example.com">');
  p.push('<div class="row">');
  p.push('<div><label>First Delay (সেকেন্ড)</label><input type="number" id="intervalFirstDelayInput" value="15" min="0" placeholder="15"><p class="hint">Watch page খোলার কত সেকেন্ড পরে প্রথম open হবে</p></div>');
  p.push('<div><label>Interval (সেকেন্ড)</label><input type="number" id="intervalSecondsInput" value="60" min="5" placeholder="60"><p class="hint">এরপর প্রতি কত সেকেন্ড পর পর open হবে</p></div>');
  p.push('</div>');
  p.push('<button class="primary" id="intervalLinkSaveBtn">Save Settings</button>');
  p.push('<button class="primary" style="background:#333" id="intervalTestBtn" type="button">🧪 Test Open</button>');
  p.push('<div id="ilm" class="msg"></div>');
  p.push('</div>');
  p.push('</div>');
  p.push('<button class="primary danger" id="logoutBtn">Logout</button>');
  p.push('</div></div>');
  p.push('<script>');
  p.push('var token=localStorage.getItem("admin_token")||"";');
  p.push('function $(i){return document.getElementById(i)}');
  p.push('function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}');
  p.push('function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}');
  p.push('window.addEventListener("DOMContentLoaded",function(){');
  p.push(' $("loginBtn").onclick=doLogin;');
  p.push(' $("sb").onclick=saveMovie;');
  p.push(' $("cb").onclick=reset;');
  p.push(' $("logoutBtn").onclick=logout;');
  p.push(' $("adsSaveBtn").onclick=saveAds;');
  p.push(' $("intervalLinkSaveBtn").onclick=saveIntervalLink;');
  p.push(' $("intervalTestBtn").onclick=testIntervalOpen;');
  p.push(' $("parseSourceBtn").onclick=parseViewSource;');
  p.push(' document.querySelectorAll("[data-tab]").forEach(function(b){b.onclick=function(){tab(b.getAttribute("data-tab"))}});');
  p.push(' if(token)verify().then(function(ok){if(ok)show()});');
  p.push('});');
  p.push('async function verify(){try{var r=await fetch("/api/check-auth",{headers:{"X-Admin-Password":token}});return r.ok}catch(e){return false}}');
  p.push('async function doLogin(){var pwd=$("pwd").value;var m=$("lm");try{var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});var d=await r.json();if(r.ok){token=d.token;localStorage.setItem("admin_token",token);show()}else{m.textContent=d.error||"Failed";m.className="msg err show"}}catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}}');
  p.push('function show(){$("login").classList.add("hidden");$("content").classList.remove("hidden");loadList();loadAds();loadIntervalLink()}');
  p.push('function logout(){localStorage.removeItem("admin_token");location.reload()}');
  p.push('function tab(n){');
  p.push(' $("tm").classList.add("hidden");$("tad").classList.add("hidden");$("til").classList.add("hidden");');
  p.push(' $("t1").classList.remove("active");$("t2").classList.remove("active");$("t3").classList.remove("active");');
  p.push(' if(n==="m"){$("tm").classList.remove("hidden");$("t1").classList.add("active")}');
  p.push(' if(n==="ad"){$("tad").classList.remove("hidden");$("t2").classList.add("active")}');
  p.push(' if(n==="il"){$("til").classList.remove("hidden");$("t3").classList.add("active")}');
  p.push('}');
  p.push('function reset(){$("eid").value="";$("title").value="";$("vurl").value="";$("thumb").value="";$("videoIdField").value="";$("embedUrl").value="";$("contentUrl").value="";$("ft").textContent="Add / Edit Movie";$("sb").textContent="Add Movie";$("cb").classList.add("hidden")}');
  
  // PARSE VIEW SOURCE - 100% FIXED
  p.push('function parseViewSource(){');
  p.push('  var text=$("viewSource").value;var m=$("psm");');
  p.push('  if(!text||!text.trim()){m.textContent="View Source পেস্ট করুন";m.className="msg err show";return}');
  p.push('  var found=[];');
  
  // Title
  p.push('  var title="";');
  p.push('  var tm=text.match(/<title>([^<]+)<\\/title>/i);');
  p.push('  if(tm){title=tm[1].trim();found.push("Title")}');
  
  // Embed URL
  p.push('  var embedUrl="";');
  p.push('  var iframes=text.match(/<iframe[\\s\\S]*?>/gi)||[];');
  p.push('  for(var i=0;i<iframes.length;i++){var tag=iframes[i];if(!/embedframe/i.test(tag)&&i>0)continue;var sm=tag.match(/src\\s*=\\s*["\']([^"\']+)["\']/i);if(sm){embedUrl=sm[1];break}}');
  p.push('  if(!embedUrl){var dm=text.match(/https?:\\/\\/[^"\'\\s<>]*embedframe\\/[a-zA-Z0-9\\-]+/i);if(dm)embedUrl=dm[0]}');
  p.push('  if(embedUrl){embedUrl=embedUrl.replace(/&amp;/g,"&");found.push("Embed URL")}');
  
  // Content URL - ⭐ আপনার exact format including secure=xxx==,timestamp
  p.push('  var contentUrl="";');
  p.push('  var cm=text.match(/setVideoUrlHigh\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  p.push('  if(!cm)cm=text.match(/setVideoUrlLow\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  p.push('  if(!cm)cm=text.match(/setVideoUrl\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  p.push('  if(!cm)cm=text.match(/(https?:\\/\\/[^"\'\\s<>]+\\.mp4[^"\'\\s<>]*)/i);');
  p.push('  if(!cm)cm=text.match(/(https?:\\/\\/[^"\'\\s<>]+\\.m3u8[^"\'\\s<>]*)/i);');
  p.push('  if(cm){contentUrl=cm[1].replace(/&amp;/g,"&").replace(/\\\\\\//g,"/");found.push("Content URL")}');
  
  // Thumbnail
  p.push('  var thumb="";');
  p.push('  var thm=text.match(/"thumbnailUrl"\\s*:\\s*\\[\\s*"([^"]+)"/i);');
  p.push('  if(!thm)thm=text.match(/"thumbnailUrl"\\s*:\\s*"([^"]+)"/i);');
  p.push('  if(!thm)thm=text.match(/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)/i);');
  p.push('  if(thm){thumb=thm[1].replace(/&amp;/g,"&");found.push("Thumbnail")}');
  
  // Fill form
  p.push('  if(title)$("title").value=title;');
  p.push('  if(embedUrl)$("embedUrl").value=embedUrl;');
  p.push('  if(contentUrl)$("contentUrl").value=contentUrl;');
  p.push('  if(thumb)$("thumb").value=thumb;');
  p.push('  if(contentUrl)$("vurl").value=contentUrl;else if(embedUrl)$("vurl").value=embedUrl;');
  
  // Auto Extract videoId from embedUrl
  p.push('  if(embedUrl){var vm=embedUrl.match(/embedframe\\/([a-zA-Z0-9\\-]+)/);if(vm)$("videoIdField").value=vm[1]}');
  
  // Message
  p.push('  if(found.length){m.innerHTML="✅ পাওয়া গেছে: <b>"+found.join(", ")+"</b>";m.className="msg ok show";m.style.color="#b6ffb6"}');
  p.push('  else{m.innerHTML="❌ কিছু পাওয়া যায়নি। View Source সঠিকভাবে কপি করুন।";m.className="msg err show";m.style.color="#ffb6b6"}');
  p.push('}');
  
  p.push('async function saveMovie(){');
  p.push('  var eid=$("eid").value;var title=$("title").value.trim();var embedUrl=$("embedUrl").value.trim();');
  p.push('  var contentUrl=$("contentUrl").value.trim();var thumb=$("thumb").value.trim();');
  p.push('  var vurl=$("vurl").value.trim();var vid=$("videoIdField").value.trim();var m=$("am");');
  p.push('  if(!title||(!vurl&&!contentUrl&&!embedUrl)){m.textContent="Title ও URL দরকার";m.className="msg err show";return}');
  p.push('  var u=eid?"/api/movies/update":"/api/movies";');
  p.push('  var body={title:title,embedUrl:embedUrl,contentUrl:contentUrl,thumbnail:thumb,videoUrl:vurl};');
  p.push('  if(eid)body.id=eid;if(!eid&&vid)body.videoId=vid;');
  p.push('  try{var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify(body)});');
  p.push('    var d=await r.json();');
  p.push('    if(r.ok){m.textContent=eid?"Updated":"Added";m.className="msg ok show";reset();loadList();setTimeout(function(){m.classList.remove("show")},2500)}');
  p.push('    else{m.textContent=d.error||"Failed";m.className="msg err show"}');
  p.push('  }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}');
  p.push('}');
  p.push('async function refreshOne(id,btn){btn.disabled=true;var old=btn.textContent;btn.textContent="⏳";try{var r=await fetch("/api/refresh-movie",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({id:id})});var d=await r.json();if(r.ok){btn.textContent="✓"}else{btn.textContent="✗";alert(d.error||"Failed")}}catch(e){btn.textContent="✗";alert(e.message)}setTimeout(function(){btn.textContent=old;btn.disabled=false},1500)}');
  p.push('async function refreshAllBtn(){if(!confirm("সব refresh করবে?"))return;var b=$("refreshAllTop");if(b){b.disabled=true;b.textContent="⏳ Refreshing..."}try{var r=await fetch("/api/refresh-all",{method:"POST",headers:{"X-Admin-Password":token}});var d=await r.json();if(r.ok){var msg="OK: "+d.ok+"  Fail: "+d.fail;if(d.skipped)msg+="  Skipped: "+d.skipped;if(d.failures&&d.failures.length){msg+="\\n\\nপ্রথম ১০টা:\\n"+d.failures.slice(0,10).map(function(f){return "• "+f.title+": "+f.reason}).join("\\n")}alert(msg)}else{alert(d.error||"Failed")}}catch(e){alert(e.message)}if(b){b.disabled=false;b.textContent="🔄 Refresh All"}loadList()}');
  p.push('async function loadList(){var pg=1,all=[];while(true){var r=await fetch("/api/movies?page="+pg+"&noshuffle=1");var d=await r.json();all=all.concat(d.items);if(pg>=d.totalPages)break;pg++}var el=$("list");if(!all.length){el.innerHTML=\'<p style="color:#666">No movies</p>\';return}el.innerHTML="";var hdr=document.createElement("div");hdr.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px";hdr.innerHTML=\'<div style="font-size:14px;color:#888">Total: \'+all.length+\'</div>\';var refAll=document.createElement("button");refAll.id="refreshAllTop";refAll.className="primary small";refAll.style.background="#ff9800";refAll.style.marginTop="0";refAll.textContent="🔄 Refresh All";refAll.onclick=refreshAllBtn;hdr.appendChild(refAll);el.appendChild(hdr);all.forEach(function(mv){var s=mv.thumbnail?"background-image:url(\'"+mv.thumbnail+"\')":"";var row=document.createElement("div");row.className="item";var hasC=mv.contentUrl?"✅":"⚠️";var info=document.createElement("div");info.className="info";info.innerHTML=\'<div class="mini" style="\'+s+\'"></div><div><h4>\'+esc(mv.title)+\' \'+hasC+\'</h4><div class="stats">👁 \'+fmt(mv.views||0)+\'</div></div>\';var acts=document.createElement("div");acts.className="acts";var rb=document.createElement("button");rb.className="primary small";rb.style.background="#ff9800";rb.style.marginTop="0";rb.textContent="🔄 Refresh";rb.onclick=function(){refreshOne(mv.id,rb)};var eb=document.createElement("button");eb.className="primary small";eb.style.marginTop="0";eb.textContent="Edit";eb.onclick=function(){editMovie(mv.id)};var db=document.createElement("button");db.className="primary small danger";db.style.marginTop="0";db.textContent="Delete";db.onclick=function(){delMovie(mv.id)};acts.appendChild(rb);acts.appendChild(eb);acts.appendChild(db);row.appendChild(info);row.appendChild(acts);el.appendChild(row)})}');
  p.push('async function editMovie(id){var pg=1,all=[];while(true){var r=await fetch("/api/movies?page="+pg+"&noshuffle=1");var d=await r.json();all=all.concat(d.items);if(pg>=d.totalPages)break;pg++}var mv=all.find(function(x){return x.id===id});if(!mv)return;$("eid").value=mv.id;$("title").value=mv.title;$("embedUrl").value=mv.embedUrl||"";$("contentUrl").value=mv.contentUrl||"";$("thumb").value=mv.thumbnail||"";$("vurl").value=mv.videoUrl||"";$("videoIdField").value="";$("ft").textContent="Edit Movie";$("sb").textContent="Update";$("cb").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"})}');
  p.push('async function delMovie(id){if(!confirm("Delete?"))return;var r=await fetch("/api/movies/"+encodeURIComponent(id),{method:"DELETE",headers:{"X-Admin-Password":token}});if(r.ok)loadList()}');
  p.push('async function loadAds(){var r=await fetch("/api/ads");var d=await r.json();$("ads").value=d.code||""}');
  p.push('async function saveAds(){var code=$("ads").value;var m=$("adm");var r=await fetch("/api/ads",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({code:code})});if(r.ok){m.textContent="Saved";m.className="msg ok show"}else{m.textContent="Failed";m.className="msg err show"}setTimeout(function(){m.classList.remove("show")},2500)}');
  p.push('async function loadIntervalLink(){');
  p.push('  try{');
  p.push('    var r=await fetch("/api/interval-link");');
  p.push('    var d=await r.json();');
  p.push('    $("intervalLinkInput").value=d.url||"";');
  p.push('    $("intervalSecondsInput").value=d.seconds||60;');
  p.push('    $("intervalFirstDelayInput").value=d.firstDelay||15;');
  p.push('  }catch(e){}');
  p.push('}');
  p.push('async function saveIntervalLink(){');
  p.push('  var u=$("intervalLinkInput").value.trim();');
  p.push('  var s=parseInt($("intervalSecondsInput").value)||60;');
  p.push('  var f=parseInt($("intervalFirstDelayInput").value)||15;');
  p.push('  var m=$("ilm");');
  p.push('  if(s<5){m.textContent="Interval minimum 5 সেকেন্ড হতে হবে";m.className="msg err show";return}');
  p.push('  try{');
  p.push('    var r=await fetch("/api/interval-link",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({url:u,seconds:s,firstDelay:f})});');
  p.push('    if(r.ok){m.textContent="✅ Saved! Watch page-এ apply হবে";m.className="msg ok show"}');
  p.push('    else{m.textContent="Failed";m.className="msg err show"}');
  p.push('  }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}');
  p.push('  setTimeout(function(){m.classList.remove("show")},3000);');
  p.push('}');
  p.push('function testIntervalOpen(){');
  p.push('  var u=$("intervalLinkInput").value.trim();');
  p.push('  if(!u){alert("আগে URL দিন");return}');
  p.push('  var w=window.open(u,"_blank","noopener,noreferrer");');
  p.push('  if(w){w.blur();window.focus();}');
  p.push('  else{alert("Popup blocked! Browser-এ popup allow করুন।");}');
  p.push('}');
  p.push('<\/script></body></html>');
  return p.join("\n");
}
