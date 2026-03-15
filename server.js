const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connecté à MongoDB"))
    .catch(err => console.error("❌ Erreur MongoDB :", err));

const Script = mongoose.model('Script', {
    title: String,
    fanart: String,
    description: String,
    loadstring: String
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware de sécurité
const auth = (req, res, next) => {
    const pass = req.query.password || req.body.password;
    if (pass === ADMIN_PASSWORD) return next();
    res.status(403).send("Accès refusé : Ajoutez ?password=... à l'URL");
};

app.get('/', async (req, res) => {
    const scripts = await Script.find();
    res.render('index', { scripts });
});

app.get('/admin', auth, async (req, res) => {
    const scripts = await Script.find();
    res.render('admin', { scripts, password: req.query.password || req.body.password });
});

app.post('/admin/add', auth, async (req, res) => {
    await Script.create(req.body);
    res.redirect(`/admin?password=${ADMIN_PASSWORD}`);
});

app.get('/admin/delete/:id', auth, async (req, res) => {
    await Script.findByIdAndDelete(req.params.id);
    res.redirect(`/admin?password=${ADMIN_PASSWORD}`);
});

app.listen(PORT, () => console.log(`Serveur sur port ${PORT}`));
