const Ambulance = require('../../models/Ambulance');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: Generate Token (Dev: 100 years, Prod: 30 days)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. REGISTER INDEPENDENT AMBULANCE (Step 1) ---
// Endpoint: POST /api/auth/ambulance/register
const registerAmbulance = async (req, res) => {
    try {
        const { name, email, phone, country, state, city, password } = req.body;

        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });

        const exists = await Ambulance.findOne({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (exists) return res.status(400).json({ message: 'Ambulance Partner already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const ambulance = await Ambulance.create({
            name, email, phone, country, state, city,
            password: hashedPassword,
            role: 'ambulance',
            profileStatus: 'Incomplete' // Pehla step complete, docs baaki hain
        });

        // Registration ke baad token denge taki Step 2 (Complete Profile) hit kar sake
        const token = generateToken(ambulance._id, ambulance.role);
        ambulance.token = token;
        await ambulance.save();

        res.status(201).json({ 
            success: true, 
            message: 'Step 1 Registered. Please upload documents.',
            token,
            profileStatus: 'Incomplete'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. LOGIN AMBULANCE (Hospital Flow Style) ---
// Endpoint: POST /api/auth/ambulance/login
const loginAmbulance = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const amb = await Ambulance.findOne(query).select('+password');
        if (!amb || !(await bcrypt.compare(String(password), amb.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // ============================================================
        // 🚀 STATUS BASED LOGIN FLOW (Matches Hospital)
        // ============================================================

        // 1. Case: PENDING
        if (amb.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Profile under review. Waiting for Admin approval.' 
            });
        }

        // 2. Case: INCOMPLETE (Token denge documents upload ke liye)
        if (amb.profileStatus === 'Incomplete') {
            const token = amb.token || generateToken(amb._id, amb.role);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload documents.' 
            });
        }

        // 3. Case: REJECTED
        if (amb.profileStatus === 'Rejected') {
            const token = amb.token || generateToken(amb._id, amb.role);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Rejected',
                rejectionReason: amb.rejectionReason,
                message: `Rejected: ${amb.rejectionReason}. Re-upload required documents.` 
            });
        }

        // 4. Case: APPROVED (Full Access)
        let token = null;
        if (process.env.NODE_ENV === 'development' && amb.token) {
            try {
                jwt.verify(amb.token, process.env.JWT_SECRET);
                token = amb.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(amb._id, amb.role);
            amb.token = token;
            await amb.save();
        }

        amb.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved', 
            data: amb 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. COMPLETE PROFILE & UPLOAD DOCS (Step 2, 3, 4) ---
// Endpoint: PUT /api/auth/ambulance/complete-profile
const completeAmbulanceProfile = async (req, res) => {
    try {
        const ambId = req.user.id;
        const updates = req.body;
        const files = req.files;

        // Figma logic: Handle Documents and update status to Pending
        if (files) {
            const documentPaths = {
                drivingLicenseFile: files.drivingLicenseFile ? files.drivingLicenseFile[0].path : null,
                rcFile: files.rcFile ? files.rcFile[0].path : null,
                insuranceFile: files.insuranceFile ? files.insuranceFile[0].path : null,
                fitnessCertificate: files.fitnessCertificate ? files.fitnessCertificate[0].path : null,
                ambulancePermit: files.ambulancePermit ? files.ambulancePermit[0].path : null
            };
            
            updates.documents = documentPaths;

            // Agar main documents upload ho gaye hain, to status Pending kar do
            if (files.drivingLicenseFile && files.rcFile) {
                updates.profileStatus = 'Pending';
                updates.rejectionReason = null; // Purana reject reason hatao
            }
        }

        const updatedAmb = await Ambulance.findByIdAndUpdate(
            ambId, 
            { $set: updates }, 
            { new: true }
        );

        res.json({ 
            success: true, 
            message: updates.profileStatus === 'Pending' ? 'Profile submitted for review' : 'Profile partially updated', 
            data: updatedAmb 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


const toggleDriverAvailability = async (req, res) => {
    try {
        const { available } = req.body; // expects true (Online) or false (Offline)

        const ambulance = await Ambulance.findByIdAndUpdate(
            req.user.id,
            { $set: { availableForEmergency: available } },
            { new: true }
        );

        if (!ambulance) return res.status(404).json({ success: false, message: "Driver profile not found." });

        res.json({ 
            success: true, 
            message: `Driver status updated to ${available ? 'Online' : 'Offline'}`, 
            available: ambulance.availableForEmergency 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getMyAmbulanceProfile = async (req, res) => {
    try {
        const ambulance = await Ambulance.findById(req.user.id).select('-password');
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }
        res.json({ success: true, data: ambulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// testing only
// --- 4. RESET PASSWORD (Testing Bypass - No Old Password Required) ---
// Endpoint: PUT /api/auth/ambulance/reset-password-test
const resetPasswordTest = async (req, res) => {
    try {
        const { email, phone, id, newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({ success: false, message: 'newPassword is required' });
        }

        // Target identify karne ke liye alag-alag options check karenge
        let query = {};
        if (id) {
            query = { _id: id };
        } else if (email) {
            query = { email: email.toLowerCase() };
        } else if (phone) {
            query = { phone };
        } else if (req.user && req.user.id) {
            // Agar token provided hai toh logged-in user ko use karega
            query = { _id: req.user.id };
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Provide email, phone, id in body, or send Authorization token' 
            });
        }

        // New password hash karein (bcrypt ke sath)
        const hashedPassword = await bcrypt.hash(String(newPassword), 10);

        const ambulance = await Ambulance.findOneAndUpdate(
            query,
            { $set: { password: hashedPassword } },
            { new: true }
        );

        if (!ambulance) {
            return res.status(404).json({ success: false, message: 'Ambulance profile not found' });
        }

        res.json({
            success: true,
            message: 'Password updated successfully (Testing Bypass)',
            data: {
                id: ambulance._id,
                name: ambulance.name,
                email: ambulance.email,
                phone: ambulance.phone
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


module.exports = { registerAmbulance, loginAmbulance, completeAmbulanceProfile,toggleDriverAvailability,getMyAmbulanceProfile,resetPasswordTest };