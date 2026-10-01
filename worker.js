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

    if (p === "/") return html(homePage());
    if (p === "/admin") return html(adminPage());
    if (p === "/watch") return html(watchPage(url.searchParams.get("id")));

    return new Response("404", { status: 404 });
  }
};

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

async function listMovies(env, url) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const raw = await env.MOVIES.get("movie_list");
  let list = raw ? JSON.parse(raw) : [];
  list.sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  return json({ items: list.slice(start, start + PAGE_SIZE), page: page, totalPages: pages, total: total });
}

async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);
  const b = await request.json();
  if (!b.title || !b.videoUrl) return json({ error: "Missing" }, 400);
  const vurl = extractSrc(b.videoUrl);
  let thumb = (b.thumbnail || "").trim();
  if (!thumb) thumb = autoThumb(vurl);
  const raw = await env.MOVIES.get("movie_list");
  const list = raw ? JSON.parse(raw) : [];
  const movie = {
    id: crypto.randomUUID(),
    title: b.title.trim(),
    videoUrl: vurl.trim(),
    thumbnail: thumb,
    createdAt: Date.now()
  };
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

function homePage() {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="bn"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>MovieHub</title>');
  parts.push('<style>');
  parts.push('*{margin:0;padding:0;box-sizing:border-box}');
  parts.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}');
  parts.push('header{background:#1a1a1a;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040;position:sticky;top:0;z-index:100}');
  parts.push('header h1{color:#ff0040;font-size:24px}');
  parts.push('.box{max-width:1300px;margin:0 auto;padding:30px 20px}');
  parts.push('.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}');
  parts.push('.card{background:#1c1c1c;border-radius:10px;overflow:hidden;text-decoration:none;color:#eee;display:block;transition:.3s}');
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
  parts.push('.empty{text-align:center;padding:60px 20px;color:#666;font-size:18px}');
  parts.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  parts.push('</style></head><body>');
  parts.push('<header><h1>MovieHub</h1></header>');
  parts.push('<div class="box">');
  parts.push('<div class="ad" id="adTop"></div>');
  parts.push('<div id="grid" class="grid"></div>');
  parts.push('<div id="pager" class="pager"></div>');
  parts.push('<div class="ad" id="adBot"></div>');
  parts.push('</div>');
  parts.push('<script>');
  parts.push('async function loadAds(){');
  parts.push('  try{');
  parts.push('    var r=await fetch("/api/ads");');
  parts.push('    var d=await r.json();');
  parts.push('    if(d.code&&d.code.trim()){');
  parts.push('      document.getElementById("adTop").innerHTML=d.code;');
  parts.push('      document.getElementById("adBot").innerHTML=d.code;');
  parts.push('    }');
  parts.push('  }catch(e){}');
  parts.push('}');
  parts.push('async function load(p){');
  parts.push('  var r=await fetch("/api/movies?page="+p);');
  parts.push('  var d=await r.json();');
  parts.push('  var g=document.getElementById("grid");');
  parts.push('  g.innerHTML="";');
  parts.push('  if(!d.items.length){');
  parts.push('    g.innerHTML=\'<div class="empty">No videos yet</div>\';');
  parts.push('    document.getElementById("pager").innerHTML="";');
  parts.push('    return;');
  parts.push('  }');
  parts.push('  d.items.forEach(function(m){');
  parts.push('    var a=document.createElement("a");');
  parts.push('    a.className="card";');
  parts.push('    a.href="/watch?id="+m.id;');
  parts.push('    var s=m.thumbnail?("background-image:url(\'" + m.thumbnail + "\')"):"";');
  parts.push('    a.innerHTML=\'<div class="thumb" style="\'+s+\'"><div class="play">▶</div></div><div class="info"><h3>\'+esc(m.title)+\'</h3></div>\';');
  parts.push('    g.appendChild(a);');
  parts.push('  });');
  parts.push('  pager(d.page,d.totalPages);');
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
  parts.push('load(1);');
  parts.push('<\/script>');
  parts.push('</body></html>');
  return parts.join("\n");
}

