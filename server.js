const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION PUBLIQUE / CLOUD ---
const PORT = process.env.PORT || 3000;
const MY_IP = process.env.PUBLIC_URL || ""; 
const ADMIN_PASSWORD = "123"; 

let approvedPhotos = []; 
let rejectedPhotos = []; 
let connectedUsers = {}; 

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');

if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true });
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.static(publicPath));
app.use(express.json());

// --- 1. PAGE INVITÉ ---
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <h2 style="margin-bottom:5px;">📸 Mariage</h2>
                <input type="text" id="user" placeholder="Votre Prénom" style="width:100%; padding:15px; margin-bottom:25px; border-radius:10px; border:none; background:#333; color:white; font-size:16px;">
                <div style="display:flex; flex-direction:column; gap:15px;">
                    <label style="background:#007bff; padding:20px; border-radius:15px; cursor:pointer; font-weight:bold;">
                        <input type="file" id="file_cam" accept="image/*" capture="camera" style="display:none;" onchange="document.getElementById('txt_cam').innerText='✅ PHOTO PRÊTE'">
                        <span id="txt_cam">📸 PRENDRE UNE PHOTO</span>
                    </label>
                    <label style="background:#444; padding:20px; border-radius:15px; cursor:pointer;">
                        <input type="file" id="file_album" accept="image/*" style="display:none;" onchange="document.getElementById('txt_album').innerText='✅ IMAGE CHOISIE'">
                        <span id="txt_album">🖼️ ALBUM</span>
                    </label>
                </div>
                <button id="sendBtn" onclick="send()" style="width:100%; padding:20px; background:#28a745; color:white; border:none; border-radius:12px; margin-top:30px; cursor:pointer; font-weight:bold; font-size:18px;">ENVOYER</button>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                const inputUser = document.getElementById('user');
                const savedName = localStorage.getItem('guestName');
                if(savedName) { inputUser.value = savedName; socket.emit('identify', savedName); }
                inputUser.onchange = () => { localStorage.setItem('guestName', inputUser.value); socket.emit('identify', inputUser.value); };
                async function send() {
                    const file = document.getElementById('file_cam').files[0] || document.getElementById('file_album').files[0];
                    if(!file || !inputUser.value) return alert("Prénom + Photo requis !");
                    const fd = new FormData(); fd.append('photo', file); fd.append('username', inputUser.value);
                    await fetch('/upload', { method:'POST', body:fd });
                    alert("C'est envoyé !"); location.reload();
                }
            </script>
        </body>
    `);
});

// --- 2. PAGE ADMIN (RESTAURÉE AVEC TOUTES TES FONCTIONS) ---
app.get('/admin', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div id="modal-users" onclick="closeUsers()" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center;">
                <div style="background:white; padding:25px; border-radius:15px; width:280px;" onclick="event.stopPropagation()">
                    <h2 style="margin-top:0;">👥 En ligne</h2>
                    <div id="full-user-list" style="max-height:300px; overflow-y:auto; font-size:18px;"></div>
                    <button onclick="closeUsers()" style="width:100%; margin-top:20px; padding:12px; background:#444; color:white; border:none; border-radius:8px;">Fermer</button>
                </div>
            </div>

            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div>
                        <h1 style="margin:0; font-size:18px;">🛡 Admin</h1>
                        <button onclick="openUsers()" style="background:none; border:none; color:#007bff; padding:0; cursor:pointer; font-size:12px; text-decoration:underline;">👥 <span id="count">0</span> connectés</button>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                    <input type="password" id="pass" placeholder="Code" style="padding:8px; border-radius:5px; border:1px solid #ccc; width:80px;">
                    <button onclick="downloadZip()" style="font-size:10px; background:#444; color:white; border:none; padding:5px 8px; border-radius:4px; cursor:pointer;">💾 ZIP</button>
                </div>
            </div>

            <div style="display:flex; gap:8px; margin-bottom:15px;">
                <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:12px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; background:#007bff; color:white;">📥 ATTENTE</button>
                <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:12px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; background:#ddd;">✅ OUI (<span id="nb-oui">0</span>)</button>
                <button onclick="showTab('rejected')" id="btn-rejected" style="flex:1; padding:12px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; background:#ddd;">❌ NON (<span id="nb-non">0</span>)</button>
            </div>

            <div id="tab-pending" class="tab-content" style="display:block;"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-rejected" class="tab-content" style="display:none;"><div id="list-rejected" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                let currentNames = [];
                let approvedCount = 0;
                let rejectedCount = 0;

                function openUsers() { 
                    document.getElementById('full-user-list').innerHTML = currentNames.length > 0 ? currentNames.map(n => "• " + n).join('<br>') : "Personne";
                    document.getElementById('modal-users').style.display = 'flex'; 
                }
                function closeUsers() { document.getElementById('modal-users').style.display = 'none'; }
                function downloadZip() { window.location.href = "/download-all?pass=" + document.getElementById('pass').value; }

                function updateCounters() {
                    document.getElementById('nb-oui').innerText = approvedCount;
                    document.getElementById('nb-non').innerText = rejectedCount;
                }

                function showTab(t) {
                    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
                    document.querySelectorAll('button[id^="btn-"]').forEach(b => { b.style.background = '#ddd'; b.style.color = 'black'; });
                    document.getElementById('tab-' + t).style.display = 'block';
                    const a = document.getElementById('btn-' + t);
                    a.style.color = 'white';
                    a.style.background = (t === 'pending' ? '#007bff' : (t === 'approved' ? '#28a745' : '#dc3545'));
                }

                socket.on('init_admin', d => {
                    approvedCount = d.approved.length;
                    rejectedCount = d.rejected.length;
                    updateCounters();
                    d.approved.forEach(p => addThumb(p, 'list-approved', false));
                    d.rejected.forEach(p => addThumb(p, 'list-rejected', true));
                });

                socket.on('update_users', d => { document.getElementById('count').innerText = d.total; currentNames = d.names; });

                socket.on('new_photo_pending', d => {
                    const div = document.createElement('div');
                    div.style = "background:white; padding:8px; border-radius:10px; text-align:center; width:155px; box-shadow:0 2px 5px rgba(0,0,0,0.1);";
                    div.innerHTML = \`
                        <img src="\${d.url}" style="width:100%; height:110px; object-fit:cover; border-radius:5px;">
                        <p style="margin:5px 0; font-size:13px;">👤 <b>\${d.user}</b></p>
                        <div style="display:flex; gap:5px;">
                            <button onclick="action(this,'/approve','\${d.url}','\${d.user}')" style="background:#28a745; color:white; border:none; padding:8px; border-radius:5px; flex:1; font-weight:bold;">OUI</button>
                            <button onclick="action(this,'/reject','\${d.url}','\${d.user}')" style="background:#dc3545; color:white; border:none; padding:8px; border-radius:5px; flex:1; font-weight:bold;">NON</button>
                        </div>\`;
                    document.getElementById('list-pending').prepend(div);
                });

                function addThumb(p, targetId, isRejected) {
                    const div = document.createElement('div');
                    div.style = "background:white; padding:5px; border-radius:8px; text-align:center; width:90px; box-shadow:0 1px 3px rgba(0,0,0,0.1); position:relative;";
                    div.innerHTML = \`<img src="\${p.url}" style="width:100%; height:70px; object-fit:cover; border-radius:5px;">
                        <p style="font-size:9px; margin:3px 0;">\${p.user}</p>
                        \${isRejected ? \`<button onclick="restore(this,'\${p.url}','\${p.user}')" style="font-size:8px; background:#007bff; color:white; border:none; width:100%; border-radius:3px; cursor:pointer;">RÉTABLIR</button>\` : ''}\`;
                    document.getElementById(targetId).prepend(div);
                }

                async function action(btn, route, url, user) {
                    const pass = document.getElementById('pass').value;
                    const res = await fetch(route, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url, user, pass}) });
                    if(res.ok) {
                        if(route === '/approve') { approvedCount++; addThumb({url, user}, 'list-approved', false); }
                        else { rejectedCount++; addThumb({url, user}, 'list-rejected', true); }
                        updateCounters();
                        btn.closest('div').parentElement.remove();
                    } else alert("Code incorrect");
                }

                function restore(btn, url, user) {
                    rejectedCount--;
                    updateCounters();
                    socket.emit('restore_photo', {url, user});
                    btn.parentElement.remove();
                }
            </script>
        </body>
    `);
});

