const Doctor = require('../../models/Doctor');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- 1. REGISTER (Step 1 & 2: Basic Info & OTP Verification logic) ---
const registerDoctor = async (req, res) => {
    try {
        const { name, email, phone, country, state, city, password } = req.body;

        // Duplicate Check
        const exists = await Doctor.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ message: 'Email or Phone already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const doctor = await Doctor.create({
            name, email, phone, country, state, city,
            password: hashedPassword,
            profileStatus: 'Incomplete', // Initial status
            isPhoneVerified: false 
        });

        res.status(201).json({ 
            success: true, 
            message: 'OTP sent to your phone (Static: 1234)', 
            doctorId: doctor._id 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. VERIFY OTP (Static) ---
const verifyOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (otp !== '1234') return res.status(400).json({ message: 'Invalid OTP' });

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

// --- 3. UPLOAD DOCUMENTS (Status change to Pending) ---
// --- 1. UPLOAD DOCUMENTS (Figma: Upload Screen) ---
// --- 2. UPLOAD DOCUMENTS (Update for Array Structure) ---
// --- UPLOAD DOCUMENTS (Step 3: Professional Info & Docs) ---
const uploadDocuments = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const { 
            qualification, 
            councilNumber, 
            councilName, // 👈 req.body se extract kiya
            licenseNumber, 
            speciality 
        } = req.body;

        const files = req.files;

        let updateData = {
            qualification,
            councilNumber,
            councilName, // 👈 updateData mein add kiya
            licenseNumber,
            speciality,
            profileStatus: 'Pending' // Submission ke baad Pending status
        };

        // Profile Image handle karein
        if (files && files.profileImage) {
            updateData.profileImage = files.profileImage[0].path;
        }

        // Certificates (Documents) array handle karein
        if (files && files.certificates) {
            updateData.documents = files.certificates.map(file => file.path);
        }

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId, 
            updateData, 
            { new: true }
        );

        res.json({ 
            success: true, 
            message: 'Documents and Professional details uploaded successfully. Waiting for admin approval.', 
            data: updatedDoctor 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};




// --- 4. LOGIN ---
// --- LOGIN DOCTOR (Updated with Token Reuse Logic) ---
// --- 1. LOGIN DOCTOR (With Token Save Logic) ---
const loginDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email } : { phone };
        if (!email && !phone) return res.status(400).json({ message: 'Provide Email or Phone' });

        const doctor = await Doctor.findOne(query).select('+password');
        if (!doctor || !(await bcrypt.compare(password, doctor.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        let token = null;

        // --- DEVELOPMENT MODE: Reuse Token ---
        if (process.env.NODE_ENV === 'development' && doctor.token) {
            try {
                jwt.verify(doctor.token, process.env.JWT_SECRET);
                token = doctor.token;
            } catch (err) { token = null; }
        }

        // --- NEW TOKEN ---
        if (!token) {
            token = generateToken(doctor._id);
            doctor.token = token; // DB mein save ho jayega
            await doctor.save();
        }

        doctor.password = undefined;
        res.json({ success: true, token, role: 'doctor', data: doctor });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


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


module.exports = { registerDoctor, verifyOTP, uploadDocuments, loginDoctor };