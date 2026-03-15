require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const User = require('./models/User');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Pour vos fichiers CSS/JS clients

// Connexion MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Connecté"))
    .catch(err => console.error("❌ Erreur DB:", err));

// --- ROUTES RENDU (FRONTEND SIMPLE) ---

app.get('/', (req, res) => {
    res.send(`
        <h1>Bienvenue sur MyDiscord-Clone</h1>
        <p>Une plateforme de messagerie avec API Lua intégrée.</p>
        <hr>
        <a href="/login">Se connecter</a> | <a href="/signup">S'inscrire</a>
    `);
});

app.get('/signup', (req, res) => {
    res.send(`
        <h2>Inscription</h2>
        <form action="/api/auth/signup" method="POST">
            <input type="text" name="username" placeholder="Pseudo" required><br>
            <input type="email" name="email" placeholder="Email" required><br>
            <input type="password" name="password" placeholder="Mot de passe" required><br>
            <button type="submit">Créer mon compte</button>
        </form>
    `);
});

app.get('/login', (req, res) => {
    res.send(`
        <h2>Connexion</h2>
        <form action="/api/auth/login" method="POST">
            <input type="email" name="email" placeholder="Email" required><br>
            <input type="password" name="password" placeholder="Mot de passe" required><br>
            <button type="submit">Entrer</button>
        </form>
    `);
});

// --- ROUTES API (LOGIQUE) ---

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({ username, email, password: hashedPassword });
        await newUser.save();
        
        res.send("Compte créé ! <a href='/login'>Connectez-vous ici</a>");
    } catch (err) {
        res.status(400).send("Erreur lors de l'inscription : " + err.message);
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        // Ici on redirigera vers l'espace membre plus tard
        res.send(`Connecté ! Votre Token Webhook est : ${user.webhookToken}`);
    } else {
        res.status(401).send("Identifiants incorrects.");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
