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

// ================= CHECK LINK =================
async function checkLink(url) {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) return json({ ok: false, error: "URL required" }, 400);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", "Range": "bytes=0-2048" },
      signal: controller.signal,
      redirect: "follow"
    });
    clearTimeout(timeoutId);
    return json({ ok: res.ok, status: res.status });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

// ================= RELATED MOVIES =================
async function getRelatedMovies(env, url) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const others = list.filter(m => m.id !== id);
  for (let m of others) { if (!m.views) m.views = Math.floor(Math.random() * 4500) + 500; }
  const shuffled = others.map(m => ({ m, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, 12).map(x => x.m);
  return json({ items: shuffled });
}

// ================= TRENDING MOVIES =================
async function getTrendingMovies(env) {
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  for (let m of list) { if (!m.views) m.views = Math.floor(Math.random() * 4500) + 500; }
  const sorted = list.map(m => ({ m, score: (m.views || 0) + Math.random() * 500 })).sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.m);
  return json({ items: sorted });
}

// ================= TRACK VIEW =================
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

// ================= GET SINGLE MOVIE =================
async function getSingleMovie(env, url) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "ID required" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const movie = list.find(m => m.id === id);
  if (!movie) return json({ error: "Not found" }, 404);
  if (!movie.views) {
    movie.views = Math.floor(Math.random() * 4500) + 500;
    const idx = list.findIndex(m => m.id === id);
    list[idx].views = movie.views;
    await env.MOVIES.put("movie_list", JSON.stringify(list));
  }
  return json({ success: true, movie: movie });
}

// ================= AUTO FETCH / SCRAPER =================
async function fetchSourceData(request) {
  try {
    const body = await request.json();
    const targetUrl = body.url;
    if (!targetUrl) return json({ error: "URL required" }, 400);

    let htmlText = "";
    let isBlocked = false;

    try {
      const res = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5"
        }
      });
      if (res.ok) {
        htmlText = await res.text();
        if (!htmlText.includes('video_alt_url') && !htmlText.includes('video_url')) isBlocked = true;
      } else { isBlocked = true; }
    } catch (e) { isBlocked = true; }

    if (isBlocked) {
      try {
        const jinaRes = await fetch("https://r.jina.ai/" + targetUrl, { headers: { "Accept": "text/plain" } });
        if (jinaRes.ok) { htmlText = await jinaRes.text(); }
      } catch (e) {}
    }

    if (!htmlText) return json({ error: "Failed to load page source." }, 400);

    const getMatch = (key) => {
      let regex = new RegExp(key + "\\s*:\\s*['\"]([^'\"]+)['\"]", "i");
      let match = htmlText.match(regex);
      if (match) return match[1];
      regex = new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"', "i");
      match = htmlText.match(regex);
      if (match) return match[1];
      return "";
    };

    const video_title = getMatch('video_title');
    const video_id = getMatch('video_id');
    let preview_url = getMatch('preview_url') || getMatch('preview_url1');
    let video_url = getMatch('video_alt_url') || getMatch('video_url');

    if(!video_url) return json({ error: "Could not find video link. Site might block it." }, 400);

    return json({
      success: true,
      data: { title: video_title, id: video_id, thumbnail: preview_url, videoUrl: video_url }
    });

  } catch (err) { return json({ error: "Scraping failed: " + err.message }, 500); }
}

// ================= HELPER FUNCTIONS =================
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
  const sp = url.match(/screenpal\.com\/(?:player|embed)\/([a-zA-Z0-9]+)/);
  if (sp) return "https://go.screenpal.com/player/" + sp[1] + "/thumbnail.jpg";
  const yt = url.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return "https://img.youtube.com/vi/" + yt[1] + "/maxresdefault.jpg";
  const dm = url.match(/dailymotion\.com\/(?:embed\/)?video\/([a-zA-Z0-9]+)/);
  if (dm) return "https://www.dailymotion.com/thumbnail/video/" + dm[1];
  return "";
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ================= API: LIST MOVIES =================
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

async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.title || !b.videoUrl) return json({ error: "Missing Title or Video URL" }, 400);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const vurl = extractSrc(b.videoUrl);
  let thumb = (b.thumbnail || "").trim();
  if (!thumb) thumb = autoThumb(vurl);
  const movie = {
    id: b.videoId || crypto.randomUUID(),
    title: b.title.trim(),
    videoUrl: vurl.trim(),
    thumbnail: thumb,
    createdAt: Date.now(),
    views: Math.floor(Math.random() * 4500) + 500
  };
  if (b.videoId && list.find(m => m.id === b.videoId)) return json({ error: "This video is already added!" }, 400);
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
  if (b.videoUrl) {
    list[i].videoUrl = extractSrc(b.videoUrl).trim();
    if (!b.thumbnail) {
      const t = autoThumb(list[i].videoUrl);
      if (t) list[i].thumbnail = t;
    }
  }
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

async function login(request) {
  const b = await request.json();
  if (b.password === ADMIN_PASSWORD) return json({ success: true, token: ADMIN_PASSWORD });
  return json({ error: "Wrong password" }, 401);
}

async function checkAuth(request) {
  const a = request.headers.get("X-Admin-Password");
  if (a === ADMIN_PASSWORD) return json({ valid: true });
  return json({ valid: false }, 401);
}

async function getAds(env) {
  const raw = await env.MOVIES.get("ads_code");
  return json({ code: raw || "" });
}

async function saveAds(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("ads_code", b.code || "");
  return json({ success: true });
}

async function getIntervalLink(env) {
  const raw = await env.MOVIES.get("interval_link");
  return json({ url: raw || "" });
}

