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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "123"; 

let approvedPhotos = []; 
let rejectedPhotos = []; 
let connectedUsers = {}; 

const uploadPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use('/uploads', express.static(uploadPath));
app.use(express.json());

// --- 1. PAGE INVITÉ ---
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <h2 style="margin-bottom:5px;">📸 Dk'anim</h2>
                <p style="color:#aaa; font-size:14px; margin-bottom:20px;">Partagez vos moments en direct !</p>
                <input type="text" id="user" placeholder="Votre Prénom" style="width:100%; padding:15px; margin-bottom:25px; border-radius:10px; border:none; background:#333; color:white; font-size:16px;">
                <div style="display:flex; flex-direction:column; gap:15px;">
                    <label style="background:#007bff; padding:20px; border-radius:15px; cursor:pointer; font-weight:bold;">
                        <input type="file" id="file_cam" accept="image/*" capture="camera" style="display:none;" onchange="document.getElementById('txt_cam').innerText='✅ PHOTO PRÊTE'">
                        <span id="txt_cam">📸 PRENDRE UNE PHOTO</span>
                    </label>
                    <label style="background:#444; padding:20px; border-radius:15px; cursor:pointer;">
                        <input type="file" id="file_album" accept="image/*" style="display:none;" onchange="document.getElementById('txt_album').innerText='✅ IMAGE CHOISIE'">
                        <span id="txt_album">🖼️ DEPUIS L'ALBUM</span>
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
                    const res = await fetch('/upload', { method:'POST', body:fd });
                    if(res.ok) { alert("Photo envoyée à Dk'anim !"); location.reload(); }
                    else { alert("Erreur d'envoi"); }
                }
            </script>
        </body>
    `);
});

// --- 2. PAGE ADMIN ---
app.get('/admin', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:10px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:10px;">
                <h1 style="margin:0; font-size:18px;">🛡 Dk'anim Admin <span id="count" style="font-size:12px; color:#666;">(0)</span></h1>
                <div style="display:flex; gap:5px; align-items:center;">
                    <input type="password" id="pass" placeholder="Code" style="padding:8px; border-radius:5px; border:1px solid #ccc; width:60px;">
                    <button onclick="window.location.href='/download-all?pass='+document.getElementById('pass').value" style="background:#444; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer;">💾 ZIP</button>
                </div>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:10px; border:none; border-radius:8px; cursor:pointer; background:#007bff; color:white; font-weight:bold;">📥 ATTENTE</button>
                <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:10px; border:none; border-radius:8px; cursor:pointer; background:#ddd;">✅ OUI (<span id="nb-oui">0</span>)</button>
                <button onclick="showTab('rejected')" id="btn-rejected" style="flex:1; padding:10px; border:none; border-radius:8px; cursor:pointer; background:#ddd;">❌ NON (<span id="nb-non">0</span>)</button>
            </div>

            <div id="tab-pending" class="tab-content" style="display:block;"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-rejected" class="tab-content" style="display:none;"><div id="list-rejected" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                function showTab(t) {
                    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
                    document.getElementById('tab-' + t).style.display = 'block';
                    document.querySelectorAll('button').forEach(b => { if(b.id.startsWith('btn-')) b.style.background = '#ddd'; b.style.color = 'black'; });
                    document.getElementById('btn-'+t).style.background = (t==='pending'?'#007bff':(t==='approved'?'#28a745':'#dc3545'));
                    document.getElementById('btn-'+t).style.color = 'white';
                }

                socket.on('init_admin', d => {
                    document.getElementById('nb-oui').innerText = d.approved.length;
                    document.getElementById('nb-non').innerText = d.rejected.length;
                    d.approved.forEach(p => addThumb(p, 'list-approved'));
                    d.rejected.forEach(p => addThumb(p, 'list-rejected'));
                });

                socket.on('update_users', d => { document.getElementById('count').innerText = "👤 " + d.total; });

                socket.on('new_photo_pending', d => {
                    const div = document.createElement('div');
                    div.style = "background:white; padding:8px; border-radius:10px; text-align:center; width:155px; box-shadow:0 2px 5px rgba(0,0,0,0.1);";
                    div.innerHTML = \`
                        <img src="\${d.url}" style="width:100%; height:110px; object-fit:cover; border-radius:5px;">
                        <p style="margin:5px 0; font-size:13px;">👤 <b>\${d.user}</b></p>
                        <div style="display:flex; gap:5px;">
                            <button onclick="decide(this,'\${d.url}','\${d.user}','approve')" style="flex:1; background:#28a745; color:white; border:none; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer;">OUI</button>
                            <button onclick="decide(this,'\${d.url}','\${d.user}','reject')" style="flex:1; background:#dc3545; color:white; border:none; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer;">NON</button>
                        </div>\`;
                    document.getElementById('list-pending').prepend(div);
                });

                function addThumb(p, targetId) {
                    const div = document.createElement('div');
                    div.style = "background:white; padding:5px; border-radius:8px; text-align:center; width:90px;";
                    div.innerHTML = \`<img src="\${p.url}" style="width:100%; height:70px; object-fit:cover; border-radius:5px;"><p style="font-size:9px; margin:2px 0;">\${p.user}</p>\`;
                    document.getElementById(targetId).prepend(div);
                }

                async function decide(btn, url, user, action) {
                    const pass = document.getElementById('pass').value;
                    const res = await fetch('/'+action, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url, user, pass}) });
                    if(res.ok) { 
                        if(action==='approve') { addThumb({url, user}, 'list-approved'); let n=document.getElementById('nb-oui'); n.innerText = parseInt(n.innerText)+1; }
                        else { addThumb({url, user}, 'list-rejected'); let n=document.getElementById('nb-non'); n.innerText = parseInt(n.innerText)+1; }
                        btn.parentElement.parentElement.remove();
                    } else alert("Code incorrect");
                }
            </script>
        </body>
    `);
});

