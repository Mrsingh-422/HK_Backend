const mongoose = require('mongoose');

const tabSchema = new mongoose.Schema({
    tabId: { type: Number, required: true, unique: true }, 
    name: { type: String, required: true },               
    parentId: { type: Number, default: 0 },               
    subParentId: { type: Number, default: 0 }             
}, { timestamps: true });

module.exports = mongoose.model('Tab', tabSchema);