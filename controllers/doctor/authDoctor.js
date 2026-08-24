const Doctor = require('../../models/Doctor');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const { deleteFile } = require('../../utils/fileHandler');
const { verifyFirebasePhoneToken } = require('../../utils/firebaseAuthHelper');

// Helper: Generate Token
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// ==========================================
// 1. REGISTER DOCTOR (With Real Firebase OTP Verification)
// Endpoint: POST /api/auth/doctor/register
// ==========================================
const registerDoctor = async (req, res) => {
    try {
        const { name, email, phone, countryCode, country, state, city, password, idToken } = req.body;

        // 1. Basic Validations
        if (!name || !phone || !password) {
            return res.status(400).json({ success: false, message: "Name, Phone and Password are required." });
        }

        const normalizedEmail = email ? email.toLowerCase().trim() : null;
        const cleanPhone = phone.trim();

        // 2. Duplicate check
        const query = [];
        if (normalizedEmail) query.push({ email: normalizedEmail });
        if (cleanPhone) query.push({ phone: cleanPhone });

        const exists = await Doctor.findOne({ $or: query });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Email or Phone already exists with another Doctor account.' });
        }

        // 3. 🚨 Firebase Phone Verification Check
        // Production me idToken compulsory hai, Dev/Local testing me optional
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Firebase idToken is required for phone verification." 
                });
            }

            const verification = await verifyFirebasePhoneToken(idToken, cleanPhone);
            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        }

        // 4. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 5. Create Doctor in DB (Directly Phone Verified)
        const doctor = await Doctor.create({
            name,
            email: normalizedEmail || undefined,
            phone: cleanPhone,
            countryCode: countryCode || "+91",
            country: country || null,
            state: state || null,
            city: city || null,
            password: hashedPassword,
            role: 'doctor',
            isPhoneVerified: true, // Firebase se verified ho chuka hai
            profileStatus: 'Incomplete'
        });

        // 6. Generate Session Token (Step 2 document upload ke liye)
        const token = generateToken(doctor._id, doctor.role);
        doctor.token = token;
        await doctor.save();

        res.status(201).json({
            success: true,
            message: "Doctor registered & Phone verified successfully. Please upload documents to complete profile.",
            token,
            doctorId: doctor._id,
            profileStatus: doctor.profileStatus
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. UPLOAD DOCUMENTS (Step 2 of Onboarding)
// Endpoint: PUT /api/auth/doctor/upload-docs
// ==========================================
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
            profileStatus: 'Pending', // Review status
            rejectionReason: null
        };

        if (req.files?.profileImage && req.files.profileImage[0]) {
            updateData.profileImage = req.files.profileImage[0].path.replace(/\\/g, "/");
        }
        if (req.files?.certificates) {
            updateData.documents = req.files.certificates.map(f => f.path.replace(/\\/g, "/"));
        }

        const updated = await Doctor.findByIdAndUpdate(doctorId, { $set: updateData }, { new: true });
        
        res.json({ 
            success: true, 
            message: 'Documents submitted successfully. Profile is under Admin review.', 
            profileStatus: 'Pending',
            data: updated 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. LOGIN DOCTOR
// Endpoint: POST /api/auth/doctor/login
// ==========================================
const loginDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        let query = email ? { email: email.toLowerCase().trim() } : { phone: phone ? phone.trim() : null };
        const doctor = await Doctor.findOne(query).select('+password');

        if (!doctor || !(await bcrypt.compare(String(password), doctor.password))) {
            return res.status(400).json({ success: false, message: 'Invalid Credentials' });
        }

        if (doctor.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your account is deactivated. Please contact support." 
            });
        }

        if (doctor.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                role: doctor.role, 
                profileStatus: 'Pending',
                message: 'Profile under review. Please wait for Admin approval.' 
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
                message: `Application Rejected: ${doctor.rejectionReason || "Please re-upload documents."}` 
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
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. TOGGLE ONLINE STATUS
// ==========================================
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

        res.json({
            success: true,
            message: `Your status has been updated to ${isOnline ? 'Online' : 'Offline'}.`,
            isOnline: updatedDoctor.isOnline
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. UPDATE PROFILE (Staged)
// ==========================================
const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const updates = { ...req.body };

        const existingDoc = await Doctor.findById(doctorId);
        if (!existingDoc) {
            return res.status(404).json({ success: false, message: 'Doctor not found' });
        }
 
        delete updates.email;
        delete updates.phone;
        delete updates.password;
        delete updates.role;
        delete updates.profileStatus;
        delete updates.rejectionReason;
        delete updates.documents;
 
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
 
        if (req.files?.profileImage && req.files.profileImage[0]) {
            updates.profileImage = `/uploads/doctors/${req.files.profileImage[0].filename}`;
        }
        if (req.files?.signatureImage && req.files.signatureImage[0]) {
            updates.signatureImage = `/uploads/doctors/${req.files.signatureImage[0].filename}`;
        }

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
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. GET PROFILES
// ==========================================
const getDoctorProfile = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id).populate('hospitalId', 'name address');
        if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });

        res.status(200).json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getDoctorById = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id)
            .select('-password -token -resetOTP')
            .populate('hospitalId', 'name address');

        if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });

        res.status(200).json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getLatestDoctorProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Doctor'
        }).sort({ createdAt: -1 }).lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const changeDoctorPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

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

module.exports = { 
    registerDoctor, 
    uploadDocuments, 
    loginDoctor, 
    toggleDoctorOnlineStatus, 
    updateDoctorProfile, 
    getDoctorProfile, 
    getDoctorById, 
    getLatestDoctorProfileRequest, 
    changeDoctorPassword 
};