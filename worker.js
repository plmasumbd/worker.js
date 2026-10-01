// ==========================================
// CONFIG
// ==========================================
const ADMIN_PASSWORD = "admin123";
const PAGE_SIZE = 20;
const CATEGORIES = ["Movie", "Series", "Others"];

// ==========================================
// MAIN HANDLER
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/movies" && request.method === "GET")
      return await listMovies(env, url);
    if (path === "/api/movies" && request.method === "POST")
      return await addMovie(request, env);
    if (path === "/api/movies/update" && request.method === "POST")
      return await updateMovie(request, env);
    if (path.startsWith("/api/movies/") && request.method === "DELETE")
      return await deleteMovie(request, env, path);
    if (path === "/api/login" && request.method === "POST")
      return await login(request);
    if (path === "/api/check-auth" && request.method === "GET")
      return await checkAuth(request);
    if (path === "/api/ads" && request.method === "GET")
      return await getAds(env);
    if (path === "/api/ads" && request.method === "POST")
      return await saveAds(request, env);

    if (path === "/") return htmlPage(homePage());
    if (path === "/admin") return htmlPage(adminPage());
    if (path === "/watch") {
      const id = url.searchParams.get("id");
      return htmlPage(watchPage(id));
    }

    return new Response("404 Not Found", { status: 404 });
  },
};

// ==========================================
// EXTRACT SRC FROM HTML / URL
// ==========================================
function extractSrc(input) {
  if (!input) return "";
  let s = input.trim();

  const iframeMatch = s.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (iframeMatch) return iframeMatch[1];

  const videoSrcMatch = s.match(/<(?:video|source|embed)[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (videoSrcMatch) return videoSrcMatch[1];

  if (/^https?:\/\/\S+$/i.test(s)) return s;

  const screenpalMatch = s.match(/https?:\/\/go\.screenpal\.com\/player\/[^\s"'<>]+/i);
  if (screenpalMatch) return screenpalMatch[0];

  const cleaned = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const urlMatch = cleaned.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) return urlMatch[0];

  return s;
}

// ==========================================
// AUTO THUMBNAIL
// ==========================================
function getAutoThumb(url) {
  if (!url) return "";

  const spMatch = url.match(/screenpal\.com\/(?:player|embed)\/([a-zA-Z0-9]+)/);
  if (spMatch) {
    return "https://go.screenpal.com/player/" + spMatch[1] + "/thumbnail.jpg";
  }

  const ytMatch = url.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return "https://img.youtube.com/vi/" + ytMatch[1] + "/maxresdefault.jpg";
  }

  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) {
    return "https://vumbnail.com/" + vimeoMatch[1] + ".jpg";
  }

  const dmMatch = url.match(/dailymotion\.com\/(?:embed\/)?video\/([a-zA-Z0-9]+)/);
  if (dmMatch) {
    return "https://www.dailymotion.com/thumbnail/video/" + dmMatch[1];
  }

  return "";
}

// ==========================================
// API: List movies
// ==========================================
async function listMovies(env, url) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const category = url.searchParams.get("category") || "all";

  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];

  if (category !== "all") {
    list = list.filter(function(m) { return m.category === category; });
  }

  list.sort(function(a, b) { return b.createdAt - a.createdAt; });

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const items = list.slice(start, start + PAGE_SIZE);

  return jsonResponse({ items: items, page: page, totalPages: totalPages, total: total });
}

// ==========================================
// API: Add movie
// ==========================================
async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD)
    return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  let title = body.title;
  let videoUrl = body.videoUrl;
  let thumbnail = body.thumbnail;
  let category = body.category || "Movie";

  if (!title || !videoUrl)
    return jsonResponse({ error: "Title & Video URL required" }, 400);

  videoUrl = extractSrc(videoUrl);

  let finalThumb = thumbnail ? thumbnail.trim() : "";
  if (!finalThumb) finalThumb = getAutoThumb(videoUrl);

  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];

  const movie = {
    id: crypto.randomUUID(),
    title: title.trim(),
    videoUrl: videoUrl.trim(),
    thumbnail: finalThumb,
    category: category,
    createdAt: Date.now(),
  };

  list.push(movie);
  await env.MOVIES.put("movie_list", JSON.stringify(list));

  return jsonResponse({ success: true, movie: movie });
}

