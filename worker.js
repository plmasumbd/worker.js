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
    
    // Ad Redirect endpoints
    if (p === "/api/ad-redirect" && request.method === "GET") return getAdRedirect(env);
    if (p === "/api/ad-redirect" && request.method === "POST") return saveAdRedirect(request, env);

    if (p === "/api/movie" && request.method === "GET") return getSingleMovie(env, url);
    if (p === "/api/fetch-source" && request.method === "POST") return fetchSourceData(request);

    if (p === "/") return html(homePage());
    if (p === "/admin") return html(adminPage());
    if (p === "/watch") return html(watchPage(url.searchParams.get("id")));

    return new Response("404", { status: 404 });
  }
};

// ================= GET SINGLE MOVIE =================
async function getSingleMovie(env, url) {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "ID required" }, 400);
  
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  const movie = list.find(m => m.id === id);
  
  if (!movie) return json({ error: "Not found" }, 404);
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
        if (!htmlText.includes('video_alt_url') && !htmlText.includes('video_url')) {
          isBlocked = true;
        }
      } else {
        isBlocked = true;
      }
    } catch (e) {
      isBlocked = true;
    }

    if (isBlocked) {
      try {
        const jinaRes = await fetch("https://r.jina.ai/" + targetUrl, {
          headers: { "Accept": "text/plain" }
        });
        if (jinaRes.ok) {
          htmlText = await jinaRes.text();
        }
      } catch (e) {}
    }

    if (!htmlText) {
      return json({ error: "Failed to load page source." }, 400);
    }

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

    if(!video_url) {
       return json({ error: "Could not find video link. Site might block it." }, 400);
    }

    return json({
      success: true,
      data: {
        title: video_title,
        id: video_id,
        thumbnail: preview_url,
        videoUrl: video_url
      }
    });

  } catch (err) {
    return json({ error: "Scraping failed: " + err.message }, 500);
  }
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

// ================= API: LIST MOVIES =================
async function listMovies(env, url) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();
  
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];

  if (search) {
    list = list.filter(m => m.title.toLowerCase().includes(search));
  } else {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  return json({ items: list.slice(start, start + PAGE_SIZE), page: page, totalPages: pages, total: total });
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
    createdAt: Date.now()
  };
  
  if (b.videoId && list.find(m => m.id === b.videoId)) {
     return json({ error: "This video is already added!" }, 400);
  }

  list.push(movie);
  await env.MOVIES.put("movie_list", JSON.stringify(list));
  return json({ success: true, movie: movie });
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
  if (b.password === ADMIN_PASSWORD)
    return json({ success: true, token: ADMIN_PASSWORD });
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

async function getAdRedirect(env) {
  const raw = await env.MOVIES.get("ad_redirect_url");
  return json({ url: raw || "" });
}

