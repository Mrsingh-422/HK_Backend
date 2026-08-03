const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { pharmacyPrescriptionUploads } = require('../../../middleware/multer');
const { scanPrescription,getMedicineSuggestions,getMedicineFullDetails, getMedicineCategories,getPharmacySubCategories,getMedicineCategoryDetails,getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails,searchAlternateBrand,getTrendingMedicinesNearUser,getStandardMedicineCatalog,getMedicineVendors,
    getPharmacySlots,getPharmacyDeliveryCharges,checkoutMedicineOrder,getPharmacyAvailableCoupons,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,verifyPharmacyPayment,getOrderHistory,trackOrder,
getLatestAddedMedicines,getNonPrescriptionMedicines,getHighestDiscountMedicines,

createPrescriptionRequest,payAndConfirmOrder,verifyPrescriptionRequestPayment,
 getUserPrescriptionRequests, getUserPrescriptionRequestDetails,estimateRxPrices,

getActiveStoreComboOffers,getGlobalActiveComboOffers,getComboOfferDetails,ratePharmacyOrder
} = require('../../../controllers/user/Pharmacy/BookPharmacy');

// Base URL: /user/pharmacy
const Medicine = require('../../../models/Medicine.js'); // Import the Medicine model
router.post('/push-legacy-alternates', async (req, res) => {
    try {
        // Purane records ke Id ke anusar detailed alternate brands ka mapping array
        const updates = [
    // --- 1. FEVER & PAIN (Paracetamol / NSAIDs) ---
    { id: "90001", alt: "Calpol 500 Tablet :: GSK :: 1.00/Tablet :: save 10% | Xykaa Rapid 650 Tablet :: Troikaa :: 2.01/Tablet :: save 2%" },
    { id: "90002", alt: "Dolo 650 Tablet :: Micro Labs :: 2.00/Tablet :: save 16% | P 500 Tablet :: Apex :: 0.90/Tablet :: save 10%" },
    { id: "90061", alt: "Flexon Tablet :: Aristo :: 1.50/Tablet :: save 12% | Combiflam Tablet :: Sanofi :: 1.70/Tablet :: same price" },
    { id: "90092", alt: "Hifenac-P Tablet :: Intas :: 4.20/Tablet :: save 8% | Zerodol-P Tablet :: Ipca :: 4.60/Tablet :: same price" },
    { id: "90073", alt: "Dart Tablet :: Crocin :: 3.50/Tablet :: save 5% | Saridon Tablet :: Bayer :: 3.60/Tablet :: same price" },

    // --- 2. CARDIAC CARE (Blood Pressure & Cholesterol) ---
    { id: "90003", alt: "Telmikind 40 Tablet :: Mankind Pharma :: 4.20/Tablet :: save 16% | Telma 40 Tablet :: Glenmark :: 10.00/Tablet :: same price" },
    { id: "90004", alt: "Telma 40 Tablet :: Glenmark :: 10.00/Tablet :: same price | Telmikind 40 Tablet :: Mankind :: 4.20/Tablet :: save 16%" },
    { id: "90005", alt: "Roseday 10 Tablet :: USV Ltd :: 8.66/Tablet :: save 5% | Rosuvas 10 Tablet :: Sun Pharma :: 9.06/Tablet :: same price" },
    { id: "90006", alt: "Rosuvas 10 Tablet :: Sun Pharma :: 9.06/Tablet :: same price | Roseday 10 Tablet :: USV Ltd :: 8.66/Tablet :: save 5%" },
    { id: "90007", alt: "Loprin 75 Tablet :: Unichem :: 0.35/Tablet :: save 12% | Ecosprin 75 Tablet :: USV Ltd :: 0.28/Tablet :: same price" },
    { id: "90057", alt: "Cilaheart 10 Tablet :: Mankind :: 7.00/Tablet :: save 15% | Cilacar 10 Tablet :: JB Chemicals :: 8.30/Tablet :: same price" },
    { id: "90076", alt: "Atorlip 10 Tablet :: Cipla :: 5.00/Tablet :: save 15% | Atorva 10 Tablet :: Zydus :: 5.66/Tablet :: same price" },
    { id: "90081", alt: "Amlong 5 Tablet :: Micro Labs :: 1.30/Tablet :: save 7% | Amlokind 5 Tablet :: Mankind :: 1.40/Tablet :: same price" },
    { id: "90090", alt: "Lipitor 10mg Tablet :: Pfizer :: 5.50/Tablet :: same price | Atacor 10 Tablet :: Ipca :: 4.53/Tablet :: save 15%" },

    // --- 3. NEURO CNS (Antipsychotics, Antidepressants, Insomnia) ---
    { id: "90008", alt: "Lozapin 100 Tablet :: Torrent :: 6.30/Tablet :: save 15% | Sizopin 100 Tablet :: Sun Pharma :: 6.80/Tablet :: same price" },
    { id: "90009", alt: "Sizopin 100 Tablet :: Sun Pharma :: 6.80/Tablet :: same price | Lozapin 100 Tablet :: Torrent :: 6.30/Tablet :: save 15%" },
    { id: "90010", alt: "Cipralex 10mg Tablet :: Lundbeck :: 8.50/Tablet :: save 5% | Nexito 10 Tablet :: Sun Pharma :: 9.30/Tablet :: same price" },
    { id: "90058", alt: "Paxil 12.5mg Tablet :: GSK :: 10.50/Tablet :: save 4% | Paxidep CR 12.5 :: Sun Pharma :: 9.50/Tablet :: same price" },
    { id: "90082", alt: "Zapiz 0.5 Tablet :: Zenara :: 3.50/Tablet :: save 8% | Clonafit 0.5 Tablet :: Mankind :: 3.80/Tablet :: same price" },
    { id: "90091", alt: "Valofit 3mg Tablet :: Abbott :: 4.80/Tablet :: save 5% | Meloset 3 Tablet :: Aristo :: 5.10/Tablet :: same price" },

    // --- 4. DIABETES (Oral Medication & Devices) ---
    { id: "90011", alt: "Zoryl-M 2 Tablet :: Intas :: 11.40/Tablet :: save 4% | Glycomet GP 2 Tablet :: USV Ltd :: 11.90/Tablet :: same price" },
    { id: "90012", alt: "Glycomet GP 2 Tablet :: USV Ltd :: 11.90/Tablet :: same price | Zoryl-M 2 Tablet :: Intas :: 11.40/Tablet :: save 4%" },
    { id: "90065", alt: "Istamet 50/500 Tablet :: Sun Pharma :: 18.50/Tablet :: save 7% | Janumet 50/500 :: MSD :: 19.80/Tablet :: same price" },
    { id: "90077", alt: "Volibo 0.3 Tablet :: Sun Pharma :: 7.20/Tablet :: same price | Vogli 0.3 Tablet :: Matrix :: 6.80/Tablet :: save 5%" },
    { id: "90013", alt: "OneTouch Select Strips :: LifeScan :: 19.40/Strip :: save 10% | Accu-Chek Active Strips :: Roche :: 19.80/Strip :: same price" },
    { id: "90014", alt: "Accu-Chek Active Strips :: Roche :: 19.80/Strip :: same price | OneTouch Select Plus Strips :: LifeScan :: 19.40/Strip :: save 2%" },
    { id: "90083", alt: "Accu-Chek Active Strips :: Roche :: 19.80/Strip :: same price | Dr. Morepen BG-03 Strips :: Morepen :: 18.00/Strip :: save 10%" },
    { id: "90094", alt: "Accu-Chek Active Strips :: Roche :: 19.80/Strip :: same price | OneTouch Select Plus Simple :: LifeScan :: 18.40/Strip :: save 7%" },

    // --- 5. AYURVEDA & HEALTH (Immunity, Liver, Digestion) ---
    { id: "90015", alt: "Patanjali Chyawanprash :: Patanjali :: 270.00/kg :: save 10% | Dabur Chyawanprash :: Dabur :: 335.00/kg :: same price" },
    { id: "90016", alt: "Dabur Chyawanprash :: Dabur :: 335.00/kg :: same price | Patanjali Chyawanprash :: Patanjali :: 270.00/kg :: save 10%" },
    { id: "90017", alt: "Amlycure DS :: Aimil :: 150.00/60tabs :: save 12% | Himalaya Liv.52 DS :: Himalaya :: 153.00/60tabs :: same price" },
    { id: "90086", alt: "Himalaya Liv.52 DS :: Himalaya :: 153.00/60tabs :: same price | Livan Syrup :: Local :: 100.00/200ml :: save 16%" },
    { id: "90059", alt: "Aristozyme Liquid :: Gastro :: 48.00/100ml :: save 8% | Neopeptine Capsule :: Raptakos :: 52.00/10caps :: same price" },
    { id: "90066", alt: "Baidyanath Ashwagandha :: Baidyanath :: 160.00/60tabs :: save 11% | Himalaya Ashwagandha :: Himalaya :: 180.00/60tabs :: same price" },
    { id: "90067", alt: "Patanjali Arjun Arishta :: Patanjali :: 120.00/450ml :: save 16% | Arjun Arishta :: Baidyanath :: 144.00/450ml :: same price" },
    { id: "90079", alt: "Koflet Syrup :: Himalaya :: 68.00/100ml :: save 5% | Dabur Adulsa Syrup :: Dabur :: 72.00/100ml :: same price" },

    // --- 6. BABY CARE & DIAPERS (Hygiene & Skincare) ---
    { id: "90018", alt: "Huggies Wonder Pants L :: Kimberly-Clark :: 17.84/unit :: save 15% | Pampers Baby Dry L :: P&G :: 18.70/unit :: same price" },
    { id: "90019", alt: "Pampers Baby Dry Large :: P&G :: 18.70/unit :: same price | Huggies Wonder Pants L :: Kimberly-Clark :: 17.84/unit :: save 15%" },
    { id: "90020", alt: "Himalaya Baby Cream :: Himalaya :: 125.00/100g :: save 7% | Johnson's Baby Cream :: J&J :: 135.00/100g :: same price" },
    { id: "90055", alt: "Aveeno Baby Lotion :: J&J :: 980.00/400ml :: save 3% | Sebamed Baby Lotion :: Sebapharma :: 1020.00/400ml :: same price" },
    { id: "90064", alt: "Pampers Wipes :: P&G :: 140.00/72wipes :: save 8% | Himalaya Baby Wipes :: Himalaya :: 153.00/72wipes :: same price" },
    { id: "90085", alt: "Johnson's Baby Soap :: J&J :: 36.00/75g :: save 10% | Himalaya Baby Soap :: Himalaya :: 40.00/75g :: same price" },
    { id: "90097", alt: "Rashfree Cream :: Neon :: 150.00/75g :: save 11% | B4 Nappi Cream :: Curatio :: 170.00/75g :: same price" },

    // --- 7. PERSONAL CARE (Face Wash, Body Lotion, Sanitizer, Toothpaste) ---
    { id: "90021", alt: "Episoft Cleanser :: Glenmark :: 450.00/250ml :: save 9% | Cetaphil Gentle Cleanser :: Galderma :: 495.00/250ml :: same price" },
    { id: "90022", alt: "Savlon Handwash :: ITC :: 110.00/750ml :: save 7% | Dettol Handwash :: Reckitt :: 119.00/750ml :: same price" },
    { id: "90023", alt: "Vaseline Cocoa Lotion :: Unilever :: 290.00/400ml :: save 9% | Nivea Nourishing Lotion :: Nivea :: 320.00/400ml :: same price" },
    { id: "90063", alt: "Mildy Shampoo :: Skin :: 310.00/100ml :: save 10% | Hair 4U Shampoo :: Glenmark :: 348.00/100ml :: same price" },
    { id: "90070", alt: "Colgate Pro Sensitive :: Colgate :: 150.00/150g :: save 7% | Sensodyne Fresh Gel :: GSK :: 162.00/150g :: same price" },
    { id: "90074", alt: "Scalpe+ Shampoo :: Glenmark :: 155.00/100ml :: save 8% | Ketocip Shampoo :: Cipla :: 170.00/100ml :: same price" },
    { id: "90080", alt: "BoroPlus Cream :: Emami :: 60.00/40g :: save 11% | Boroline Cream :: GD Pharma :: 68.00/40g :: same price" },
    { id: "90084", alt: "Ponds Acne Clear :: Unilever :: 120.00/100ml :: save 11% | Himalaya Purifying Neem Face Wash :: Himalaya :: 135.00/100ml :: same price" },
    { id: "90089", alt: "Moisturex Cream :: Sun Pharma :: 390.00/150g :: save 8% | Venusia Max Cream :: Dr Reddy's :: 425.00/150g :: same price" },
    { id: "90093", alt: "Sensodyne Fresh Gel :: GSK :: 100.00/100g :: save 7% | Colgate Sensitive Plus :: Colgate :: 108.00/100g :: same price" },
    { id: "90095", alt: "Vicco Turmeric Cream :: Vicco :: 211.00/70g :: same price | Vicco Turmeric (Sandalwood) :: Vicco :: 220.00/70g :: save 4%" },
    { id: "90096", alt: "Savlon Sanitizer :: ITC :: 20.00/50ml :: save 9% | Dettol Sanitizer :: Reckitt :: 22.00/50ml :: same price" },

    // --- 8. MEDICAL DEVICES & MONITORS (BP, Thermometer, Nebulizer, Scale) ---
    { id: "90026", alt: "BPL Medical B18 BP :: BPL :: 1785.00/Unit :: save 15% | Omron HEM-7120 BP :: Omron :: 2244.00/Unit :: same price" },
    { id: "90027", alt: "Omron HEM-7120 BP :: Omron :: 2244.00/Unit :: same price | BPL Medical B18 BP :: BPL :: 1785.00/Unit :: save 15%" },
    { id: "90028", alt: "Omron Infrared Temp :: Omron :: 1150.00/Unit :: save 4% | Dr Trust Infrared Temp :: Dr Trust :: 1199.00/Unit :: same price" },
    { id: "90029", alt: "Hicks Digital Temp :: Hicks :: 250.00/Unit :: save 15% | Omron MC-246 Digital :: Omron :: 297.00/Unit :: same price" },
    { id: "90030", alt: "Omron Nebulizer NE :: Omron :: 2800.00/Unit :: save 13% | Philips Innospire Neb :: Philips :: 3230.00/Unit :: same price" },
    { id: "90060", alt: "Philips Power Adapter :: Philips :: 380.00/Unit :: save 6% | Omron AC Adapter :: Omron :: 405.00/Unit :: same price" },
    { id: "90068", alt: "Omron weighing Scale :: Omron :: 850.00/Unit :: save 5% | Dr Trust Digital Scale :: Dr Trust :: 900.00/Unit :: same price" },
    { id: "90088", alt: "Philips Innospire Neb :: Philips :: 3230.00/Unit :: save 13% | Omron NE C28 Neb :: Omron :: 2800.00/Unit :: same price" },
    { id: "90099", alt: "Omron HEM-7120 BP :: Omron :: 2244.00/Unit :: save 26% | Beurer BM28 BP :: Beurer :: 1650.00/Unit :: same price" },

    // --- 9. EYE & NOSE DROPS ---
    { id: "90051", alt: "Himalaya Eye Drops :: Himalaya :: 48.00/10ml :: save 11% | Itone Eye Drops :: Dey's :: 54.00/10ml :: same price" },
    { id: "90071", alt: "EcoTears Eye Drops :: Cipla :: 121.50/10ml :: save 10% | Refresh Tears Drops :: Allergan :: 135.00/10ml :: same price" },

    // --- 10. OTHER MEDICINES (Acidity, Steroids, Antibiotics, Cough, Spasms) ---
    { id: "90031", alt: "Autrin Capsule :: Pfizer :: 127.00/30caps :: same price | Becosules Z Capsule :: Pfizer :: 40.00/20caps :: same price" },
    { id: "90032", alt: "Dexorange Syrup :: Franco-Indian :: 123.00/200ml :: same price | Autrin Capsule :: Pfizer :: 127.00/30caps :: same price" },
    { id: "90037", alt: "Gelusil MPS Liquid :: Pfizer :: 114.00/200ml :: save 4% | Digene Mint :: Abbott :: 119.00/200ml :: same price" },
    { id: "90038", alt: "Digene Gel Mint :: Abbott :: 119.00/200ml :: same price | Gelusil MPS Liquid :: Pfizer :: 114.00/200ml :: save 4%" },
    { id: "90039", alt: "Pan 40 Tablet :: Alkem :: 123.00/15tabs :: save 3% | Pantocid 40 Tablet :: Sun Pharma :: 127.00/15tabs :: same price" },
    { id: "90040", alt: "Pantocid 40 Tablet :: Sun Pharma :: 127.00/15tabs :: same price | Pan 40 Tablet :: Alkem :: 123.00/15tabs :: save 3%" },
    { id: "90041", alt: "Omnacortil 5 Tablet :: Macleods :: 11.00/15tabs :: save 8% | Wysolone 5 Tablet :: Wyeth :: 12.00/15tabs :: same price" },
    { id: "90042", alt: "Wysolone 5 Tablet :: Wyeth :: 12.00/15tabs :: same price | Omnacortil 5 Tablet :: Macleods :: 11.00/15tabs :: save 8%" },
    { id: "90043", alt: "Chymoral Forte Tablet :: Torrent :: 382.00/10tabs :: same price | Chymozen Forte :: Zydus :: 340.00/10tabs :: save 11%" },
    { id: "90044", alt: "Chymozen Forte :: Zydus :: 340.00/10tabs :: save 11% | Chymoral Forte Tablet :: Torrent :: 382.00/10tabs :: same price" },
    { id: "90045", alt: "L-Hist 5 Tablet :: Alkem :: 40.00/10tabs :: save 4% | Levocet 5 Tablet :: Hetero :: 42.00/10tabs :: same price" },
    { id: "90046", alt: "Levocet 5 Tablet :: Hetero :: 42.00/10tabs :: same price | L-Hist 5 Tablet :: Alkem :: 40.00/10tabs :: save 4%" },
    { id: "90047", alt: "Solvin LS Syrup :: Ipca Labs :: 89.00/100ml :: save 4% | Ascoril LS Syrup :: Glenmark :: 93.00/100ml :: same price" },
    { id: "90048", alt: "Ascoril LS Syrup :: Glenmark :: 93.00/100ml :: same price | Solvin LS Syrup :: Ipca Labs :: 89.00/100ml :: save 4%" },
    { id: "90049", alt: "Ethasyl 500 Tablet :: FDC Ltd :: 161.00/10tabs :: save 5% | Sylate 500 Tablet :: Emcure :: 170.00/10tabs :: same price" },
    { id: "90050", alt: "Sylate 500 Tablet :: Emcure :: 170.00/10tabs :: same price | Ethasyl 500 Tablet :: FDC Ltd :: 161.00/10tabs :: save 5%" },
    { id: "90052", alt: "Stevia Sweetener :: SugarFree :: 180.00/500pellets :: save 15% | Sugar Free Gold :: Zydus :: 212.00/500pellets :: same price" },
    { id: "90053", alt: "SevenSeas Cod Liver :: SevenSeas :: 250.00/100caps :: save 15% | Seacod Capsule :: Sanofi :: 297.00/100caps :: same price" },
    { id: "90054", alt: "Confido Tablet :: Himalaya :: 140.00/60tabs :: save 12% | Charak Addyzoa :: Charak :: 160.00/20caps :: same price" },
    { id: "90056", alt: "Augmentin 625 Duo :: GSK :: 170.00/10tabs :: save 4% | Amoxyclav 625 :: Abbott :: 178.00/10tabs :: same price" },
    { id: "90062", alt: "Omee Capsule :: Alkem :: 38.00/15caps :: save 9% | Omez 20 Capsule :: Dr Reddy's :: 42.00/15caps :: same price" },
    { id: "90069", alt: "Sinarest Tablet :: Centaur :: 35.00/10tabs :: save 7% | Crocin Cold & Flu :: GSK :: 38.00/10tabs :: same price" },
    { id: "90072", alt: "i-Can Pregnancy Kit :: Piramal :: 42.00/Kit :: save 6% | Prega News Test Kit :: Mankind :: 45.00/Kit :: same price" },
    { id: "90087", alt: "Autrin Capsule :: Pfizer :: 127.00/30caps :: save 15% | Dexorange Syrup :: Franco-Indian :: 123.00/200ml :: same price" },
    { id: "90098", alt: "Chericof Syrup :: Sun Pharma :: 85.00/100ml :: save 12% | Alex Syrup :: Glenmark :: 97.00/100ml :: same price" }
];

        // Database me bulk update perform karein
        const bulkOperations = updates.map(update => ({
            updateOne: {
                filter: { Id: update.id },
                update: { $set: { alternate_brand: update.alt } }
            }
        }));

        const result = await Medicine.bulkWrite(bulkOperations);

        res.json({
            success: true,
            message: "Purane data ke alternate brands sahi format me update ho gaye hain.",
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount
        });

    } catch (error) {
        console.error("Bulk update error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/scan-rx', 
    protect('user'), 
    pharmacyPrescriptionUploads.single('prescriptionFile'), 
    scanPrescription
);
// --- API 1: GET MEDICINE SUGGESTIONS (Search Bar) ---
router.post('/search-suggestions', getMedicineSuggestions);
router.get('/full-details/:id', getMedicineFullDetails);

router.get('/categories', getMedicineCategories);
router.get('/sub-categories', getPharmacySubCategories);
router.get('/category-details', getMedicineCategoryDetails);

router.get('/standard-list', getStandardMedicineCatalog); // get all list medicine
router.post('/trending-medicines', getTrendingMedicinesNearUser); // Get trending medicines near user
router.get('/medicine-details/:medicineId', getMedicineVendors); // Get medcine by id
router.get('/search-alternate', searchAlternateBrand);

router.get('/search-suggestions', getPharmacySearchSuggestions);
router.get('/pharmacy-suggestions', getPharmacyNameSuggestions);
router.post('/list', getPharmacies); // Search & Filter
router.get('/details/:id', getPharmacyDetails); // Profile Detail




router.get('/slots', protect('user'), getPharmacySlots); // Naya Endpoint
router.get('/delivery-charges', protect('user'), getPharmacyDeliveryCharges); // Re-use lab delivery logic if same

router.post('/validate-coupon',protect('user'),validateCoupon);
router.get('/available-coupons',protect('user'),getPharmacyAvailableCoupons);

router.post('/checkout', 
    protect('user'),  
    checkoutMedicineOrder
);
router.post('/upload-prescription',protect('user'),uploadPrescription);
router.post('/cancel-order',protect('user'),cancelMedicineOrder);

router.post('/place-order', pharmacyPrescriptionUploads.fields([{ name: 'prescriptionImages', maxCount: 5 }]), protect('user'),placeOrder);

router.post('/verify-payment',protect('user'),verifyPharmacyPayment);

router.get('/order-history',protect('user'),getOrderHistory);
router.get('/track-order/:orderId',protect('user'),trackOrder);

router.get('/latest-added-medicines',getLatestAddedMedicines);
router.get('/non-prescription-list', getNonPrescriptionMedicines);
router.get('/highest-discount-medicines', getHighestDiscountMedicines);

router.post('/rate',protect('user'),ratePharmacyOrder);




/// ai prescription request

router.get(
    '/prescription-request/list', 
    protect('user'), 
    getUserPrescriptionRequests
);

router.get(
    '/prescription-request/details/:requestId', 
    protect('user'), 
    getUserPrescriptionRequestDetails
);
router.post(
    '/prescription-request', 
    protect('user'), 
    pharmacyPrescriptionUploads.single('prescriptionImage'), 
    createPrescriptionRequest
);

router.post(
    '/prescription-request/pay-confirm', 
    protect('user'), 
    payAndConfirmOrder
);

router.post(
    '/prescription-request/verify-payment', 
    protect('user'), 
    verifyPrescriptionRequestPayment
);
router.post(
    '/prescription-request/estimate-prices', 
    protect('user'), 
    estimateRxPrices
);


router.get(
    '/combo-offers', 
    getActiveStoreComboOffers
);
router.get(
    '/combo-offers/details/:offerId', 
    getComboOfferDetails
);

router.get(
    '/global-combo-offers', 
    getGlobalActiveComboOffers
);

module.exports = router;