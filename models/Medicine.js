const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
    Id: { type: String, unique: true, index: true },
    bread_crumb: { type: String, index: true },
    url: { type: String },
    name: { type: String, index: true },
    manufacturers: { type: String, index: true },
    salt_composition: { type: String, index: true },
    packaging: { type: String },
    mrp: { type: String },
    best_price: { type: String },
    discont_percent: { type: String },
    prescription_required: { type: String },
    image_url: [String], 
    primary_use: { type: String },
    description: { type: String },
    salt_synonmys: { type: String },
    storage: { type: String },
    introduction: { type: String },
    use_of: { type: String },
    benefits: { type: String },
    side_effect: { type: String },
    how_crop_side_effects: { type: String },
    how_to_use: { type: String },
    how_works: { type: String },
    safety_advise: { type: String },
    if_miss: { type: String },
    alternate_brand: { type: String },
    manufaturer_address: { type: String },
    for_sale: { type: String }
}, {
    timestamps: true 
});

module.exports = mongoose.model('Medicine', medicineSchema);