// --- 3. PAGE RÉTRO (DIAPORAMA) ---
app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif;">
            <div id="container" style="height:100vh; width:100vw; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
                <div id="top-bar" style="position:absolute; top:20px; left:30px; font-size:24px; color:#aaa; font-weight:bold;">📸 Dk'anim</div>
                <h1 id="msg">En attente des premières photos...</h1>
                <img id="img" style="max-width:100%; max-height:100vh; object-fit:contain; display:none;">
                <div id="tag" style="position:absolute; bottom:50px; background:rgba(0,0,0,0.7); padding:10px 30px; border-radius:30px; font-size:30px; display:none;"></div>
                <div style="position:absolute; bottom:15px; right:15px; background:white; padding:10px; border-radius:10px; text-align:center;">
                    <img id="qr" style="width:100px; height:100px;">
                    <p style="color:black; margin:5px 0 0; font-size:12px; font-weight:bold;">SCANNEZ & ENVOYEZ !</p>
                </div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                document.getElementById('qr').src = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + encodeURIComponent(window.location.origin);
                const socket = io(); let playlist = []; let cur = 0; let timer = null;
                const i = document.getElementById('img'); const t = document.getElementById('tag'); const m = document.getElementById('msg');
                socket.on('init_photos', (ps) => { playlist = ps; if(ps.length > 0 && !timer) start(); });
                socket.on('show_photo', (p) => { playlist.push(p); if(!timer) start(); });
                function displayPhoto(p) { m.style.display = 'none'; i.style.display = 'block'; t.style.display = 'block'; i.src = p.url; t.innerText = "📸 " + p.user; }
                function showNext() { if(playlist.length === 0) return; cur = (cur + 1) % playlist.length; displayPhoto(playlist[cur]); }
                function start() { displayPhoto(playlist[cur]); timer = setInterval(showNext, 5000); }
            </script>
        </body>
    `);
});

// --- LOGIQUE SERVEUR ---
io.on('connection', (s) => {
    s.emit('init_photos', approvedPhotos);
    s.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos });
    s.on('identify', (n) => { connectedUsers[s.id] = n || "Anonyme"; broadcastUsers(); });
    s.on('disconnect', () => { delete connectedUsers[s.id]; broadcastUsers(); });
    function broadcastUsers() { io.emit('update_users', { total: Object.keys(connectedUsers).length }); }
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
    if(req.query.pass !== ADMIN_PASSWORD) return res.send("Code incorrect");
    const archive = archiver('zip');
    res.attachment('photos-dkanim.zip');
    archive.pipe(res);
    approvedPhotos.forEach(p => {
        const filePath = path.join(__dirname, p.url);
        if(fs.existsSync(filePath)) archive.file(filePath, { name: path.basename(filePath) });
    });
    archive.finalize();
});

server.listen(PORT, () => console.log(`🚀 Dk'anim lancé sur le port: ${PORT}`));
