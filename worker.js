const ADMIN_PASSWORD = "admin123";
const PAGE_SIZE = 20;

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

    if (p === "/api/movies/related" && request.method === "GET") return getRelatedMovies(env, url);
    if (p === "/api/movies/trending" && request.method === "GET") return getTrendingMovies(env);
    if (p === "/api/movies/track-view" && request.method === "POST") return trackView(request, env);
    if (p === "/api/check-link" && request.method === "GET") return checkLink(url);

    if (p === "/") return html(homePage());
    if (p === "/admin") return html(adminPage());
    if (p === "/watch") return html(watchPage(url.searchParams.get("id")));

    return new Response("404", { status: 404 });
  }
};

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
  if (!embedUrl) return json({ error: "embedUrl নেই। Edit করে embedframe লিংক দিন।" }, 400);

  try {
    const fresh = await fetchFreshFromEmbed(embedUrl);
    if (!fresh.contentUrl) return json({ error: "নতুন contentUrl পাওয়া যায়নি।" }, 502);
    list[idx].contentUrl = fresh.contentUrl;
    list[idx].videoUrl = fresh.contentUrl;
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
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  let ok = 0, fail = 0;
  const failures = [];
  for (const movie of list) {
    const embedUrl = movie.embedUrl || deriveEmbedUrl(movie);
    if (!embedUrl) { fail++; failures.push({ id: movie.id, title: movie.title, reason: "no embedUrl" }); continue; }
    try {
      const fresh = await fetchFreshFromEmbed(embedUrl);
      if (fresh.contentUrl) {
        movie.contentUrl = fresh.contentUrl;
        movie.videoUrl = fresh.contentUrl;
        if (fresh.title) movie.title = fresh.title;
        if (fresh.thumbnail) movie.thumbnail = fresh.thumbnail;
        if (fresh.views) movie.views = fresh.views;
        movie.lastRefresh = Date.now();
        ok++;
      } else { fail++; failures.push({ id: movie.id, title: movie.title, reason: "no contentUrl" }); }
    } catch (e) { fail++; failures.push({ id: movie.id, title: movie.title, reason: e.message }); }
    await new Promise(r => setTimeout(r, 300));
  }
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true, ok, fail, failures });
}

// ================= SCRAPE EMBED PAGE =================
async function fetchFreshFromEmbed(embedUrl) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://expmle.com/"
  };
  let text = "";
  try {
    const res = await fetch(embedUrl, { headers, redirect: "follow" });
    if (res.ok) text = await res.text();
  } catch (e) {}
  if (!text || !/contentUrl/i.test(text)) {
    try {
      const j = await fetch("https://r.jina.ai/" + embedUrl, { headers: { "Accept": "text/plain" } });
      if (j.ok) text = await j.text();
    } catch (e) {}
  }
  const out = { contentUrl: "", title: "", thumbnail: "", views: 0 };
  if (!text) return out;
  let m = text.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
  if (m) out.contentUrl = m[1];
  m = text.match(/"name"\s*:\s*"([^"]+)"/i);
  if (m) out.title = m[1];
  m = text.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i) || text.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (m) out.thumbnail = m[1];
  m = text.match(/"userInteractionCount"\s*:\s*"?(\d+)"?/i);
  if (m) out.views = parseInt(m[1], 10) || 0;
  return out;
}

function deriveEmbedUrl(movie) {
  if (movie.embedUrl && /^https?:\/\//i.test(movie.embedUrl)) return movie.embedUrl;
  if (movie.videoUrl) {
    const m = String(movie.videoUrl).match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
    if (m) return m[1];
    if (/embedframe/i.test(movie.videoUrl) && /^https?:\/\//i.test(movie.videoUrl)) return movie.videoUrl;
  }
  if (movie.id && /^[a-z0-9]+$/i.test(String(movie.id))) return "https://expmle.com/embedframe/" + movie.id;
  return "";
}

// ================= SCRAPE FROM URL (Admin) =================
async function fetchSourceData(request) {
  try {
    const body = await request.json();
    const targetUrl = body.url;
    if (!targetUrl) return json({ error: "URL required" }, 400);
    let htmlText = "";
    try {
      const res = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://expmle.com/"
        }
      });
      if (res.ok) htmlText = await res.text();
    } catch (e) {}
    if (!htmlText || !/contentUrl/i.test(htmlText)) {
      try {
        const jinaRes = await fetch("https://r.jina.ai/" + targetUrl, { headers: { "Accept": "text/plain" } });
        if (jinaRes.ok) htmlText = await jinaRes.text();
      } catch (e) {}
    }
    if (!htmlText) return json({ error: "পেজ লোড হয়নি" }, 400);

    const getJson = (key) => {
      let m = htmlText.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"', "i"));
      if (m) return m[1];
      m = htmlText.match(new RegExp(key + "\\s*:\\s*['\"]([^'\"]+)['\"]", "i"));
      return m ? m[1] : "";
    };
    const contentUrl = getJson("contentUrl");
    const title = getJson("name");
    let thumbnail = "";
    const tArr = htmlText.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i);
    if (tArr) thumbnail = tArr[1];
    let views = 0;
    const vm = htmlText.match(/"userInteractionCount"\s*:\s*"?(\d+)"?/i);
    if (vm) views = parseInt(vm[1], 10) || 0;
    let embedUrl = "";
    const im = htmlText.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
    if (im) embedUrl = im[1];
    let videoId = "";
    if (embedUrl) { const em = embedUrl.match(/embedframe\/([a-zA-Z0-9]+)/); if (em) videoId = em[1]; }
    if (!contentUrl && !embedUrl) return json({ error: "contentUrl বা iframe পাওয়া যায়নি" }, 400);
    return json({ success: true, data: { title, id: videoId, thumbnail, contentUrl, embedUrl, views, videoUrl: contentUrl || embedUrl } });
  } catch (err) { return json({ error: "Scraping failed: " + err.message }, 500); }
}

