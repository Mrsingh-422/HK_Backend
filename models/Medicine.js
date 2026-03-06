const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
    originalId: { type: String }, // Excel ka 'Id'
    bread_crumb: { type: String },
    url: { type: String },
    name: { type: String, required: true },
    manufacturers: { type: String },
    salt_composition: { type: String },
    packaging: { type: String },
    mrp: { type: String },
    best_price: { type: String },
    discont_percent: { type: String },
    prescription_required: { type: String },
    
    // Excel me image_url me '|' se separate karke multiple links hain
    image_url: [{ type: String }], 
    
    primary_use: { type: String },
    description: { type: String },
    salt_synonmys: { type: String },
    storage: { type: String },
    introduction: { type: String },
    use_of: { type: String },
    benefits: { type: String },
    side_effect: { type: String },
    how_to_use: { type: String },
    how_works: { type: String },
    safety_advise: { type: String },
    if_miss: { type: String },
    alternate_brand: { type: String },
    manufaturer_address: { type: String },
    for_sale: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Medicine', medicineSchema);