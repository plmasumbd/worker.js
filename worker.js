// ==========================================
// CONFIG
// ==========================================
const ADMIN_PASSWORD = "admin123"; // 🔴 অবশ্যই বদলে নিও
const PAGE_SIZE = 20;

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
// EXTRACT SRC FROM IFRAME CODE
// ==========================================
function extractSrc(input) {
  if (!input) return "";
  let s = input.trim();

  // 🎯 Step 1: প্রথমে iframe এর src বের করার চেষ্টা করো (সবচেয়ে নির্ভরযোগ্য)
  const iframeMatch = s.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (iframeMatch) return iframeMatch[1];

  // 🎯 Step 2: video/source tag এর src
  const videoSrcMatch = s.match(/<(?:video|source|embed)[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (videoSrcMatch) return videoSrcMatch[1];

  // 🎯 Step 3: শুধু একটা সরল URL দিলে
  if (/^https?:\/\/\S+$/i.test(s)) return s;

  // 🎯 Step 4: ScreenPal এর জন্য specific pattern
  const screenpalMatch = s.match(/https?:\/\/go\.screenpal\.com\/player\/[^\s"'<>]+/i);
  if (screenpalMatch) return screenpalMatch[0];

  // 🎯 Step 5: শেষ চেষ্টা — যেকোনো URL (তবে script tag এর না)
  // script src বাদ দিয়ে বাকি URL দেখি
  const cleaned = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const urlMatch = cleaned.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) return urlMatch[0];

  return s;
}
// ==========================================
// API: List movies
// ==========================================
async function listMovies(env, url) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];

  list.sort((a, b) => b.createdAt - a.createdAt);

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const items = list.slice(start, start + PAGE_SIZE);

  return jsonResponse({ items, page, totalPages, total });
}

// ==========================================
// API: Add movie
// ==========================================
async function addMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD)
    return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  let { title, videoUrl, previewSec, thumbnail, type } = body;

  if (!title || !videoUrl)
    return jsonResponse({ error: "Title & Video URL required" }, 400);

  // 🎯 Auto extract src from iframe HTML
  videoUrl = extractSrc(videoUrl);

  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];

  const movie = {
    id: crypto.randomUUID(),
    title: title.trim(),
    videoUrl: videoUrl.trim(),
    previewSec: Math.max(1, parseInt(previewSec) || 10),
    thumbnail: thumbnail ? thumbnail.trim() : "",
    type: type || "iframe",
    createdAt: Date.now(),
  };

  list.push(movie);
  await env.MOVIES.put("movie_list", JSON.stringify(list));

  return jsonResponse({ success: true, movie });
}