// ==========================================
// API: Update movie
// ==========================================
async function updateMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD)
    return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  const id = body.id;
  if (!id) return jsonResponse({ error: "ID required" }, 400);

  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];
  const idx = list.findIndex(function(m) { return m.id === id; });
  if (idx === -1) return jsonResponse({ error: "Not found" }, 404);

  if (body.title) list[idx].title = body.title.trim();
  if (body.videoUrl) {
    list[idx].videoUrl = extractSrc(body.videoUrl).trim();
    if (!body.thumbnail) {
      const autoThumb = getAutoThumb(list[idx].videoUrl);
      if (autoThumb) list[idx].thumbnail = autoThumb;
    }
  }
  if (body.thumbnail !== undefined && body.thumbnail !== "") {
    list[idx].thumbnail = body.thumbnail.trim();
  }
  if (body.category) list[idx].category = body.category;

  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return jsonResponse({ success: true, movie: list[idx] });
}

// ==========================================
// API: Delete movie
// ==========================================
async function deleteMovie(request, env, path) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD)
    return jsonResponse({ error: "Unauthorized" }, 401);

  const id = path.split("/").pop();
  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];
  list = list.filter(function(m) { return m.id !== id; });
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return jsonResponse({ success: true });
}

// ==========================================
// API: Auth
// ==========================================
async function login(request) {
  const body = await request.json();
  if (body.password === ADMIN_PASSWORD)
    return jsonResponse({ success: true, token: ADMIN_PASSWORD });
  return jsonResponse({ error: "Wrong password" }, 401);
}

async function checkAuth(request) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth === ADMIN_PASSWORD) return jsonResponse({ valid: true });
  return jsonResponse({ valid: false }, 401);
}

// ==========================================
// API: Ads
// ==========================================
async function getAds(env) {
  const raw = await env.MOVIES.get("ads_code");
  return jsonResponse({ code: raw || "" });
}

async function saveAds(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD)
    return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  await env.MOVIES.put("ads_code", body.code || "");
  return jsonResponse({ success: true });
}

