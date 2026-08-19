// seedDetailedHsn.js
const mongoose = require('mongoose');
const HsnMaster = require('./models/HsnMaster');
require('dotenv').config(); // Load environment variables from .env file

// 🚨 Database Connection string ko badlein
const MONGO_URI = process.env.MONGO_URI;

const detailedHsnData = [
    // 1. Finished Formulations (3004 Series) - 12% standard GST 
    { hsnCode: "30041010", description: "Penicillins and Ampicillin capsules, tablets, or oral dry syrups", totalGstPercent: 12 },
    { hsnCode: "30041020", description: "Ampicillin standard raw or blended formulation packing", totalGstPercent: 12 },
    { hsnCode: "30041030", description: "Amoxicillin dry syrups, dispersible tablets, and active combinations", totalGstPercent: 12 },
    { hsnCode: "30041090", description: "Other related penicillin therapeutic antibiotic variations", totalGstPercent: 12 },
    { hsnCode: "30042011", description: "Cephalosporins family (e.g., Cefixime, Cefpodoxime, Cefuroxime oral strips)", totalGstPercent: 12 },
    { hsnCode: "30042012", description: "Macrolides class medicines (e.g., Azithromycin tablets, Erythromycin suspensions)", totalGstPercent: 12 },
    { hsnCode: "30042013", description: "Quinolones class treatments (e.g., Ciprofloxacin, Ofloxacin, Levofloxacin)", totalGstPercent: 12 },
    { hsnCode: "30042019", description: "Other systemic wide-spectrum antibiotic tablets, or therapeutic liquids", totalGstPercent: 12 },
    { hsnCode: "30043110", description: "Insulin standard injections, multi-dose vials, and cartridges", totalGstPercent: 5 }, // Special 5% rate for Insulin
    { hsnCode: "30043200", description: "Corticosteroid systemic injections, structural pills, and ointments", totalGstPercent: 12 },
    { hsnCode: "30043912", description: "Oral anti-diabetic standard drugs (e.g., Metformin, Glimepiride, Sitagliptin)", totalGstPercent: 12 },
    { hsnCode: "30043921", description: "Thyroid management specific medications (e.g., Levothyroxine Sodium)", totalGstPercent: 12 },
    { hsnCode: "30045010", description: "Hematinic preparations (Therapeutic Iron and Folic Acid)", totalGstPercent: 12 },
    { hsnCode: "30045020", description: "Calcium and Vitamin D3 structural bone therapeutic combinations", totalGstPercent: 12 },
    { hsnCode: "30045030", description: "B-Complex, multivitamin formulations, and mineral combinations", totalGstPercent: 12 },
    { hsnCode: "30045036", description: "Calcium & Vitamin D3 Preparations", totalGstPercent: 12 },
    { hsnCode: "30049011", description: "Antipyretic, analgesic, anti-inflammatory packs (Paracetamol, Ibuprofen)", totalGstPercent: 12 },
    { hsnCode: "30049022", description: "Antihistamines and common allergy/cold medicines (Cetirizine, Montelukast)", totalGstPercent: 12 },
    { hsnCode: "30049029", description: "Antiulcer, antacid, and gastrointestinal line items (Pantoprazole, Omeprazole)", totalGstPercent: 12 },
    { hsnCode: "30049033", description: "Cardiovascular management and antihypertensive pills (Telmisartan, Amlodipine)", totalGstPercent: 12 },
    { hsnCode: "30049039", description: "Gastrointestinal Antacids & DSR series", totalGstPercent: 12 },
    { hsnCode: "30049044", description: "Antiepileptics, anticonvulsants, and neuro-care (Gabapentin, Levetiracetam)", totalGstPercent: 12 },
    { hsnCode: "30049069", description: "External Topical Gels & Ointments", totalGstPercent: 12 },
    { hsnCode: "30049099", description: "General unclassified allopathic prescription drugs (Fallback code)", totalGstPercent: 12 },

    // 2. AYUSH & Alternative Medicines - 12% GST
    { hsnCode: "30049012", description: "Branded Unani System healthcare formulations and herbal products", totalGstPercent: 12 },
    { hsnCode: "30049013", description: "Branded Siddha System therapeutic mineral or botanical preparations", totalGstPercent: 12 },
    { hsnCode: "30049014", description: "Homeopathic System diluted potencies, mother tinctures, and biochemic tablets", totalGstPercent: 12 },

    // 3. Vaccines & Biologicals - 5% GST
    { hsnCode: "30022013", description: "Human Single or Multi-component retail Vaccines (BCG, MMR, DPT)", totalGstPercent: 5 },
    { hsnCode: "30022021", description: "Tetanus Toxoid standard vaccine active single variants", totalGstPercent: 5 },
    { hsnCode: "30021500", description: "Monoclonal Antibodies, therapeutic sera, and fractions of blood", totalGstPercent: 5 },

    // 4. Surgical Consumables & Dressings - 12% GST
    { hsnCode: "30051010", description: "Adhesive plastic adhesive strips, medicated band-aids, and tapes", totalGstPercent: 12 },
    { hsnCode: "30059040", description: "Absorbent cotton wadding rolls, sterile dressing cotton pads, and lint", totalGstPercent: 12 },
    { hsnCode: "30059050", description: "Sterile surgical gauze cloths, rolled bandages, and compression bindings", totalGstPercent: 12 },
    { hsnCode: "30061010", description: "Sterile surgical absorbable catgut sutures, non-absorbable threads", totalGstPercent: 12 },
    { hsnCode: "30064000", description: "Dental cements, permanent or temporary fillings, and cavity resins", totalGstPercent: 12 },

    // 5. Fully Exempt Items - 0% GST
    { hsnCode: "30066010", description: "Hormonal or chemical contraceptive pills (Oral birth control)", totalGstPercent: 0 },
    { hsnCode: "40141010", description: "Rubber prophylactic physical barrier contraceptives (Condoms)", totalGstPercent: 0 },

    // 6. Diagnostic Kits & Cosmetics
    { hsnCode: "38221910", description: "Blood glucose glucometer electro-chemical strip packs", totalGstPercent: 12 },
    { hsnCode: "38221990", description: "Pregnancy card test kits, lateral flow rapid fever diagnostic kits", totalGstPercent: 12 },
    { hsnCode: "90189019", description: "Electronic clinical diagnostic tools (Digital BP monitors, oximeters)", totalGstPercent: 12 },
    { hsnCode: "33049990", description: "Medicated skincare products (Anti-acne washes, sunscreens)", totalGstPercent: 18 },
    { hsnCode: "21069099", description: "Non-therapeutic nutraceuticals, protein powders, and supplements", totalGstPercent: 18 }
];

const seedDetailedDatabase = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB...");
        await HsnMaster.deleteMany({});
        await HsnMaster.insertMany(detailedHsnData);
        console.log("SUCCESS: Master HSN collection successfully populated!");
        mongoose.connection.close();
    } catch (error) {
        console.error("Error seeding detailed HSN data:", error);
    }
};

seedDetailedDatabase();