// ==========================================
// API: Update movie
// ==========================================
async function updateMovie(request, env) {
  const auth = request.headers.get("X-Admin-Password");
  if (auth !== ADMIN_PASSWORD)
    return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  const { id, title, thumbnail, previewSec, type } = body;
  let { videoUrl } = body;
  if (!id) return jsonResponse({ error: "ID required" }, 400);

  const listRaw = await env.MOVIES.get("movie_list");
  let list = listRaw ? JSON.parse(listRaw) : [];
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) return jsonResponse({ error: "Not found" }, 404);

  if (title) list[idx].title = title.trim();
  if (videoUrl) list[idx].videoUrl = extractSrc(videoUrl).trim();
  if (previewSec) list[idx].previewSec = Math.max(1, parseInt(previewSec));
  if (thumbnail !== undefined) list[idx].thumbnail = thumbnail.trim();
  if (type) list[idx].type = type;

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
  list = list.filter((m) => m.id !== id);
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
// HELPERS
// ==========================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
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
// HOME PAGE (Admin button hidden)
// ==========================================
function homePage() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎬 MovieHub</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background:#0f0f0f; color:#eee; min-height:100vh; }
  header {
    background: linear-gradient(90deg, #1a1a1a, #2a2a2a);
    padding: 18px 24px; display: flex; justify-content: space-between;
    align-items: center; border-bottom: 2px solid #ff0040;
    position: sticky; top: 0; z-index: 100;
  }
  header h1 { color: #ff0040; font-size: 24px; }
  .container { max-width: 1300px; margin: 0 auto; padding: 30px 20px; }
  .grid {
    display: grid; gap: 20px;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
  .card {
    background: #1c1c1c; border-radius: 10px; overflow: hidden;
    cursor: pointer; transition: 0.3s; text-decoration: none; color: #eee;
    display: block;
  }
  .card:hover { transform: translateY(-5px); box-shadow: 0 10px 25px rgba(255,0,64,0.3); }
  .card .thumb {
    width: 100%; aspect-ratio: 16/9; background: #333;
    display: flex; align-items: center; justify-content: center;
    font-size: 40px; color: #666;
    background-size: cover; background-position: center;
    position: relative;
  }
  .card .play-icon {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 50px; height: 50px;
    background: rgba(255,0,64,0.9);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; color: #fff;
    transition: 0.3s;
  }
  .card:hover .play-icon { transform: translate(-50%, -50%) scale(1.15); }
  .card .info { padding: 12px; }
  .card .info h3 {
    font-size: 15px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .card .info p { font-size: 12px; color: #888; margin-top: 4px; }
  .pagination {
    display: flex; justify-content: center; gap: 8px;
    margin-top: 40px; flex-wrap: wrap;
  }
  .pagination button {
    padding: 10px 16px; background: #1c1c1c; color: #eee;
    border: 1px solid #333; border-radius: 6px; cursor: pointer; font-size: 14px;
  }
  .pagination button:hover:not(:disabled) { background: #ff0040; border-color: #ff0040; }
  .pagination button.active { background: #ff0040; border-color: #ff0040; }
  .pagination button:disabled { opacity: 0.3; cursor: not-allowed; }
  .empty { text-align: center; padding: 60px 20px; color: #666; font-size: 18px; }
</style>
</head>
<body>
<header>
  <h1>🎬 MovieHub</h1>
</header>
<div class="container">
  <div id="movies" class="grid"></div>
  <div id="pagination" class="pagination"></div>
</div>
<script>
async function loadMovies(page = 1) {
  const res = await fetch('/api/movies?page=' + page);
  const data = await res.json();
  const grid = document.getElementById('movies');
  grid.innerHTML = '';

  if (!data.items.length) {
    grid.innerHTML = '<div class="empty">এখনো কোনো ভিডিও যোগ করা হয়নি</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  data.items.forEach(m => {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = '/watch?id=' + m.id;
    const thumbStyle = m.thumbnail ? \`background-image:url('\${m.thumbnail}')\` : '';
    a.innerHTML = \`
      <div class="thumb" style="\${thumbStyle}">
        <div class="play-icon">▶</div>
      </div>
      <div class="info">
        <h3>\${escapeHtml(m.title)}</h3>
      </div>
    \`;
    grid.appendChild(a);
  });

  renderPagination(data.page, data.totalPages);
}

function renderPagination(current, total) {
  const el = document.getElementById('pagination');
  el.innerHTML = '';
  if (total <= 1) return;

  const prev = document.createElement('button');
  prev.textContent = '« Prev';
  prev.disabled = current === 1;
  prev.onclick = () => loadMovies(current - 1);
  el.appendChild(prev);

  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);

  for (let i = start; i <= end; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    if (i === current) btn.classList.add('active');
    btn.onclick = () => loadMovies(i);
    el.appendChild(btn);
  }

  const next = document.createElement('button');
  next.textContent = 'Next »';
  next.disabled = current === total;
  next.onclick = () => loadMovies(current + 1);
  el.appendChild(next);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

loadMovies(1);
</script>
</body>
</html>`;
}

// ==========================================
// WATCH PAGE (Full video, no lock)
// ==========================================
function watchPage(id) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎬 Watch</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: system-ui, sans-serif; background:#0f0f0f; color:#eee; }
  header {
    background:#1a1a1a; padding: 16px 24px;
    border-bottom: 2px solid #ff0040;
    display: flex; justify-content: space-between; align-items: center;
  }
  header h1 { color: #ff0040; font-size: 22px; }
  header a { color:#eee; text-decoration:none; padding:8px 14px; background:#ff0040; border-radius:6px; font-size:14px; }
  .wrap { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
  .player-box {
    position: relative; width: 100%; aspect-ratio: 16/9;
    background: #000; border-radius: 10px; overflow: hidden;
  }
  .player-box video, .player-box iframe {
    width: 100%; height: 100%; border: 0; display: block;
  }
  .title { margin-top: 20px; font-size: 22px; font-weight: 700; }
  .info { color: #888; margin-top: 8px; font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>🎬 MovieHub</h1>
  <a href="/">← Home</a>
</header>
<div class="wrap">
  <div class="player-box" id="playerBox"></div>
  <div class="title" id="title">Loading...</div>
  <div class="info" id="info"></div>
</div>

<script>
const id = new URLSearchParams(location.search).get('id');
const playerBox = document.getElementById('playerBox');
const titleEl = document.getElementById('title');
const infoEl = document.getElementById('info');

async function load() {
  const all = await fetchAllMovies();
  const movieData = all.find(m => m.id === id);
  if (!movieData) {
    titleEl.textContent = 'ভিডিও পাওয়া যায়নি';
    return;
  }
  titleEl.textContent = movieData.title;
  infoEl.textContent = 'এখন উপভোগ করুন 🎬';

  const isDirectVideo = /\\.(mp4|webm|ogg|m3u8)(\\?|$)/i.test(movieData.videoUrl);

  if (movieData.type === 'video' && isDirectVideo) {
    const video = document.createElement('video');
    video.src = movieData.videoUrl;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    playerBox.appendChild(video);
  } else {
    const iframe = document.createElement('iframe');
    iframe.src = movieData.videoUrl;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'no-referrer';
    playerBox.appendChild(iframe);
  }
}

async function fetchAllMovies() {
  let page = 1, all = [];
  while (true) {
    const r = await fetch('/api/movies?page=' + page);
    const d = await r.json();
    all = all.concat(d.items);
    if (page >= d.totalPages) break;
    page++;
  }
  return all;
}

load();
</script>
</body>
</html>`;
}

// ==========================================
// ADMIN PAGE
// ==========================================
function adminPage() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Panel</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: system-ui, sans-serif; background:#0f0f0f; color:#eee; min-height:100vh; }
  header {
    background:#1a1a1a; padding:16px 24px; display:flex;
    justify-content:space-between; align-items:center;
    border-bottom:2px solid #ff0040;
  }
  header h1 { color:#ff0040; font-size:22px; }
  header a { color:#eee; text-decoration:none; padding:8px 14px; background:#333; border-radius:6px; font-size:14px; }
  .wrap { max-width:900px; margin: 30px auto; padding: 0 20px; }
  .card { background:#1c1c1c; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
  .card h2 { color:#ff0040; margin-bottom: 16px; font-size: 18px; }
  label { display:block; margin-top: 12px; font-size: 14px; color:#aaa; }
  input, select, textarea {
    width: 100%; padding: 12px; margin-top: 6px; background:#111;
    border:1px solid #333; border-radius:6px; color:#eee; font-size:15px;
    font-family: inherit;
  }
  textarea { resize: vertical; min-height: 80px; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:#ff0040; }
  button.primary {
    background:#ff0040; color:#fff; border:none; padding: 12px 24px;
    border-radius: 6px; cursor:pointer; font-weight:600; margin-top: 20px;
    font-size: 15px;
  }
  button.primary:hover { opacity: 0.9; }
  button.danger { background:#c00; }
  button.small { padding: 6px 12px; font-size: 12px; margin: 0; }
  .movie-item {
    display:flex; justify-content:space-between; align-items:center;
    padding: 12px; background:#111; border-radius:6px; margin-bottom:8px;
    gap: 12px; flex-wrap: wrap;
  }
  .movie-item .info { flex:1; min-width: 200px; }
  .movie-item .info h4 { font-size: 14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .movie-item .info p { font-size: 12px; color: #888; margin-top: 4px; }
  .actions { display:flex; gap:6px; }
  .msg { padding: 10px; border-radius:6px; margin-top: 12px; display:none; }
  .msg.show { display:block; }
  .msg.ok { background: #164d2c; color:#b6ffb6; }
  .msg.err { background: #4d1616; color:#ffb6b6; }
  .hidden { display:none; }
  #loginCard { max-width: 400px; margin: 100px auto; }
  .hint { font-size: 12px; color:#666; margin-top: 4px; }
  .tag {
    display:inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 10px; font-weight: 700; margin-left: 6px;
  }
  .tag.iframe { background: #ff0040; color:#fff; }
  .tag.video { background: #0080ff; color:#fff; }
</style>
</head>
<body>
<header>
  <h1>⚙️ Admin Panel</h1>
  <a href="/">🏠 Home</a>
</header>
<div class="wrap">

  <div id="loginCard" class="card">
    <h2>Admin Login</h2>
    <label>Password</label>
    <input type="password" id="pwd" placeholder="Enter admin password">
    <button class="primary" onclick="doLogin()">Login</button>
    <div id="loginMsg" class="msg"></div>
  </div>

  <div id="adminContent" class="hidden">
    <div class="card">
      <h2 id="formTitle">➕ Add New Movie</h2>
      <input type="hidden" id="editId">

      <label>Movie Title</label>
      <input type="text" id="title" placeholder="Enter movie name">

      <label>Video Source Type</label>
      <select id="type" onchange="updateHint()">
        <option value="iframe">Iframe (YouTube / Dailymotion / Any Site)</option>
        <option value="video">Direct Video (mp4 / m3u8 / webm)</option>
      </select>
      <p class="hint" id="urlHint">পেস্ট করতে পারো শুধু URL, অথবা পুরো &lt;iframe&gt; কোড</p>

      <label>Video URL / Embed Code</label>
      <textarea id="videoUrl" placeholder='যেমন: &lt;iframe src="https://www.youtube.com/embed/xxxxx" ...&gt;&lt;/iframe&gt;'></textarea>
      <p class="hint">✅ শুধু URL, অথবা পুরো iframe HTML — দুটোই কাজ করবে</p>

      <label>Thumbnail URL (optional)</label>
      <input type="text" id="thumbnail" placeholder="https://example.com/thumb.jpg">

      <label>Preview Duration (seconds)</label>
      <select id="previewSec">
        <option value="5">5 seconds</option>
        <option value="10" selected>10 seconds</option>
        <option value="15">15 seconds</option>
        <option value="20">20 seconds</option>
        <option value="30">30 seconds</option>
        <option value="45">45 seconds</option>
        <option value="60">60 seconds</option>
      </select>

      <button class="primary" id="submitBtn" onclick="submitMovie()">Add Movie</button>
      <button class="primary" style="background:#333" onclick="resetForm()" id="cancelBtn" type="button">Cancel</button>
      <div id="addMsg" class="msg"></div>
    </div>

    <div class="card">
      <h2>🎬 All Movies</h2>
      <div id="movieList"></div>
      <div id="listMsg" class="msg"></div>
    </div>

    <button class="primary danger" onclick="logout()">Logout</button>
  </div>

</div>

<script>
let token = localStorage.getItem('admin_token') || '';

window.addEventListener('DOMContentLoaded', () => {
  if (token) verifyToken().then(ok => { if (ok) showAdmin(); });
});

async function verifyToken() {
  const r = await fetch('/api/check-auth', { headers: { 'X-Admin-Password': token } });
  return r.ok;
}

async function doLogin() {
  const pwd = document.getElementById('pwd').value;
  const r = await fetch('/api/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: pwd })
  });
  const d = await r.json();
  const msg = document.getElementById('loginMsg');
  if (r.ok) {
    token = d.token;
    localStorage.setItem('admin_token', token);
    showAdmin();
  } else {
    msg.textContent = d.error || 'Login failed';
    msg.className = 'msg err show';
  }
}

function showAdmin() {
  document.getElementById('loginCard').classList.add('hidden');
  document.getElementById('adminContent').classList.remove('hidden');
  loadList();
}

function logout() {
  localStorage.removeItem('admin_token');
  location.reload();
}

function updateHint() {
  const t = document.getElementById('type').value;
  const hint = document.getElementById('urlHint');
  const input = document.getElementById('videoUrl');
  if (t === 'iframe') {
    hint.textContent = '✅ শুধু URL, অথবা পুরো iframe HTML — দুটোই কাজ করবে';
    input.placeholder = 'যেমন: <iframe src="https://www.youtube.com/embed/xxxxx" ...></iframe>';
  } else {
    hint.textContent = 'যেমন: https://example.com/video.mp4';
    input.placeholder = 'https://example.com/video.mp4';
  }
}

function resetForm() {
  document.getElementById('editId').value = '';
  document.getElementById('title').value = '';
  document.getElementById('videoUrl').value = '';
  document.getElementById('thumbnail').value = '';
  document.getElementById('previewSec').value = '10';
  document.getElementById('type').value = 'iframe';
  document.getElementById('formTitle').textContent = '➕ Add New Movie';
  document.getElementById('submitBtn').textContent = 'Add Movie';
  document.getElementById('cancelBtn').classList.add('hidden');
  updateHint();
}

async function submitMovie() {
  const editId = document.getElementById('editId').value;
  const title = document.getElementById('title').value.trim();
  const videoUrl = document.getElementById('videoUrl').value.trim();
  const thumbnail = document.getElementById('thumbnail').value.trim();
  const previewSec = document.getElementById('previewSec').value;
  const type = document.getElementById('type').value;
  const msg = document.getElementById('addMsg');

  if (!title || !videoUrl) {
    msg.textContent = 'Title & Video URL দিতে হবে';
    msg.className = 'msg err show';
    return;
  }

  const url = editId ? '/api/movies/update' : '/api/movies';
  const payload = { title, videoUrl, thumbnail, previewSec, type };
  if (editId) payload.id = editId;

  const r = await fetch(url, {
    method:'POST',
    headers: {
      'Content-Type':'application/json',
      'X-Admin-Password': token
    },
    body: JSON.stringify(payload)
  });
  const d = await r.json();
  if (r.ok) {
    msg.textContent = editId ? '✅ Movie updated!' : '✅ Movie added successfully!';
    msg.className = 'msg ok show';
    resetForm();
    loadList();
    setTimeout(() => msg.classList.remove('show'), 2500);
  } else {
    msg.textContent = d.error || 'Failed';
    msg.className = 'msg err show';
  }
}

async function loadList() {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch('/api/movies?page=' + page);
    const d = await r.json();
    all.push(...d.items);
    if (page >= d.totalPages) break;
    page++;
  }
  const el = document.getElementById('movieList');
  if (!all.length) {
    el.innerHTML = '<p style="color:#666">কোনো মুভি নেই</p>';
    return;
  }
  el.innerHTML = all.map(m => \`
    <div class="movie-item">
      <div class="info">
        <h4>\${escapeHtml(m.title)}<span class="tag \${m.type === 'iframe' ? 'iframe' : 'video'}">\${(m.type || 'iframe').toUpperCase()}</span></h4>
        <p>⏱ Preview: \${m.previewSec}s</p>
      </div>
      <div class="actions">
        <button class="primary small" onclick='editMovie("\${m.id}")'>Edit</button>
        <button class="primary small danger" onclick='delMovie("\${m.id}")'>Delete</button>
      </div>
    </div>
  \`).join('');
}

async function editMovie(id) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch('/api/movies?page=' + page);
    const d = await r.json();
    all.push(...d.items);
    if (page >= d.totalPages) break;
    page++;
  }
  const m = all.find(x => x.id === id);
  if (!m) return;
  document.getElementById('editId').value = m.id;
  document.getElementById('title').value = m.title;
  document.getElementById('videoUrl').value = m.videoUrl;
  document.getElementById('thumbnail').value = m.thumbnail || '';
  document.getElementById('previewSec').value = m.previewSec;
  document.getElementById('type').value = m.type || 'iframe';
  document.getElementById('formTitle').textContent = '✏️ Edit Movie';
  document.getElementById('submitBtn').textContent = 'Update Movie';
  document.getElementById('cancelBtn').classList.remove('hidden');
  updateHint();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function delMovie(id) {
  if (!confirm('Delete this movie?')) return;
  const r = await fetch('/api/movies/' + id, {
    method: 'DELETE',
    headers: { 'X-Admin-Password': token }
  });
  if (r.ok) loadList();
  else alert('Delete failed');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
</script>
</body>
</html>`;
}