// --- 3. PAGE RÉTRO (PLEIN ÉCRAN + QR DYNAMIQUE) ---
app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif;">
            <button id="fsBtn" onclick="toggleFS()" style="position:fixed; top:10px; right:10px; z-index:100; background:rgba(255,255,255,0.2); border:none; color:white; padding:10px; border-radius:5px; cursor:pointer; opacity:0; transition:opacity 0.5s;">⛶ Plein écran</button>
            <div id="container" style="height:100vh; width:100vw; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative; background:black;">
                <h1 id="msg">En attente de photos...</h1>
                <img id="img" style="max-width:100%; max-height:100vh; object-fit:contain; display:none; transition:opacity 1s, transform 6s linear; opacity:0;">
                <div id="tag" style="position:absolute; bottom:60px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); padding:15px 40px; border-radius:50px; font-size:45px; border:3px solid white; display:none; z-index:10; box-shadow:0 0 20px rgba(255,255,255,0.3);"></div>
                <div style="position:absolute; bottom:15px; right:15px; background:white; padding:8px; border-radius:10px; opacity:0.8;">
                    <img id="qr" src="" style="width:90px;">
                </div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                document.getElementById('qr').src = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + encodeURIComponent(window.location.origin);
                const socket = io(); let playlist = []; let cur = 0; let timer = null;
                const i = document.getElementById('img'); const t = document.getElementById('tag'); const m = document.getElementById('msg');
                const fsBtn = document.getElementById('fsBtn');

                let hideTimeout;
                window.onmousemove = () => { fsBtn.style.opacity = 1; clearTimeout(hideTimeout); hideTimeout = setTimeout(() => { fsBtn.style.opacity = 0; }, 3000); };
                function toggleFS() {
                    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
                    else if (document.exitFullscreen) document.exitFullscreen();
                }

                socket.on('init_photos', (ps) => { playlist = ps; if(ps.length > 0 && !timer) start(); });
                socket.on('show_photo', (p) => { playlist.push(p); if(!timer) start(); });

                function displayPhoto(p) {
                    m.style.display = 'none'; i.style.display = 'block'; t.style.display = 'block';
                    i.style.transition = 'none'; i.style.opacity = 0; i.style.transform = 'scale(1)';
                    setTimeout(() => { 
                        i.src = p.url; 
                        t.innerText = "📸 " + p.user; 
                        i.style.transition = 'opacity 1s, transform 7s linear'; i.style.opacity = 1; i.style.transform = 'scale(1.1)'; 
                    }, 50);
                }
                function showNext() { if(playlist.length === 0) return; cur = (cur + 1) % playlist.length; displayPhoto(playlist[cur]); }
                function start() { displayPhoto(playlist[cur]); timer = setInterval(showNext, 7000); }
            </script>
        </body>
    `);
});

// --- LOGIQUE SERVEUR (RESTREINTE AUX FONCTIONS ORIGINALES) ---
io.on('connection', (s) => {
    s.emit('init_photos', approvedPhotos);
    s.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos });
    s.on('identify', (n) => { connectedUsers[s.id] = n || "Anonyme"; broadcastUsers(); });
    s.on('disconnect', () => { delete connectedUsers[s.id]; broadcastUsers(); });
    s.on('restore_photo', (data) => {
        rejectedPhotos = rejectedPhotos.filter(p => p.url !== data.url);
        io.emit('new_photo_pending', data); 
    });
    function broadcastUsers() {
        const names = Object.values(connectedUsers).filter(n => n !== "Anonyme");
        io.emit('update_users', { total: Object.keys(connectedUsers).length, names: [...new Set(names)] });
    }
});

app.post('/upload', upload.single('photo'), (req, res) => {
    if(!req.file) return res.sendStatus(400);
    io.emit('new_photo_pending', { url: '/uploads/'+req.file.filename, user: req.body.username });
    res.sendStatus(200);
});

app.post('/approve', (req, res) => {
    if(req.body.pass === ADMIN_PASSWORD) {
        approvedPhotos.push({ url: req.body.url, user: req.body.user });
        io.emit('show_photo', { url: req.body.url, user: req.body.user });
        res.sendStatus(200);
    } else res.sendStatus(403);
});

app.post('/reject', (req, res) => {
    if(req.body.pass === ADMIN_PASSWORD) {
        rejectedPhotos.push({ url: req.body.url, user: req.body.user });
        res.sendStatus(200);
    } else res.sendStatus(403);
});

app.get('/download-all', (req, res) => {
    if(req.query.pass !== ADMIN_PASSWORD) return res.send("Mot de passe incorrect");
    const archive = archiver('zip');
    res.attachment('mariage-souvenirs.zip');
    archive.pipe(res);
    approvedPhotos.forEach(p => {
        const filePath = path.join(publicPath, p.url);
        if(fs.existsSync(filePath)) archive.file(filePath, { name: p.user + "-" + path.basename(filePath) });
    });
    archive.finalize();
});

server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Port: ${PORT}`));