// ================= LINK CHECK =================
async function checkLink(url) {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) return json({ ok: false, error: "URL required" }, 400);
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(targetUrl, { method: "GET", headers: { "User-Agent": "Mozilla/5.0", "Range": "bytes=0-2048" }, signal: controller.signal, redirect: "follow" });
    clearTimeout(tid);
    return json({ ok: res.ok, status: res.status });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

// ================= HELPERS =================
function extractSrc(input) {
  if (!input) return "";
  const s = input.trim();
  const m1 = s.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (m1) return m1[1];
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  const m2 = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (m2) return m2[0];
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

// ================= ADD / UPDATE / DELETE =================
async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.title || (!b.videoUrl && !b.contentUrl && !b.embedUrl)) return json({ error: "Title ও URL দরকার" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const embedUrl = b.embedUrl || extractSrc(b.videoUrl || "");
  const contentUrl = b.contentUrl || "";
  const vurl = contentUrl || embedUrl;
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
    views: b.views || (Math.floor(Math.random() * 4500) + 500)
  };
  if (b.videoId && list.find(m => m.id === b.videoId)) return json({ error: "এই ভিডিও আগেই আছে!" }, 400);
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
  if (b.contentUrl !== undefined) { list[i].contentUrl = b.contentUrl; list[i].videoUrl = b.contentUrl || list[i].embedUrl; }
  if (b.embedUrl) list[i].embedUrl = b.embedUrl.trim();
  if (b.thumbnail) list[i].thumbnail = b.thumbnail.trim();
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true });
}

async function deleteMovie(request, env, path) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const id = path.split("/").pop();
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