function watchPage(id) {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="bn"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>Watch</title>');
  parts.push('<style>');
  parts.push('*{margin:0;padding:0;box-sizing:border-box}');
  parts.push('body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee}');
  parts.push('header{background:#1a1a1a;padding:16px 24px;border-bottom:2px solid #ff0040;display:flex;justify-content:space-between;align-items:center}');
  parts.push('header h1{color:#ff0040;font-size:22px}');
  parts.push('header a{color:#eee;text-decoration:none;padding:8px 14px;background:#ff0040;border-radius:6px;font-size:14px}');
  parts.push('.wrap{max-width:1000px;margin:30px auto;padding:0 20px}');
  parts.push('.player{width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden}');
  parts.push('.player iframe,.player video{width:100%;height:100%;border:0;display:block}');
  parts.push('.title{margin-top:20px;font-size:22px;font-weight:700}');
  parts.push('.ad{margin:20px 0;text-align:center;overflow:hidden}');
  parts.push('</style></head><body>');
  parts.push('<header><h1>MovieHub</h1><a href="/">← Home</a></header>');
  parts.push('<div class="wrap">');
  parts.push('<div class="player" id="pb"></div>');
  parts.push('<div class="title" id="t">Loading...</div>');
  parts.push('<div class="ad" id="adBox"></div>');
  parts.push('</div>');
  parts.push('<script>');
  parts.push('var id=new URLSearchParams(location.search).get("id");');
  parts.push('async function go(){');
  parts.push('  var p=1,all=[];');
  parts.push('  while(true){');
  parts.push('    var r=await fetch("/api/movies?page="+p);');
  parts.push('    var d=await r.json();');
  parts.push('    all=all.concat(d.items);');
  parts.push('    if(p>=d.totalPages)break;');
  parts.push('    p++;');
  parts.push('  }');
  parts.push('  var mv=all.find(function(x){return x.id===id});');
  parts.push('  if(!mv){document.getElementById("t").textContent="Not found";return}');
  parts.push('  document.getElementById("t").textContent=mv.title;');
  parts.push('  var pb=document.getElementById("pb");');
  parts.push('  var direct=/\\.(mp4|webm|ogg|m3u8)(\\?|$)/i.test(mv.videoUrl);');
  parts.push('  if(direct){');
  parts.push('    var v=document.createElement("video");');
  parts.push('    v.src=mv.videoUrl;v.controls=true;v.autoplay=true;v.playsInline=true;');
  parts.push('    pb.appendChild(v);');
  parts.push('  }else{');
  parts.push('    var f=document.createElement("iframe");');
  parts.push('    f.src=mv.videoUrl;');
  parts.push('    f.allow="autoplay;encrypted-media;picture-in-picture;fullscreen";');
  parts.push('    f.allowFullscreen=true;');
  parts.push('    f.referrerPolicy="no-referrer";');
  parts.push('    pb.appendChild(f);');
  parts.push('  }');
  parts.push('  try{');
  parts.push('    var ar=await fetch("/api/ads");');
  parts.push('    var ad=await ar.json();');
  parts.push('    if(ad.code&&ad.code.trim())document.getElementById("adBox").innerHTML=ad.code;');
  parts.push('  }catch(e){}');
  parts.push('}');
  parts.push('go();');
  parts.push('<\/script>');
  parts.push('</body></html>');
  return parts.join("\n");
}

