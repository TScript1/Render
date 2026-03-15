require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// Modèles
const User = require('./models/User');
const Message = require('./models/Message');
const Script = require('./models/Script');
const ScriptRequest = require('./models/ScriptRequest');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), 'public')));

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connecté"))
    .catch(err => console.error("❌ Erreur DB:", err));

const authMiddleware = (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) return res.redirect('/login');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('auth_token');
        res.redirect('/login');
    }
};

// --- ROUTES RENDU ---
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), 'public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(process.cwd(), 'public/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(process.cwd(), 'public/signup.html')));
app.get('/dashboard', authMiddleware, (req, res) => res.sendFile(path.join(process.cwd(), 'public/dashboard.html')));
app.get('/admin', authMiddleware, (req, res) => res.sendFile(path.join(process.cwd(), 'public/admin.html')));

// --- API AUTH ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, hitsCount: 0 });
        await newUser.save();
        res.redirect('/login');
    } catch (err) {
        res.status(400).send("Erreur: " + err.message);
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign(
            { id: user._id, username: user.username, webhook: user.webhookToken }, 
            process.env.JWT_SECRET, 
            { expiresIn: '24h' }
        );
        res.cookie('auth_token', token, { httpOnly: true });
        res.redirect('/dashboard');
    } else {
        res.send("Identifiants incorrects.");
    }
});

app.get('/api/user/me', authMiddleware, (req, res) => res.json(req.user));

// --- API CHAT ---
app.get('/api/messages', authMiddleware, async (req, res) => {
    const messages = await Message.find({ recipient: 'General' }).sort({ timestamp: 1 }).limit(50);
    res.json(messages);
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
    const newMessage = new Message({
        sender: req.user.id,
        senderName: req.user.username,
        recipient: 'General',
        content: req.body.content
    });
    await newMessage.save();
    io.emit('new_general_message', newMessage); 
    res.json({ success: true });
});

// --- API SCRIPTS ---
app.get('/api/my-scripts', authMiddleware, async (req, res) => {
    const scripts = await Script.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(scripts);
});

app.post('/api/scripts/request', authMiddleware, async (req, res) => {
    const newRequest = new ScriptRequest({
        userId: req.user.id,
        username: req.user.username,
        webhookuuid: req.user.webhook,
        receivers: req.body.receivers,
        minIncome: req.body.minIncome
    });
    await newRequest.save();
    io.emit('new_script_request'); // Notifier l'admin
    res.json({ success: true });
});

// --- API ADMIN ---
app.post('/api/admin/verify', authMiddleware, (req, res) => {
    if (req.body.password === process.env.MASTER_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false });
});

app.get('/api/admin/users', authMiddleware, async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.MASTER_PASSWORD) return res.status(403).end();
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json(users);
});

app.get('/api/admin/requests', authMiddleware, async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.MASTER_PASSWORD) return res.status(403).end();
    const requests = await ScriptRequest.find().sort({ createdAt: -1 });
    res.json(requests);
});

app.delete('/api/admin/users/:id', authMiddleware, async (req, res) => {
    if (req.headers['x-admin-key'] !== process.env.MASTER_PASSWORD) return res.status(403).end();
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post('/api/scripts/send', async (req, res) => {
    const { webhookuuid, receiver, minincome, script } = req.body;
    const user = await User.findOne({ webhookToken: webhookuuid });
    if (!user) return res.status(404).json({ error: "UUID Invalide" });

    const newScript = new Script({ userId: user._id, receiver, minIncome: minincome, scriptCode: script });
    await newScript.save();
    await ScriptRequest.findOneAndDelete({ webhookuuid: webhookuuid, minIncome: minincome });

    io.to(user._id.toString()).emit('script_generated');
    res.json({ success: true });
});

// --- WEBHOOK (POST pour le bot, GET pour le test admin) ---
app.all('/webhook/:token', async (req, res) => {
    const user = await User.findOneAndUpdate(
        { webhookToken: req.params.token },
        { $inc: { hitsCount: 1 } }
    );
    if (user) {
        const hitData = {
            username: req.body.username || "Test_User",
            executor: req.body.executor || "Admin_Panel",
            text: req.body.text || "🚨 New hit captured!",
            date: new Date().toLocaleTimeString()
        };
        io.to(user._id.toString()).emit('receive_message', hitData);
        return req.method === 'GET' ? res.send("<h1>Hit envoyé !</h1>") : res.json({ status: "success" });
    }
    res.status(404).json({ error: "Invalid Token" });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('join_room', (userId) => socket.join(userId));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Serveur sur port ${PORT}`));
