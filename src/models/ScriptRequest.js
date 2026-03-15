const mongoose = require('mongoose');

const ScriptRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: String,
    webhookuuid: String,
    receivers: String, // Les noms Roblox
    minIncome: String,
    status: { type: String, default: 'Pending' }, // Pour ton futur panel admin
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScriptRequest', ScriptRequestSchema);