// ==========================================
// HELPERS
// ==========================================
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function htmlPage(content) {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ==========================================
// HOME PAGE
// ==========================================
function homePage() {
  let html = "";
  html += '<!DOCTYPE html>';
  html += '<html lang="bn">';
  html += '<head>';
  html += '<meta charset="UTF-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<title>MovieHub</title>';
  html += '<style>';
  html += '* { margin:0; padding:0; box-sizing:border-box; }';
  html += 'body { font-family: system-ui, sans-serif; background:#0f0f0f; color:#eee; min-height:100vh; }';
  html += 'header { background:#1a1a1a; padding:18px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #ff0040; position:sticky; top:0; z-index:100; flex-wrap:wrap; gap:12px; }';
  html += 'header h1 { color:#ff0040; font-size:24px; }';
  html += '.cats { display:flex; gap:8px; flex-wrap:wrap; }';
  html += '.cat-btn { padding:8px 18px; background:#1c1c1c; color:#eee; border:1px solid #333; border-radius:20px; cursor:pointer; font-size:14px; font-weight:600; transition:0.2s; }';
  html += '.cat-btn:hover { border-color:#ff0040; }';
  html += '.cat-btn.active { background:#ff0040; border-color:#ff0040; }';
  html += '.container { max-width:1300px; margin:0 auto; padding:30px 20px; }';
  html += '.grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); }';
  html += '.card { background:#1c1c1c; border-radius:10px; overflow:hidden; cursor:pointer; transition:0.3s; text-decoration:none; color:#eee; display:block; }';
  html += '.card:hover { transform:translateY(-5px); box-shadow:0 10px 25px rgba(255,0,64,0.3); }';
  html += '.card .thumb { width:100%; aspect-ratio:16/9; background:#333; display:flex; align-items:center; justify-content:center; font-size:40px; color:#666; background-size:cover; background-position:center; position:relative; }';
  html += '.card .play-icon { position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:50px; height:50px; background:rgba(255,0,64,0.9); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; color:#fff; transition:0.3s; }';
  html += '.card:hover .play-icon { transform:translate(-50%, -50%) scale(1.15); }';
  html += '.card .cat-tag { position:absolute; top:8px; left:8px; background:#ff0040; color:#fff; padding:3px 10px; border-radius:4px; font-size:10px; font-weight:700; text-transform:uppercase; }';
  html += '.card .info { padding:12px; }';
  html += '.card .info h3 { font-size:15px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }';
  html += '.pagination { display:flex; justify-content:center; gap:8px; margin-top:40px; flex-wrap:wrap; }';
  html += '.pagination button { padding:10px 16px; background:#1c1c1c; color:#eee; border:1px solid #333; border-radius:6px; cursor:pointer; font-size:14px; }';
  html += '.pagination button:hover:not(:disabled) { background:#ff0040; border-color:#ff0040; }';
  html += '.pagination button.active { background:#ff0040; border-color:#ff0040; }';
  html += '.pagination button:disabled { opacity:0.3; cursor:not-allowed; }';
  html += '.empty { text-align:center; padding:60px 20px; color:#666; font-size:18px; }';
  html += '.ad-box { margin:20px 0; text-align:center; overflow:hidden; }';
  html += '</style>';
  html += '</head>';
  html += '<body>';
  html += '<header>';
  html += '<h1>MovieHub</h1>';
  html += '<div class="cats">';
  html += '<button class="cat-btn active" data-cat="all" onclick="setCat(this,\\'all\\')">All</button>';
  html += '<button class="cat-btn" data-cat="Movie" onclick="setCat(this,\\'Movie\\')">Movie</button>';
  html += '<button class="cat-btn" data-cat="Series" onclick="setCat(this,\\'Series\\')">Series</button>';
  html += '<button class="cat-btn" data-cat="Others" onclick="setCat(this,\\'Others\\')">Others</button>';
  html += '</div>';
  html += '</header>';
  html += '<div class="container">';
  html += '<div class="ad-box" id="adTop"></div>';
  html += '<div id="movies" class="grid"></div>';
  html += '<div id="pagination" class="pagination"></div>';
  html += '<div class="ad-box" id="adBottom"></div>';
  html += '</div>';
  html += '<script>';
  html += 'let currentCat = "all";';
  html += 'let currentPage = 1;';
  html += 'function setCat(el, cat) {';
  html += '  currentCat = cat; currentPage = 1;';
  html += '  document.querySelectorAll(".cat-btn").forEach(function(b) { b.classList.remove("active"); });';
  html += '  el.classList.add("active");';
  html += '  loadMovies(1);';
  html += '}';
  html += 'async function loadAds() {';
  html += '  try {';
  html += '    const r = await fetch("/api/ads");';
  html += '    const d = await r.json();';
  html += '    if (d.code && d.code.trim()) {';
  html += '      document.getElementById("adTop").innerHTML = d.code;';
  html += '      document.getElementById("adBottom").innerHTML = d.code;';
  html += '    }';
  html += '  } catch(e) {}';
  html += '}';
  html += 'async function loadMovies(page) {';
  html += '  currentPage = page;';
  html += '  const res = await fetch("/api/movies?page=" + page + "&category=" + encodeURIComponent(currentCat));';
  html += '  const data = await res.json();';
  html += '  const grid = document.getElementById("movies");';
  html += '  grid.innerHTML = "";';
  html += '  if (!data.items.length) {';
  html += '    grid.innerHTML = "<div class=\\"empty\\">এই category তে কোনো ভিডিও নেই</div>";';
  html += '    document.getElementById("pagination").innerHTML = "";';
  html += '    return;';
  html += '  }';
  html += '  data.items.forEach(function(m) {';
  html += '    const a = document.createElement("a");';
  html += '    a.className = "card";';
  html += '    a.href = "/watch?id=" + m.id;';
  html += '    const thumbStyle = m.thumbnail ? "background-image:url(" + JSON.stringify(m.thumbnail) + ")" : "";';
  html += '    a.innerHTML = "<div class=\\"thumb\\" style=\\"" + thumbStyle + "\\">" +';
  html += '      (m.category ? "<div class=\\"cat-tag\\">" + m.category + "</div>" : "") +';
  html += '      "<div class=\\"play-icon\\">▶</div>" +';
  html += '      "</div><div class=\\"info\\"><h3>" + escapeHtml(m.title) + "</h3></div>";';
  html += '    grid.appendChild(a);';
  html += '  });';
  html += '  renderPagination(data.page, data.totalPages);';
  html += '}';
  html += 'function renderPagination(current, total) {';
  html += '  const el = document.getElementById("pagination");';
  html += '  el.innerHTML = "";';
  html += '  if (total <= 1) return;';
  html += '  const prev = document.createElement("button");';
  html += '  prev.textContent = "« Prev";';
  html += '  prev.disabled = current === 1;';
  html += '  prev.onclick = function() { loadMovies(current - 1); };';
  html += '  el.appendChild(prev);';
  html += '  let start = Math.max(1, current - 2);';
  html += '  let end = Math.min(total, start + 4);';
  html += '  if (end - start < 4) start = Math.max(1, end - 4);';
  html += '  for (let i = start; i <= end; i++) {';
  html += '    const btn = document.createElement("button");';
  html += '    btn.textContent = i;';
  html += '    if (i === current) btn.classList.add("active");';
  html += '    btn.onclick = (function(p) { return function() { loadMovies(p); }; })(i);';
  html += '    el.appendChild(btn);';
  html += '  }';
  html += '  const next = document.createElement("button");';
  html += '  next.textContent = "Next »";';
  html += '  next.disabled = current === total;';
  html += '  next.onclick = function() { loadMovies(current + 1); };';
  html += '  el.appendChild(next);';
  html += '}';
  html += 'function escapeHtml(s) {';
  html += '  return String(s).replace(/[&<>"\\x27]/g, function(c) { return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\\x27":"&#39;"}[c]; });';
  html += '}';
  html += 'loadAds();';
  html += 'loadMovies(1);';
  html += '<\\/script>';
  html += '</body>';
  html += '</html>';
  return html;
}

// ==========================================
// WATCH PAGE
// ==========================================
function watchPage(id) {
  let html = "";
  html += '<!DOCTYPE html>';
  html += '<html lang="bn">';
  html += '<head>';
  html += '<meta charset="UTF-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<title>Watch - MovieHub</title>';
  html += '<style>';
  html += '* { margin:0; padding:0; box-sizing:border-box; }';
  html += 'body { font-family: system-ui, sans-serif; background:#0f0f0f; color:#eee; }';
  html += 'header { background:#1a1a1a; padding:16px 24px; border-bottom:2px solid #ff0040; display:flex; justify-content:space-between; align-items:center; }';
  html += 'header h1 { color:#ff0040; font-size:22px; }';
  html += 'header a { color:#eee; text-decoration:none; padding:8px 14px; background:#ff0040; border-radius:6px; font-size:14px; }';
  html += '.wrap { max-width:1000px; margin:30px auto; padding:0 20px; }';
  html += '.player-box { position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; overflow:hidden; }';
  html += '.player-box video, .player-box iframe { width:100%; height:100%; border:0; display:block; }';
  html += '.title { margin-top:20px; font-size:22px; font-weight:700; }';
  html += '.info { color:#888; margin-top:8px; font-size:14px; }';
  html += '.ad-box { margin:20px 0; text-align:center; overflow:hidden; }';
  html += '</style>';
  html += '</head>';
  html += '<body>';
  html += '<header>';
  html += '<h1>MovieHub</h1>';
  html += '<a href="/">← Home</a>';
  html += '</header>';
  html += '<div class="wrap">';
  html += '<div class="player-box" id="playerBox"></div>';
  html += '<div class="title" id="title">Loading...</div>';
  html += '<div class="info" id="info"></div>';
  html += '<div class="ad-box" id="adWatch"></div>';
  html += '</div>';
  html += '<script>';
  html += 'const id = new URLSearchParams(location.search).get("id");';
  html += 'const playerBox = document.getElementById("playerBox");';
  html += 'const titleEl = document.getElementById("title");';
  html += 'const infoEl = document.getElementById("info");';
  html += 'async function load() {';
  html += '  const r = await fetch("/api/movies?page=1&category=all");';
  html += '  let page = 1, all = [];';
  html += '  while (true) {';
  html += '    const rr = await fetch("/api/movies?page=" + page + "&category=all");';
  html += '    const dd = await rr.json();';
  html += '    all = all.concat(dd.items);';
  html += '    if (page >= dd.totalPages) break;';
  html += '    page++;';
  html += '  }';
  html += '  const movieData = all.find(function(m) { return m.id === id; });';
  html += '  if (!movieData) { titleEl.textContent = "Video not found"; return; }';
  html += '  titleEl.textContent = movieData.title;';
  html += '  infoEl.textContent = "Category: " + (movieData.category || "Movie");';
  html += '  const isDirectVideo = /\\.(mp4|webm|ogg|m3u8)(\\?|$)/i.test(movieData.videoUrl);';
  html += '  if (isDirectVideo) {';
  html += '    const video = document.createElement("video");';
  html += '    video.src = movieData.videoUrl;';
  html += '    video.controls = true;';
  html += '    video.autoplay = true;';
  html += '    video.playsInline = true;';
  html += '    playerBox.appendChild(video);';
  html += '  } else {';
  html += '    const iframe = document.createElement("iframe");';
  html += '    iframe.src = movieData.videoUrl;';
  html += '    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";';
  html += '    iframe.allowFullscreen = true;';
  html += '    iframe.referrerPolicy = "no-referrer";';
  html += '    playerBox.appendChild(iframe);';
  html += '  }';
  html += '  try {';
  html += '    const ar = await fetch("/api/ads");';
  html += '    const ad = await ar.json();';
  html += '    if (ad.code && ad.code.trim()) document.getElementById("adWatch").innerHTML = ad.code;';
  html += '  } catch(e) {}';
  html += '}';
  html += 'load();';
  html += '<\\/script>';
  html += '</body>';
  html += '</html>';
  return html;
}

// ==========================================
// ADMIN PAGE
// ==========================================
function adminPage() {
  let html = "";
  html += '<!DOCTYPE html>';
  html += '<html lang="bn">';
  html += '<head>';
  html += '<meta charset="UTF-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<title>Admin Panel</title>';
  html += '<style>';
  html += '* { margin:0; padding:0; box-sizing:border-box; }';
  html += 'body { font-family: system-ui, sans-serif; background:#0f0f0f; color:#eee; min-height:100vh; }';
  html += 'header { background:#1a1a1a; padding:16px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #ff0040; }';
  html += 'header h1 { color:#ff0040; font-size:22px; }';
  html += 'header a { color:#eee; text-decoration:none; padding:8px 14px; background:#333; border-radius:6px; font-size:14px; }';
  html += '.wrap { max-width:900px; margin:30px auto; padding:0 20px; }';
  html += '.card { background:#1c1c1c; border-radius:12px; padding:24px; margin-bottom:20px; }';
  html += '.card h2 { color:#ff0040; margin-bottom:16px; font-size:18px; }';
  html += 'label { display:block; margin-top:12px; font-size:14px; color:#aaa; }';
  html += 'input, select, textarea { width:100%; padding:12px; margin-top:6px; background:#111; border:1px solid #333; border-radius:6px; color:#eee; font-size:15px; font-family:inherit; }';
  html += 'textarea { resize:vertical; min-height:90px; font-family:monospace; font-size:13px; }';
  html += 'input:focus, select:focus, textarea:focus { outline:none; border-color:#ff0040; }';
  html += 'button.primary { background:#ff0040; color:#fff; border:none; padding:12px 24px; border-radius:6px; cursor:pointer; font-weight:600; margin-top:20px; font-size:15px; }';
  html += 'button.primary:hover { opacity:0.9; }';
  html += 'button.danger { background:#c00; }';
  html += 'button.small { padding:6px 12px; font-size:12px; margin:0; }';
  html += '.movie-item { display:flex; justify-content:space-between; align-items:center; padding:12px; background:#111; border-radius:6px; margin-bottom:8px; gap:12px; flex-wrap:wrap; }';
  html += '.movie-item .info { flex:1; min-width:200px; display:flex; gap:12px; align-items:center; }';
  html += '.movie-item .thumb-mini { width:70px; height:44px; border-radius:4px; flex-shrink:0; background:#333 center/cover no-repeat; }';
  html += '.movie-item .info h4 { font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }';
  html += '.movie-item .info .cat-label { font-size:11px; color:#ff0040; font-weight:600; }';
  html += '.actions { display:flex; gap:6px; }';
  html += '.msg { padding:10px; border-radius:6px; margin-top:12px; display:none; }';
  html += '.msg.show { display:block; }';
  html += '.msg.ok { background:#164d2c; color:#b6ffb6; }';
  html += '.msg.err { background:#4d1616; color:#ffb6b6; }';
  html += '.hidden { display:none; }';
  html += '#loginCard { max-width:400px; margin:100px auto; }';
  html += '.hint { font-size:12px; color:#666; margin-top:4px; }';
  html += '.tabs { display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap; }';
  html += '.tabs button { padding:10px 20px; background:#1c1c1c; color:#eee; border:1px solid #333; border-radius:6px; cursor:pointer; font-size:14px; font-weight:600; }';
  html += '.tabs button.active { background:#ff0040; border-color:#ff0040; }';
  html += '</style>';
  html += '</head>';
  html += '<body>';
  html += '<header>';
  html += '<h1>Admin Panel</h1>';
  html += '<a href="/">Home</a>';
  html += '</header>';
  html += '<div class="wrap">';

  html += '<div id="loginCard" class="card">';
  html += '<h2>Admin Login</h2>';
  html += '<label>Password</label>';
  html += '<input type="password" id="pwd" placeholder="Enter admin password">';
  html += '<button class="primary" onclick="doLogin()">Login</button>';
  html += '<div id="loginMsg" class="msg"></div>';
  html += '</div>';

  html += '<div id="adminContent" class="hidden">';

  html += '<div class="tabs">';
  html += '<button id="tabMovies" class="active" onclick="showTab(\\'movies\\')">Movies</button>';
  html += '<button id="tabAds" onclick="showTab(\\'ads\\')">Adsterra Ads</button>';
  html += '</div>';

  html += '<div id="tab-movies">';

  html += '<div class="card">';
  html += '<h2 id="formTitle">Add New Movie</h2>';
  html += '<input type="hidden" id="editId">';
  html += '<label>Movie Title</label>';
  html += '<input type="text" id="title" placeholder="Enter movie name">';
  html += '<label>Category</label>';
  html += '<select id="category">';
  html += '<option value="Movie">Movie</option>';
  html += '<option value="Series">Series</option>';
  html += '<option value="Others">Others</option>';
  html += '</select>';
  html += '<label>Video URL / Embed Code</label>';
  html += '<textarea id="videoUrl" placeholder="Direct mp4 link OR ScreenPal embed code"></textarea>';
  html += '<p class="hint">Direct video link অথবা ScreenPal embed code — দুটোই কাজ করবে</p>';
  html += '<label>Thumbnail URL (optional)</label>';
  html += '<input type="text" id="thumbnail" placeholder="খালি রাখলে auto video থেকে নেবে">';
  html += '<button class="primary" id="submitBtn" onclick="submitMovie()">Add Movie</button>';
  html += '<button class="primary" style="background:#333" onclick="resetForm()" id="cancelBtn" type="button">Cancel</button>';
  html += '<div id="addMsg" class="msg"></div>';
  html += '</div>';

  html += '<div class="card">';
  html += '<h2>All Movies</h2>';
  html += '<div id="movieList"></div>';
  html += '</div>';

  html += '</div>';

  html += '<div id="tab-ads" class="hidden">';
  html += '<div class="card">';
  html += '<h2>Adsterra Ad Code</h2>';
  html += '<p class="hint" style="margin-bottom:12px">এখানে Adsterra এর ad code paste করো। এটা Home page এর উপরে-নিচে এবং Watch page এ auto বসবে।</p>';
  html += '<label>Ad Code (HTML / JavaScript)</label>';
  html += '<textarea id="adsCode" placeholder="<script>...adsterra code...</script>" style="min-height:200px"></textarea>';
  html += '<button class="primary" onclick="saveAds()">Save Ad Code</button>';
  html += '<div id="adsMsg" class="msg"></div>';
  html += '</div>';
  html += '</div>';

  html += '<button class="primary danger" onclick="logout()">Logout</button>';
  html += '</div>';
  html += '</div>';

  html += '<script>';
  html += 'let token = localStorage.getItem("admin_token") || "";';
  html += 'window.addEventListener("DOMContentLoaded", function() {';
  html += '  if (token) verifyToken().then(function(ok) { if (ok) showAdmin(); });';
  html += '});';
  html += 'async function verifyToken() {';
  html += '  const r = await fetch("/api/check-auth", { headers: { "X-Admin-Password": token } });';
  html += '  return r.ok;';
  html += '}';
  html += 'async function doLogin() {';
  html += '  const pwd = document.getElementById("pwd").value;';
  html += '  const r = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ password: pwd }) });';
  html += '  const d = await r.json();';
  html += '  const msg = document.getElementById("loginMsg");';
  html += '  if (r.ok) { token = d.token; localStorage.setItem("admin_token", token); showAdmin(); }';
  html += '  else { msg.textContent = d.error || "Login failed"; msg.className = "msg err show"; }';
  html += '}';
  html += 'function showAdmin() {';
  html += '  document.getElementById("loginCard").classList.add("hidden");';
  html += '  document.getElementById("adminContent").classList.remove("hidden");';
  html += '  loadList(); loadAdsCode();';
  html += '}';
  html += 'function showTab(name) {';
  html += '  document.getElementById("tab-movies").classList.add("hidden");';
  html += '  document.getElementById("tab-ads").classList.add("hidden");';
  html += '  document.getElementById("tabMovies").classList.remove("active");';
  html += '  document.getElementById("tabAds").classList.remove("active");';
  html += '  document.getElementById("tab-" + name).classList.remove("hidden");';
  html += '  if (name === "movies") document.getElementById("tabMovies").classList.add("active");';
  html += '  if (name === "ads") document.getElementById("tabAds").classList.add("active");';
  html += '}';
  html += 'function logout() { localStorage.removeItem("admin_token"); location.reload(); }';
  html += 'function resetForm() {';
  html += '  document.getElementById("editId").value = "";';
  html += '  document.getElementById("title").value = "";';
  html += '  document.getElementById("videoUrl").value = "";';
  html += '  document.getElementById("thumbnail").value = "";';
  html += '  document.getElementById("category").value = "Movie";';
  html += '  document.getElementById("formTitle").textContent = "Add New Movie";';
  html += '  document.getElementById("submitBtn").textContent = "Add Movie";';
  html += '  document.getElementById("cancelBtn").classList.add("hidden");';
  html += '}';
  html += 'async function submitMovie() {';
  html += '  const editId = document.getElementById("editId").value;';
  html += '  const title = document.getElementById("title").value.trim();';
  html += '  const videoUrl = document.getElementById("videoUrl").value.trim();';
  html += '  const thumbnail = document.getElementById("thumbnail").value.trim();';
  html += '  const category = document.getElementById("category").value;';
  html += '  const msg = document.getElementById("addMsg");';
  html += '  if (!title || !videoUrl) { msg.textContent = "Title & Video URL required"; msg.className = "msg err show"; return; }';
  html += '  const url = editId ? "/api/movies/update" : "/api/movies";';
  html += '  const payload = { title: title, videoUrl: videoUrl, thumbnail: thumbnail, category: category };';
  html += '  if (editId) payload.id = editId;';
  html += '  const r = await fetch(url, { method:"POST", headers: { "Content-Type":"application/json", "X-Admin-Password": token }, body: JSON.stringify(payload) });';
  html += '  const d = await r.json();';
  html += '  if (r.ok) {';
  html += '    msg.textContent = editId ? "Movie updated!" : "Movie added!";';
  html += '    msg.className = "msg ok show";';
  html += '    resetForm(); loadList();';
  html += '    setTimeout(function() { msg.classList.remove("show"); }, 2500);';
  html += '  } else { msg.textContent = d.error || "Failed"; msg.className = "msg err show"; }';
  html += '}';
  html += 'async function loadList() {';
  html += '  let page = 1, all = [];';
  html += '  while (true) {';
  html += '    const r = await fetch("/api/movies?page=" + page + "&category=all");';
  html += '    const d = await r.json();';
  html += '    all = all.concat(d.items);';
  html += '    if (page >= d.totalPages) break;';
  html += '    page++;';
  html += '  }';
  html += '  const el = document.getElementById("movieList");';
  html += '  if (!all.length) { el.innerHTML = "<p style=\\"color:#666\\">No movies</p>"; return; }';
  html += '  el.innerHTML = all.map(function(m) {';
  html += '    const thumbStyle = m.thumbnail ? "background-image:url(" + JSON.stringify(m.thumbnail) + ")" : "";';
  html += '    return "<div class=\\"movie-item\\">" +';
  html += '      "<div class=\\"info\\">" +';
  html += '      "<div class=\\"thumb-mini\\" style=\\"" + thumbStyle + "\\"></div>" +';
  html += '      "<div><h4>" + escapeHtml(m.title) + "</h4><span class=\\"cat-label\\">" + (m.category || "Movie") + "</span></div>" +';
  html += '      "</div>" +';
  html += '      "<div class=\\"actions\\">" +';
  html += '      "<button class=\\"primary small\\" onclick=\\"editMovie(\\x27" + m.id + "\\x27)\\">Edit</button>" +';
  html += '      "<button class=\\"primary small danger\\" onclick=\\"delMovie(\\x27" + m.id + "\\x27)\\">Delete</button>" +';
  html += '      "</div></div>";';
  html += '  }).join("");';
  html += '}';
  html += 'async function editMovie(id) {';
  html += '  let page = 1, all = [];';
  html += '  while (true) {';
  html += '    const r = await fetch("/api/movies?page=" + page + "&category=all");';
  html += '    const d = await r.json();';
  html += '    all = all.concat(d.items);';
  html += '    if (page >= d.totalPages) break;';
  html += '    page++;';
  html += '  }';
  html += '  const m = all.find(function(x) { return x.id === id; });';
  html += '  if (!m) return;';
  html += '  document.getElementById("editId").value = m.id;';
  html += '  document.getElementById("title").value = m.title;';
  html += '  document.getElementById("videoUrl").value = m.videoUrl;';
  html += '  document.getElementById("thumbnail").value = m.thumbnail || "";';
  html += '  document.getElementById("category").value = m.category || "Movie";';
  html += '  document.getElementById("formTitle").textContent = "Edit Movie";';
  html += '  document.getElementById("submitBtn").textContent = "Update Movie";';
  html += '  document.getElementById("cancelBtn").classList.remove("hidden");';
  html += '  window.scrollTo({ top: 0, behavior: "smooth" });';
  html += '}';
  html += 'async function delMovie(id) {';
  html += '  if (!confirm("Delete this movie?")) return;';
  html += '  const r = await fetch("/api/movies/" + id, { method: "DELETE", headers: { "X-Admin-Password": token } });';
  html += '  if (r.ok) loadList(); else alert("Delete failed");';
  html += '}';
  html += 'async function loadAdsCode() {';
  html += '  const r = await fetch("/api/ads");';
  html += '  const d = await r.json();';
  html += '  document.getElementById("adsCode").value = d.code || "";';
  html += '}';
  html += 'async function saveAds() {';
  html += '  const code = document.getElementById("adsCode").value;';
  html += '  const msg = document.getElementById("adsMsg");';
  html += '  const r = await fetch("/api/ads", { method:"POST", headers: { "Content-Type":"application/json", "X-Admin-Password": token }, body: JSON.stringify({ code: code }) });';
  html += '  if (r.ok) { msg.textContent = "Ad code saved!"; msg.className = "msg ok show"; }';
  html += '  else { msg.textContent = "Failed"; msg.className = "msg err show"; }';
  html += '  setTimeout(function() { msg.classList.remove("show"); }, 2500);';
  html += '}';
  html += 'function escapeHtml(s) {';
  html += '  return String(s).replace(/[&<>]/g, function(c) { return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; });';
  html += '}';
  html += '<\\/script>';
  html += '</body>';
  html += '</html>';
  return html;
}



