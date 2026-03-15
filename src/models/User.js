const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); // Pour générer le token webhook

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    webhookToken: { type: String, default: uuidv4 }, // Ton fameux webhook perso
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
