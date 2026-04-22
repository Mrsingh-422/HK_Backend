const FireStation = require('../../models/FireStation');
const FireCase = require('../../models/FireCase'); // Assuming this model exists for incidents
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');

// 1. GET DASHBOARD STATS (Screen 9)
const getDashboardStats = async (req, res) => {
    try {
        // HQ sirf apne under aane wale stations ke cases dikhayega
        const stations = await FireStation.find({ hqId: req.user.id }).select('_id');
        const stationIds = stations.map(s => s._id);

        const freshCases = await FireCase.countDocuments({ stationId: { $in: stationIds }, status: 'Fresh' });
        const pendingCases = await FireCase.countDocuments({ stationId: { $in: stationIds }, status: 'Pending' });
        const historyCases = await FireCase.countDocuments({ stationId: { $in: stationIds }, status: { $in: ['Closed', 'Archived'] } });

        res.json({
            success: true,
            data: {
                freshCases,
                pendingCases,
                historyCases,
                totalEarnings: "42,000" // Figma example value
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. CREATE NEW FIRE STATION (By Fire-HQ)
// endpoint: POST /fireHQ/management/create-station
const createFireStation = async (req, res) => {
    try {
        const { 
            stationName, stationCode, captainName, operatingZone, 
            email, phone, landline, emergencyLines, officeDesk, 
            password, address 
        } = req.body;

        // Validation: Unique Check
        const exists = await FireStation.findOne({ 
            $or: [{ email }, { phone }, { stationCode }] 
        });

        if (exists) {
            return res.status(400).json({ 
                message: "Station with this Email, Phone or Station Code already exists" 
            });
        }

        // Individual Station ka login password hash karein
        const hashedPassword = await bcrypt.hash(password, 10);

        const newStation = await FireStation.create({
            hqId: req.user.id, // Current logged-in HQ ki ID link hogi
            stationName,
            stationCode,
            captainName,
            operatingZone,
            email,
            phone,
            landline,
            emergencyLines,
            officeDesk,
            address,
            password: hashedPassword,
            role: 'Fire-Station'
        });

        res.status(201).json({ 
            success: true, 
            message: "Fire Station created successfully. They can now login with their credentials.",
            data: {
                id: newStation._id,
                stationName: newStation.stationName,
                stationCode: newStation.stationCode
            }
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. GET ALL STATIONS UNDER THIS HQ (Screen 10)
const getMyStations = async (req, res) => {
    try {
        // HQ sirf wahi stations dekhega jo usne khud create kiye hain
        const stations = await FireStation.find({ hqId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: stations });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. CASE HISTORY WITH FILTERS (Screen 11 & 12)
const getCaseHistory = async (req, res) => {
    try {
        const { status, search } = req.query; // status: Closed, Archived, All
        const stations = await FireStation.find({ hqId: req.user.id }).select('_id');
        const stationIds = stations.map(s => s._id);

        let query = { stationId: { $in: stationIds } };
        
        if (status && status !== 'All') query.status = status;
        if (search) query.caseNo = new RegExp(search, 'i');

        const cases = await FireCase.find(query).sort({ createdAt: -1 });
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. CONTACT ADMIN (Screen 16/17 Help Modal)
const getAdminContact = async (req, res) => {
    res.json({
        success: true,
        data: {
            phone: "+91 9876543210",
            email: "help@gmail.com"
        }
    });
};

// 6. UPDATE FIRE STATION
// endpoint: PUT /fireHQ/management/update-station/:id
const updateFireStation = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Pehle check karein ki ye station isi HQ ka hai ya nahi
        const station = await FireStation.findOne({ _id: id, hqId: req.user.id });
        if (!station) {
            return res.status(404).json({ message: "Station not found or unauthorized" });
        }

        // Agar password update ho raha hai to use hash karein
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }

        // Agar nayi profile image upload hui hai
        if (req.file) {
            if (station.profileImage) {
                deleteFile(station.profileImage); // Purani image delete karein
            }
            updates.profileImage = req.file.path;
        }

        const updatedStation = await FireStation.findByIdAndUpdate(
            id, 
            { $set: updates }, 
            { new: true, runValidators: true }
        );

        res.json({ 
            success: true, 
            message: "Station details updated successfully", 
            data: updatedStation 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. DELETE FIRE STATION
// endpoint: DELETE /fireHQ/management/delete-station/:id
const deleteFireStation = async (req, res) => {
    try {
        const { id } = req.params;

        // Check ownership before deletion
        const station = await FireStation.findOne({ _id: id, hqId: req.user.id });
        if (!station) {
            return res.status(404).json({ message: "Station not found or unauthorized" });
        }

        // Station delete karne se pehle uski profile image server se delete karein
        if (station.profileImage) {
            deleteFile(station.profileImage);
        }

        await FireStation.findByIdAndDelete(id);

        res.json({ 
            success: true, 
            message: "Fire Station and its data deleted successfully" 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
module.exports = { getDashboardStats,createFireStation, getMyStations, getCaseHistory, getAdminContact, updateFireStation, deleteFireStation };