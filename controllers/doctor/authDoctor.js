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
        // countryCode add kiya gaya hai (Optional)
        const { name, email, phone, countryCode, country, state, city, password } = req.body;
        
        // Validation: Email/Phone ki duplicate check
        const normalizedEmail = email?.toLowerCase();
        const exists = await Doctor.findOne({ $or: [{ email: normalizedEmail }, { phone }] });
        if (exists) return res.status(400).json({ success: false, message: 'Email or Phone already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Doctor creation logic (Logic remains same, countryCode added to object)
        const doctor = await Doctor.create({
            name, 
            email: normalizedEmail, 
            phone, 
            countryCode, // Agar req.body me nahi hoga toh null/undefined save hoga
            country, 
            state, 
            city,
            password: hashedPassword,
            role: 'doctor',
            profileStatus: 'Incomplete'
        });

        // 🚀 Auto-Login Token: Taaki register ke baad session maintain rahe
        const token = generateToken(doctor._id, doctor.role);
        doctor.token = token;
        await doctor.save();

        res.status(201).json({ 
            success: true, 
            message: 'Registration successful. OTP sent to your phone (Static: 1111)', 
            token, 
            doctorId: doctor._id,
            profileStatus: doctor.profileStatus
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. VERIFY OTP (Step 2) ---
// Flow: OTP verify hoga -> isPhoneVerified true hoga -> Token refresh/return hoga
const verifyOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (otp !== '1111') return res.status(400).json({ success: false, message: 'Invalid OTP' });

        const doctor = await Doctor.findOneAndUpdate(
            { phone }, 
            { isPhoneVerified: true }, 
            { new: true }
        );

        if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });

        const token = doctor.token || generateToken(doctor._id, doctor.role);

        res.json({ 
            success: true, 
            message: 'Phone Verified Successfully', 
            token, 
            profileStatus: doctor.profileStatus 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. UPLOAD DOCUMENTS ---
const uploadDocuments = async (req, res) => {
    try {
        const doctorId = req.user.id; // Middleware se aayega
        const { qualification, councilNumber, councilName, licenseNumber, speciality } = req.body;

        const updateData = {
            qualification, 
            councilNumber, 
            councilName,
            licenseNumber, 
            speciality,
            profileStatus: 'Pending' 
        };

        if (req.files?.profileImage) {
            updateData.profileImage = req.files.profileImage[0].path;
        }
        if (req.files?.certificates) {
            updateData.documents = req.files.certificates.map(f => f.path);
        }

        const updated = await Doctor.findByIdAndUpdate(doctorId, updateData, { new: true });
        
        res.json({ 
            success: true, 
            message: 'Documents submitted for approval.', 
            profileStatus: 'Pending', // Frontend ko status sync karne ke liye
            data: updated 
        });
    } catch (error) {
        // Yahan success: false add kiya hai consistency ke liye
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 4. LOGIN DOCTOR (Unified Logic) ---
// Endpoint: POST /api/auth/doctor/login
const loginDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        // 1. Find Doctor by Email or Phone
        let query = email ? { email: email.toLowerCase() } : { phone };
        const doctor = await Doctor.findOne(query).select('+password');

        if (!doctor || !(await bcrypt.compare(String(password), doctor.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // ------------------------------------------------------------
        // 🚀 STATUS & ROLE BASED FLOW
        // ------------------------------------------------------------
        
        // A. PENDING: Review ke liye wait kar raha hai
        if (doctor.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                role: doctor.role, // 'doctor' ya 'hospital-doctor'
                profileStatus: 'Pending',
                message: 'Profile under review. No dashboard access yet.' 
            });
        }

        // B. INCOMPLETE: Docs upload karne baaki hain
        if (doctor.profileStatus === 'Incomplete') {
            const token = doctor.token || generateToken(doctor._id, doctor.role);
            if (!doctor.token) { doctor.token = token; await doctor.save(); }
            
            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                role: doctor.role,
                profileStatus: 'Incomplete',
                message: 'Please complete your profile by uploading documents.' 
            });
        }

        // C. REJECTED: Admin ne docs reject kar diye
        if (doctor.profileStatus === 'Rejected') {
            const token = doctor.token || generateToken(doctor._id, doctor.role);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                role: doctor.role,
                profileStatus: 'Rejected',
                rejectionReason: doctor.rejectionReason,
                message: `Rejected: ${doctor.rejectionReason}. Re-upload required.` 
            });
        }

        // D. APPROVED: Full Access (Dashboard)
        let token = null;
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
            fullAccess: true, 
            token, 
            role: doctor.role, // Figma navigation ke liye zaroori
            profileStatus: 'Approved', 
            data: doctor 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 5. UPDATE PROFILE (Bio, Fees, Availability, etc.) ---
// Endpoint: PUT /api/auth/doctor/update-profile
const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id; // From Protect Middleware
        const updates = req.body;

        // Security Check: Kuch fields update karne se profileStatus wapas 'Pending' ho sakta hai (Optional Logic)
        // Agar aap chahte hain ki name ya qualification badalne par dobara verify ho:
        // if (updates.name || updates.qualification) { updates.profileStatus = 'Pending'; }

        // Handle Profile Image Update (If uploaded)
        if (req.files && req.files.profileImage) {
            updates.profileImage = req.files.profileImage[0].path;
        }

        // Nested objects (fees, availability) ko update karne ke liye $set use hota hai
        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!updatedDoctor) {
            return res.status(404).json({ success: false, message: 'Doctor not found' });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: updatedDoctor
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 6. GET DOCTOR PROFILE (Self) ---
// Endpoint: GET /api/auth/doctor/profile
const getDoctorProfile = async (req, res) => {
    try {
        // req.user.id protect middleware se aata hai
        const doctor = await Doctor.findById(req.user.id).populate('hospitalId', 'name address');

        if (!doctor) {
            return res.status(404).json({ success: false, message: 'Doctor not found' });
        }

        res.status(200).json({
            success: true,
            data: doctor
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 7. GET DOCTOR BY ID (Public/Admin/Patient view) ---
// Endpoint: GET /api/auth/doctor/:id
const getDoctorById = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id)
            .select('-password -token -resetOTP') // Sensitive data hide karein
            .populate('hospitalId', 'name address');

        if (!doctor) {
            return res.status(404).json({ success: false, message: 'Doctor not found' });
        }

        res.status(200).json({
            success: true,
            data: doctor
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { registerDoctor, verifyOTP, uploadDocuments, loginDoctor, updateDoctorProfile ,getDoctorProfile, getDoctorById };