const Doctor = require('../../models/Doctor');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest'); // For handling profile update requests
const { deleteFile } = require('../../utils/fileHandler'); // Import the deleteFile utility

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
// 1. UPDATED LOGIN DOCTOR (With Inactive check)
const loginDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        let query = email ? { email: email.toLowerCase() } : { phone };
        const doctor = await Doctor.findOne(query).select('+password');

        if (!doctor || !(await bcrypt.compare(String(password), doctor.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // 🚨 SECURITY LOCK: Block login if Doctor account is inactive/disabled by Admin
        if (doctor.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your account is inactive. Please contact support/administrator." 
            });
        }

        if (doctor.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                role: doctor.role, 
                profileStatus: 'Pending',
                message: 'Profile under review. No dashboard access yet.' 
            });
        }

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
            role: doctor.role, 
            profileStatus: 'Approved', 
            data: doctor 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. NEW DOCTOR STATUS TOGGLE API
const toggleDoctorOnlineStatus = async (req, res) => {
    try {
        const { isOnline } = req.body;
        const doctorId = req.user.id;

        if (isOnline === undefined) {
            return res.status(400).json({ success: false, message: "isOnline status value is required." });
        }

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId,
            { $set: { isOnline: Boolean(isOnline) } },
            { new: true }
        ).select('-password');

        if (!updatedDoctor) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        res.json({
            success: true,
            message: `Your status has been updated to ${isOnline ? 'Online' : 'Offline'}.`,
            isOnline: updatedDoctor.isOnline
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// --- 5. UPDATE PROFILE (Bio, Fees, Availability, etc.) ---

// Endpoint: PUT /api/auth/doctor/update-profile

const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const updates = { ...req.body };

        const existingDoc = await Doctor.findById(doctorId);
        if (!existingDoc) {
            return res.status(404).json({ success: false, message: 'Doctor not found' });
        }
 
        // 🚨 SECURITY LOCKS: Protect sensitive fields from direct modifications
        delete updates.email;
        delete updates.phone;
        delete updates.password;
        delete updates.role;
        delete updates.profileStatus;
        delete updates.rejectionReason;
        delete updates.documents;
 
        // Parse multipart JSON strings
        const arrayFields = ['availability', 'languages', 'fees', 'consultationStatus', 'treatedConditions', 'competencies'];
        arrayFields.forEach(field => {
            if (updates[field]) {
                try {
                    updates[field] = typeof updates[field] === 'string' ? JSON.parse(updates[field]) : updates[field];
                } catch (e) {
                    console.error(`Error parsing ${field}:`, e.message);
                }
            }
        });
 
        // Process new files
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            updates.profileImage = `/uploads/doctors/${req.files.profileImage[0].filename}`;
        }
        if (req.files && req.files.signatureImage && req.files.signatureImage[0]) {
            updates.signatureImage = `/uploads/doctors/${req.files.signatureImage[0].filename}`;
        }

        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ vendorId: doctorId, vendorModel: 'Doctor', status: 'Pending' });
        if (existingPending) {
            if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            if (updates.signatureImage && existingPending.updatedFields?.signatureImage) {
                deleteFile(existingPending.updatedFields.signatureImage);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }

        // Save staged update request
        const request = await ProfileUpdateRequest.create({
            vendorId: doctorId,
            vendorModel: 'Doctor',
            updatedFields: updates,
            status: 'Pending'
        });
 
        res.json({
            success: true,
            message: 'Profile changes submitted to Admin for review. Your profile will update once approved.',
            data: request
        });
 
    } catch (error) {
        console.error("Profile update error:", error);
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

const getLatestDoctorProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Doctor'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH: Change Doctor Password
// Endpoint: PATCH /api/auth/doctor/change-password
const changeDoctorPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        // Explicitly select password since it is hidden by default in Mongoose schema
        const doctor = await Doctor.findById(req.user.id).select('+password');
        if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found." });

        const isMatch = await bcrypt.compare(String(oldPassword), doctor.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        doctor.password = await bcrypt.hash(String(newPassword), 10);
        await doctor.save();

        res.json({ success: true, message: "Password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { registerDoctor, verifyOTP, uploadDocuments, loginDoctor,toggleDoctorOnlineStatus, updateDoctorProfile ,getDoctorProfile, getDoctorById, getLatestDoctorProfileRequest,changeDoctorPassword };