// ================= ADS / INTERVAL =================
async function getAds(env) { const raw = await env.MOVIES.get("ads_code"); return json({ code: raw || "" }); }
async function saveAds(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("ads_code", b.code || "");
  return json({ success: true });
}
async function getIntervalLink(env) { const raw = await env.MOVIES.get("interval_link"); return json({ url: raw || "" }); }
async function saveIntervalLink(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("interval_link", b.url || "");
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
  p.push('.adblock-popup{display:none;position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:9999;align-items:center;justify-content:center;text-align:center}');
  p.push('.adblock-content{background:#1c1c1c;padding:30px;border-radius:10px;border:2px solid #ff0040;max-width:450px;margin:20px}');
  p.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  p.push('</style></head><body>');
  p.push('<div id="adblockPopup" class="adblock-popup"><div class="adblock-content"><h2 style="color:#ff0040;margin-bottom:15px">⚠️ AdBlocker Detected!</h2><p style="color:#ccc;margin-bottom:20px">Please disable to support us.</p><button onclick="reloadPage()" style="background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:bold;width:100%">Reload</button></div></div>');
  p.push('<header><a href="/" class="logo">AdultMovie</a><div class="search-box"><input id="searchInput" placeholder="Search..." onkeypress="if(event.key===\'Enter\')triggerSearch()"><button onclick="triggerSearch()">Search</button></div></header>');
  p.push('<div class="box"><div class="ad" id="adTop"></div><div id="grid" class="grid"></div><div id="pager" class="pager"></div><div class="ad" id="adBot"></div></div>');
  p.push('<script>');
  p.push('var SEED=Math.random().toString(36).substring(2,12),P=1,S="";');
  p.push('function $(i){return document.getElementById(i)}');
  p.push('function getWatched(){try{return JSON.parse(localStorage.getItem("watched_ids")||"[]")}catch(e){return[]}}');
  p.push('function fmt(n){n=parseInt(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return n}');
  p.push('function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}');
  p.push('function reloadPage(){localStorage.setItem("adblockDismissed","true");location.reload()}');
  p.push('function triggerSearch(){S=$("searchInput").value.trim();P=1;load(1)}');
  p.push('function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s)}else{c.appendChild(n.cloneNode(true))}});sc.forEach(function(s){c.appendChild(s)})}');
  p.push('async function loadAds(){var a=localStorage.getItem("admin_token");if(a)return;try{var r=await fetch("/api/ads");var d=await r.json();if(d.code&&d.code.trim()){injectAds("adTop",d.code);injectAds("adBot",d.code)}}catch(e){}}');
  p.push('function detectAdBlocker(){var a=localStorage.getItem("admin_token");if(a)return;if(localStorage.getItem("adblockDismissed"))return;var s=document.createElement("script");s.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";s.async=true;var b=false;s.onerror=function(){b=true};document.head.appendChild(s);setTimeout(function(){if(!window.adsbygoogle||b){var p=$("adblockPopup");if(p)p.style.display="flex"}},1500)}');
  p.push('async function load(p){P=p;var u="/api/movies?page="+p+"&seed="+encodeURIComponent(SEED);var w=getWatched().join(",");if(w)u+="&watched="+encodeURIComponent(w);if(S)u+="&search="+encodeURIComponent(S);try{var r=await fetch(u);var d=await r.json();var g=$("grid");g.innerHTML="";if(!d.items||!d.items.length){g.innerHTML=\'<div class="empty">No videos</div>\';$("pager").innerHTML="";return}var ws={};getWatched().forEach(function(x){ws[String(x)]=1});d.items.forEach(function(m){var a=document.createElement("div");a.className="card";var s=m.thumbnail?"background-image:url(\'"+m.thumbnail+"\')":"";var badge=ws[String(m.id)]?\'<div class="watched-badge">✓ Watched</div>\':"";var v=m.views||(Math.floor(Math.random()*4500)+500);a.innerHTML=\'<div class="thumb" style="\'+s+\'">\'+badge+\'<div class="views-badge">👁 \'+fmt(v)+\'</div><div class="play">▶</div></div><div class="info"><h3>\'+esc(m.title)+\'</h3></div>\';a.onclick=function(){location.href="/watch?id="+m.id};g.appendChild(a)});pager(d.page,d.totalPages)}catch(e){$("grid").innerHTML=\'<div class="empty">Error</div>\'}}');
  p.push('function pager(c,t){var el=$("pager");el.innerHTML="";if(t<=1)return;var pv=document.createElement("button");pv.textContent="« Prev";pv.disabled=c===1;pv.onclick=function(){load(c-1)};el.appendChild(pv);var st=Math.max(1,c-2),en=Math.min(t,st+4);if(en-st<4)st=Math.max(1,en-4);for(var i=st;i<=en;i++){(function(i){var b=document.createElement("button");b.textContent=i;if(i===c)b.classList.add("active");b.onclick=function(){load(i)};el.appendChild(b)})(i)}var nx=document.createElement("button");nx.textContent="Next »";nx.disabled=c===t;nx.onclick=function(){load(c+1)};el.appendChild(nx)}');
  p.push('loadAds();detectAdBlocker();load(1);');
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
  p.push('.player video,.player iframe{width:100%;height:100%;border:0;display:block;object-fit:contain}');
  p.push('.loader-box{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10}');
  p.push('.spinner{width:50px;height:50px;border:5px solid rgba(255,0,64,.2);border-top-color:#ff0040;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:15px}');
  p.push('@keyframes spin{to{transform:rotate(360deg)}}');
  p.push('.loader-text{color:#ff0040;font-size:14px;font-weight:bold;letter-spacing:1px}');
  p.push('.title{margin-top:18px;font-size:20px;font-weight:700;line-height:1.4}');
  p.push('.meta{margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:#aaa;font-size:14px}');
  p.push('.meta .views{color:#ff9800;font-weight:600}');
  p.push('.actions{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-bottom:16px;border-bottom:1px solid #222}');
  p.push('.act-btn{background:#1c1c1c;color:#eee;border:1px solid #333;padding:9px 16px;border-radius:8px;cursor:pointer;font-size:14px}');
  p.push('.act-btn:hover{background:#ff0040;border-color:#ff0040}');
  p.push('.act-btn.saved{background:#00c853;border-color:#00c853;color:#fff}');
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
  p.push('.adblock-popup{display:none;position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:9999;align-items:center;justify-content:center;text-align:center}');
  p.push('.adblock-content{background:#1c1c1c;padding:30px;border-radius:10px;border:2px solid #ff0040;max-width:450px;margin:20px}');
  p.push('@media(max-width:768px){.title{font-size:16px}.related-grid{grid-template-columns:repeat(2,1fr)}.wrap{padding:0 12px}}');
  p.push('</style></head><body>');
  p.push('<div id="adblockPopup" class="adblock-popup"><div class="adblock-content"><h2 style="color:#ff0040;margin-bottom:15px">⚠️ AdBlocker Detected!</h2><p style="color:#ccc;margin-bottom:20px">Please disable to support us.</p><button onclick="reloadPage()" style="background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:bold;width:100%">Reload</button></div></div>');
  p.push('<header><a href="/" class="logo">AdultMovie</a><a href="/" class="back-btn">← Home</a></header>');
  p.push('<div class="wrap">');
  p.push('<div class="player-wrap" id="playerWrap">');
  p.push('  <div class="loader-box" id="loadingBox"><div class="spinner"></div><div class="loader-text">Loading Video...</div></div>');
  p.push('  <div class="player" id="pb" style="display:none;"></div>');
  p.push('  <div class="video-error" id="videoError"><h3>⚠️ Video Not Loading</h3><p>This video might be unavailable or expired. Try another, or ask admin to refresh.</p><button onclick="location.reload()">🔄 Reload Page</button></div>');
  p.push('</div>');
  p.push('<div class="title" id="t">Loading...</div>');
  p.push('<div class="meta" id="metaBar"></div>');
  p.push('<div class="actions" id="actBar"></div>');
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
  p.push('function reloadPage(){localStorage.setItem("adblockDismissed","true");location.reload()}');
  p.push('function markWatched(id){try{var a=JSON.parse(localStorage.getItem("watched_ids")||"[]");var s=String(id);if(a.indexOf(s)===-1)a.push(s);if(a.length>500)a=a.slice(-500);localStorage.setItem("watched_ids",JSON.stringify(a))}catch(e){}}');
  p.push('function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s)}else{c.appendChild(n.cloneNode(true))}});sc.forEach(function(s){c.appendChild(s)})}');
  p.push('function detectAdBlocker(){var a=localStorage.getItem("admin_token");if(a)return;if(localStorage.getItem("adblockDismissed"))return;var s=document.createElement("script");s.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";s.async=true;var b=false;s.onerror=function(){b=true};document.head.appendChild(s);setTimeout(function(){if(!window.adsbygoogle||b){var p=$("adblockPopup");if(p)p.style.display="flex"}},1500)}');
  p.push('function getFavs(){try{return JSON.parse(localStorage.getItem("fav_ids")||"[]")}catch(e){return[]}}');
  p.push('function isFav(id){return getFavs().indexOf(String(id))!==-1}');
  p.push('function toggleFav(id){var a=getFavs();var s=String(id);var i=a.indexOf(s);if(i===-1)a.push(s);else a.splice(i,1);localStorage.setItem("fav_ids",JSON.stringify(a));return i===-1}');
  p.push('var id=new URLSearchParams(location.search).get("id");');
  p.push('var movieData=null,relatedList=[];');
  p.push('async function loadData(){if(!id){$("t").textContent="No ID";return}try{var r=await fetch("/api/movie?id="+id);if(!r.ok)throw new Error("Not found");var d=await r.json();movieData=d.movie;document.title=movieData.title;$("t").textContent=movieData.title;renderMeta();renderActions();markWatched(movieData.id);playVideo();loadRelated();loadTrending()}catch(e){$("t").textContent="Video Not Found";$("loadingBox").style.display="none";$("videoError").classList.add("show")}}');
  p.push('function trackView(){if(!movieData)return;fetch("/api/movies/track-view",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:movieData.id})}).then(function(r){return r.json()}).then(function(d){if(d.success&&d.views){movieData.views=d.views;renderMeta()}}).catch(function(){})}');
  p.push('function renderMeta(){if(!movieData)return;var v=movieData.views||0;$("metaBar").innerHTML=\'<span class="views">👁️ \'+fmt(v)+\' views</span>\'}');
  p.push('function renderActions(){if(!movieData)return;var f=isFav(movieData.id);$("actBar").innerHTML=\'<button class="act-btn \'+(f?"saved":"")+\'" id="favBtn" onclick="toggleFavClick()">\'+(f?"✅ Saved":"🔖 Save")+\'</button><button class="act-btn" onclick="copyLink()">🔗 Copy Link</button>\'}');
  p.push('function toggleFavClick(){var now=toggleFav(movieData.id);var b=$("favBtn");if(now){b.classList.add("saved");b.textContent="✅ Saved"}else{b.classList.remove("saved");b.textContent="🔖 Save"}}');
  p.push('function copyLink(){navigator.clipboard.writeText(location.href).then(function(){alert("Link copied!")}).catch(function(){prompt("Copy:",location.href)})}');
  p.push('async function loadRelated(){if(!id)return;try{var r=await fetch("/api/movies/related?id="+id);var d=await r.json();relatedList=d.items||[];var g=$("relatedGrid");g.innerHTML="";if(!relatedList.length){g.innerHTML=\'<p style="color:#666">No related</p>\';return}relatedList.forEach(function(m){var a=document.createElement("a");a.className="rcard";a.href="/watch?id="+m.id;var s=m.thumbnail?"background-image:url(\'"+m.thumbnail+"\')":"";var v=m.views||0;a.innerHTML=\'<div class="rthumb" style="\'+s+\'"></div><div class="rinfo"><h4>\'+esc(m.title)+\'</h4><div class="rviews">👁 \'+fmt(v)+\'</div></div>\';g.appendChild(a)})}catch(e){}}');
  p.push('async function loadTrending(){try{var r=await fetch("/api/movies/trending");var d=await r.json();var g=$("trendingList");g.innerHTML="";if(!d.items)return;d.items.forEach(function(m,i){var a=document.createElement("a");a.className="tcard";a.href="/watch?id="+m.id;var s=m.thumbnail?"background-image:url(\'"+m.thumbnail+"\')":"";var v=m.views||0;a.innerHTML=\'<div class="tthumb" style="\'+s+\'"><div class="tnum">#\'+(i+1)+\'</div></div><div class="tinfo"><h4>\'+esc(m.title)+\'</h4><div class="tviews">👁 \'+fmt(v)+\' views</div></div>\';g.appendChild(a)})}catch(e){}}');
  // 🔥 Play: contentUrl → <video> direct (no proxy)
  p.push('function playVideo(){');
  p.push('  if(!movieData)return;');
  p.push('  var pb=$("pb");pb.style.display="block";pb.innerHTML="";');
  p.push('  $("videoError").classList.remove("show");');
  p.push('  $("loadingBox").style.display="flex";');
  p.push('  var url=movieData.contentUrl||movieData.videoUrl||movieData.embedUrl||"";');
  p.push('  if(!url){showVideoError();return}');
  p.push('  var isDirect=/\\.(mp4|webm|ogg|m3u8)(\\?|$)/i.test(url)||/secure=/.test(url);');
  p.push('  if(isDirect){');
  p.push('    var v=document.createElement("video");');
  p.push('    v.src=url;v.controls=true;v.autoplay=true;v.playsInline=true;v.setAttribute("playsinline","");');
  p.push('    v.style.width="100%";v.style.height="100%";v.style.objectFit="contain";v.style.background="#000";');
  p.push('    v.onloadeddata=function(){$("loadingBox").style.display="none"};');
  p.push('    v.onerror=function(){showVideoError()};');
  p.push('    setTimeout(function(){if($("loadingBox").style.display!=="none")showVideoError()},12000);');
  p.push('    pb.appendChild(v);');
  p.push('  }else{');
  p.push('    var f=document.createElement("iframe");');
  p.push('    f.src=url;f.allow="autoplay; encrypted-media; picture-in-picture; fullscreen";f.allowFullscreen=true;');
  p.push('    f.setAttribute("webkitallowfullscreen","true");f.setAttribute("mozallowfullscreen","true");f.referrerPolicy="no-referrer";');
  p.push('    f.onload=function(){setTimeout(function(){$("loadingBox").style.display="none"},1000)};');
  p.push('    setTimeout(function(){if($("loadingBox").style.display!=="none")showVideoError()},8000);');
  p.push('    pb.appendChild(f);');
  p.push('  }');
  p.push('  trackView();');
  p.push('  var a=localStorage.getItem("admin_token");');
  p.push('  if(!a){try{fetch("/api/ads").then(function(r){return r.json()}).then(function(ad){if(ad.code&&ad.code.trim())injectAds("adBox",ad.code)})}catch(e){}}');
  p.push('}');
  p.push('function showVideoError(){$("videoError").classList.add("show");$("loadingBox").style.display="none"}');
  p.push('detectAdBlocker();loadData();');
  p.push('<\/script></body></html>');
  return p.join("\n");
}

