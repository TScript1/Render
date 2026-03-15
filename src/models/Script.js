const mongoose = require('mongoose');

const ScriptSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: String, required: true }, // ex: MagixSafe
    minIncome: { type: String, required: true }, // ex: 10M/s
    scriptCode: { type: String, required: true }, // Le loadstring
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Script', ScriptSchema);
