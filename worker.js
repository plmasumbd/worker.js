const ADMIN_PASSWORD = "admin123";
const PAGE_SIZE = 20;
const ONE_DAY = 24 * 60 * 60 * 1000;

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

    if (p === "/") return html(homePage());
    if (p === "/admin") return html(adminPage());
    if (p === "/watch") return html(watchPage(url.searchParams.get("id")));

    return new Response("404", { status: 404 });
  }
};

// ================= ভিডিও লিংক খোঁজার ফাংশন =================
async function fetchFreshFromEmbed(embedUrl) {
  let text = "";
  // ১. allorigins প্রোক্সি দিয়ে সোর্স আনা
  try {
    const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(embedUrl));
    if (r.ok) {
      const t = await r.text();
      if (/setVideoUrl/i.test(t)) text = t;
    }
  } catch (e) {}

  // ২. corsproxy প্রোক্সি দিয়ে সোর্স আনা
  if (!text) {
    try {
      const r = await fetch("https://corsproxy.io/?url=" + encodeURIComponent(embedUrl));
      if (r.ok) {
        const t = await r.text();
        if (/setVideoUrl/i.test(t)) text = t;
      }
    } catch (e) {}
  }

  const out = { contentUrl: "", title: "", thumbnail: "", views: 0 };
  if (!text) return out;

  // setVideoUrlHigh / Low / normal থেকে লিংক খোঁজা
  let m = text.match(/setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]/i);
  if (m) out.contentUrl = m[1];
  if (!out.contentUrl) { m = text.match(/setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]/i); if (m) out.contentUrl = m[1]; }
  if (!out.contentUrl) { m = text.match(/setVideoUrl\s*\(\s*['"]([^'"]+)['"]/i); if (m) out.contentUrl = m[1]; }

  if (out.contentUrl) {
    out.contentUrl = out.contentUrl.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\/g, "");
  }

  m = text.match(/"name"\s*:\s*"([^"]+)"/i); if (m) out.title = m[1];
  m = text.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i) || text.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (m) out.thumbnail = m[1].replace(/&amp;/g, "&");
  m = text.match(/"userInteractionCount"\s*:\s*"?(\d+)"?/i); if (m) out.views = parseInt(m[1], 10) || 0;

  return out;
}

// ================= REFRESH (Admin) =================
async function refreshMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const idx = list.findIndex(m => m.id === b.id);
  if (idx === -1) return json({ error: "Not found" }, 404);
  
  const movie = list[idx];
  // embedUrl না থাকলে videoUrl বা ডিফল্ট embedframe লিংক বানাবে
  const embedUrl = movie.embedUrl || movie.videoUrl || ("https://" + new URL(request.url).hostname + "/embedframe/" + movie.id);
  
  try {
    const fresh = await fetchFreshFromEmbed(embedUrl);
    if (fresh.contentUrl) {
      list[idx].contentUrl = fresh.contentUrl;
      list[idx].videoUrl = fresh.contentUrl;
      list[idx].lastRefresh = Date.now();
      if (fresh.title) list[idx].title = fresh.title;
      if (fresh.thumbnail) list[idx].thumbnail = fresh.thumbnail;
      if (fresh.views) list[idx].views = fresh.views;
      await env.MOVIES.put("movie_list", JSON.stringify(list));
      return json({ success: true });
    }
    return json({ error: "লিংক পাওয়া যায়নি (setVideoUrlHigh)" }, 502);
  } catch (e) { return json({ error: e.message }, 500); }
}

async function refreshAll(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  let ok = 0, fail = 0;
  
  for (let i = 0; i < list.length; i++) {
    const movie = list[i];
    const embedUrl = movie.embedUrl || movie.videoUrl || ("https://" + new URL(request.url).hostname + "/embedframe/" + movie.id);
    if (embedUrl) {
      try {
        const fresh = await fetchFreshFromEmbed(embedUrl);
        if (fresh.contentUrl) {
          movie.contentUrl = fresh.contentUrl;
          movie.videoUrl = fresh.contentUrl;
          movie.lastRefresh = Date.now();
          ok++;
        } else { fail++; }
      } catch (e) { fail++; }
    } else { fail++; }
    
    if (i < list.length - 1) await new Promise(r => setTimeout(r, 2000));
    if ((i + 1) % 5 === 0 || i === list.length - 1) await env.MOVIES.put("movie_list", JSON.stringify(list));
  }
  return json({ success: true, ok, fail });
}