// ================= ADMIN PAGE (FULL, FIXED) =================
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
  p.push('.auto-box{background:#2a2a2a;border:1px dashed #ff9800;padding:15px;border-radius:8px;margin-bottom:20px}');
  p.push('.paste-box{background:#1a2a3a;border:1px dashed #00c853;padding:15px;border-radius:8px;margin-bottom:20px}');
  p.push('code{background:#111;color:#00c853;padding:2px 6px;border-radius:4px;font-size:12px}');
  p.push('</style></head><body>');
  p.push('<header><h1>Admin Panel</h1><a href="/">Home</a></header>');
  p.push('<div class="wrap">');

  // LOGIN
  p.push('<div id="login" class="card"><h2>Login</h2><label>Password</label><input type="password" id="pwd"><button class="primary" id="loginBtn">Login</button><div id="lm" class="msg"></div></div>');

  // MAIN CONTENT
  p.push('<div id="content" class="hidden">');
  p.push('<div class="tabs"><button id="t1" class="active" data-tab="m">Movies</button><button id="t2" data-tab="ad">Ad Code</button><button id="t3" data-tab="il">Interval Link</button></div>');

  // ============ MOVIES TAB ============
  p.push('<div id="tm">');

  // Paste View Source box
  p.push('<div class="card paste-box">');
  p.push('<h2 style="color:#00c853;margin-bottom:10px">📋 Paste View Source (Ctrl+U)</h2>');
  p.push('<p class="hint" style="margin-bottom:10px;color:#aaddff">1) ভিডিও পেজ খুলুন → <code>Ctrl+U</code> (View Source) → <code>Ctrl+A</code> → <code>Ctrl+C</code><br>2) নিচের বাক্সে পেস্ট করুন → <b>Extract & Fill</b> চাপুন<br>3) Title, Embed URL, Content URL, Thumbnail সব অটো ভরে যাবে</p>');
  p.push('<textarea id="viewSource" placeholder="এখানে পুরো View Source কোড পেস্ট করুন..." style="min-height:150px"></textarea>');
  p.push('<button class="primary" style="background:#00c853;margin-top:10px" id="parseSourceBtn">🔍 Extract & Fill</button>');
  p.push('<div id="psm" class="msg" style="margin-top:10px"></div>');
  p.push('</div>');

  // Auto fetch from URL
  p.push('<div class="card auto-box">');
  p.push('<h2 style="color:#fff;margin-bottom:10px">⚡ Auto Extract from URL</h2>');
  p.push('<p class="hint" style="margin-bottom:10px">URL দিলে সার্ভার নিজে source আনবে। সাইট ব্লক করলে উপরের Paste View Source ব্যবহার করুন।</p>');
  p.push('<input type="text" id="scrapeUrl" placeholder="https://expmle.com/video-page">');
  p.push('<button class="primary" style="background:#ff9800;margin-top:10px" id="scrapeBtn">Auto Extract</button>');
  p.push('<div id="sm" class="msg" style="margin-top:10px"></div>');
  p.push('</div>');

  // Add / Edit form
  p.push('<div class="card">');
  p.push('<h2 id="ft">Add / Edit Movie</h2>');
  p.push('<input type="hidden" id="eid"><input type="hidden" id="videoIdField">');
  p.push('<label>Title</label><input type="text" id="title">');
  p.push('<label>Embed URL (expmle.com/embedframe/xxx) — refresh এর জন্য</label><input type="text" id="embedUrl">');
  p.push('<label>Content URL (play link, refresh এ auto update হয়)</label><input type="text" id="contentUrl">');
  p.push('<label>Thumbnail URL</label><input type="text" id="thumb">');
  p.push('<label>Video URL / Embed (পুরনো ফিল্ড, খালি রাখলেও চলবে)</label><textarea id="vurl"></textarea>');
  p.push('<button class="primary" id="sb">Add Movie</button>');
  p.push('<button class="primary hidden" style="background:#333" id="cb" type="button">Cancel</button>');
  p.push('<div id="am" class="msg"></div>');
  p.push('</div>');

  // All movies list
  p.push('<div class="card"><h2>All Movies</h2><div id="list"></div></div>');
  p.push('</div>'); // end tm

  // ============ AD TAB ============
  p.push('<div id="tad" class="hidden"><div class="card"><h2>Ad Code</h2><p class="hint">Home ও Watch পেজে দেখাবে।</p><textarea id="ads" style="min-height:200px"></textarea><button class="primary" id="adsSaveBtn">Save</button><div id="adm" class="msg"></div></div></div>');

  // ============ INTERVAL LINK TAB ============
  p.push('<div id="til" class="hidden"><div class="card"><h2>Interval Link</h2><p class="hint">ভিডিও চালানোর আগে ৫ সেকেন্ড দেখাবে।</p><label>URL</label><input type="text" id="intervalLinkInput" placeholder="https://..."><button class="primary" id="intervalLinkSaveBtn">Save</button><div id="ilm" class="msg"></div></div></div>');

  p.push('<button class="primary danger" id="logoutBtn">Logout</button>');
  p.push('</div></div>'); // end content, wrap

  // ============ SCRIPT ============
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
  p.push(' $("scrapeBtn").onclick=autoFetch;');
  p.push(' $("parseSourceBtn").onclick=parseViewSource;');
  p.push(' document.querySelectorAll("[data-tab]").forEach(function(b){b.onclick=function(){tab(b.getAttribute("data-tab"))}});');
  p.push(' if(token)verify().then(function(ok){if(ok)show()});');
  p.push('});');

  p.push('async function verify(){try{var r=await fetch("/api/check-auth",{headers:{"X-Admin-Password":token}});return r.ok}catch(e){return false}}');

  p.push('async function doLogin(){var pwd=$("pwd").value;var m=$("lm");try{var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});var d=await r.json();if(r.ok){token=d.token;localStorage.setItem("admin_token",token);show()}else{m.textContent=d.error||"Failed";m.className="msg err show"}}catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}}');

  p.push('function show(){$("login").classList.add("hidden");$("content").classList.remove("hidden");loadList();loadAds();loadIntervalLink()}');

  p.push('function tab(n){$("tm").classList.add("hidden");$("tad").classList.add("hidden");$("til").classList.add("hidden");$("t1").classList.remove("active");$("t2").classList.remove("active");$("t3").classList.remove("active");if(n==="m"){$("tm").classList.remove("hidden");$("t1").classList.add("active")}if(n==="ad"){$("tad").classList.remove("hidden");$("t2").classList.add("active")}if(n==="il"){$("til").classList.remove("hidden");$("t3").classList.add("active")}}');

  p.push('function logout(){localStorage.removeItem("admin_token");location.reload()}');

  p.push('function reset(){$("eid").value="";$("title").value="";$("vurl").value="";$("thumb").value="";$("videoIdField").value="";$("embedUrl").value="";$("contentUrl").value="";$("ft").textContent="Add / Edit Movie";$("sb").textContent="Add Movie";$("cb").classList.add("hidden")}');

  // ========== PARSE VIEW SOURCE ==========
  p.push('function parseViewSource(){');
  p.push('  var text=$("viewSource").value;');
  p.push('  var m=$("psm");');
  p.push('  if(!text||!text.trim()){m.textContent="আগে View Source কোড পেস্ট করুন";m.className="msg err show";return}');
  p.push('  var found=[];');

  // TITLE from <meta name="description" content="...">
  p.push('  var title="";');
  p.push('  var tm=text.match(/<meta[^>]*name\\s*=\\s*["\']description["\'][^>]*content\\s*=\\s*["\']([^"\']+)["\']/i);');
  p.push('  if(!tm)tm=text.match(/<meta[^>]*content\\s*=\\s*["\']([^"\']+)["\'][^>]*name\\s*=\\s*["\']description["\']/i);');
  p.push('  if(tm){title=tm[1].trim();found.push("Title")}');

  // EMBED URL from <iframe ... src="...embedframe/xxx" ...>
  p.push('  var embedUrl="";');
  p.push('  var iframes=text.match(/<iframe[\\s\\S]*?>/gi)||[];');
  p.push('  for(var i=0;i<iframes.length;i++){');
  p.push('    var tag=iframes[i];');
  p.push('    if(!/embedframe/i.test(tag)&&i>0)continue;');
  p.push('    var sm=tag.match(/src\\s*=\\s*["\']([^"\']+)["\']/i);');
  p.push('    if(sm){embedUrl=sm[1];break}');
  p.push('  }');
  p.push('  if(!embedUrl){');
  p.push('    var d=text.match(/https?:\\/\\/[^"\'\\s<>]*embedframe\\/[a-zA-Z0-9]+/i);');
  p.push('    if(d)embedUrl=d[0];');
  p.push('  }');
  p.push('  if(embedUrl){embedUrl=embedUrl.replace(/&amp;/g,"&");found.push("Embed URL")}');

  // CONTENT URL
  p.push('  var contentUrl="";');
  p.push('  var cm=text.match(/"contentUrl"\\s*:\\s*"([^"]+)"/i);');
  p.push('  if(!cm)cm=text.match(/contentUrl\\s*[:=]\\s*[\'"]([^\'"]+)[\'"]/i);');
  p.push('  if(cm){contentUrl=cm[1].replace(/&amp;/g,"&");found.push("Content URL")}');

  // THUMBNAIL
  p.push('  var thumb="";');
  p.push('  var thm=text.match(/"thumbnailUrl"\\s*:\\s*\\[\\s*"([^"]+)"/i);');
  p.push('  if(!thm)thm=text.match(/"thumbnailUrl"\\s*:\\s*"([^"]+)"/i);');
  p.push('  if(!thm)thm=text.match(/"preview_url\\d*"\\s*:\\s*"([^"]+)"/i);');
  p.push('  if(thm){thumb=thm[1].replace(/&amp;/g,"&");found.push("Thumbnail")}');

  // VIDEO ID
  p.push('  var vid="";');
  p.push('  if(embedUrl){var vm=embedUrl.match(/embedframe\\/([a-zA-Z0-9]+)/);if(vm)vid=vm[1]}');

  // Fill form
  p.push('  if(title)$("title").value=title;');
  p.push('  if(embedUrl)$("embedUrl").value=embedUrl;');
  p.push('  if(contentUrl)$("contentUrl").value=contentUrl;');
  p.push('  if(thumb)$("thumb").value=thumb;');
  p.push('  if(contentUrl)$("vurl").value=contentUrl;else if(embedUrl)$("vurl").value=embedUrl;');
  p.push('  if(vid)$("videoIdField").value=vid;');

  // Message
  p.push('  if(found.length){');
  p.push('    m.innerHTML="✅ পাওয়া গেছে: <b>"+found.join(", ")+"</b>";');
  p.push('    m.className="msg ok show";m.style.color="#b6ffb6";');
  p.push('    window.scrollTo({top:document.querySelector("#ft").offsetTop-50,behavior:"smooth"});');
  p.push('  }else{');
  p.push('    m.innerHTML="❌ কিছু পাওয়া যায়নি।<br>Title: <code>&lt;meta name=\\"description\\" content=\\"...\\"&gt;</code><br>Embed: <code>&lt;iframe src=\\"...embedframe/xxx\\"&gt;</code><br>Content: <code>\\"contentUrl\\": \\"...\\"</code><br>Thumb: <code>\\"thumbnailUrl\\": [\\"...\\"]</code>";');
  p.push('    m.className="msg err show";m.style.color="#ffb6b6";');
  p.push('  }');
  p.push('}');

  // ========== AUTO FETCH ==========
  p.push('async function autoFetch(){var url=$("scrapeUrl").value.trim();var m=$("sm");if(!url){m.textContent="URL দিন";m.className="msg err show";return}m.textContent="Extract করছি...";m.className="msg show";m.style.color="#fff";try{var r=await fetch("/api/fetch-source",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url})});var d=await r.json();if(r.ok&&d.success){fillForm(d.data);m.textContent="Data পাওয়া গেছে!";m.className="msg ok show";m.style.color="#b6ffb6"}else{m.textContent=d.error||"Failed";m.className="msg err show";m.style.color="#ffb6b6"}}catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}}');

  p.push('function fillForm(data){$("title").value=data.title||"";$("embedUrl").value=data.embedUrl||"";$("contentUrl").value=data.contentUrl||"";$("thumb").value=data.thumbnail||"";$("vurl").value=data.videoUrl||"";$("videoIdField").value=data.id||""}');

  // ========== SAVE MOVIE ==========
  p.push('async function saveMovie(){');
  p.push('  var eid=$("eid").value;var title=$("title").value.trim();var embedUrl=$("embedUrl").value.trim();');
  p.push('  var contentUrl=$("contentUrl").value.trim();var thumb=$("thumb").value.trim();');
  p.push('  var vurl=$("vurl").value.trim();var vid=$("videoIdField").value.trim();var m=$("am");');
  p.push('  if(!title||(!vurl&&!contentUrl&&!embedUrl)){m.textContent="Title ও অন্তত একটা URL দরকার";m.className="msg err show";return}');
  p.push('  var u=eid?"/api/movies/update":"/api/movies";');
  p.push('  var body={title:title,embedUrl:embedUrl,contentUrl:contentUrl,thumbnail:thumb,videoUrl:vurl};');
  p.push('  if(eid)body.id=eid;if(!eid&&vid)body.videoId=vid;');
  p.push('  try{var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify(body)});');
  p.push('    var d=await r.json();');
  p.push('    if(r.ok){m.textContent=eid?"Updated":"Added";m.className="msg ok show";reset();loadList();setTimeout(function(){m.classList.remove("show")},2500)}');
  p.push('    else{m.textContent=d.error||"Failed";m.className="msg err show"}');
  p.push('  }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}');
  p.push('}');

  // ========== REFRESH ONE ==========
  p.push('async function refreshOne(id,btn){');
  p.push('  btn.disabled=true;var old=btn.textContent;btn.textContent="⏳";');
  p.push('  try{var r=await fetch("/api/refresh-movie",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({id:id})});');
  p.push('    var d=await r.json();');
  p.push('    if(r.ok){btn.textContent="✓"}else{btn.textContent="✗";alert(d.error||"Failed")}');
  p.push('  }catch(e){btn.textContent="✗";alert(e.message)}');
  p.push('  setTimeout(function(){btn.textContent=old;btn.disabled=false},1500);');
  p.push('}');

  // ========== REFRESH ALL ==========
  p.push('async function refreshAllBtn(){');
  p.push('  if(!confirm("সব ভিডিওর contentUrl refresh করবে?"))return;');
  p.push('  var b=$("refreshAllTop");if(b){b.disabled=true;b.textContent="⏳ Refreshing..."}');
  p.push('  try{var r=await fetch("/api/refresh-all",{method:"POST",headers:{"X-Admin-Password":token}});');
  p.push('    var d=await r.json();');
  p.push('    if(r.ok){var msg="OK: "+d.ok+"  Fail: "+d.fail;');
  p.push('      if(d.failures&&d.failures.length){msg+="\\n\\nপ্রথম ১০টা ব্যর্থ:\\n"+d.failures.slice(0,10).map(function(f){return "• "+f.title+": "+f.reason}).join("\\n")}');
  p.push('      alert(msg);');
  p.push('    }else{alert(d.error||"Failed")}');
  p.push('  }catch(e){alert(e.message)}');
  p.push('  if(b){b.disabled=false;b.textContent="🔄 Refresh All"}');
  p.push('  loadList();');
  p.push('}');

  // ========== LOAD LIST ==========
  p.push('async function loadList(){');
  p.push('  var pg=1,all=[];');
  p.push('  while(true){var r=await fetch("/api/movies?page="+pg+"&noshuffle=1");var d=await r.json();all=all.concat(d.items);if(pg>=d.totalPages)break;pg++}');
  p.push('  var el=$("list");');
  p.push('  if(!all.length){el.innerHTML=\'<p style="color:#666">No movies</p>\';return}');
  p.push('  el.innerHTML="";');
  p.push('  var hdr=document.createElement("div");');
  p.push('  hdr.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px";');
  p.push('  hdr.innerHTML=\'<div style="font-size:14px;color:#888">Total: \'+all.length+\'</div>\';');
  p.push('  var refAll=document.createElement("button");');
  p.push('  refAll.id="refreshAllTop";refAll.className="primary small";');
  p.push('  refAll.style.background="#ff9800";refAll.style.marginTop="0";');
  p.push('  refAll.textContent="🔄 Refresh All";refAll.onclick=refreshAllBtn;');
  p.push('  hdr.appendChild(refAll);el.appendChild(hdr);');

  p.push('  all.forEach(function(mv){');
  p.push('    var s=mv.thumbnail?"background-image:url(\'"+mv.thumbnail+"\')":"";');
  p.push('    var row=document.createElement("div");row.className="item";');
  p.push('    var hasC=mv.contentUrl?"✅":"⚠️";');
  p.push('    var info=document.createElement("div");info.className="info";');
  p.push('    info.innerHTML=\'<div class="mini" style="\'+s+\'"></div><div><h4>\'+esc(mv.title)+\' \'+hasC+\'</h4><div class="stats">👁 \'+fmt(mv.views||0)+\' • embed: \'+(mv.embedUrl?"✓":"✗")+\'</div></div>\';');
  p.push('    var acts=document.createElement("div");acts.className="acts";');
  p.push('    var rb=document.createElement("button");rb.className="primary small";rb.style.background="#ff9800";rb.style.marginTop="0";rb.textContent="🔄 Refresh";rb.onclick=function(){refreshOne(mv.id,rb)};');
  p.push('    var eb=document.createElement("button");eb.className="primary small";eb.style.marginTop="0";eb.textContent="Edit";eb.onclick=function(){editMovie(mv.id)};');
  p.push('    var db=document.createElement("button");db.className="primary small danger";db.style.marginTop="0";db.textContent="Delete";db.onclick=function(){delMovie(mv.id)};');
  p.push('    acts.appendChild(rb);acts.appendChild(eb);acts.appendChild(db);');
  p.push('    row.appendChild(info);row.appendChild(acts);el.appendChild(row);');
  p.push('  });');
  p.push('}');

  // ========== EDIT / DELETE ==========
  p.push('async function editMovie(id){');
  p.push('  var pg=1,all=[];');
  p.push('  while(true){var r=await fetch("/api/movies?page="+pg+"&noshuffle=1");var d=await r.json();all=all.concat(d.items);if(pg>=d.totalPages)break;pg++}');
  p.push('  var mv=all.find(function(x){return x.id===id});if(!mv)return;');
  p.push('  $("eid").value=mv.id;$("title").value=mv.title;$("embedUrl").value=mv.embedUrl||"";');
  p.push('  $("contentUrl").value=mv.contentUrl||"";$("thumb").value=mv.thumbnail||"";');
  p.push('  $("vurl").value=mv.videoUrl||"";$("videoIdField").value="";');
  p.push('  $("ft").textContent="Edit Movie";$("sb").textContent="Update";$("cb").classList.remove("hidden");');
  p.push('  window.scrollTo({top:0,behavior:"smooth"});');
  p.push('}');

  p.push('async function delMovie(id){if(!confirm("Delete?"))return;var r=await fetch("/api/movies/"+id,{method:"DELETE",headers:{"X-Admin-Password":token}});if(r.ok)loadList()}');

  // ========== ADS ==========
  p.push('async function loadAds(){var r=await fetch("/api/ads");var d=await r.json();$("ads").value=d.code||""}');
  p.push('async function saveAds(){var code=$("ads").value;var m=$("adm");var r=await fetch("/api/ads",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({code:code})});if(r.ok){m.textContent="Saved";m.className="msg ok show"}else{m.textContent="Failed";m.className="msg err show"}setTimeout(function(){m.classList.remove("show")},2500)}');

  // ========== INTERVAL LINK ==========
  p.push('async function loadIntervalLink(){var r=await fetch("/api/interval-link");var d=await r.json();$("intervalLinkInput").value=d.url||""}');
  p.push('async function saveIntervalLink(){var u=$("intervalLinkInput").value.trim();var m=$("ilm");var r=await fetch("/api/interval-link",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({url:u})});if(r.ok){m.textContent="Saved";m.className="msg ok show"}else{m.textContent="Failed";m.className="msg err show"}setTimeout(function(){m.classList.remove("show")},2500)}');

  p.push('<\/script></body></html>');
  return p.join("\n");
}
