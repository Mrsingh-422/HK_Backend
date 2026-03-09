const Ambulance = require('../../models/Ambulance');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. REGISTER AMBULANCE (Step 1) ---
const registerAmbulance = async (req, res) => {
    try {
        const { name, email, phone, country, state, city, password, hospitalId } = req.body;

        const exists = await Ambulance.findOne({ $or: [{ email: email || undefined }, { phone: phone || undefined }] });
        if (exists) return res.status(400).json({ message: 'Email or Phone already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const ambulance = await Ambulance.create({
            name, email, phone, country, state, city,
            password: hashedPassword,
            hospitalId: hospitalId || null,
            role: hospitalId ? 'hospital-ambulance' : 'ambulance',
            profileStatus: 'Incomplete'
        });

        res.status(201).json({ success: true, message: 'Step 1 Complete. Verify OTP.', ambulanceId: ambulance._id });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. LOGIN AMBULANCE ---
const loginAmbulance = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const amb = await Ambulance.findOne(query).select('+password');
        if (!amb || !(await bcrypt.compare(String(password), amb.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (amb.profileStatus === 'Rejected') return res.status(403).json({ message: `Rejected: ${amb.rejectionReason}` });

        let token = (process.env.NODE_ENV === 'development') ? amb.token : null;
        if (!token) {
            token = generateToken(amb._id, amb.role);
            amb.token = token;
            await amb.save();
        }

        amb.password = undefined;
        res.json({ success: true, token, profileStatus: amb.profileStatus, data: amb });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. COMPLETE PROFILE & UPLOAD DOCS (Step 2, 3, 4) ---
const completeAmbulanceProfile = async (req, res) => {
    try {
        const ambId = req.user.id;
        const updates = req.body;
        const files = req.files;

        // Documents Handling
        if (files) {
            updates.documents = {
                drivingLicenseFile: files.drivingLicenseFile ? files.drivingLicenseFile[0].path : null,
                rcFile: files.rcFile ? files.rcFile[0].path : null,
                insuranceFile: files.insuranceFile ? files.insuranceFile[0].path : null,
                fitnessCertificate: files.fitnessCertificate ? files.fitnessCertificate[0].path : null,
                ambulancePermit: files.ambulancePermit ? files.ambulancePermit[0].path : null
            };
            updates.profileStatus = 'Pending'; // Documents uploaded, waiting for Admin
        }

        const updatedAmb = await Ambulance.findByIdAndUpdate(ambId, { $set: updates }, { new: true });
        res.json({ success: true, message: 'Profile submitted for verification', data: updatedAmb });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerAmbulance, loginAmbulance, completeAmbulanceProfile };