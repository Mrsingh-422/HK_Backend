const Hospital = require('../../models/Hospital');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
    // Agar development hai toh 100 saal (maano expire hi nahi hoga)
    // Warna production mein sirf 30 din
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';

    return jwt.sign(
        { id, role }, 
        process.env.JWT_SECRET, 
        { expiresIn: expiry }
    );
};


// --- 1. REGISTER HOSPITAL ---
const registerHospital = async (req, res) => {
    try {
        const { name, email, phone, country, state, city, password, type } = req.body;

        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });

        const exists = await Hospital.findOne({ $or: [{ email: email || undefined }, { phone: phone || undefined }] });
        if (exists) return res.status(400).json({ message: 'Hospital already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newHospital = await Hospital.create({
            name,
            email: email || undefined,
            phone: phone || undefined,
            country, state, city, type,
            password: hashedPassword,
            profileStatus: 'Incomplete' // Pehla step complete, documents baaki hain
        });

        const token = generateToken(newHospital._id);
        newHospital.token = token;
        await newHospital.save();

        res.status(201).json({ 
            success: true, 
            message: 'Registered successfully. Please upload documents.',
            token,
            profileStatus: 'Incomplete'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. LOGIN HOSPITAL (Flow-Based Logic) ---
const loginHospital = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email } : { phone };

        const hospital = await Hospital.findOne(query).select('+password');
        if (!hospital || !(await bcrypt.compare(password, hospital.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // ============================================================
        // 🚀 STATUS BASED LOGIN FLOW
        // ============================================================
        
        // 1. Agar PENDING hai
        if (hospital.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Your profile is under review. Please wait for Admin approval.' 
            });
        }

        // 2. Agar INCOMPLETE hai (Token denge taki docs upload kar sake)
        if (hospital.profileStatus === 'Incomplete') {
            const token = hospital.token || generateToken(hospital._id);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                token,
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload documents to proceed.' 
            });
        }

        // 3. Agar REJECTED hai
        if (hospital.profileStatus === 'Rejected') {
            const token = hospital.token || generateToken(hospital._id);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                token,
                profileStatus: 'Rejected',
                rejectionReason: hospital.rejectionReason,
                message: `Application Rejected: ${hospital.rejectionReason}. Please re-upload documents.` 
            });
        }

        // 4. Agar APPROVED hai (Full Login)
        let token = null;
        if (process.env.NODE_ENV === 'development' && hospital.token) {
            try {
                jwt.verify(hospital.token, process.env.JWT_SECRET);
                token = hospital.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(hospital._id);
            hospital.token = token;
            await hospital.save();
        }

        hospital.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved', 
            data: hospital 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPDATE DOCUMENTS & CHANGE STATUS ---
const updateHospitalProfile = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const updates = req.body;

        if (req.files) {
            if (req.files.hospitalImage) {
                updates.hospitalImage = req.files.hospitalImage.map(f => `/uploads/hospitals/${f.filename}`);
            }
            if (req.files.licenseDocument) {
                updates.licenseDocument = req.files.licenseDocument.map(f => `/uploads/hospitals/${f.filename}`);
            }
            if (req.files.otherDocuments) {
                updates.otherDocuments = req.files.otherDocuments.map(f => `/uploads/hospitals/${f.filename}`);
            }

            // Agar main docs upload ho gaye hain, to status Pending kar do
            if (req.files.hospitalImage && req.files.licenseDocument) {
                updates.profileStatus = 'Pending';
                updates.rejectionReason = null; // Purana reason clear karein
            }
        }

        const updatedHospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            { $set: updates },
            { new: true }
        );

        res.json({ 
            success: true, 
            message: updates.profileStatus === 'Pending' ? "Documents submitted for review" : "Profile Updated", 
            data: updatedHospital 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerHospital, loginHospital, updateHospitalProfile };