function adminPage() {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="bn"><head>');
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>Admin</title>');
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
  parts.push('</style></head><body>');
  parts.push('<header><h1>Admin Panel</h1><a href="/">Home</a></header>');
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
  parts.push('<button id="t2" data-tab="a">Ads</button>');
  parts.push('</div>');
  parts.push('<div id="tm">');
  parts.push('<div class="card">');
  parts.push('<h2 id="ft">Add New Movie</h2>');
  parts.push('<input type="hidden" id="eid">');
  parts.push('<label>Title</label>');
  parts.push('<input type="text" id="title">');
  parts.push('<label>Video URL / Embed</label>');
  parts.push('<textarea id="vurl"></textarea>');
  parts.push('<label>Thumbnail URL (optional)</label>');
  parts.push('<input type="text" id="thumb">');
  parts.push('<button class="primary" id="sb">Add Movie</button>');
  parts.push('<button class="primary hidden" style="background:#333" id="cb" type="button">Cancel</button>');
  parts.push('<div id="am" class="msg"></div>');
  parts.push('</div>');
  parts.push('<div class="card"><h2>All Movies</h2><div id="list"></div></div>');
  parts.push('</div>');
  parts.push('<div id="ta" class="hidden">');
  parts.push('<div class="card">');
  parts.push('<h2>Adsterra Ad Code</h2>');
  parts.push('<p class="hint">Ad code paste করো। Home ও Watch page এ auto বসবে।</p>');
  parts.push('<label>Ad Code</label>');
  parts.push('<textarea id="ads" style="min-height:200px"></textarea>');
  parts.push('<button class="primary" id="adsSaveBtn">Save</button>');
  parts.push('<div id="adm" class="msg"></div>');
  parts.push('</div>');
  parts.push('</div>');
  parts.push('<button class="primary danger" id="logoutBtn">Logout</button>');
  parts.push('</div>');
  parts.push('</div>');
  parts.push('<script>');
  parts.push('var token=localStorage.getItem("admin_token")||"";');
  parts.push('function $(id){return document.getElementById(id)}');
  parts.push('window.addEventListener("DOMContentLoaded",function(){');
  parts.push('  $("loginBtn").onclick=doLogin;');
  parts.push('  $("sb").onclick=saveMovie;');
  parts.push('  $("cb").onclick=reset;');
  parts.push('  $("logoutBtn").onclick=logout;');
  parts.push('  $("adsSaveBtn").onclick=saveAds;');
  parts.push('  document.querySelectorAll("[data-tab]").forEach(function(b){');
  parts.push('    b.onclick=function(){tab(b.getAttribute("data-tab"))};');
  parts.push('  });');
  parts.push('  if(token)verify().then(function(ok){if(ok)show()});');
  parts.push('});');
  parts.push('async function verify(){');
  parts.push('  try{');
  parts.push('    var r=await fetch("/api/check-auth",{headers:{"X-Admin-Password":token}});');
  parts.push('    return r.ok;');
  parts.push('  }catch(e){return false}');
  parts.push('}');
  parts.push('async function doLogin(){');
  parts.push('  var pwd=$("pwd").value;');
  parts.push('  var m=$("lm");');
  parts.push('  try{');
  parts.push('    var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});');
  parts.push('    var d=await r.json();');
  parts.push('    if(r.ok){token=d.token;localStorage.setItem("admin_token",token);show()}');
  parts.push('    else{m.textContent=d.error||"Failed";m.className="msg err show"}');
  parts.push('  }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}');
  parts.push('}');
  parts.push('function show(){');
  parts.push('  $("login").classList.add("hidden");');
  parts.push('  $("content").classList.remove("hidden");');
  parts.push('  loadList();loadAds();');
  parts.push('}');
  parts.push('function tab(n){');
  parts.push('  $("tm").classList.add("hidden");');
  parts.push('  $("ta").classList.add("hidden");');
  parts.push('  $("t1").classList.remove("active");');
  parts.push('  $("t2").classList.remove("active");');
  parts.push('  if(n==="m"){$("tm").classList.remove("hidden");$("t1").classList.add("active")}');
  parts.push('  if(n==="a"){$("ta").classList.remove("hidden");$("t2").classList.add("active")}');
  parts.push('}');
  parts.push('function logout(){localStorage.removeItem("admin_token");location.reload()}');
  parts.push('function reset(){');
  parts.push('  $("eid").value="";');
  parts.push('  $("title").value="";');
  parts.push('  $("vurl").value="";');
  parts.push('  $("thumb").value="";');
  parts.push('  $("ft").textContent="Add New Movie";');
  parts.push('  $("sb").textContent="Add Movie";');
  parts.push('  $("cb").classList.add("hidden");');
  parts.push('}');
  parts.push('async function saveMovie(){');
  parts.push('  var eid=$("eid").value;');
  parts.push('  var title=$("title").value.trim();');
  parts.push('  var vurl=$("vurl").value.trim();');
  parts.push('  var thumb=$("thumb").value.trim();');
  parts.push('  var m=$("am");');
  parts.push('  if(!title||!vurl){m.textContent="Title and URL required";m.className="msg err show";return}');
  parts.push('  var u=eid?"/api/movies/update":"/api/movies";');
  parts.push('  var p={title:title,videoUrl:vurl,thumbnail:thumb};');
  parts.push('  if(eid)p.id=eid;');
  parts.push('  try{');
  parts.push('    var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify(p)});');
  parts.push('    var d=await r.json();');
  parts.push('    if(r.ok){');
  parts.push('      m.textContent=eid?"Updated":"Added";');
  parts.push('      m.className="msg ok show";');
  parts.push('      reset();loadList();');
  parts.push('      setTimeout(function(){m.classList.remove("show")},2500);');
  parts.push('    }else{m.textContent=d.error||"Failed";m.className="msg err show"}');
  parts.push('  }catch(e){m.textContent="Error: "+e.message;m.className="msg err show"}');
  parts.push('}');
  parts.push('async function loadList(){');
  parts.push('  var p=1,all=[];');
  parts.push('  while(true){');
  parts.push('    var r=await fetch("/api/movies?page="+p);');
  parts.push('    var d=await r.json();');
  parts.push('    all=all.concat(d.items);');
  parts.push('    if(p>=d.totalPages)break;');
  parts.push('    p++;');
  parts.push('  }');
  parts.push('  var el=$("list");');
  parts.push('  if(!all.length){el.innerHTML=\'<p style="color:#666">No movies</p>\';return}');
  parts.push('  el.innerHTML="";');
  parts.push('  all.forEach(function(m){');
  parts.push('    var s=m.thumbnail?("background-image:url(\'" + m.thumbnail + "\')"):"";');
  parts.push('    var d=document.createElement("div");');
  parts.push('    d.className="item";');
  parts.push('    d.innerHTML=\'<div class="info"><div class="mini" style="\'+s+\'"></div><h4>\'+esc(m.title)+\'</h4></div>\';');
  parts.push('    var acts=document.createElement("div");');
  parts.push('    acts.className="acts";');
  parts.push('    var eb=document.createElement("button");');
  parts.push('    eb.className="primary small";');
  parts.push('    eb.textContent="Edit";');
  parts.push('    eb.onclick=function(){editMovie(m.id)};');
  parts.push('    var db=document.createElement("button");');
  parts.push('    db.className="primary small danger";');
  parts.push('    db.textContent="Delete";');
  parts.push('    db.onclick=function(){delMovie(m.id)};');
  parts.push('    acts.appendChild(eb);');
  parts.push('    acts.appendChild(db);');
  parts.push('    d.appendChild(acts);');
  parts.push('    el.appendChild(d);');
  parts.push('  });');
  parts.push('}');
  parts.push('async function editMovie(id){');
  parts.push('  var p=1,all=[];');
  parts.push('  while(true){');
  parts.push('    var r=await fetch("/api/movies?page="+p);');
  parts.push('    var d=await r.json();');
  parts.push('    all=all.concat(d.items);');
  parts.push('    if(p>=d.totalPages)break;');
  parts.push('    p++;');
  parts.push('  }');
  parts.push('  var m=all.find(function(x){return x.id===id});');
  parts.push('  if(!m)return;');
  parts.push('  $("eid").value=m.id;');
  parts.push('  $("title").value=m.title;');
  parts.push('  $("vurl").value=m.videoUrl;');
  parts.push('  $("thumb").value=m.thumbnail||"";');
  parts.push('  $("ft").textContent="Edit Movie";');
  parts.push('  $("sb").textContent="Update";');
  parts.push('  $("cb").classList.remove("hidden");');
  parts.push('  window.scrollTo({top:0,behavior:"smooth"});');
  parts.push('}');
  parts.push('async function delMovie(id){');
  parts.push('  if(!confirm("Delete?"))return;');
  parts.push('  var r=await fetch("/api/movies/"+id,{method:"DELETE",headers:{"X-Admin-Password":token}});');
  parts.push('  if(r.ok)loadList();');
  parts.push('}');
  parts.push('async function loadAds(){');
  parts.push('  var r=await fetch("/api/ads");');
  parts.push('  var d=await r.json();');
  parts.push('  $("ads").value=d.code||"";');
  parts.push('}');
  parts.push('async function saveAds(){');
  parts.push('  var code=$("ads").value;');
  parts.push('  var m=$("adm");');
  parts.push('  var r=await fetch("/api/ads",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({code:code})});');
  parts.push('  if(r.ok){m.textContent="Saved";m.className="msg ok show"}');
  parts.push('  else{m.textContent="Failed";m.className="msg err show"}');
  parts.push('  setTimeout(function(){m.classList.remove("show")},2500);');
  parts.push('}');
  parts.push('function esc(s){');
  parts.push('  return String(s).replace(/[&<>]/g,function(c){');
  parts.push('    return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];');
  parts.push('  });');
  parts.push('}');
  parts.push('<\/script>');
  parts.push('</body></html>');
  return parts.join("\n");
}
