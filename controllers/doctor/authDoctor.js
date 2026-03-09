const Doctor = require('../../models/Doctor');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: Generate Token (Lifetime for Dev, 30d for Prod)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. REGISTER (Step 1: Basic Info) ---
// Endpoint: POST /api/auth/doctor/register
const registerDoctor = async (req, res) => {
    try {
        const { name, email, phone, country, state, city, password } = req.body;
        
        // Duplicate Check
        const exists = await Doctor.findOne({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (exists) return res.status(400).json({ message: 'Email or Phone already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const doctor = await Doctor.create({
            name, 
            email: email?.toLowerCase(), 
            phone, 
            country, state, city,
            password: hashedPassword,
            role: 'doctor', // Independent Role
            profileStatus: 'Incomplete'
        });

        res.status(201).json({ 
            success: true, 
            message: 'OTP sent to your phone (Static: 1111)', 
            doctorId: doctor._id 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. VERIFY OTP (Static) ---
// Endpoint: POST /api/auth/doctor/verify-otp
const verifyOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (otp !== '1111') return res.status(400).json({ message: 'Invalid OTP' });

        const doctor = await Doctor.findOneAndUpdate(
            { phone }, 
            { isPhoneVerified: true }, 
            { new: true }
        );

        if (!doctor) return res.status(404).json({ message: 'Doctor not found' });

        res.json({ success: true, message: 'Phone Verified Successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPLOAD DOCUMENTS (Step 3: Professional Info & Docs) ---
// Endpoint: POST /api/auth/doctor/upload-docs
const uploadDocuments = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { qualification, councilNumber, councilName, licenseNumber, speciality } = req.body;

        const updateData = {
            qualification, 
            councilNumber, 
            councilName,
            licenseNumber, 
            speciality,
            profileStatus: 'Pending' // Wait for Admin
        };

        if (req.files?.profileImage) {
            updateData.profileImage = req.files.profileImage[0].path;
        }
        if (req.files?.certificates) {
            updateData.documents = req.files.certificates.map(f => f.path);
        }

        const updated = await Doctor.findByIdAndUpdate(doctorId, updateData, { new: true });
        res.json({ success: true, message: 'Documents submitted for approval.', data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 4. LOGIN DOCTOR (Unified Logic) ---
// Endpoint: POST /api/auth/doctor/login
const loginDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const doctor = await Doctor.findOne(query).select('+password');
        if (!doctor || !(await bcrypt.compare(String(password), doctor.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        let token = null;
        // DEVELOPMENT MODE: Reuse Token
        if (process.env.NODE_ENV === 'development' && doctor.token) {
            try {
                jwt.verify(doctor.token, process.env.JWT_SECRET);
                token = doctor.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(doctor._id, doctor.role);
            doctor.token = token;
            await doctor.save();
        }

        doctor.password = undefined;
        res.json({ 
            success: true, 
            token, 
            role: doctor.role, 
            profileStatus: doctor.profileStatus, 
            data: doctor 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerDoctor, verifyOTP, uploadDocuments, loginDoctor };