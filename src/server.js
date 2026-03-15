require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const cookieParser = require('cookie-parser');
const User = require('./models/User');
const Message = require('./models/Message');
const crypto = require('crypto');

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

app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/signup.html'));
});

app.get('/dashboard', authMiddleware, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/dashboard.html'));
});

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

// Récupérer les 50 derniers messages du salon général
app.get('/api/messages', authMiddleware, async (req, res) => {
    try {
        const messages = await Message.find({ recipient: 'General' }) // On cible le salon General
            .sort({ timestamp: 1 })
            .limit(50);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: "Erreur de chargement" });
    }
});

// Envoyer un message au salon général
app.post('/api/messages/send', authMiddleware, async (req, res) => {
    const { content } = req.body;
    
    const newMessage = new Message({
        sender: req.user.id,
        senderName: req.user.username,
        recipient: 'General', // Toujours vers General
        content: content
    });

    await newMessage.save();

    // On diffuse à TOUS les utilisateurs connectés
    io.emit('new_general_message', newMessage); 
    
    res.json({ success: true });
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

// Route pour que le dashboard récupère les infos de l'utilisateur
app.get('/api/user/me', authMiddleware, (req, res) => {
    res.json(req.user);
});

// --- WEBHOOK EXTERNE ---
app.post('/webhook/:token', async (req, res) => {
    const user = await User.findOne({ webhookToken: req.params.token });
    if (user) {
        const messageContent = req.body.message || "Système: Requête reçue sur votre webhook.";
        io.to(user._id.toString()).emit('receive_message', {
            from: 'WEBHOOK EXTERNE',
            text: messageContent,
            date: new Date().toLocaleTimeString()
        });
        return res.json({ status: "success" });
    }
    res.status(404).json({ error: "Token invalide" });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('join_room', (userId) => {
        socket.join(userId);
        console.log(`Utilisateur ${userId} a rejoint sa room.`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Serveur sur http://localhost:${PORT}`));
