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
            name, email, phone, password, 
            country, state, city, address,
            drivingLicenseNumber, licenseExpiryDate, experienceYears, bloodGroup, // Driver info
            vehicleNumber, vehicleType, rcNumber, rcExpiryDate, insuranceNumber, insuranceValidTill, // Vehicle info
            serviceRadius, availableForEmergency
        } = req.body;

        const files = req.files;

        const exists = await Ambulance.findOne({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (exists) return res.status(400).json({ message: 'Ambulance Partner already registered' });

        const hashedPassword = await bcrypt.hash(String(password || '123456'), 10);

        // Document Mapping (Same as Independent flow)
        const documentPaths = {
            drivingLicenseFile: files?.drivingLicenseFile ? files.drivingLicenseFile[0].path : null,
            rcFile: files?.rcFile ? files.rcFile[0].path : null,
            insuranceFile: files?.insuranceFile ? files.insuranceFile[0].path : null,
            fitnessCertificate: files?.fitnessCertificate ? files.fitnessCertificate[0].path : null,
            ambulancePermit: files?.ambulancePermit ? files.ambulancePermit[0].path : null
        };

        const ambulance = await Ambulance.create({
            hospitalId: req.user.id,
            name, email, phone,
            password: hashedPassword,
            country, state, city, address,
            // Driver Details
            drivingLicenseNumber, licenseExpiryDate, experienceYears, bloodGroup,
            // Vehicle Details
            vehicleNumber, vehicleType, rcNumber, rcExpiryDate, insuranceNumber, insuranceValidTill,
            // Availability
            serviceRadius,
            availableForEmergency: availableForEmergency === 'true' || availableForEmergency === true,
            // System
            documents: documentPaths,
            role: 'hospital-ambulance',
            profileStatus: 'Approved', // Hospital added are usually pre-approved
            isActive: true
        });

        res.status(201).json({ success: true, message: 'Hospital Ambulance Added with Documents', data: ambulance });
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