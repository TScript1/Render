const mongoose = require('mongoose');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    // Génère un token de 8 caractères hexadécimaux (ex: A1B2C3D4)
    webhookToken: { 
        type: String, 
        default: () => crypto.randomBytes(4).toString('hex').toUpperCase(), 
        unique: true 
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
