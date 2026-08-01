const Medicine = require('../../../models/Medicine');
const MasterRequest = require('../../../models/MasterRequest');
const fs = require('fs');
const csv = require('csv-parser'); // xlsx ki jagah csv-parser use karenge for large files
const mongoose = require('mongoose');

// --- 1. UPLOAD CSV / EXCEL (Optimized for 150MB+ Files & 8 Lakh Data) ---

const uploadMedicinesCSV = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload a file" });

        let batch = [];
        const BATCH_SIZE = 1000;
        let totalInserted = 0;
        let lastValidBreadCrumb = "Others";

        console.log(`🚀 Processing Started: ${req.file.path}`);

        // 1. Create Read Stream
        const readStream = fs.createReadStream(req.file.path).pipe(csv({
            mapHeaders: ({ header }) => header.trim().replace(/["']/g, '')
        }));

        // 2. Use 'for await' loop (Best for Async tasks like DB insert)
        for await (const row of readStream) {
            
            // Breadcrumb inheritance logic
            let currentBread = row['bread_crumb'] || row['breadcrumb'] || row['Bread_crumb'];
            if (currentBread && currentBread.trim() !== "") {
                lastValidBreadCrumb = currentBread.trim();
            }

            const formattedData = {
                Id: row['Id'] || row['id'] || row['ID'],
                bread_crumb: lastValidBreadCrumb,
                url: row['url'],
                name: row['name'] || row['Name'],
                manufacturers: row['manufacturers'] || row['Manufacturers'],
                salt_composition: row['salt_composition'],
                packaging: row['packaging'],
                mrp: row['mrp'],
                best_price: row['best_price'],
                discont_percent: row['discont_percent'] || row['discount_percent'],
                prescription_required: row['prescription_required'],
                image_url: row['image_url'] ? row['image_url'].split('|').map(img => img.trim()) : [],
                primary_use: row['primary_use'],
                description: row['description'],
                salt_synonmys: row['salt_synonmys'],
                storage: row['storage'],
                introduction: row['introduction'],
                use_of: row['use_of'],
                benefits: row['benefits'],
                side_effect: row['side_effect'],
                how_crop_side_effects: row['how_crop_side_effects'],
                how_to_use: row['how_to_use'],
                how_works: row['how_works'],
                safety_advise: row['safety_advise'],
                if_miss: row['if_miss'],
                alternate_brand: row['alternate_brand'],
                manufaturer_address: row['manufaturer_address'],
                for_sale: row['for_sale']
            };

            if (formattedData.name) {
                batch.push(formattedData);
            }

            // Batch insert when size reached
            if (batch.length >= BATCH_SIZE) {
                try {
                    const result = await Medicine.insertMany(batch, { ordered: false });
                    totalInserted += result.length;
                    console.log(`📑 Batch saved: ${totalInserted} records so far...`);
                    batch = [];
                } catch (err) {
                    // Unique ID collisions handle karne ke liye
                    if (err.insertedDocs) totalInserted += err.insertedDocs.length;
                    batch = [];
                }
            }
        }

        // Final batch processing
        if (batch.length > 0) {
            try {
                const result = await Medicine.insertMany(batch, { ordered: false });
                totalInserted += result.length;
            } catch (err) {
                if (err.insertedDocs) totalInserted += err.insertedDocs.length;
                // Agar 0 records inserted aaye hain, iska matlab saare duplicates the
                else if (err.code === 11000) console.log("⚠️ All records in this batch were duplicates.");
            }
        }

        // 3. Cleanup: Delete file
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        console.log(`🎉 COMPLETED! Final Count Inserted: ${totalInserted}`);
        
        if (totalInserted === 0) {
            return res.status(200).json({ 
                success: true, 
                message: "No new medicines added. They might already exist in the database (Duplicate IDs)." 
            });
        }

        res.status(201).json({ success: true, message: `${totalInserted} Medicines added successfully!` });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error("❌ ERROR:", error);
        res.status(500).json({ message: error.message });
    }
};