// ================= ADMIN: ADD/UPDATE/DELETE =================
async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.title) return json({ error: "Title দরকার" }, 400);
  
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  
  const embedUrl = b.embedUrl || b.videoUrl || "";
  const contentUrl = b.contentUrl || "";
  
  const movie = {
    id: b.videoId || crypto.randomUUID(),
    title: b.title.trim(),
    videoUrl: contentUrl || embedUrl,
    embedUrl: embedUrl.trim(),
    contentUrl: contentUrl.trim(),
    thumbnail: b.thumbnail || "",
    createdAt: Date.now(),
    lastRefresh: contentUrl ? Date.now() : 0,
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
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const i = list.findIndex(m => m.id === b.id);
  if (i === -1) return json({ error: "Not found" }, 404);
  
  if (b.title) list[i].title = b.title.trim();
  if (b.embedUrl) list[i].embedUrl = b.embedUrl.trim();
  if (b.contentUrl) { list[i].contentUrl = b.contentUrl; list[i].videoUrl = b.contentUrl; }
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

// ================= HELPERS =================
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

async function listMovies(env, url) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  return json({ items: list.slice(start, start + PAGE_SIZE), page, totalPages: pages, total });
}

async function getSingleMovie(env, url) {
  const id = url.searchParams.get("id");
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const movie = list.find(m => m.id === id);
  if (!movie) return json({ error: "Not found" }, 404);
  return json({ success: true, movie });
}

