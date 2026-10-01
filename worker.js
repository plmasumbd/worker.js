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
  return json({
    items: list.slice(start, start + PAGE_SIZE),
    page: page,
    totalPages: pages,
    total: total
  });
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
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function html(s) {
  return new Response(s, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function homePage() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MovieHub</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}
header{background:#1a1a1a;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040;position:sticky;top:0;z-index:100}
header h1{color:#ff0040;font-size:24px}
.box{max-width:1300px;margin:0 auto;padding:30px 20px}
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.card{background:#1c1c1c;border-radius:10px;overflow:hidden;text-decoration:none;color:#eee;display:block;transition:.3s}
.card:hover{transform:translateY(-5px);box-shadow:0 10px 25px rgba(255,0,64,.3)}
.thumb{width:100%;aspect-ratio:16/9;background:#333 center/cover no-repeat;position:relative}
.play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;background:rgba(255,0,64,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff}
.info{padding:12px}
.info h3{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pager{display:flex;justify-content:center;gap:8px;margin-top:40px;flex-wrap:wrap}
.pager button{padding:10px 16px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:14px}
.pager button:hover:not(:disabled){background:#ff0040;border-color:#ff0040}
.pager button.active{background:#ff0040;border-color:#ff0040}
.pager button:disabled{opacity:.3;cursor:not-allowed}
.empty{text-align:center;padding:60px 20px;color:#666;font-size:18px}
.ad{margin:20px 0;text-align:center;overflow:hidden}
</style>
</head>
<body>
<header><h1>MovieHub</h1></header>
<div class="box">
<div class="ad" id="adTop"></div>
<div id="grid" class="grid"></div>
<div id="pager" class="pager"></div>
<div class="ad" id="adBot"></div>
</div>
<script>
async function loadAds(){
  try{
    var r=await fetch("/api/ads");
    var d=await r.json();
    if(d.code&&d.code.trim()){
      document.getElementById("adTop").innerHTML=d.code;
      document.getElementById("adBot").innerHTML=d.code;
    }
  }catch(e){}
}
async function load(p){
  var r=await fetch("/api/movies?page="+p);
  var d=await r.json();
  var g=document.getElementById("grid");
  g.innerHTML="";
  if(!d.items.length){
    g.innerHTML='<div class="empty">No videos yet</div>';
    document.getElementById("pager").innerHTML="";
    return;
  }
  d.items.forEach(function(m){
    var a=document.createElement("a");
    a.className="card";
    a.href="/watch?id="+m.id;
    var s=m.thumbnail?("background-image:url('"+m.thumbnail+"')"):"";
    a.innerHTML='<div class="thumb" style="'+s+'"><div class="play">▶</div></div><div class="info"><h3>'+esc(m.title)+'</h3></div>';
    g.appendChild(a);
  });
  pager(d.page,d.totalPages);
}
function pager(c,t){
  var el=document.getElementById("pager");
  el.innerHTML="";
  if(t<=1)return;
  var p=document.createElement("button");
  p.textContent="« Prev";
  p.disabled=c===1;
  p.onclick=function(){load(c-1)};
  el.appendChild(p);
  var st=Math.max(1,c-2),en=Math.min(t,st+4);
  if(en-st<4)st=Math.max(1,en-4);
  for(var i=st;i<=en;i++){
    (function(i){
      var b=document.createElement("button");
      b.textContent=i;
      if(i===c)b.classList.add("active");
      b.onclick=function(){load(i)};
      el.appendChild(b);
    })(i);
  }
  var n=document.createElement("button");
  n.textContent="Next »";
  n.disabled=c===t;
  n.onclick=function(){load(c+1)};
  el.appendChild(n);
}
function esc(s){
  return String(s).replace(/[&<>]/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];
  });
}
loadAds();
load(1);
</script>
</body>
</html>`;
}

function watchPage(id) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Watch</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee}
header{background:#1a1a1a;padding:16px 24px;border-bottom:2px solid #ff0040;display:flex;justify-content:space-between;align-items:center}
header h1{color:#ff0040;font-size:22px}
header a{color:#eee;text-decoration:none;padding:8px 14px;background:#ff0040;border-radius:6px;font-size:14px}
.wrap{max-width:1000px;margin:30px auto;padding:0 20px}
.player{width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden}
.player iframe,.player video{width:100%;height:100%;border:0;display:block}
.title{margin-top:20px;font-size:22px;font-weight:700}
.ad{margin:20px 0;text-align:center;overflow:hidden}
</style>
</head>
<body>
<header><h1>MovieHub</h1><a href="/">← Home</a></header>
<div class="wrap">
<div class="player" id="pb"></div>
<div class="title" id="t">Loading...</div>
<div class="ad" id="adBox"></div>
</div>
<script>
var id=new URLSearchParams(location.search).get("id");
async function go(){
  var p=1,all=[];
  while(true){
    var r=await fetch("/api/movies?page="+p);
    var d=await r.json();
    all=all.concat(d.items);
    if(p>=d.totalPages)break;
    p++;
  }
  var mv=all.find(function(x){return x.id===id});
  if(!mv){document.getElementById("t").textContent="Not found";return}
  document.getElementById("t").textContent=mv.title;
  var pb=document.getElementById("pb");
  var direct=/\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(mv.videoUrl);
  if(direct){
    var v=document.createElement("video");
    v.src=mv.videoUrl;v.controls=true;v.autoplay=true;v.playsInline=true;
    pb.appendChild(v);
  }else{
    var f=document.createElement("iframe");
    f.src=mv.videoUrl;
    f.allow="autoplay;encrypted-media;picture-in-picture;fullscreen";
    f.allowFullscreen=true;
    f.referrerPolicy="no-referrer";
    pb.appendChild(f);
  }
  try{
    var ar=await fetch("/api/ads");
    var ad=await ar.json();
    if(ad.code&&ad.code.trim())document.getElementById("adBox").innerHTML=ad.code;
  }catch(e){}
}
go();
</script>
</body>
</html>`;
}

function adminPage() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;min-height:100vh}
header{background:#1a1a1a;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #ff0040}
header h1{color:#ff0040;font-size:22px}
header a{color:#eee;text-decoration:none;padding:8px 14px;background:#333;border-radius:6px;font-size:14px}
.wrap{max-width:900px;margin:30px auto;padding:0 20px}
.card{background:#1c1c1c;border-radius:12px;padding:24px;margin-bottom:20px}
.card h2{color:#ff0040;margin-bottom:16px;font-size:18px}
label{display:block;margin-top:12px;font-size:14px;color:#aaa}
input,select,textarea{width:100%;padding:12px;margin-top:6px;background:#111;border:1px solid #333;border-radius:6px;color:#eee;font-size:15px;font-family:inherit}
textarea{resize:vertical;min-height:100px;font-family:monospace;font-size:13px}
input:focus,select:focus,textarea:focus{outline:none;border-color:#ff0040}
button.primary{background:#ff0040;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:600;margin-top:20px;font-size:15px}
button.primary:hover{opacity:.9}
button.danger{background:#c00}
button.small{padding:6px 12px;font-size:12px;margin:0}
.item{display:flex;justify-content:space-between;align-items:center;padding:12px;background:#111;border-radius:6px;margin-bottom:8px;gap:12px;flex-wrap:wrap}
.item .info{flex:1;min-width:200px;display:flex;gap:12px;align-items:center}
.item .mini{width:70px;height:44px;border-radius:4px;flex-shrink:0;background:#333 center/cover no-repeat}
.item h4{font-size:14px}
.acts{display:flex;gap:6px}
.msg{padding:10px;border-radius:6px;margin-top:12px;display:none}
.msg.show{display:block}
.msg.ok{background:#164d2c;color:#b6ffb6}
.msg.err{background:#4d1616;color:#ffb6b6}
.hidden{display:none}
#login{max-width:400px;margin:100px auto}
.hint{font-size:12px;color:#666;margin-top:4px}
.tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.tabs button{padding:10px 20px;background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600}
.tabs button.active{background:#ff0040;border-color:#ff0040}
</style>
</head>
<body>
<header><h1>Admin Panel</h1><a href="/">Home</a></header>
<div class="wrap">
<div id="login" class="card">
<h2>Login</h2>
<label>Password</label>
<input type="password" id="pwd">
<button class="primary" onclick="doLogin()">Login</button>
<div id="lm" class="msg"></div>
</div>
<div id="content" class="hidden">
<div class="tabs">
<button id="t1" class="active" onclick="tab('m')">Movies</button>
<button id="t2" onclick="tab('a')">Ads</button>
</div>
<div id="tm">
<div class="card">
<h2 id="ft">Add New Movie</h2>
<input type="hidden" id="eid">
<label>Title</label>
<input type="text" id="title">
<label>Video URL / Embed</label>
<textarea id="vurl" placeholder="Direct mp4 OR ScreenPal embed code"></textarea>
<label>Thumbnail URL (optional - খালি রাখলে auto)</label>
<input type="text" id="thumb">
<button class="primary" id="sb" onclick="saveMovie()">Add Movie</button>
<button class="primary" style="background:#333" onclick="reset()" id="cb" type="button">Cancel</button>
<div id="am" class="msg"></div>
</div>
<div class="card"><h2>All Movies</h2><div id="list"></div></div>
</div>
<div id="ta" class="hidden">
<div class="card">
<h2>Adsterra Ad Code</h2>
<p class="hint">Ad code paste করো। Home ও Watch page এ auto বসবে।</p>
<label>Ad Code</label>
<textarea id="ads" style="min-height:200px"></textarea>
<button class="primary" onclick="saveAds()">Save</button>
<div id="adm" class="msg"></div>
</div>
</div>
<button class="primary danger" onclick="logout()">Logout</button>
</div>
</div>
<script>
var token=localStorage.getItem("admin_token")||"";
window.addEventListener("DOMContentLoaded",function(){
  if(token)verify().then(function(ok){if(ok)show()});
});
async function verify(){
  var r=await fetch("/api/check-auth",{headers:{"X-Admin-Password":token}});
  return r.ok;
}
async function doLogin(){
  var pwd=document.getElementById("pwd").value;
  var r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});
  var d=await r.json();
  var m=document.getElementById("lm");
  if(r.ok){token=d.token;localStorage.setItem("admin_token",token);show()}
  else{m.textContent=d.error||"Failed";m.className="msg err show"}
}
function show(){
  document.getElementById("login").classList.add("hidden");
  document.getElementById("content").classList.remove("hidden");
  loadList();loadAds();
}
function tab(n){
  document.getElementById("tm").classList.add("hidden");
  document.getElementById("ta").classList.add("hidden");
  document.getElementById("t1").classList.remove("active");
  document.getElementById("t2").classList.remove("active");
  if(n==="m"){document.getElementById("tm").classList.remove("hidden");document.getElementById("t1").classList.add("active")}
  if(n==="a"){document.getElementById("ta").classList.remove("hidden");document.getElementById("t2").classList.add("active")}
}
function logout(){localStorage.removeItem("admin_token");location.reload()}
function reset(){
  document.getElementById("eid").value="";
  document.getElementById("title").value="";
  document.getElementById("vurl").value="";
  document.getElementById("thumb").value="";
  document.getElementById("ft").textContent="Add New Movie";
  document.getElementById("sb").textContent="Add Movie";
  document.getElementById("cb").classList.add("hidden");
}
async function saveMovie(){
  var eid=document.getElementById("eid").value;
  var title=document.getElementById("title").value.trim();
  var vurl=document.getElementById("vurl").value.trim();
  var thumb=document.getElementById("thumb").value.trim();
  var m=document.getElementById("am");
  if(!title||!vurl){m.textContent="Title and URL required";m.className="msg err show";return}
  var u=eid?"/api/movies/update":"/api/movies";
  var p={title:title,videoUrl:vurl,thumbnail:thumb};
  if(eid)p.id=eid;
  var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify(p)});
  var d=await r.json();
  if(r.ok){
    m.textContent=eid?"Updated":"Added";
    m.className="msg ok show";
    reset();loadList();
    setTimeout(function(){m.classList.remove("show")},2500);
  }else{m.textContent=d.error||"Failed";m.className="msg err show"}
}
async function loadList(){
  var p=1,all=[];
  while(true){
    var r=await fetch("/api/movies?page="+p);
    var d=await r.json();
    all=all.concat(d.items);
    if(p>=d.totalPages)break;
    p++;
  }
  var el=document.getElementById("list");
  if(!all.length){el.innerHTML='<p style="color:#666">No movies</p>';return}
  el.innerHTML=all.map(function(m){
    var s=m.thumbnail?("background-image:url('"+m.thumbnail+"')"):"";
    return '<div class="item">'+
      '<div class="info">'+
      '<div class="mini" style="'+s+'"></div>'+
      '<h4>'+esc(m.title)+'</h4>'+
      '</div>'+
      '<div class="acts">'+
      '<button class="primary small" onclick="editMovie(\''+m.id+'\')">Edit</button>'+
      '<button class="primary small danger" onclick="delMovie(\''+m.id+'\')">Delete</button>'+
      '</div></div>';
  }).join("");
}
async function editMovie(id){
  var p=1,all=[];
  while(true){
    var r=await fetch("/api/movies?page="+p);
    var d=await r.json();
    all=all.concat(d.items);
    if(p>=d.totalPages)break;
    p++;
  }
  var m=all.find(function(x){return x.id===id});
  if(!m)return;
  document.getElementById("eid").value=m.id;
  document.getElementById("title").value=m.title;
  document.getElementById("vurl").value=m.videoUrl;
  document.getElementById("thumb").value=m.thumbnail||"";
  document.getElementById("ft").textContent="Edit Movie";
  document.getElementById("sb").textContent="Update";
  document.getElementById("cb").classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}
async function delMovie(id){
  if(!confirm("Delete?"))return;
  var r=await fetch("/api/movies/"+id,{method:"DELETE",headers:{"X-Admin-Password":token}});
  if(r.ok)loadList();
}
async function loadAds(){
  var r=await fetch("/api/ads");
  var d=await r.json();
  document.getElementById("ads").value=d.code||"";
}
async function saveAds(){
  var code=document.getElementById("ads").value;
  var m=document.getElementById("adm");
  var r=await fetch("/api/ads",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Password":token},body:JSON.stringify({code:code})});
  if(r.ok){m.textContent="Saved";m.className="msg ok show"}
  else{m.textContent="Failed";m.className="msg err show"}
  setTimeout(function(){m.classList.remove("show")},2500);
}
function esc(s){
  return String(s).replace(/[&<>]/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];
  });
}
</script>
</body>
</html>`;
}
