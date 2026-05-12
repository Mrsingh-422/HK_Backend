const Ambulance = require('../../../models/Ambulance'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: Generate Token
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. ADD AMBULANCE (By Hospital Admin with Full Documents) ---
// Endpoint: POST /api/hospital/ambulance/add
const addHospitalAmbulance = async (req, res) => {
    try {
        const { 
            name, email, phone, password, address, vehicleType, ambulanceNumber,
            fixedPrice, distance, perKMPrice, // Pricing
            accidentalService, emergencyService, referralService, // Toggles
            defaultService, optionalService, // Dropdowns
            fullName, department, dob 
        } = req.body;

        const ambulance = await Ambulance.create({
            hospitalId: req.user.id,
            name: fullName, // Screen pe Full Name hai
            email, phone, address,
            password: await bcrypt.hash(password, 10),
            vehicleType,
            ambulanceNumber, // API mein ye key use karein
            pricing: {
                fixedPrice: Number(fixedPrice),
                baseDistance: Number(distance),
                pricePerKM: Number(perKMPrice)
            },
            freeServices: {
                accidental: accidentalService === 'true',
                emergency: emergencyService === 'true',
                referral: referralService === 'true'
            },
            defaultService,
            optionalServices: JSON.parse(optionalService || '[]'), // Array format
            driverInfo: { fullName, department, dob }
        });

        res.status(201).json({ success: true, data: ambulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. GET ALL AMBULANCES OF A HOSPITAL ---
const getMyHospitalAmbulances = async (req, res) => {
    try {
        const ambulances = await Ambulance.find({ hospitalId: req.user.id });
        res.json({ success: true, data: ambulances });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPDATE AMBULANCE DETAILS ---
const updateHospitalAmbulance = async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files;
        let updateData = { ...req.body };

        if (files) {
            // Mapping new files to the documents object
            const docs = {};
            if (files.drivingLicenseFile) docs.drivingLicenseFile = files.drivingLicenseFile[0].path;
            if (files.rcFile) docs.rcFile = files.rcFile[0].path;
            if (files.insuranceFile) docs.insuranceFile = files.insuranceFile[0].path;
            if (files.fitnessCertificate) docs.fitnessCertificate = files.fitnessCertificate[0].path;
            if (files.ambulancePermit) docs.ambulancePermit = files.ambulancePermit[0].path;
            
            updateData.documents = docs;
        }

        if (req.body.password) {
            updateData.password = await bcrypt.hash(String(req.body.password), 10);
        }

        const ambulance = await Ambulance.findOneAndUpdate(
            { _id: id, hospitalId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        if (!ambulance) return res.status(404).json({ message: "Ambulance not found or unauthorized" });

        res.json({ success: true, message: "Updated successfully", data: ambulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 4. DELETE AMBULANCE ---
const deleteHospitalAmbulance = async (req, res) => {
    try {
        const ambulance = await Ambulance.findOneAndDelete({ _id: req.params.id, hospitalId: req.user.id });
        if (!ambulance) return res.status(404).json({ message: "Ambulance not found or unauthorized" });
        res.json({ success: true, message: "Ambulance removed from hospital" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 5. LOGIN HOSPITAL AMBULANCE ---
const loginHospitalAmbulance = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const ambulance = await Ambulance.findOne(query).select('+password');
        if (!ambulance || !(await bcrypt.compare(String(password), ambulance.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (!ambulance.isActive) return res.status(403).json({ message: 'Account Deactivated' });

        let token = (process.env.NODE_ENV === 'development') ? ambulance.token : null;
        if (!token) {
            token = generateToken(ambulance._id, ambulance.role);
            ambulance.token = token;
            await ambulance.save();
        }

        ambulance.password = undefined;
        res.json({ success: true, token, role: ambulance.role, data: ambulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addHospitalAmbulance, 
    getMyHospitalAmbulances, 
    updateHospitalAmbulance, 
    deleteHospitalAmbulance, 
    loginHospitalAmbulance 
};