async function saveIntervalLink(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("interval_link", b.url || "");
  return json({ success: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

function html(s) {
  return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ================= HOME PAGE =================
function homePage() {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>AdultMovie</title>');
  parts.push('<style>');
  parts.push('*{margin:0;padding:0;box-sizing:border-box}');
  parts.push('@import url("https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap");');
  parts.push('body{font-family:"Hind Siliguri", system-ui, sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}');
  parts.push('header{background:#1a1a1a;padding:15px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040;position:sticky;top:0;z-index:100;flex-wrap:wrap;gap:10px}');
  parts.push('header a.logo{color:#ff0040;font-size:24px;font-weight:bold;text-decoration:none;cursor:pointer;}');
  parts.push('.search-box{flex:1; max-width:400px; display:flex; gap:5px;}');
  parts.push('.search-box input{width:100%; padding:10px 15px; background:#111; border:1px solid #333; border-radius:6px; color:#fff; font-size:15px; outline:none;}');
  parts.push('.search-box input:focus{border-color:#ff0040;}');
  parts.push('.search-box button{background:#ff0040; color:#fff; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:bold;}');
  parts.push('.box{max-width:1300px;margin:0 auto;padding:30px 20px}');
  parts.push('.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}');
  parts.push('.card{background:#1c1c1c;border-radius:10px;overflow:hidden;text-decoration:none;color:#eee;display:block;transition:.3s;cursor:pointer;position:relative}');
  parts.push('.card:hover{transform:translateY(-5px);box-shadow:0 10px 25px rgba(255,0,64,.3)}');
  parts.push('.thumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}');
  parts.push('.play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;background:rgba(255,0,64,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff}');
  parts.push('.watched-badge{position:absolute;top:6px;right:6px;background:#00c853;color:#000;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:10px;z-index:2}');
  parts.push('.views-badge{position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,.75);color:#fff;font-size:11px;padding:3px 8px;border-radius:4px;z-index:2}');
  parts.push('.info{padding:12px}');
  parts.push('.info h3{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
  parts.push('.pager{display:flex;justify-content:center;gap:8px;margin-top:40px;flex-wrap:wrap}');
  parts.push('.pager button{padding:10px 16px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:14px}');
  parts.push('.pager button:hover:not(:disabled){background:#ff0040;border-color:#ff0040}');
  parts.push('.pager button.active{background:#ff0040;border-color:#ff0040}');
  parts.push('.pager button:disabled{opacity:.3;cursor:not-allowed}');
  parts.push('.empty{text-align:center;padding:60px 20px;color:#666;font-size:18px;grid-column: 1 / -1;}');
  parts.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  parts.push('.adblock-popup{display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:9999; align-items:center; justify-content:center; text-align:center; flex-direction:column;}');
  parts.push('.adblock-content{background:#1c1c1c; padding:30px; border-radius:10px; border:2px solid #ff0040; max-width:450px; margin:20px; box-shadow:0 0 20px rgba(255,0,64,0.5);}');
  parts.push('.adblock-content h2{color:#ff0040; margin-bottom:15px; font-size:24px;}');
  parts.push('</style></head><body>');

  parts.push('<div id="adblockPopup" class="adblock-popup">');
  parts.push(' <div class="adblock-content">');
  parts.push(' <h2>⚠️ AdBlocker Detected!</h2>');
  parts.push(' <p style="margin-bottom:20px; color:#ccc; font-size:16px; line-height:1.6;">Our only source of income is advertisements. Please disable your adblocker to support this site.</p>');
  parts.push(' <button onclick="reloadPage()" style="background:#ff0040; color:#fff; border:none; padding:12px 24px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:16px; width:100%;">I Have Disabled My AdBlocker (Reload)</button>');
  parts.push(' </div>');
  parts.push('</div>');

  parts.push('<header>');
  parts.push(' <a href="/" class="logo">AdultMovie</a>');
  parts.push(' <div class="search-box">');
  parts.push(' <input type="text" id="searchInput" placeholder="Search videos..." onkeypress="handleSearch(event)">');
  parts.push(' <button onclick="triggerSearch()">Search</button>');
  parts.push(' </div>');
  parts.push('</header>');
  parts.push('<div class="box">');
  parts.push('<div class="ad" id="adTop"></div>');
  parts.push('<div id="grid" class="grid"></div>');
  parts.push('<div id="pager" class="pager"></div>');
  parts.push('<div class="ad" id="adBot"></div>');
  parts.push('</div>');

  parts.push('<script>');
  parts.push('var SESSION_SEED = Math.random().toString(36).substring(2, 12);');
  parts.push('var currentPage = 1;');
  parts.push('var currentSearch = "";');
  parts.push('function getWatchedIds(){ try{ return JSON.parse(localStorage.getItem("watched_ids")||"[]"); } catch(e){ return []; } }');
  parts.push('function fmtViews(n){ n = parseInt(n)||0; if(n>=1000000) return (n/1000000).toFixed(1).replace(/\\.0$/,"")+"M"; if(n>=1000) return (n/1000).toFixed(1).replace(/\\.0$/,"")+"K"; return n.toString(); }');
  parts.push('function injectAds(containerId, code){ var container=document.getElementById(containerId); if(!container)return; container.innerHTML=""; var temp=document.createElement("div"); temp.innerHTML=code; var scripts=[]; Array.from(temp.childNodes).forEach(function(node){ if(node.tagName==="SCRIPT"){ var s=document.createElement("script"); if(node.src)s.src=node.src; else s.textContent=node.textContent; scripts.push(s); } else { container.appendChild(node.cloneNode(true)); } }); scripts.forEach(function(s){container.appendChild(s);}); }');
  parts.push('async function loadAds(){ var isAdmin = localStorage.getItem("admin_token"); if(isAdmin) return; try{ var r=await fetch("/api/ads"); var d=await r.json(); if(d.code && d.code.trim()){ injectAds("adTop", d.code); injectAds("adBot", d.code); } }catch(e){console.error("Ad error:", e);} }');
  parts.push('function detectAdBlocker(){ var isAdmin = localStorage.getItem("admin_token"); if(isAdmin) return; if (localStorage.getItem("adblockDismissed")) { return; } var s = document.createElement("script"); s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"; s.async = true; var blocked = false; s.onerror = function() { blocked = true; }; document.head.appendChild(s); setTimeout(function(){ var isBlocked = !window.adsbygoogle || blocked; if(isBlocked) { var popup = document.getElementById("adblockPopup"); if(popup) popup.style.display = "flex"; } }, 1500); }');
  parts.push('function reloadPage() { localStorage.setItem("adblockDismissed", "true"); location.reload(); }');
  parts.push('function handleSearch(e){ if(e.key === "Enter"){ triggerSearch(); } }');
  parts.push('function triggerSearch(){ var q = document.getElementById("searchInput").value.trim(); currentSearch = q; currentPage = 1; load(1); }');
  parts.push('async function load(p){ currentPage = p; var watchedIds = getWatchedIds().join(","); var url = "/api/movies?page=" + p + "&seed=" + encodeURIComponent(SESSION_SEED); if(watchedIds) url += "&watched=" + encodeURIComponent(watchedIds); if(currentSearch) url += "&search=" + encodeURIComponent(currentSearch); try { var r=await fetch(url); var d=await r.json(); var g=document.getElementById("grid"); g.innerHTML=""; if(!d.items || !d.items.length){ g.innerHTML=\'<div class="empty">No videos found!</div>\'; document.getElementById("pager").innerHTML=""; return; } var watchedSet = {}; getWatchedIds().forEach(function(x){ watchedSet[String(x)] = true; }); d.items.forEach(function(m){ var a=document.createElement("a"); a.className="card"; a.href="javascript:void(0)"; var s=m.thumbnail?("background-image:url(\'" + m.thumbnail + "\')"):""; var isW = watchedSet[String(m.id)]; var badge = isW ? \'<div class="watched-badge">✓ Watched</div>\' : \'\'; var v = m.views || (Math.floor(Math.random()*4500)+500); var vb = \'<div class="views-badge">👁 \' + fmtViews(v) + \'</div>\'; a.innerHTML=\'<div class="thumb" style="\'+s+\'">\'+badge+vb+\'<div class="play">▶</div></div><div class="info"><h3>\'+esc(m.title)+\'</h3></div>\'; if(isW) a.style.opacity="0.65"; a.onclick = function() { window.location.href = "/watch?id="+m.id; }; g.appendChild(a); }); pager(d.page,d.totalPages); } catch(err) { document.getElementById("grid").innerHTML = \'<div class="empty">Error loading videos. Please refresh.</div>\'; } }');
  parts.push('function pager(c,t){ var el=document.getElementById("pager"); el.innerHTML=""; if(t<=1)return; var p=document.createElement("button"); p.textContent="« Prev"; p.disabled=c===1; p.onclick=function(){load(c-1)}; el.appendChild(p); var st=Math.max(1,c-2),en=Math.min(t,st+4); if(en-st<4)st=Math.max(1,en-4); for(var i=st;i<=en;i++){ (function(i){ var b=document.createElement("button"); b.textContent=i; if(i===c)b.classList.add("active"); b.onclick=function(){load(i)}; el.appendChild(b); })(i); } var n=document.createElement("button"); n.textContent="Next »"; n.disabled=c===t; n.onclick=function(){load(c+1)}; el.appendChild(n); }');
  parts.push('function esc(s){ return String(s).replace(/[&<>]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }');
  parts.push('loadAds(); detectAdBlocker(); load(1);');
  parts.push('<\/script>');
  parts.push('</body></html>');
  return parts.join("\n");
}

// ================= WATCH PAGE =================
function watchPage(id) {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">');
  parts.push('<title>Watch - AdultMovie</title>');
  parts.push('<style>');
  parts.push('*{margin:0;padding:0;box-sizing:border-box}');
  parts.push('@import url("https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap");');
  parts.push('body{font-family:"Hind Siliguri", system-ui, sans-serif;background:#0f0f0f;color:#eee}');
  parts.push('header{background:#1a1a1a;padding:14px 24px;border-bottom:2px solid #ff0040;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}');
  parts.push('header a.logo{color:#ff0040;font-size:22px;font-weight:bold;text-decoration:none;}');
  parts.push('header a.back-btn{color:#eee;text-decoration:none;padding:8px 14px;background:#ff0040;border-radius:6px;font-size:14px}');
  parts.push('.wrap{max-width:1200px;margin:24px auto;padding:0 20px}');
  parts.push('.player-wrap{position:relative;width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center;}');
  parts.push('.player {width:100%; height:100%; position:relative;}');
  parts.push('.player iframe, .player video{width:100%;height:100%;border:0;display:block; object-fit:contain;}');
  parts.push('body.fs-mode{overflow:hidden;background:#000;}');
  parts.push('body.fs-mode .player-wrap:fullscreen{width:100vw !important; height:100vh !important; border-radius:0 !important;}');
  parts.push('body.fs-mode .player-wrap:-webkit-full-screen{width:100vw !important; height:100vh !important; border-radius:0 !important;}');
  parts.push('body.fs-mode .player {width:100%; height:100%;}');
  parts.push('body.fs-mode .player iframe, body.fs-mode .player video {width:100%; height:100%; object-fit:contain;}');
  parts.push('body.fs-mode header,body.fs-mode .title,body.fs-mode .meta,body.fs-mode .actions,body.fs-mode .ad,body.fs-mode .controls,body.fs-mode .section-title,body.fs-mode .related-grid,body.fs-mode .trending-side,body.fs-mode .continue-wrap{display:none !important;}');
  parts.push('body.fs-mode .wrap{max-width:none;margin:0;padding:0;}');
  parts.push('.fs-exit-btn{display:none;position:fixed;top:15px;right:15px;z-index:100000;background:rgba(255,0,64,.95);color:#fff;border:none;padding:8px 16px;border-radius:20px;font-size:14px;font-weight:bold;cursor:pointer;font-family:inherit;box-shadow:0 2px 10px rgba(0,0,0,.5);align-items:center;gap:5px;}');
  parts.push('body.fs-mode .fs-exit-btn{display:flex;}');
  parts.push('.loader-box{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10;}');
  parts.push('.spinner{width:50px;height:50px;border:5px solid rgba(255,0,64,0.2);border-top-color:#ff0040;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:15px;}');
  parts.push('@keyframes spin{to{transform:rotate(360deg)}}');
  parts.push('.loader-text{color:#ff0040;font-size:14px;font-weight:bold;letter-spacing:1px;}');
  parts.push('.title{margin-top:18px;font-size:22px;font-weight:700;line-height:1.4}');
  parts.push('.meta{margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:#aaa;font-size:14px}');
  parts.push('.meta .views{display:flex;align-items:center;gap:6px;color:#ff9800;font-weight:600}');
  parts.push('.meta .date{color:#888}');
  parts.push('.actions{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-bottom:16px;border-bottom:1px solid #222}');
  parts.push('.act-btn{background:#1c1c1c;color:#eee;border:1px solid #333;padding:9px 16px;border-radius:8px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:6px;transition:.2s;font-family:inherit}');
  parts.push('.act-btn:hover{background:#ff0040;border-color:#ff0040}');
  parts.push('.act-btn.saved{background:#00c853;border-color:#00c853;color:#fff}');
  parts.push('.nav-btns{display:flex;gap:8px;margin-left:auto}');
  parts.push('.nav-btn{background:#1c1c1c;color:#eee;border:1px solid #333;padding:9px 16px;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;transition:.2s}');
  parts.push('.nav-btn:hover:not(:disabled){background:#ff0040;border-color:#ff0040}');
  parts.push('.nav-btn:disabled{opacity:.3;cursor:not-allowed}');
  parts.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  parts.push('.controls{display:flex;justify-content:flex-end;margin-top:10px;gap:8px}');
  parts.push('.fs-btn{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;display:flex;align-items:center;gap:8px;font-family:inherit}');
  parts.push('.fs-btn:hover{background:#e60039}');
  parts.push('.section-title{margin:32px 0 16px;font-size:19px;font-weight:700;color:#fff;display:flex;align-items:center;gap:10px}');
  parts.push('.section-title:before{content:"";width:4px;height:22px;background:#ff0040;border-radius:2px}');
  parts.push('.related-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:30px}');
  parts.push('.rcard{background:#1c1c1c;border-radius:8px;overflow:hidden;cursor:pointer;transition:.25s;text-decoration:none;color:#eee;display:block}');
  parts.push('.rcard:hover{transform:translateY(-4px);box-shadow:0 8px 20px rgba(255,0,64,.3)}');
  parts.push('.rthumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}');
  parts.push('.rplay{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:40px;height:40px;background:rgba(255,0,64,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;opacity:0;transition:.2s}');
  parts.push('.rcard:hover .rplay{opacity:1}');
  parts.push('.rinfo{padding:10px}');
  parts.push('.rinfo h4{font-size:13px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}');
  parts.push('.rinfo .rviews{font-size:11px;color:#888;margin-top:4px}');
  parts.push('.trending-side{display:grid;gap:12px;grid-template-columns:1fr;margin-bottom:30px}');
  parts.push('.tcard{display:flex;gap:12px;background:#1c1c1c;border-radius:8px;overflow:hidden;cursor:pointer;transition:.2s;padding:8px;text-decoration:none;color:#eee}');
  parts.push('.tcard:hover{background:#252525}');
  parts.push('.tthumb{width:120px;aspect-ratio:16/9;border-radius:6px;background:#333 center/cover no-repeat;flex-shrink:0;position:relative}');
  parts.push('.tthumb .tnum{position:absolute;top:4px;left:4px;background:rgba(255,0,64,.9);color:#fff;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px}');
  parts.push('.tinfo{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}');
  parts.push('.tinfo h4{font-size:14px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:4px}');
  parts.push('.tinfo .tviews{font-size:12px;color:#888}');
  parts.push('.continue-wrap{margin-bottom:30px}');
  parts.push('.continue-row{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin}');
  parts.push('.continue-row::-webkit-scrollbar{height:6px}');
  parts.push('.continue-row::-webkit-scrollbar-thumb{background:#333;border-radius:3px}');
  parts.push('.ccard{flex-shrink:0;width:200px;background:#1c1c1c;border-radius:8px;overflow:hidden;cursor:pointer;text-decoration:none;color:#eee;position:relative}');
  parts.push('.ccard:hover{background:#252525}');
  parts.push('.cthumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}');
  parts.push('.cinfo{padding:8px 10px}');
  parts.push('.cinfo h4{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
  parts.push('.share-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;align-items:center;justify-content:center;padding:20px}');
  parts.push('.share-box{background:#1c1c1c;border-radius:14px;padding:24px;max-width:420px;width:100%;border:2px solid #ff0040}');
  parts.push('.share-box h3{color:#fff;margin-bottom:18px;font-size:18px;text-align:center}');
  parts.push('.share-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}');
  parts.push('.share-item{background:#111;border:1px solid #333;padding:14px 8px;border-radius:10px;cursor:pointer;text-align:center;color:#eee;font-size:12px;transition:.2s;font-family:inherit}');
  parts.push('.share-item:hover{background:#ff0040;border-color:#ff0040}');
  parts.push('.share-item .ico{font-size:22px;display:block;margin-bottom:4px}');
  parts.push('.share-close{width:100%;background:#333;color:#fff;border:none;padding:12px;border-radius:8px;cursor:pointer;font-weight:600;font-family:inherit;font-size:14px}');
  parts.push('.share-close:hover{background:#444}');
  parts.push('.copy-input{background:#111;border:1px solid #333;color:#888;padding:10px;border-radius:6px;font-size:12px;width:100%;margin-bottom:12px;font-family:monospace}');
  parts.push('.adblock-popup{display:none;position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:9999;align-items:center;justify-content:center;text-align:center;flex-direction:column}');
  parts.push('.adblock-content{background:#1c1c1c;padding:30px;border-radius:10px;border:2px solid #ff0040;max-width:450px;margin:20px;box-shadow:0 0 20px rgba(255,0,64,.5)}');
  parts.push('.adblock-content h2{color:#ff0040;margin-bottom:15px;font-size:24px}');
  parts.push('.interstitial-modal{display:flex;position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:10000;flex-direction:column;align-items:center;justify-content:center;padding:10px}');
  parts.push('.interstitial-box{background:#1c1c1c;width:100%;max-width:800px;height:100%;max-height:95vh;padding:15px;border-radius:12px;border:2px solid #ff0040;text-align:center;display:flex;flex-direction:column}');
  parts.push('.interstitial-box h3{color:#fff;margin-bottom:10px;font-size:18px;flex-shrink:0}');
  parts.push('.ad-container{flex:1;width:100%;min-height:200px;display:flex;align-items:center;justify-content:center;background:#000;border-radius:8px;overflow:hidden;margin-bottom:10px}');
  parts.push('.ad-container iframe{width:100%;height:100%;border:0}');
  parts.push('.btn-row{display:flex;gap:10px;width:100%;flex-shrink:0;flex-wrap:wrap}');
  parts.push('.action-btn{border:none;padding:14px 10px;border-radius:8px;font-size:16px;font-weight:bold;transition:.3s;flex:1;min-width:120px;font-family:inherit}');
  parts.push('.btn-ad{background:#2196F3;color:#fff;cursor:pointer}');
  parts.push('.btn-ad:hover{background:#1976D2}');
  parts.push('.btn-watch{background:#333;color:#fff;cursor:not-allowed}');
  parts.push('.btn-watch.active{background:#ff0040;cursor:pointer;box-shadow:0 0 15px rgba(255,0,64,.5)}');
  parts.push('.btn-watch.active:hover{background:#e60039}');
  parts.push('.autonext{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9998;align-items:center;justify-content:center;flex-direction:column;padding:20px;text-align:center}');
  parts.push('.autonext h2{color:#fff;font-size:24px;margin-bottom:12px}');
  parts.push('.autonext p{color:#aaa;margin-bottom:20px;font-size:16px}');
  parts.push('.autonext .countdown{font-size:60px;color:#ff0040;font-weight:bold;margin-bottom:24px;font-variant-numeric:tabular-nums}');
  parts.push('.autonext .an-btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}');
  parts.push('.autonext .an-btn{padding:14px 28px;border-radius:10px;border:none;cursor:pointer;font-size:16px;font-weight:600;font-family:inherit}');
  parts.push('.an-play{background:#ff0040;color:#fff}');
  parts.push('.an-play:hover{background:#e60039}');
  parts.push('.an-cancel{background:#333;color:#fff}');
  parts.push('.an-cancel:hover{background:#444}');
  parts.push('.video-error{display:none;position:absolute;inset:0;background:rgba(0,0,0,.9);z-index:15;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;}');
  parts.push('.video-error.show{display:flex}');
  parts.push('.video-error h3{color:#ff0040;font-size:18px;margin-bottom:10px}');
  parts.push('.video-error p{color:#ccc;font-size:14px;margin-bottom:16px;max-width:400px}');
  parts.push('.video-error button{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;font-family:inherit;font-size:14px}');
  parts.push('@media(max-width:768px){.title{font-size:17px}.related-grid{grid-template-columns:repeat(2,1fr)}.nav-btns{margin-left:0;width:100%;margin-top:8px}.nav-btn{flex:1}.share-grid{grid-template-columns:repeat(2,1fr)}}');
  parts.push('</style></head><body>');
  
  parts.push('<div id="adblockPopup" class="adblock-popup"><div class="adblock-content"><h2>⚠️ AdBlocker Detected!</h2><p style="margin-bottom:20px;color:#ccc;font-size:16px;line-height:1.6;">Our only source of income is advertisements. Please disable your adblocker to support this site.</p><button onclick="reloadPage()" style="background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:16px;width:100%;font-family:inherit">I Have Disabled My AdBlocker (Reload)</button></div></div>');

  parts.push('<div id="interstitialModal" class="interstitial-modal"><div class="interstitial-box"><h3>Your video is loading... Please wait</h3><div class="ad-container" id="interstitialAdBox"></div><div class="btn-row"><button id="viewAdBtn" class="action-btn btn-ad" style="display:none;">🔗 View Ad</button><button id="skipBtn" class="action-btn btn-watch" disabled>Please Wait (5)</button></div></div></div>');

  parts.push('<div id="autoNextBox" class="autonext"><h2>Up Next</h2><p id="anTitle">Loading...</p><div class="countdown" id="anCount">5</div><div class="an-btns"><button class="an-btn an-play" onclick="playNextNow()">▶ Play Now</button><button class="an-btn an-cancel" onclick="cancelAutoNext()">✖ Cancel</button></div></div>');

  parts.push('<div id="shareModal" class="share-modal"><div class="share-box"><h3>🔗 Share this video</h3><input type="text" class="copy-input" id="shareUrl" readonly><div class="share-grid"><button class="share-item" onclick="shareTo(\'fb\')"><span class="ico">📘</span>Facebook</button><button class="share-item" onclick="shareTo(\'tw\')"><span class="ico">🐦</span>Twitter</button><button class="share-item" onclick="shareTo(\'wa\')"><span class="ico">💬</span>WhatsApp</button><button class="share-item" onclick="shareTo(\'tg\')"><span class="ico">✈️</span>Telegram</button><button class="share-item" onclick="shareTo(\'rd\')"><span class="ico">👽</span>Reddit</button><button class="share-item" onclick="shareTo(\'cp\')"><span class="ico">📋</span>Copy</button><button class="share-item" onclick="shareTo(\'nv\')"><span class="ico">📱</span>Native</button><button class="share-item" onclick="shareTo(\'em\')"><span class="ico">✉️</span>Email</button></div><button class="share-close" onclick="closeShare()">Close</button></div></div>');

  parts.push('<button id="fsExitBtn" class="fs-exit-btn" onclick="exitFullscreen()">✖ Exit Fullscreen</button>');

  parts.push('<header><a href="/" class="logo">AdultMovie</a><a href="/" class="back-btn">← Home</a></header>');
  parts.push('<div class="wrap">');
  parts.push('<div class="player-wrap" id="playerWrap">');
  parts.push('  <div class="loader-box" id="loadingBox"><div class="spinner"></div><div class="loader-text">Loading Video...</div></div>');
  parts.push('  <div class="player" id="pb" style="display:none;"></div>');
  parts.push('  <div class="video-error" id="videoError"><h3>⚠️ Video Not Loading</h3><p>This video might be temporarily unavailable or blocked. Try another one.</p><button onclick="location.reload()">🔄 Reload Page</button></div>');
  parts.push('</div>');
  parts.push('<div class="controls" id="ctrl" style="display:none;"><button class="fs-btn" onclick="enterFullscreen()">⛶ Full Screen</button></div>');
  parts.push('<div class="title" id="t">Loading...</div>');
  parts.push('<div class="meta" id="metaBar"></div>');
  parts.push('<div class="actions" id="actBar"></div>');
  parts.push('<div class="ad" id="adBox"></div>');
  parts.push('<div id="continueWrap" class="continue-wrap" style="display:none;"><div class="section-title">⏱️ Continue Watching</div><div class="continue-row" id="continueRow"></div></div>');
  parts.push('<div class="section-title">🎬 You May Also Like</div>');
  parts.push('<div class="related-grid" id="relatedGrid"></div>');
  parts.push('<div class="section-title">🔥 Trending Now</div>');
  parts.push('<div class="trending-side" id="trendingList"></div>');
  parts.push('</div>');

  parts.push('<script>');
  parts.push('function $(id){return document.getElementById(id)}');
  parts.push('function markWatched(id){try{var arr=JSON.parse(localStorage.getItem("watched_ids")||"[]");var sid=String(id);if(arr.indexOf(sid)===-1)arr.push(sid);if(arr.length>500)arr=arr.slice(-500);localStorage.setItem("watched_ids",JSON.stringify(arr));}catch(e){}}');
  parts.push('function injectAds(id,code){var c=$(id);if(!c)return;c.innerHTML="";var t=document.createElement("div");t.innerHTML=code;var sc=[];Array.from(t.childNodes).forEach(function(n){if(n.tagName==="SCRIPT"){var s=document.createElement("script");if(n.src)s.src=n.src;else s.textContent=n.textContent;sc.push(s);}else{c.appendChild(n.cloneNode(true));}});sc.forEach(function(s){c.appendChild(s);});}');
  parts.push('function enterFullscreen(){var elem = $("playerWrap");if (elem.requestFullscreen) { elem.requestFullscreen().catch(function(){}); }else if (elem.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); }}');
  parts.push('function exitFullscreen(){document.body.classList.remove("fs-mode");try{ if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){}); }catch(e){}try{ if(document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen(); }catch(e){}try{ if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}}');
  parts.push('document.addEventListener("fullscreenchange", function(){ if(document.fullscreenElement) document.body.classList.add("fs-mode"); else document.body.classList.remove("fs-mode"); });');
  parts.push('document.addEventListener("webkitfullscreenchange", function(){ if(document.webkitFullscreenElement) document.body.classList.add("fs-mode"); else document.body.classList.remove("fs-mode"); });');
  parts.push('window.addEventListener("keydown", function(e){ if(e.key === "Escape"){ exitFullscreen(); } });');
  parts.push('function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c];});}');
  parts.push('function fmtViews(n){ n = parseInt(n)||0; if(n>=1000000) return (n/1000000).toFixed(1).replace(/\\.0$/,"")+"M"; if(n>=1000) return (n/1000).toFixed(1).replace(/\\.0$/,"")+"K"; return n.toString(); }');
  parts.push('function fmtAgo(ts){ if(!ts) return "Recently"; var diff = Date.now() - ts; var d = Math.floor(diff / 86400000); if(d < 1) return "Today"; if(d < 7) return d + " days ago"; if(d < 30) return Math.floor(d/7) + " weeks ago"; if(d < 365) return Math.floor(d/30) + " months ago"; return Math.floor(d/365) + " years ago"; }');
  parts.push('function detectAdBlocker(){ var isAdmin=localStorage.getItem("admin_token");if(isAdmin)return; if(localStorage.getItem("adblockDismissed"))return; var s=document.createElement("script");s.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";s.async=true; var blocked=false;s.onerror=function(){blocked=true;};document.head.appendChild(s); setTimeout(function(){ var isBlocked=!window.adsbygoogle||blocked; if(isBlocked){var p=$("adblockPopup");if(p)p.style.display="flex";} },1500); }');
  parts.push('function reloadPage(){localStorage.setItem("adblockDismissed","true");location.reload();}');
  parts.push('function getFavs(){try{return JSON.parse(localStorage.getItem("fav_ids")||"[]");}catch(e){return [];}}');
  parts.push('function isFav(id){return getFavs().indexOf(String(id))!==-1;}');
  parts.push('function toggleFav(id){ var arr=getFavs();var sid=String(id);var idx=arr.indexOf(sid); if(idx===-1)arr.push(sid);else arr.splice(idx,1); localStorage.setItem("fav_ids",JSON.stringify(arr)); return idx===-1; }');
  parts.push('function getHistory(){try{return JSON.parse(localStorage.getItem("watch_history")||"[]");}catch(e){return [];}}');
  parts.push('function saveHistory(entry){ var arr=getHistory().filter(function(x){return x.id!==entry.id;}); arr.unshift(entry); if(arr.length>20)arr=arr.slice(0,20); localStorage.setItem("watch_history",JSON.stringify(arr)); }');
  parts.push('var id=new URLSearchParams(location.search).get("id");');
  parts.push('var movieData=null;');
  parts.push('var relatedList=[];');
  parts.push('var prevMovie=null,nextMovie=null;');
  parts.push('var autoNextTimer=null, autoNextTarget=null, autoNextCount=0;');

  // ============ AUTO REFRESH FROM CLIENT ============
  parts.push('async function autoRefreshLink(){');
  parts.push('  try{');
  parts.push('    if(!movieData) return false;');
  parts.push('    console.log("Auto-refresh for ID: "+movieData.id);');
  parts.push('    var searchUrl="https://letsporn.com/s-"+movieData.id;');
  parts.push('    var jinaResp=await fetch("https://r.jina.ai/"+searchUrl,{headers:{"Accept":"text/plain"}});');
  parts.push('    if(!jinaResp.ok) return false;');
  parts.push('    var txt=await jinaResp.text();');
  parts.push('    var regex=new RegExp("https?:\\\\/\\\\/letsporn\\\\.com\\\\/[a-z0-9\\\\-]+-"+movieData.id+"(?![0-9])","i");');
  parts.push('    var match=txt.match(regex);');
  parts.push('    if(!match) return false;');
  parts.push('    var videoPageUrl=match[0];');
  parts.push('    var vpResp=await fetch("https://r.jina.ai/"+videoPageUrl,{headers:{"Accept":"text/plain"}});');
  parts.push('    if(!vpResp.ok) return false;');
  parts.push('    var vpHtml=await vpResp.text();');
  parts.push('    var mp4Regex=/https?:\\/\\/[^\\s"\'<>\\\\]+\\.mp4[^\\s"\'<>\\\\]*/i;');
  parts.push('    var mp4Match=vpHtml.match(mp4Regex);');
  parts.push('    if(!mp4Match) return false;');
  parts.push('    var newUrl=mp4Match[0];');
  parts.push('    console.log("New URL: "+newUrl);');
  parts.push('    await fetch("/api/movies/update",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":"' + ADMIN_PASSWORD + '"},body:JSON.stringify({id:movieData.id,videoUrl:newUrl})});');
  parts.push('    movieData.videoUrl=newUrl;');
  parts.push('    return true;');
  parts.push('  }catch(e){ console.error("Auto-refresh failed:",e); return false; }');
  parts.push('}');

  parts.push('async function loadData(){ if(!id){$("t").textContent="ID not provided";return} try{ var r=await fetch("/api/movie?id="+id); if(!r.ok)throw new Error("Not found"); var d=await r.json(); movieData=d.movie; if(!movieData.views) movieData.views = Math.floor(Math.random()*4500)+500; document.title = movieData.title + " - AdultMovie"; $("t").textContent=movieData.title; renderMeta(); renderActions(); saveHistory({id:movieData.id,title:movieData.title,thumbnail:movieData.thumbnail,ts:Date.now()}); var isAdmin=localStorage.getItem("admin_token"); if(!isAdmin){showInterstitialAd();}else{$("interstitialModal").style.display="none";playVideo();} loadRelated(); loadTrending(); renderContinue(); }catch(err){ $("t").textContent="Video Not Found"; } }');
  parts.push('function trackView(){ if(!movieData)return; fetch("/api/movies/track-view",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:movieData.id})}).then(function(r){return r.json()}).then(function(d){ if(d.success && d.views){ movieData.views = d.views; renderMeta(); } }).catch(function(){}); }');
  parts.push('function renderMeta(){ if(!movieData)return; var v = movieData.views || Math.floor(Math.random()*4500)+500; var ago = fmtAgo(movieData.createdAt); $("metaBar").innerHTML = \'<span class="views">👁️ \'+fmtViews(v)+\' views</span><span class="date">📅 \'+ago+\'</span>\'; }');
  parts.push('function renderActions(){ if(!movieData)return; var fav = isFav(movieData.id); var html = \'\'; html += \'<button class="act-btn \'+(fav?"saved":"")+\'" id="favBtn" onclick="toggleFavClick()">\'+(fav?"✅ Saved":"🔖 Save")+\'</button>\'; html += \'<button class="act-btn" onclick="openShare()">🔗 Share</button>\'; html += \'<div class="nav-btns">\'; html += \'<button class="nav-btn" id="prevBtn" onclick="goPrev()" disabled>← Prev</button>\'; html += \'<button class="nav-btn" id="nextBtn" onclick="goNext()" disabled>Next →</button>\'; html += \'</div>\'; $("actBar").innerHTML = html; }');
  parts.push('function toggleFavClick(){ var now = toggleFav(movieData.id); var btn = $("favBtn"); if(now){btn.classList.add("saved");btn.textContent="✅ Saved";} else{btn.classList.remove("saved");btn.textContent="🔖 Save";} }');
  parts.push('function openShare(){ $("shareUrl").value = location.href; $("shareModal").style.display = "flex"; }');
  parts.push('function closeShare(){$("shareModal").style.display="none";}');
  parts.push('function shareTo(type){ var u = encodeURIComponent(location.href); var t = encodeURIComponent(movieData ? movieData.title : "Watch this!"); var links = { fb: "https://www.facebook.com/sharer/sharer.php?u="+u, tw: "https://twitter.com/intent/tweet?url="+u+"&text="+t, wa: "https://wa.me/?text="+t+"%20"+u, tg: "https://t.me/share/url?url="+u+"&text="+t, rd: "https://www.reddit.com/submit?url="+u+"&title="+t, em: "mailto:?subject="+t+"&body="+u }; if(type==="cp"){ navigator.clipboard.writeText(location.href).then(function(){ alert("Link copied!"); closeShare(); }).catch(function(){ var inp = $("shareUrl");inp.select();document.execCommand("copy");alert("Link copied!"); }); return; } if(type==="nv"){ if(navigator.share){ navigator.share({title: movieData?movieData.title:"Video", url: location.href}).catch(function(){}); }else{alert("Native share not supported");} return; } if(links[type]) window.open(links[type], "_blank"); }');
  parts.push('async function loadRelated(){ if(!id)return; try{ var r = await fetch("/api/movies/related?id="+id); var d = await r.json(); relatedList = d.items || []; var g = $("relatedGrid"); g.innerHTML = ""; if(!relatedList.length){ g.innerHTML = \'<p style="color:#666;grid-column:1/-1">No related videos</p>\'; return; } relatedList.forEach(function(m){ var a = document.createElement("a"); a.className = "rcard"; a.href = "/watch?id="+m.id; var s = m.thumbnail ? ("background-image:url(\'" + m.thumbnail + "\')") : ""; var v = m.views || (Math.floor(Math.random()*4500)+500); a.innerHTML = \'<div class="rthumb" style="\'+s+\'"><div class="rplay">▶</div></div><div class="rinfo"><h4>\'+esc(m.title)+\'</h4><div class="rviews">👁 \'+fmtViews(v)+\'</div></div>\'; g.appendChild(a); }); updatePrevNext(); }catch(e){} }');
  parts.push('function updatePrevNext(){ if(!relatedList.length)return; var idx = 0; prevMovie = relatedList[idx % relatedList.length]; nextMovie = relatedList[(idx+1) % relatedList.length]; if(prevMovie){var pb=$("prevBtn");if(pb)pb.disabled=false;} if(nextMovie){var nb=$("nextBtn");if(nb)nb.disabled=false;} }');
  parts.push('function goPrev(){if(prevMovie)location.href="/watch?id="+prevMovie.id;}');
  parts.push('function goNext(){if(nextMovie)location.href="/watch?id="+nextMovie.id;}');
  parts.push('async function loadTrending(){ try{ var r = await fetch("/api/movies/trending"); var d = await r.json(); var g = $("trendingList"); g.innerHTML = ""; if(!d.items || !d.items.length)return; d.items.forEach(function(m, i){ var a = document.createElement("a"); a.className = "tcard"; a.href = "/watch?id="+m.id; var s = m.thumbnail ? ("background-image:url(\'" + m.thumbnail + "\')") : ""; var v = m.views || (Math.floor(Math.random()*4500)+500); a.innerHTML = \'<div class="tthumb" style="\'+s+\'"><div class="tnum">#\'+(i+1)+\'</div></div><div class="tinfo"><h4>\'+esc(m.title)+\'</h4><div class="tviews">👁 \'+fmtViews(v)+\' views</div></div>\'; g.appendChild(a); }); }catch(e){} }');
  parts.push('function renderContinue(){ var h = getHistory(); var others = h.filter(function(x){return x.id !== id;}); if(!others.length){$("continueWrap").style.display="none";return;} $("continueWrap").style.display="block"; var row = $("continueRow"); row.innerHTML = ""; others.slice(0, 8).forEach(function(m){ var a = document.createElement("a"); a.className = "ccard"; a.href = "/watch?id="+m.id; var s = m.thumbnail ? ("background-image:url(\'" + m.thumbnail + "\')") : ""; a.innerHTML = \'<div class="cthumb" style="\'+s+\'"></div><div class="cinfo"><h4>\'+esc(m.title)+\'</h4></div>\'; row.appendChild(a); }); }');
  parts.push('async function showInterstitialAd(){ var adBox = $("interstitialAdBox"); var skipBtn = $("skipBtn"); var viewAdBtn = $("viewAdBtn"); var adUrl = ""; try{ var ar=await fetch("/api/interval-link"); var ad=await ar.json(); if(ad.url && ad.url.trim() && (ad.url.trim().startsWith("http://") || ad.url.trim().startsWith("https://"))){ adUrl = ad.url.trim(); adBox.innerHTML = \'<iframe src="\'+adUrl+\'" allowfullscreen></iframe>\'; } else { $("interstitialModal").style.display = "none"; playVideo(); return; } }catch(e){ $("interstitialModal").style.display = "none"; playVideo(); return; } var timeLeft = 5; skipBtn.textContent = "Please Wait (" + timeLeft + ")"; var timer = setInterval(function(){ timeLeft--; if(timeLeft > 0){ skipBtn.textContent = "Please Wait (" + timeLeft + ")"; } else { clearInterval(timer); if(adUrl !== ""){ viewAdBtn.style.display = "block"; } skipBtn.textContent = "Watch Video ▶"; skipBtn.classList.add("active"); skipBtn.disabled = false; skipBtn.onclick = function(){ $("interstitialModal").style.display = "none"; playVideo(); }; if(adUrl !== "") { viewAdBtn.onclick = function(){ window.open(adUrl, "_blank"); }; } } }, 1000); }');
  parts.push('function playVideo(){ if(!movieData) return; markWatched(movieData.id); var pb = $("pb"); pb.style.display = "block"; $("ctrl").style.display="flex"; pb.innerHTML = ""; $("videoError").classList.remove("show"); $("loadingBox").style.display="flex"; var direct=/\\.(mp4|webm|ogg|m3u8)(\\?|$)/i.test(movieData.videoUrl); if(direct){ var v=document.createElement("video"); v.src=movieData.videoUrl;v.controls=true;v.autoplay=true;v.playsInline=true; v.onended = function(){ onVideoEnded(); }; v.onerror = async function(){ $("loadingBox").style.display="none"; var ok = await autoRefreshLink(); if(ok){ playVideo(); } else { showVideoError(); } }; v.onloadeddata = function(){ $("loadingBox").style.display="none"; }; pb.appendChild(v); }else{ var f=document.createElement("iframe"); f.src=movieData.videoUrl; f.allow="autoplay; encrypted-media; picture-in-picture; fullscreen;"; f.allowFullscreen=true; f.setAttribute("webkitallowfullscreen", "true"); f.setAttribute("mozallowfullscreen", "true"); f.referrerPolicy="no-referrer"; f.onload = function(){ setTimeout(function(){ $("loadingBox").style.display="none"; }, 1000); }; setTimeout(function(){ if($("loadingBox").style.display !== "none"){ showVideoError(); } }, 8000); pb.appendChild(f); } trackView(); var isAdmin = localStorage.getItem("admin_token"); if(!isAdmin){ try{ fetch("/api/ads").then(r=>r.json()).then(ad=>{ if(ad.code && ad.code.trim()) injectAds("adBox", ad.code); }); }catch(e){} } }');
  parts.push('function showVideoError(){ $("videoError").classList.add("show"); $("loadingBox").style.display="none"; }');
  parts.push('function onVideoEnded(){ if(!nextMovie)return; autoNextTarget = nextMovie; autoNextCount = 5; $("anTitle").textContent = "▶ " + nextMovie.title; $("anCount").textContent = autoNextCount; $("autoNextBox").style.display = "flex"; autoNextTimer = setInterval(function(){ autoNextCount--; if(autoNextCount <= 0){ clearInterval(autoNextTimer); playNextNow(); } else { $("anCount").textContent = autoNextCount; } }, 1000); }');
  parts.push('function playNextNow(){ clearInterval(autoNextTimer); if(autoNextTarget) location.href = "/watch?id=" + autoNextTarget.id; }');
  parts.push('function cancelAutoNext(){ clearInterval(autoNextTimer); $("autoNextBox").style.display = "none"; }');
  parts.push('detectAdBlocker();');
  parts.push('loadData();');
  parts.push('<\/script>');
  parts.push('</body></html>');
  return parts.join("\n");
}

// ================= ADMIN PAGE =================
function adminPage() {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>Admin - AdultMovie</title>');
  parts.push('<style>');
  parts.push('*{margin:0;padding:0;box-sizing:border-box}');
  parts.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}');
  parts.push('header{background:#1a1a1a;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040}');
  parts.push('header h1{color:#ff0040;font-size:22px}');
  parts.push('header a{color:#eee;text-decoration:none;padding:8px 14px;background:#333;border-radius:6px;font-size:14px}');
  parts.push('.wrap{max-width:900px;margin:30px auto;padding:0 20px}');
  parts.push('.card{background:#1c1c1c;border-radius:12px;padding:24px;margin-bottom:20px}');
  parts.push('.card h2{color:#ff0040;margin-bottom:16px;font-size:18px}');
  parts.push('label{display:block;margin-top:12px;font-size:14px;color:#aaa}');
  parts.push('input,textarea{width:100%;padding:12px;margin-top:6px;background:#111;border:1px solid #333;border-radius:6px;color:#eee;font-size:15px;font-family:inherit}');
  parts.push('textarea{resize:vertical;min-height:100px;font-family:monospace;font-size:13px}');
  parts.push('input:focus,textarea:focus{outline:none;border-color:#ff0040}');
  parts.push('button.primary{background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:600;margin-top:20px;font-size:15px}');
  parts.push('button.primary:hover{opacity:.9}');
  parts.push('button.danger{background:#c00}');
  parts.push('button.small{padding:6px 12px;font-size:12px;margin:0}');
  parts.push('.item{display:flex;justify-content:space-between;align-items:center;padding:12px;background:#111;border-radius:6px;margin-bottom:8px;gap:12px;flex-wrap:wrap}');
  parts.push('.item .info{flex:1;min-width:200px;display:flex;gap:12px;align-items:center}');
  parts.push('.item .mini{width:70px;height:44px;border-radius:4px;flex-shrink:0;background:#333 center/cover no-repeat}');
  parts.push('.item h4{font-size:14px}');
  parts.push('.item .stats{font-size:12px;color:#888;margin-top:2px}');
  parts.push('.acts{display:flex;gap:6px}');
  parts.push('.msg{padding:10px;border-radius:6px;margin-top:12px;display:none}');
  parts.push('.msg.show{display:block}');
  parts.push('.msg.ok{background:#164d2c;color:#b6ffb6}');
  parts.push('.msg.err{background:#4d1616;color:#ffb6b6}');
  parts.push('.hidden{display:none}');
  parts.push('#login{max-width:400px;margin:100px auto}');
  parts.push('.hint{font-size:12px;color:#666;margin-top:4px}');
  parts.push('.tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}');
  parts.push('.tabs button{padding:10px 20px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}');
  parts.push('.tabs button.active{background:#ff0040;border-color:#ff0040}');
  parts.push('.auto-box{background:#2a2a2a;border:1px dashed #ff9800;padding:15px;border-radius:8px;margin-bottom:20px}');
  parts.push('.paste-box{background:#1a2a3a;border:1px dashed #00c853;padding:15px;border-radius:8px;margin-bottom:20px}');
  parts.push('.preview-box{width:100%; height:400px; background:#000; border-radius:8px; border:2px solid #ff9800; margin-top:15px; display:none; position:relative; overflow:hidden;}');
  parts.push('.preview-box iframe{width:100%; height:100%; border:0;}');
  parts.push('.close-preview{position:absolute; top:5px; right:5px; background:#c00; color:#fff; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; z-index:10; font-weight:bold;}');
  parts.push('</style></head><body>');
  parts.push('<header><h1>Admin Panel - AdultMovie</h1><a href="/">Home</a></header>');
  parts.push('<div class="wrap">');

  parts.push('<div id="login" class="card">');
  parts.push('<h2>Login</h2>');
  parts.push('<label>Password</label>');
  parts.push('<input type="password" id="pwd">');
  parts.push('<button class="primary" id="loginBtn">Login</button>');
  parts.push('<div id="lm" class="msg"></div>');
  parts.push('</div>');

  parts.push('<div id="content" class="hidden">');
  parts.push('<div class="tabs">');
  parts.push('<button id="t1" class="active" data-tab="m">Movies</button>');
  parts.push('<button id="t2" data-tab="ad">Ad Code</button>');
  parts.push('<button id="t3" data-tab="il">Interval Link</button>');
  parts.push('</div>');

  parts.push('<div id="tm">');
  parts.push('<div class="card auto-box">');
  parts.push('<h2 style="color:#fff;margin-bottom:10px;">⚡ Auto Extract from URL</h2>');
  parts.push('<p class="hint" style="margin-bottom:10px;">Enter a link and extract the data automatically.</p>');
  parts.push('<input type="text" id="scrapeUrl" placeholder="https://example.com/video-page">');
  parts.push('<div style="display:flex; gap:10px; flex-wrap:wrap;">');
  parts.push('  <button class="primary" style="background:#ff9800; margin-top:10px;" id="scrapeBtn">Open & Extract</button>');
  parts.push('  <button class="primary" style="background:#2196F3; margin-top:10px;" id="openLiveBtn">🔗 Open Page Live</button>');
  parts.push('</div>');
  parts.push('<div id="sm" class="msg" style="margin-top:10px;"></div>');
  parts.push('<div id="livePreview" class="preview-box">');
  parts.push('  <button class="close-preview" onclick="closePreview()">✖ Close</button>');
  parts.push('  <iframe id="previewFrame" sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe>');
  parts.push('</div>');
  parts.push('</div>');

  parts.push('<div class="card paste-box">');
  parts.push('<h2 style="color:#00c853;margin-bottom:10px;">📋 Smart Paste (Manual Source Code)</h2>');
  parts.push('<p class="hint" style="margin-bottom:10px;color:#aaddff;">Open the page yourself -> View Source -> copy the lines below and paste them here.</p>');
  parts.push('<textarea id="sourceCode" placeholder="video_title: \'Example Title\',&#10;video_id: \'1234\',&#10;preview_url: \'https://image.jpg\',&#10;video_alt_url: \'https://video.mp4\'" style="min-height:120px;"></textarea>');
  parts.push('<button class="primary" style="background:#00c853; margin-top:10px;" id="parseBtn">Extract & Fill Data</button>');
  parts.push('<div id="pm" class="msg" style="margin-top:10px;"></div>');
  parts.push('</div>');

  parts.push('<div class="card">');
  parts.push('<h2 id="ft">Add / Edit Movie</h2>');
  parts.push('<input type="hidden" id="eid">');
  parts.push('<label>Title</label>');
  parts.push('<input type="text" id="title">');
  parts.push('<label>Video URL / Embed</label>');
  parts.push('<textarea id="vurl"></textarea>');
  parts.push('<label>Thumbnail URL (optional)</label>');
  parts.push('<input type="text" id="thumb">');
  parts.push('<input type="hidden" id="videoIdField">');
  parts.push('<button class="primary" id="sb">Add Movie</button>');
  parts.push('<button class="primary hidden" style="background:#333" id="cb" type="button">Cancel</button>');
  parts.push('<div id="am" class="msg"></div>');
  parts.push('</div>');

  parts.push('<div class="card"><h2>All Movies</h2><div id="list"></div></div>');
  parts.push('</div>');

  parts.push('<div id="tad" class="hidden">');
  parts.push('<div class="card">');
  parts.push('<h2>Adsterra Ad Code</h2>');
  parts.push('<p class="hint">Paste your ad code. It will be placed automatically on the Home and Watch pages.</p>');
  parts.push('<label>Ad Code</label>');
  parts.push('<textarea id="ads" style="min-height:200px"></textarea>');
  parts.push('<button class="primary" id="adsSaveBtn">Save</button>');
  parts.push('<div id="adm" class="msg"></div>');
  parts.push('</div>');
  parts.push('</div>');

  parts.push('<div id="til" class="hidden">');
  parts.push('<div class="card">');
  parts.push('<h2>Interval Link (5-Second Popup)</h2>');
  parts.push('<p class="hint">This link will be shown for 5 seconds before the video plays. (e.g. https://...)</p>');
  parts.push('<label>Interval Link</label>');
  parts.push('<input type="text" id="intervalLinkInput" placeholder="https://your-site.com">');
  parts.push('<button class="primary" id="intervalLinkSaveBtn">Save</button>');
  parts.push('<div id="ilm" class="msg"></div>');
  parts.push('</div>');
  parts.push('</div>');

  parts.push('<button class="primary danger" id="logoutBtn">Logout</button>');
  parts.push('</div>');
  parts.push('</div>');
  parts.push('<script>');
  parts.push('var token=localStorage.getItem("admin_token")||"";');
  parts.push('function $(id){return document.getElementById(id)}');
  parts.push('window.addEventListener("DOMContentLoaded",function(){');
  parts.push(' $("loginBtn").onclick=doLogin;');
  parts.push(' $("sb").onclick=saveMovie;');
  parts.push(' $("cb").onclick=reset;');
  parts.push(' $("logoutBtn").onclick=logout;');
  parts.push(' $("adsSaveBtn").onclick=saveAds;');
  parts.push(' $("intervalLinkSaveBtn").onclick=saveIntervalLink;');
  parts.push(' $("scrapeBtn").onclick=autoFetchWithPreview;');
  parts.push(' $("openLiveBtn").onclick=openLivePage;');
  parts.push(' $("parseBtn").onclick=parseSourceCode;');
  parts.push(' document.querySelectorAll("[data-tab]").forEach(function(b){');
  parts.push(' b.onclick=function(){tab(b.getAttribute("data-tab"))};');
  parts.push(' });');
  parts.push(' if(token)verify().then(function(ok){if(ok)show()});');
  parts.push('});');
  parts.push('async function verify(){ try{ var r=await fetch("/api/check-auth",{headers:{"X-Admin-Password":token}}); return r.ok; }catch(e){return false} }');
  parts.push('async function doLogin(){ var pwd=$("pwd").value; var m=$("lm"); try{ var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})}); var d=await r.json(); if(r.ok){token=d.token;localStorage.setItem("admin_token",token);show()} else{m.textContent=d.error||"Failed";m.className="msg err show"} }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"} }');
  parts.push('function show(){ $("login").classList.add("hidden"); $("content").classList.remove("hidden"); loadList();loadAds();loadIntervalLink(); }');
  parts.push('function tab(n){ $("tm").classList.add("hidden"); $("tad").classList.add("hidden"); $("til").classList.add("hidden"); $("t1").classList.remove("active"); $("t2").classList.remove("active"); $("t3").classList.remove("active"); if(n==="m"){$("tm").classList.remove("hidden");$("t1").classList.add("active")} if(n==="ad"){$("tad").classList.remove("hidden");$("t2").classList.add("active")} if(n==="il"){$("til").classList.remove("hidden");$("t3").classList.add("active")} }');
  parts.push('function logout(){localStorage.removeItem("admin_token");location.reload()}');
  parts.push('function reset(){ $("eid").value=""; $("title").value=""; $("vurl").value=""; $("thumb").value=""; $("videoIdField").value=""; $("ft").textContent="Add / Edit Movie"; $("sb").textContent="Add Movie"; $("cb").classList.add("hidden"); }');
  parts.push('function closePreview(){ $("livePreview").style.display="none"; $("previewFrame").src=""; }');
  parts.push('function openLivePage(){ var url=$("scrapeUrl").value.trim(); var m=$("sm"); if(!url){m.textContent="URL required";m.className="msg err show";return} window.open(url, "_blank"); }');
  parts.push('async function autoFetchWithPreview(){ var url=$("scrapeUrl").value.trim(); var m=$("sm"); var previewBox = $("livePreview"); var frame = $("previewFrame"); if(!url){m.textContent="URL required";m.className="msg err show";return} previewBox.style.display="block"; frame.src = url; m.textContent="Extracting data in background...";m.className="msg show";m.style.color="#fff"; try{ var r=await fetch("/api/fetch-source",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url})}); var d=await r.json(); if(r.ok && d.success){ fillForm(d.data); m.textContent="Data fetched successfully!";m.className="msg ok show"; m.style.color="#b6ffb6"; }else{ m.textContent=d.error || "Failed to fetch data. Please use Smart Paste.";m.className="msg err show"; m.style.color="#ffb6b6"; } }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"} }');
  parts.push('function parseSourceCode(){ var text = $("sourceCode").value; var m = $("pm"); if(!text){m.textContent="Please paste source code";m.className="msg err show";return} var getMatch = function(key) { var regex = new RegExp(key + "\\\\s*:\\\\s*[\'\\"]([^\'\\"]+)[\'\\"]", "i"); var match = text.match(regex); if (match) return match[1]; regex = new RegExp(\'"\' + key + \'"\\\\s*:\\\\s*"([^"]+)"\', "i"); match = text.match(regex); return match ? match[1] : ""; }; var title = getMatch(\'video_title\'); var vid = getMatch(\'video_id\'); var img = getMatch(\'preview_url\') || getMatch(\'preview_url1\'); var vurl = getMatch(\'video_alt_url\') || getMatch(\'video_url\'); if(vurl){ fillForm({title: title, id: vid, thumbnail: img, videoUrl: vurl}); m.textContent="Data extracted and filled successfully!";m.className="msg ok show"; m.style.color="#b6ffb6"; } else { m.textContent="Could not find video link in the pasted code.";m.className="msg err show"; m.style.color="#ffb6b6"; } }');
  parts.push('function fillForm(data){ $("title").value = data.title || ""; $("vurl").value = data.videoUrl || ""; $("thumb").value = data.thumbnail || ""; $("videoIdField").value = data.id || ""; }');
  parts.push('async function saveMovie(){ var eid=$("eid").value; var title=$("title").value.trim(); var vurl=$("vurl").value.trim(); var thumb=$("thumb").value.trim(); var vid=$("videoIdField").value.trim(); var m=$("am"); if(!title||!vurl){m.textContent="Title and URL required";m.className="msg err show";return} var u=eid?"/api/movies/update":"/api/movies"; var p={title:title,videoUrl:vurl,thumbnail:thumb}; if(eid)p.id=eid; if(!eid && vid) p.videoId = vid; try{ var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify(p)}); var d=await r.json(); if(r.ok){ m.textContent=eid?"Updated":"Added"; m.className="msg ok show"; reset();loadList(); setTimeout(function(){m.classList.remove("show")},2500); }else{m.textContent=d.error||"Failed";m.className="msg err show"} }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"} }');
  parts.push('function fmtViews(n){ n = parseInt(n)||0; if(n>=1000000) return (n/1000000).toFixed(1)+"M"; if(n>=1000) return (n/1000).toFixed(1)+"K"; return n.toString(); }');
  parts.push('function getLinkStatus(){ try{return JSON.parse(localStorage.getItem("link_status")||"{}");}catch(e){return {};} }');
  parts.push('function setLinkStatus(id, status){ var s=getLinkStatus();s[id]=status; localStorage.setItem("link_status",JSON.stringify(s)); }');
  parts.push('function getStatusBadge(id){ var s=getLinkStatus(); var st=s[id]; if(st==="ok") return \'<span style="background:#00c853;color:#000;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px">✓ OK</span>\'; if(st==="fail") return \'<span style="background:#c00;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px">✗ FAIL</span>\'; return \'\'; }');
  parts.push('async function testLink(m, itemEl){ var h4 = itemEl.querySelector("h4"); if(!h4)return; var oldSpans = h4.querySelectorAll("span"); oldSpans.forEach(function(s){s.remove();}); h4.insertAdjacentHTML("beforeend", \'<span style="background:#ff9800;color:#000;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px">⏳</span>\'); var ok = false; try{ var r = await fetch("/api/check-link?url="+encodeURIComponent(m.videoUrl)); var d = await r.json(); ok = d.ok === true; }catch(e){ok = false;} setLinkStatus(m.id, ok?"ok":"fail"); var oldSpans2 = h4.querySelectorAll("span"); oldSpans2.forEach(function(s){s.remove();}); h4.insertAdjacentHTML("beforeend", getStatusBadge(m.id)); }');
  parts.push('async function checkAllLinks(all, btn){ btn.disabled = true; var okCount = 0, failCount = 0; for(var i=0; i<all.length; i++){ var m = all[i]; btn.textContent = "⏳ " + (i+1) + "/" + all.length; var ok = false; try{ var r = await fetch("/api/check-link?url="+encodeURIComponent(m.videoUrl)); var d = await r.json(); ok = d.ok === true; }catch(e){ok = false;} setLinkStatus(m.id, ok?"ok":"fail"); if(ok) okCount++; else failCount++; } btn.disabled = false; btn.textContent = "🔍 Check All (✓" + okCount + " ✗" + failCount + ")"; loadList(); }');
  parts.push('async function loadList(){ var p=1,all=[]; while(true){ var r=await fetch("/api/movies?page="+p+"&noshuffle=1"); var d=await r.json(); all=all.concat(d.items); if(p>=d.totalPages)break; p++; } var el=$("list"); if(!all.length){el.innerHTML=\'<p style="color:#666">No movies</p>\';return} el.innerHTML=""; var hdr=document.createElement("div"); hdr.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px"; hdr.innerHTML=\'<div style="font-size:14px;color:#888">Total: \'+all.length+\' videos</div>\'; var chkBtn=document.createElement("button"); chkBtn.className="primary small"; chkBtn.style.background="#2196F3"; chkBtn.style.marginTop="0"; chkBtn.textContent="🔍 Check All Links"; chkBtn.onclick=function(){ checkAllLinks(all, chkBtn); }; hdr.appendChild(chkBtn); el.appendChild(hdr); all.forEach(function(m){ var s=m.thumbnail?("background-image:url(\'" + m.thumbnail + "\')"):""; var d=document.createElement("div"); d.className="item"; var statusBadge = getStatusBadge(m.id); d.innerHTML=\'<div class="info"><div class="mini" style="\'+s+\'"></div><div><h4>\'+esc(m.title)+\' \'+statusBadge+\'</h4><div class="stats">👁 \'+fmtViews(m.views||0)+\' views</div></div></div>\'; var acts=document.createElement("div"); acts.className="acts"; var chk=document.createElement("button"); chk.className="primary small"; chk.style.background="#2196F3"; chk.style.marginTop="0"; chk.textContent="Test"; chk.onclick=function(){ testLink(m, d); }; var eb=document.createElement("button"); eb.className="primary small"; eb.style.marginTop="0"; eb.textContent="Edit"; eb.onclick=function(){editMovie(m.id)}; var db=document.createElement("button"); db.className="primary small danger"; db.style.marginTop="0"; db.textContent="Delete"; db.onclick=function(){delMovie(m.id)}; acts.appendChild(chk); acts.appendChild(eb); acts.appendChild(db); d.appendChild(acts); el.appendChild(d); }); }');
  parts.push('async function editMovie(id){ var p=1,all=[]; while(true){ var r=await fetch("/api/movies?page="+p+"&noshuffle=1"); var d=await r.json(); all=all.concat(d.items); if(p>=d.totalPages)break; p++; } var m=all.find(function(x){return x.id===id}); if(!m)return; $("eid").value=m.id; $("title").value=m.title; $("vurl").value=m.videoUrl; $("thumb").value=m.thumbnail||""; $("videoIdField").value=""; $("ft").textContent="Edit Movie"; $("sb").textContent="Update"; $("cb").classList.remove("hidden"); window.scrollTo({top:0,behavior:"smooth"}); }');
  parts.push('async function delMovie(id){ if(!confirm("Delete?"))return; var r=await fetch("/api/movies/"+id,{method:"DELETE",headers:{"X-Admin-Password":token}}); if(r.ok)loadList(); }');
  parts.push('async function loadAds(){ var r=await fetch("/api/ads"); var d=await r.json(); $("ads").value=d.code||""; }');
  parts.push('async function saveAds(){ var code=$("ads").value; var m=$("adm"); var r=await fetch("/api/ads",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({code:code})}); if(r.ok){m.textContent="Saved";m.className="msg ok show"} else{m.textContent="Failed";m.className="msg err show"} setTimeout(function(){m.classList.remove("show")},2500); }');
  parts.push('async function loadIntervalLink(){ var r=await fetch("/api/interval-link"); var d=await r.json(); $("intervalLinkInput").value=d.url||""; }');
  parts.push('async function saveIntervalLink(){ var url=$("intervalLinkInput").value.trim(); var m=$("ilm"); var r=await fetch("/api/interval-link",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({url:url})}); if(r.ok){m.textContent="Saved";m.className="msg ok show"} else{m.textContent="Failed";m.className="msg err show"} setTimeout(function(){m.classList.remove("show")},2500); }');
  parts.push('function esc(s){ return String(s).replace(/[&<>]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }');
  parts.push('<\/script>');
  parts.push('</body></html>');
  return parts.join("\n");
}