// --- 2. GET ALL MEDICINES LIST (Pagination 20 per page) ---
const getMedicinesList = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20; 
        const skip = (page - 1) * limit;

        const medicines = await Medicine.find()
            .sort({ createdAt: -1 }) // Latest pehle
            .skip(skip)
            .limit(limit);

        const total = await Medicine.countDocuments();

        res.json({
            success: true,
            totalMedicines: total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: medicines
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. SEARCH MEDICINES ---
const searchMedicines = async (req, res) => {
    try {
        const { search, page = 1 } = req.body;
        const limit = 20;
        const skip = (page - 1) * limit;

        if (!search) {
            return res.status(400).json({ message: "Search term is required" });
        }

        // Multiple fields me search (Name, Salt, Brand, Use)
        const query = {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { salt_composition: { $regex: search, $options: 'i' } },
                { manufacturers: { $regex: search, $options: 'i' } },
                { primary_use: { $regex: search, $options: 'i' } },
                { bread_crumb: { $regex: search, $options: 'i' } }
            ]
        };

        const medicines = await Medicine.find(query)
            .skip(skip)
            .limit(limit);

        const total = await Medicine.countDocuments(query);

        res.json({
            success: true,
            totalResults: total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data: medicines
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 4. CREATE SINGLE MEDICINE ---
const createMedicine = async (req, res) => {
    try {
        const { name, image_url } = req.body;
        if (!name) return res.status(400).json({ message: "Medicine name is required" });

        // Images array form me handle karein
        const images = Array.isArray(image_url) ? image_url : (image_url ? image_url.split(',').map(i => i.trim()) : []);

        const newMedicine = await Medicine.create({
            ...req.body,
            image_url: images,
            Id: "MANUAL-" + Date.now() // Unique ID assign
        });

        res.status(201).json({ success: true, data: newMedicine });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 5. UPDATE MEDICINE ---
const updateMedicine = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        if (updateData.image_url && typeof updateData.image_url === 'string') {
            updateData.image_url = updateData.image_url.split(',').map(img => img.trim());
        }

        const updatedMedicine = await Medicine.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedMedicine) return res.status(404).json({ message: "Medicine not found" });
        res.json({ success: true, data: updatedMedicine });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 6. DELETE MEDICINE ---
const deleteMedicine = async (req, res) => {
    try {
        const deleted = await Medicine.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Medicine not found" });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 7. GET MEDICINE DETAILS ---
const getMedicineDetails = async (req, res) => {
    try {
        const medicine = await Medicine.findById(req.params.id);
        if (!medicine) return res.status(404).json({ message: "Medicine not found" });
        res.json({ success: true, data: medicine });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};









// --- 8. GET ALL PENDING MEDICINE REQUESTS (Pharmacy Vendors) ---
// Endpoint: GET /admin/pharmacy/medicine/requests/pending
const getPendingMedicineRequests = async (req, res) => {
    try {
        const requests = await MasterRequest.find({ 
            vendorType: 'Pharmacy', 
            requestType: 'Medicine', 
            status: 'Pending' 
        }).populate('vendorId', 'name email phone');

        res.json({ success: true, count: requests.length, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 9. APPROVE MEDICINE REQUEST (Moves data to Master Collection) ---
// Endpoint: PUT /admin/pharmacy/medicine/requests/approve/:requestId
const approveMedicineRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const request = await MasterRequest.findById(requestId);

        if (!request) return res.status(404).json({ success: false, message: "Request not found" });
        if (request.requestType !== 'Medicine') return res.status(400).json({ success: false, message: "Invalid request type" });

        // Unique ID के साथ मास्टर मेडिसिन का डेटा तैयार करें
        const medicinePayload = {
            ...request.data,
            Id: "MANUAL-" + Date.now()
        };

        // मास्टर कलेक्शन में सेव करें
        const newMasterMedicine = await Medicine.create(medicinePayload);

        // रिक्वेस्ट स्टेटस अपडेट करें
        request.status = 'Approved';
        await request.save();

        res.json({ 
            success: true, 
            message: "Medicine request approved and added to Master database successfully!", 
            data: newMasterMedicine 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 10. REJECT MEDICINE REQUEST ---
// Endpoint: PUT /admin/pharmacy/medicine/requests/reject/:requestId
const rejectMedicineRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { adminComment } = req.body;

        const request = await MasterRequest.findById(requestId);
        if (!request) return res.status(404).json({ success: false, message: "Request not found" });

        request.status = 'Rejected';
        request.adminComment = adminComment || "Rejected by Admin";
        await request.save();

        res.json({ success: true, message: "Medicine request rejected successfully", data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


////////////////////////////////////////////////////////////////////////////////
///////////////////////// medicine requests mrp increase ///////////////////////
////////////////////////////////////////////////////////////////////////////////


// 1. GET ALL MEDICINE REQUESTS FOR ADMIN (With Status Filter & Pagination)
// Endpoint: GET /admin/pharmacy/requests?status=Pending&page=1
const getAdminMedicineRequests = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * limit;

        // Filter strictly for Pharmacy vendor requests of type Medicine
        let query = { 
            vendorType: 'Pharmacy', 
            requestType: 'Medicine' 
        };

        if (status) {
            query.status = status; // 'Pending', 'Approved', 'Rejected'
        }

        const requests = await MasterRequest.find(query)
            .populate('vendorId', 'name email phone city state address') // Populates Pharmacy Store details
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await MasterRequest.countDocuments(query);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. HANDLE REQUEST ACTION (Approve or Reject Request)
// Endpoint: POST /admin/pharmacy/requests/action/:requestId
const handleMedicineRequestAction = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, adminComment } = req.body; // action: 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action. Must be 'Approved' or 'Rejected'." });
        }

        const request = await MasterRequest.findById(requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: "Pending request not found or already processed." });
        }

        request.status = action;
        request.adminComment = adminComment || "";

        // 🚨 BUSINESS LOGIC: If Admin Approves, update or create the Medicine dynamically
        if (action === 'Approved') {
            const requestData = request.data;

            if (requestData.medicineId) {
                // CASE A: It is an MRP Increase Request ticket [cite: 1.1.2]
                const updatedMedicine = await Medicine.findByIdAndUpdate(
                    requestData.medicineId,
                    { 
                        mrp: requestData.proposedMrp.toString(),
                        // Auto update best_price to represent standard reference margin if needed
                        best_price: (Number(requestData.proposedMrp) * 0.9).toString() 
                    },
                    { new: true }
                );
                
                if (!updatedMedicine) {
                    return res.status(404).json({ success: false, message: "Target master medicine to update MRP not found." });
                }
                console.log(`[ADMIN] Master MRP successfully increased to ₹${requestData.proposedMrp} for ${requestData.medicineName}`);
            } else {
                // CASE B: It is a Request to Add a completely New Medicine to Master DB
                // Generate a temporary unique system Id for Medicine
                const tempSystemId = `MED-SYS-${Date.now().toString().slice(-6)}`;
                
                await Medicine.create({
                    Id: tempSystemId,
                    name: requestData.name,
                    manufacturers: requestData.manufacturers,
                    salt_composition: requestData.salt_composition,
                    packaging: requestData.packaging,
                    mrp: requestData.mrp?.toString(),
                    best_price: requestData.best_price?.toString() || requestData.mrp?.toString(),
                    description: requestData.description,
                    prescription_required: requestData.prescription_required || "No",
                    image_url: requestData.image_url || []
                });
                console.log(`[ADMIN] Successfully created new master medicine document: ${requestData.name}`);
            }
        }

        await request.save();

        res.json({
            success: true,
            message: `Request has been successfully marked as ${action}!`,
            data: request
        });

    } catch (error) {
        console.error("Admin Request Handle Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};




module.exports = {
    uploadMedicinesCSV,
    getMedicinesList,
    searchMedicines,
    createMedicine,
    updateMedicine,
    deleteMedicine,
    getMedicineDetails,

    getPendingMedicineRequests, 
    approveMedicineRequest,     
    rejectMedicineRequest,
    
    getAdminMedicineRequests,
    handleMedicineRequestAction
};