async function getRelatedMovies(env, url) {
  const id = url.searchParams.get("id");
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const others = list.filter(m => m.id !== id);
  const shuffled = others.map(m => ({ m, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, 12).map(x => x.m);
  return json({ items: shuffled });
}

async function getTrendingMovies(env) {
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const sorted = list.slice(0, 8);
  return json({ items: sorted });
}

async function trackView(request, env) {
  try {
    const body = await request.json();
    const raw = await env.MOVIES.get("movie_list");
    let list = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(m => m.id === body.id);
    if (idx !== -1) {
      if (!list[idx].views) list[idx].views = Math.floor(Math.random() * 4500) + 500;
      list[idx].views += 1;
      await env.MOVIES.put("movie_list", JSON.stringify(list));
    }
    return json({ success: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

async function getAds(env) { const raw = await env.MOVIES.get("ads_code"); return json({ code: raw || "" }); }
async function saveAds(request, env) {
  const b = await request.json();
  await env.MOVIES.put("ads_code", b.code || "");
  return json({ success: true });
}
async function getIntervalLink(env) { const raw = await env.MOVIES.get("interval_link"); return json({ url: raw || "" }); }
async function saveIntervalLink(request, env) {
  const b = await request.json();
  await env.MOVIES.put("interval_link", b.url || "");
  return json({ success: true });
}

function json(d, s) { return new Response(JSON.stringify(d), { status: s || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }); }
function html(s) { return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } }); }

// ================= WATCH PAGE =================
function watchPage(id) {
  const p = [];
  p.push('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch</title>');
  p.push('<style>');
  p.push('*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0f0f0f;color:#eee}');
  p.push('header{background:#1a1a1a;padding:14px 24px;display:flex;justify-content:space-between;border-bottom:2px solid #ff0040;align-items:center}');
  p.push('header a{color:#ff0040;text-decoration:none;font-weight:bold;font-size:20px}');
  p.push('header .back{background:#ff0040;color:#fff;padding:8px 14px;border-radius:6px;font-size:14px}');
  p.push('.wrap{max-width:860px;margin:24px auto;padding:0 16px}');
  p.push('.player{width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;position:relative;overflow:hidden}');
  p.push('video{width:100%;height:100%;object-fit:contain}');
  p.push('.loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10}');
  p.push('.spin{width:40px;height:40px;border:4px solid #ff0040;border-top-color:transparent;border-radius:50%;animation:sp 1s linear infinite;margin-bottom:15px}@keyframes sp{to{transform:rotate(360deg)}}');
  p.push('.title{margin-top:18px;font-size:20px;font-weight:bold}');
  p.push('.err{display:none;color:#ff0040;text-align:center;padding:20px;font-weight:bold}');
  p.push('.err.show{display:block}');
  p.push('</style></head><body>');
  p.push('<header><a href="/">AdultMovie</a><a href="/" class="back">← Home</a></header>');
  p.push('<div class="wrap">');
  p.push('<div class="player" id="pw">');
  p.push('  <div class="loader" id="ld"><div class="spin"></div><div>Loading...</div></div>');
  p.push('  <div class="err" id="er">Video Not Loading.<br>Try another video.</div>');
  p.push('</div>');
  p.push('<div class="title" id="t">Loading...</div>');
  p.push('</div>');
  
  p.push('<script>');
  p.push('function $(i){return document.getElementById(i)}');
  p.push('var id = new URLSearchParams(location.search).get("id");');
  p.push('var movieData = null;');
  p.push('async function load(){');
  p.push('  try{');
  p.push('    var r = await fetch("/api/movie?id="+id);');
  p.push('    var d = await r.json();');
  p.push('    movieData = d.movie;');
  p.push('    $("t").textContent = movieData.title;');
  p.push('    playVideo();');
  p.push('  }catch(e){ $("t").textContent="Error"; }');
  p.push('}');
  
  p.push('async function playVideo(){');
  p.push('  var url = movieData.contentUrl || "";');
  p.push('  var isFresh = (Date.now() - (movieData.lastRefresh||0)) < 86400000; // 24 hours');
  
  p.push('  if(url && isFresh){ showVideo(url); return; }');
  
  p.push('  $("ld").style.display="flex";');
  p.push('  $("ld").innerHTML="<div class=\'spin\'></div><div>Preparing video...</div>";');
  p.push('  var embed = movieData.embedUrl || "";');
  
  // ইউজারের ব্রাউজার থেকে লিংক খোঁজা
  p.push('  if(embed){');
  p.push('    try{');
  p.push('      var pr = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(embed));');
  p.push('      var html = await pr.text();');
  p.push('      var m = html.match(/setVideoUrlHigh\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i) || html.match(/setVideoUrlLow\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i) || html.match(/setVideoUrl\\s*\\(\\s*[\'"]([^\'"]+)[\'"]/i);');
  p.push('      if(m && m[1]){');
  p.push('        var newUrl = m[1].replace(/&amp;/g,"&");');
  p.push('        showVideo(newUrl);');
  p.push('        return;');
  p.push('      }');
  p.push('    }catch(e){}');
  p.push('  }');
  
  p.push('  if(url){ showVideo(url); return; }');
  p.push('  $("ld").style.display="none";');
  p.push('  $("er").classList.add("show");');
  p.push('}');
  
  p.push('function showVideo(url){');
  p.push('  var v = document.createElement("video");');
  p.push('  v.src = url; v.controls = true; v.autoplay = true;');
  p.push('  v.style.width="100%"; v.style.height="100%";');
  p.push('  v.onloadeddata = function(){ $("ld").style.display="none"; };');
  p.push('  v.onerror = function(){ $("ld").style.display="none"; $("er").classList.add("show"); };');
  p.push('  $("pw").appendChild(v);');
  p.push('}');
  
  p.push('load();');
  p.push('<\/script></body></html>');
  return p.join("\n");
}

// ================= HOME PAGE =================
function homePage() {
  const p = [];
  p.push('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdultMovie</title>');
  p.push('<style>');
  p.push('*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0f0f0f;color:#eee}');
  p.push('header{background:#1a1a1a;padding:15px 24px;display:flex;justify-content:space-between;border-bottom:2px solid #ff0040;align-items:center}');
  p.push('header a{color:#ff0040;text-decoration:none;font-weight:bold;font-size:24px}');
  p.push('.box{max-width:1300px;margin:0 auto;padding:30px 20px}');
  p.push('.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}');
  p.push('.card{background:#1c1c1c;border-radius:10px;overflow:hidden;cursor:pointer;color:#eee;text-decoration:none;display:block}');
  p.push('.thumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}');
  p.push('.info{padding:12px}');
  p.push('.info h3{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
  p.push('</style></head><body>');
  p.push('<header><a href="/">AdultMovie</a></header>');
  p.push('<div class="box"><div id="grid" class="grid"></div></div>');
  p.push('<script>');
  p.push('async function load(){');
  p.push('  var r = await fetch("/api/movies");');
  p.push('  var d = await r.json();');
  p.push('  var g = document.getElementById("grid");');
  p.push('  d.items.forEach(function(m){');
  p.push('    var a = document.createElement("a"); a.className="card"; a.href="/watch?id="+m.id;');
  p.push('    var s = m.thumbnail ? "background-image:url(\'"+m.thumbnail+"\')" : "";');
  p.push('    a.innerHTML = "<div class=\'thumb\' style=\'"+s+"\'></div><div class=\'info\'><h3>"+m.title+"</h3></div>";');
  p.push('    g.appendChild(a);');
  p.push('  });');
  p.push('}');
  p.push('load();');
  p.push('<\/script></body></html>');
  return p.join("\n");
}

// ================= ADMIN PAGE =================
function adminPage() {
  const p = [];
  p.push('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>');
  p.push('<style>');
  p.push('*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0f0f0f;color:#eee;padding:20px}');
  p.push('.card{background:#1c1c1c;padding:24px;border-radius:12px;max-width:600px;margin:0 auto 20px}');
  p.push('h2{color:#ff0040;margin-bottom:16px}');
  p.push('label{display:block;margin-top:12px;color:#aaa;font-size:14px}');
  p.push('input,textarea{width:100%;padding:10px;margin-top:6px;background:#111;border:1px solid #333;color:#fff;border-radius:6px}');
  p.push('button{background:#ff0040;color:#fff;border:none;padding:12px;border-radius:6px;cursor:pointer;font-weight:bold;margin-top:12px;width:100%}');
  p.push('.item{background:#111;padding:10px;margin-bottom:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center}');
  p.push('</style></head><body>');
  p.push('<div class="card" id="login">');
  p.push('<h2>Login</h2>');
  p.push('<input type="password" id="pwd" placeholder="Password">');
  p.push('<button onclick="doLogin()">Login</button>');
  p.push('</div>');
  p.push('<div id="content" style="display:none">');
  p.push('<div class="card"><h2>Add Movie</h2>');
  p.push('<label>Title</label><input type="text" id="title">');
  p.push('<label>Embed URL (YourSite.com/embedframe/xxx)</label><input type="text" id="embedUrl">');
  p.push('<button onclick="addMovie()">Add</button></div>');
  p.push('<div class="card"><h2>All Movies</h2><button onclick="refreshAll()" style="background:#ff9800">Refresh All</button><div id="list" style="margin-top:15px"></div></div>');
  p.push('</div>');
  p.push('<script>');
  p.push('var token = "";');
  p.push('function doLogin(){');
  p.push('  var pwd = document.getElementById("pwd").value;');
  p.push('  fetch("/api/login", {method:"POST", body:JSON.stringify({password:pwd})}).then(r=>r.json()).then(d=>{');
  p.push('    if(d.success){ token=d.token; document.getElementById("login").style.display="none"; document.getElementById("content").style.display="block"; loadList(); }');
  p.push('  });');
  p.push('}');
  p.push('async function addMovie(){');
  p.push('  var title = document.getElementById("title").value;');
  p.push('  var embedUrl = document.getElementById("embedUrl").value;');
  p.push('  var r = await fetch("/api/movies", {method:"POST", headers:{"X-Admin-Password":token}, body:JSON.stringify({title:title, embedUrl:embedUrl})});');
  p.push('  if(r.ok){ alert("Added!"); loadList(); }');
  p.push('}');
  p.push('async function loadList(){');
  p.push('  var r = await fetch("/api/movies");');
  p.push('  var d = await r.json();');
  p.push('  var l = document.getElementById("list"); l.innerHTML="";');
  p.push('  d.items.forEach(function(m){');
  p.push('    var div = document.createElement("div"); div.className="item";');
  p.push('    div.innerHTML = "<span>"+m.title+"</span><button style=\'width:auto;padding:6px 12px;margin:0\' onclick=\'refreshOne(\\""+m.id+"\\", this)\'>Refresh</button>";');
  p.push('    l.appendChild(div);');
  p.push('  });');
  p.push('}');
  p.push('async function refreshOne(id, btn){');
  p.push('  btn.textContent="⏳";');
  p.push('  var r = await fetch("/api/refresh-movie", {method:"POST", headers:{"X-Admin-Password":token}, body:JSON.stringify({id:id})});');
  p.push('  var d = await r.json();');
  p.push('  if(d.success){ btn.textContent="✓"; } else { btn.textContent="✗"; alert(d.error); }');
  p.push('}');
  p.push('async function refreshAll(){');
  p.push('  var r = await fetch("/api/refresh-all", {method:"POST", headers:{"X-Admin-Password":token}});');
  p.push('  var d = await r.json();');
  p.push('  alert("OK: "+d.ok+", Fail: "+d.fail); loadList();');
  p.push('}');
  p.push('<\/script></body></html>');
  return p.join("\n");
}