async function saveAdRedirect(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  await env.MOVIES.put("ad_redirect_url", (b.url || "").trim());
  return json({ success: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

function html(s) {
  return new Response(s, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

// ================= HOME PAGE =================
function homePage() {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="bn"><head>');
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
  parts.push('.card{background:#1c1c1c;border-radius:10px;overflow:hidden;text-decoration:none;color:#eee;display:block;transition:.3s;cursor:pointer}');
  parts.push('.card:hover{transform:translateY(-5px);box-shadow:0 10px 25px rgba(255,0,64,.3)}');
  parts.push('.thumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}');
  parts.push('.play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;background:rgba(255,0,64,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff}');
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
  parts.push('  <div class="adblock-content">');
  parts.push('    <h2>⚠️ AdBlocker Detected!</h2>');
  parts.push('    <p style="margin-bottom:20px; color:#ccc; font-size:16px; line-height:1.6;">আমাদের সাইটের একমাত্র আয়ের উৎস হলো বিজ্ঞাপন। দয়া করে আপনার অ্যাডব্লকার বন্ধ করে সাইটটি সাপোর্ট করুন।</p>');
  parts.push('    <button onclick="reloadPage()" style="background:#ff0040; color:#fff; border:none; padding:12px 24px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:16px; width:100%;">আমি অ্যাডব্লকার বন্ধ করেছি (রিলোড করুন)</button>');
  parts.push('  </div>');
  parts.push('</div>');

  parts.push('<header>');
  parts.push('  <a href="/" class="logo">AdultMovie</a>');
  parts.push('  <div class="search-box">');
  parts.push('    <input type="text" id="searchInput" placeholder="Search videos..." onkeypress="handleSearch(event)">');
  parts.push('    <button onclick="triggerSearch()">Search</button>');
  parts.push('  </div>');
  parts.push('</header>');
  parts.push('<div class="box">');
  parts.push('<div class="ad" id="adTop"></div>');
  parts.push('<div id="grid" class="grid"></div>');
  parts.push('<div id="pager" class="pager"></div>');
  parts.push('<div class="ad" id="adBot"></div>');
  parts.push('</div>');

  parts.push('<script>');
  parts.push('var currentPage = 1;');
  parts.push('var currentSearch = "";');
  parts.push('var adRedirectUrl = "";');

  parts.push('function injectAds(containerId, code){');
  parts.push('  var container=document.getElementById(containerId);');
  parts.push('  if(!container)return;');
  parts.push('  container.innerHTML="";');
  parts.push('  var temp=document.createElement("div");');
  parts.push('  temp.innerHTML=code;');
  parts.push('  var scripts=[];');
  parts.push('  Array.from(temp.childNodes).forEach(function(node){');
  parts.push('    if(node.tagName==="SCRIPT"){');
  parts.push('      var s=document.createElement("script");');
  parts.push('      if(node.src)s.src=node.src;');
  parts.push('      else s.textContent=node.textContent;');
  parts.push('      scripts.push(s);');
  parts.push('    } else {');
  parts.push('      container.appendChild(node.cloneNode(true));');
  parts.push('    }');
  parts.push('  });');
  parts.push('  scripts.forEach(function(s){container.appendChild(s);});');
  parts.push('}');

  parts.push('async function loadAds(){');
  parts.push('  try {');
  parts.push('    var isAdmin = localStorage.getItem("admin_token");');
  parts.push('    if(isAdmin) return;');
  parts.push('  } catch(e) {}');
  parts.push('  try{');
  parts.push('    var r=await fetch("/api/ads");');
  parts.push('    var d=await r.json();');
  parts.push('    if(d.code&&d.code.trim()){');
  parts.push('      injectAds("adTop", d.code);');
  parts.push('      injectAds("adBot", d.code);');
  parts.push('    }');
  parts.push('  }catch(e){console.error("Ad error:", e);}');
  parts.push('}');

  parts.push('async function preloadAdRedirect(){');
  parts.push('  try{');
  parts.push('    var r = await fetch("/api/ad-redirect");');
  parts.push('    var d = await r.json();');
  parts.push('    if(d && d.url) adRedirectUrl = d.url.trim();');
  parts.push('  }catch(e){}');
  parts.push('}');

  parts.push('function redirectToAd(){');
  parts.push('  if(adRedirectUrl && adRedirectUrl.length > 0){');
  parts.push('    window.location.replace(adRedirectUrl);');
  parts.push('  } else {');
  parts.push('    window.location.replace("/");');
  parts.push('  }');
  parts.push('}');

  parts.push('function openMovie(watchUrl){');
  parts.push('  window.open(watchUrl, "_blank");');
  parts.push('  redirectToAd();');
  parts.push('}');

  parts.push('function detectAdBlocker(){');
  parts.push('  try {');
  parts.push('    var isAdmin = localStorage.getItem("admin_token");');
  parts.push('    if(isAdmin) return;');
  parts.push('    if (localStorage.getItem("adblockDismissed")) { return; }');
  parts.push('  } catch(e) {}');
  parts.push('  var s = document.createElement("script");');
  parts.push('  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";');
  parts.push('  s.async = true;');
  parts.push('  var blocked = false;');
  parts.push('  s.onerror = function() { blocked = true; };');
  parts.push('  document.head.appendChild(s);');
  parts.push('  setTimeout(function(){');
  parts.push('    var isBlocked = !window.adsbygoogle || blocked;');
  parts.push('    if(isBlocked) {');
  parts.push('      var popup = document.getElementById("adblockPopup");');
  parts.push('      if(popup) popup.style.display = "flex";');
  parts.push('    }');
  parts.push('  }, 1500);');
  parts.push('}');

  parts.push('function reloadPage() {');
  parts.push('  try { localStorage.setItem("adblockDismissed", "true"); } catch(e) {}');
  parts.push('  location.reload();');
  parts.push('}');

  parts.push('function handleSearch(e){');
  parts.push('  if(e.key === "Enter"){ triggerSearch(); }');
  parts.push('}');
  
  parts.push('function triggerSearch(){');
  parts.push('  var q = document.getElementById("searchInput").value.trim();');
  parts.push('  currentSearch = q;');
  parts.push('  currentPage = 1;');
  parts.push('  load(1);');
  parts.push('}');

  parts.push('async function load(p){');
  parts.push('  currentPage = p;');
  parts.push('  var url = "/api/movies?page=" + p;');
  parts.push('  if(currentSearch) url += "&search=" + encodeURIComponent(currentSearch);');
  parts.push('  try {');
  parts.push('    var r=await fetch(url);');
  parts.push('    var d=await r.json();');
  parts.push('    var g=document.getElementById("grid");');
  parts.push('    g.innerHTML="";');
  parts.push('    if(!d.items || !d.items.length){');
  parts.push('      g.innerHTML=\'<div class="empty">No videos found!</div>\';');
  parts.push('      document.getElementById("pager").innerHTML="";');
  parts.push('      return;');
  parts.push('    }');
  parts.push('    d.items.forEach(function(m){');
  parts.push('      var a=document.createElement("a");');
  parts.push('      a.className="card";');
  parts.push('      a.href="/watch?id="+m.id;');
  parts.push('      a.setAttribute("data-watch", "/watch?id="+m.id);');
  parts.push('      var s=m.thumbnail?("background-image:url(\'" + m.thumbnail + "\')"):"";');
  parts.push('      a.innerHTML=\'<div class="thumb" style="\'+s+\'"><div class="play">▶</div></div><div class="info"><h3>\'+esc(m.title)+\'</h3></div>\';');
  parts.push('      a.addEventListener("click", function(ev){');
  parts.push('        ev.preventDefault();');
  parts.push('        openMovie(a.getAttribute("data-watch"));');
  parts.push('      });');
  parts.push('      g.appendChild(a);');
  parts.push('    });');
  parts.push('    pager(d.page,d.totalPages);');
  parts.push('  } catch(err) {');
  parts.push('    console.error(err);');
  parts.push('    document.getElementById("grid").innerHTML = \'<div class="empty">Error loading videos. Please refresh.</div>\';');
  parts.push('  }');
  parts.push('}');

  parts.push('function pager(c,t){');
  parts.push('  var el=document.getElementById("pager");');
  parts.push('  el.innerHTML="";');
  parts.push('  if(t<=1)return;');
  parts.push('  var p=document.createElement("button");');
  parts.push('  p.textContent="« Prev";');
  parts.push('  p.disabled=c===1;');
  parts.push('  p.onclick=function(){load(c-1)};');
  parts.push('  el.appendChild(p);');
  parts.push('  var st=Math.max(1,c-2),en=Math.min(t,st+4);');
  parts.push('  if(en-st<4)st=Math.max(1,en-4);');
  parts.push('  for(var i=st;i<=en;i++){');
  parts.push('    (function(i){');
  parts.push('      var b=document.createElement("button");');
  parts.push('      b.textContent=i;');
  parts.push('      if(i===c)b.classList.add("active");');
  parts.push('      b.onclick=function(){load(i)};');
  parts.push('      el.appendChild(b);');
  parts.push('    })(i);');
  parts.push('  }');
  parts.push('  var n=document.createElement("button");');
  parts.push('  n.textContent="Next »";');
  parts.push('  n.disabled=c===t;');
  parts.push('  n.onclick=function(){load(c+1)};');
  parts.push('  el.appendChild(n);');
  parts.push('}');

  parts.push('function esc(s){');
  parts.push('  return String(s).replace(/[&<>]/g,function(c){');
  parts.push('    return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];');
  parts.push('  });');
  parts.push('}');

  parts.push('loadAds();');
  parts.push('preloadAdRedirect();');
  parts.push('detectAdBlocker();');
  parts.push('load(1);');
  parts.push('<\/script>');
  
  // ✅ Adsterra Social Bar / Interstitial Script
  parts.push('<script data-cfasync="false" src="https://bauval.org/14/f274e379d9ec4f2627750ad4c07a4328"></script>');
  
  parts.push('</body></html>');
  return parts.join("\n");
}

// ================= WATCH PAGE =================
// ================= WATCH PAGE =================
function watchPage(id) {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="bn"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>Watch - AdultMovie</title>');
  parts.push('<style>');
  parts.push('*{margin:0;padding:0;box-sizing:border-box}');
  parts.push('@import url("https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap");');
  parts.push('body{font-family:"Hind Siliguri", system-ui, sans-serif;background:#0f0f0f;color:#eee}');
  parts.push('header{background:#1a1a1a;padding:16px 24px;border-bottom:2px solid #ff0040;display:flex;justify-content:space-between;align-items:center}');
  parts.push('header a.logo{color:#ff0040;font-size:22px;font-weight:bold;text-decoration:none;}');
  parts.push('header a.back-btn{color:#eee;text-decoration:none;padding:8px 14px;background:#ff0040;border-radius:6px;font-size:14px}');
  parts.push('.wrap{max-width:1000px;margin:30px auto;padding:0 20px}');
  parts.push('.player{width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;position:relative}');
  parts.push('.player iframe,.player video{width:100%;height:100%;border:0;display:block}');
  parts.push('.title{margin-top:20px;font-size:22px;font-weight:700}');
  parts.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  parts.push('.controls{display:flex;justify-content:flex-end;margin-top:10px}');
  parts.push('.fs-btn{background:#ff0040;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;display:flex;align-items:center;gap:8px}');
  parts.push('.fs-btn:hover{background:#e60039}');
  
  // Pop-up CSS
  parts.push('.adblock-popup{display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:9999; align-items:center; justify-content:center; text-align:center; flex-direction:column;}');
  parts.push('.adblock-content{background:#1c1c1c; padding:30px; border-radius:10px; border:2px solid #ff0040; max-width:450px; margin:20px; box-shadow:0 0 20px rgba(255,0,64,0.5);}');
  parts.push('.adblock-content h2{color:#ff0040; margin-bottom:15px; font-size:24px;}');
  
  // ৫ সেকেন্ডের Interstitial Ad Modal CSS
  parts.push('.interstitial-modal{display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:10000; flex-direction:column; align-items:center; justify-content:center;}');
  parts.push('.interstitial-box{background:#1c1c1c; width:90%; max-width:700px; padding:20px; border-radius:12px; border:2px solid #ff0040; text-align:center; position:relative; box-shadow:0 0 30px rgba(255,0,64,0.4);}');
  parts.push('.interstitial-box h3{color:#fff; margin-bottom:15px; font-size:18px;}');
  parts.push('.ad-container{min-height:250px; display:flex; align-items:center; justify-content:center; background:#000; border-radius:8px; overflow:hidden; margin-bottom:20px;}');
  parts.push('.skip-btn{background:#333; color:#fff; border:none; padding:12px 30px; border-radius:8px; font-size:16px; font-weight:bold; cursor:not-allowed; transition:0.3s; width:100%; max-width:300px;}');
  parts.push('.skip-btn.active{background:#ff0040; cursor:pointer; box-shadow:0 0 15px rgba(255,0,64,0.5);}');
  
  parts.push('</style></head><body>');

  // Adblock Popup
  parts.push('<div id="adblockPopup" class="adblock-popup">');
  parts.push('  <div class="adblock-content">');
  parts.push('    <h2>⚠️ AdBlocker Detected!</h2>');
  parts.push('    <p style="margin-bottom:20px; color:#ccc; font-size:16px; line-height:1.6;">আমাদের সাইটের একমাত্র আয়ের উৎস হলো বিজ্ঞাপন। দয়া করে আপনার অ্যাডব্লকার বন্ধ করে সাইটটি সাপোর্ট করুন।</p>');
  parts.push('    <button onclick="reloadPage()" style="background:#ff0040; color:#fff; border:none; padding:12px 24px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:16px; width:100%;">আমি অ্যাডব্লকার বন্ধ করেছি (রিলোড করুন)</button>');
  parts.push('  </div>');
  parts.push('</div>');

  // ৫ সেকেন্ডের Interstitial Ad Modal
  parts.push('<div id="interstitialModal" class="interstitial-modal">');
  parts.push('  <div class="interstitial-box">');
  parts.push('    <h3>আপনার ভিডিওটি লোড হচ্ছে... অনুগ্রহ করে বিজ্ঞাপনটি দেখুন</h3>');
  parts.push('    <div class="ad-container" id="interstitialAdBox"></div>');
  parts.push('    <button id="skipBtn" class="skip-btn" disabled>অপেক্ষা করুন (৫)</button>');
  parts.push('  </div>');
  parts.push('</div>');

  parts.push('<header><a href="/" class="logo">AdultMovie</a><a href="/" class="back-btn">← Home</a></header>');
  parts.push('<div class="wrap">');
  parts.push('<div class="player" id="pb" style="display:none;"></div>'); // ভিডিও আগে হাইড থাকবে
  parts.push('<div class="controls" id="ctrl" style="display:none;"><button class="fs-btn" onclick="openFullscreen()">⛶ Full Screen</button></div>');
  parts.push('<div class="title" id="t">Loading...</div>');
  parts.push('<div class="ad" id="adBox"></div>');
  parts.push('</div>');

  parts.push('<script>');
  parts.push('function injectAds(id, code){');
  parts.push('  var c=document.getElementById(id);');
  parts.push('  if(!c)return;');
  parts.push('  c.innerHTML="";');
  parts.push('  var t=document.createElement("div");');
  parts.push('  t.innerHTML=code;');
  parts.push('  var sc=[];');
  parts.push('  Array.from(t.childNodes).forEach(function(n){');
  parts.push('    if(n.tagName==="SCRIPT"){');
  parts.push('      var s=document.createElement("script");');
  parts.push('      if(n.src)s.src=n.src;');
  parts.push('      else s.textContent=n.textContent;');
  parts.push('      sc.push(s);');
  parts.push('    } else { c.appendChild(n.cloneNode(true)); }');
  parts.push('  });');
  parts.push('  sc.forEach(function(s){c.appendChild(s);});');
  parts.push('}');

  parts.push('function openFullscreen() {');
  parts.push('  var elem = document.getElementById("pb");');
  parts.push('  if (elem.requestFullscreen) { elem.requestFullscreen(); }');
  parts.push('  else if (elem.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); }');
  parts.push('  else if (elem.msRequestFullscreen) { elem.msRequestFullscreen(); }');
  parts.push('}');

  parts.push('function detectAdBlocker(){');
  parts.push('  try {');
  parts.push('    var isAdmin = localStorage.getItem("admin_token");');
  parts.push('    if(isAdmin) return;');
  parts.push('    if (localStorage.getItem("adblockDismissed")) { return; }');
  parts.push('  } catch(e) {}');
  parts.push('  var s = document.createElement("script");');
  parts.push('  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";');
  parts.push('  s.async = true;');
  parts.push('  var blocked = false;');
  parts.push('  s.onerror = function() { blocked = true; };');
  parts.push('  document.head.appendChild(s);');
  parts.push('  setTimeout(function(){');
  parts.push('    var isBlocked = !window.adsbygoogle || blocked;');
  parts.push('    if(isBlocked) {');
  parts.push('      var popup = document.getElementById("adblockPopup");');
  parts.push('      if(popup) popup.style.display = "flex";');
  parts.push('    }');
  parts.push('  }, 1500);');
  parts.push('}');

  parts.push('function reloadPage() {');
  parts.push('  try { localStorage.setItem("adblockDismissed", "true"); } catch(e) {}');
  parts.push('  location.reload();');
  parts.push('}');

  parts.push('var id=new URLSearchParams(location.search).get("id");');
  parts.push('var movieData = null;');

  // ডাটা লোড করা
  parts.push('async function loadData(){');
  parts.push('  if(!id){document.getElementById("t").textContent="ID not provided";return}');
  parts.push('  try {');
  parts.push('    var r = await fetch("/api/movie?id=" + id);');
  parts.push('    if(!r.ok) throw new Error("Not found");');
  parts.push('    var d = await r.json();');
  parts.push('    movieData = d.movie;');
  parts.push('    document.getElementById("t").textContent=movieData.title;');
  parts.push('    ');
  // চেক করা ইউজার অ্যাডমিন কি না
  parts.push('    var isAdmin = localStorage.getItem("admin_token");');
  parts.push('    if(!isAdmin){');
  parts.push('      showInterstitialAd();'); // নরমাল ইউজার হলে অ্যাড দেখাও
  parts.push('    } else {');
  parts.push('      playVideo();'); // অ্যাডমিন হলে সোজা ভিডিও চালাও
  parts.push('    }');
  parts.push('  } catch(err) {');
  parts.push('    document.getElementById("t").textContent="Video Not Found";');
  parts.push('  }');
  parts.push('}');

  // ৫ সেকেন্ডের অ্যাড পপআপ দেখানো
  parts.push('async function showInterstitialAd(){');
  parts.push('  var modal = document.getElementById("interstitialModal");');
  parts.push('  var adBox = document.getElementById("interstitialAdBox");');
  parts.push('  var skipBtn = document.getElementById("skipBtn");');
  parts.push('  modal.style.display = "flex";');
  
  // API থেকে অ্যাড কোড আনা
  parts.push('  try{');
  parts.push('    var ar=await fetch("/api/ads");');
  parts.push('    var ad=await ar.json();');
  parts.push('    if(ad.code&&ad.code.trim()){');
  parts.push('      injectAds("interstitialAdBox", ad.code);');
  parts.push('    } else {');
  parts.push('      adBox.innerHTML = "<p style=\'color:#666\'>No Ad Configured</p>";');
  parts.push('    }');
  parts.push('  }catch(e){}');
  parts.push('  ');
  // ৫ সেকেন্ডের কাউন্টডাউন টাইমার
  parts.push('  var timeLeft = 5;');
  parts.push('  skipBtn.textContent = "অপেক্ষা করুন (" + timeLeft + ")";');
  parts.push('  var timer = setInterval(function(){');
  parts.push('    timeLeft--;');
  parts.push('    if(timeLeft > 0){');
  parts.push('      skipBtn.textContent = "অপেক্ষা করুন (" + timeLeft + ")";');
  parts.push('    } else {');
  parts.push('      clearInterval(timer);');
  parts.push('      skipBtn.textContent = "ভিডিও দেখুন ▶";');
  parts.push('      skipBtn.classList.add("active");');
  parts.push('      skipBtn.disabled = false;');
  parts.push('      skipBtn.onclick = function(){');
  parts.push('        modal.style.display = "none";'); // পপআপ বন্ধ
  parts.push('        playVideo();'); // ভিডিও চালু
  parts.push('      };');
  parts.push('    }');
  parts.push('  }, 1000);');
  parts.push('}');

  // ভিডিও প্লে করা
  parts.push('function playVideo(){');
  parts.push('  if(!movieData) return;');
  parts.push('  var pb = document.getElementById("pb");');
  parts.push('  pb.style.display = "block"; // ভিডিও কন্টেইনার শো করো');
  parts.push('  document.getElementById("ctrl").style.display="flex";');
  parts.push('  ');
  parts.push('  var direct=/\\.(mp4|webm|ogg|m3u8)(\\?|$)/i.test(movieData.videoUrl);');
  parts.push('  if(direct){');
  parts.push('    var v=document.createElement("video");');
  parts.push('    v.src=movieData.videoUrl;v.controls=true;v.autoplay=true;v.playsInline=true;');
  parts.push('    pb.appendChild(v);');
  parts.push('  }else{');
  parts.push('    var f=document.createElement("iframe");');
  parts.push('    f.src=movieData.videoUrl;');
  parts.push('    f.allow="autoplay;encrypted-media;picture-in-picture;fullscreen";');
  parts.push('    f.allowFullscreen=true;');
  parts.push('    f.referrerPolicy="no-referrer";');
  parts.push('    pb.appendChild(f);');
  parts.push('  }');
  parts.push('}');

  parts.push('detectAdBlocker();');
  parts.push('loadData();'); // পেজ লোড হলেই ডাটা নিয়ে অ্যাড দেখাবে
  parts.push('<\/script>');
  
  // Adsterra Social Bar Script
  parts.push('<script data-cfasync="false" src="https://bauval.org/14/f274e379d9ec4f2627750ad4c07a4328"></script>');
  
  parts.push('</body></html>');
  return parts.join("\n");
}
