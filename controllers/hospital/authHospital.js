const Hospital = require('../../models/Hospital');
const Ward = require('../../models/Ward');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { verifyFirebasePhoneToken } = require('../../utils/firebaseAuthHelper'); // 👈 Firebase Helper

const generateToken = (id, role = 'hospital') => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// ==========================================
// 1. HOSPITAL PRE-CHECK (Check if already registered)
// Endpoint: POST /api/auth/hospital/check-exists
// ==========================================
const checkHospitalExists = async (req, res) => {
    try {
        const { phone, email } = req.body;

        if (!phone && !email) {
            return res.status(400).json({ success: false, message: "Phone number or Email is required." });
        }

        const cleanPhone = phone ? phone.trim().replace(/\D/g, "").slice(-10) : null;
        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        const query = [];
        if (cleanPhone) query.push({ phone: cleanPhone });
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const exists = await Hospital.findOne({ $or: query });

        if (exists) {
            const isPhoneMatch = exists.phone === cleanPhone;
            return res.status(200).json({ 
                success: false, 
                exists: true, 
                message: isPhoneMatch 
                    ? "This mobile number is already registered for a Hospital. Please Login." 
                    : "This email address is already registered for a Hospital. Please Login."
            });
        }

        res.status(200).json({ 
            success: true, 
            exists: false, 
            message: "Phone number and email are available for Hospital registration." 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. REGISTER HOSPITAL (With Firebase Phone Verification)
// Endpoint: POST /api/auth/hospital/register
// ==========================================
const registerHospital = async (req, res) => {
    try {
        const {
            name, email, phone, countryCode,
            country, state, city,
            password, type, idToken
        } = req.body;

        if (!name || !phone || !password || !type) {
            return res.status(400).json({
                success: false,
                message: 'Hospital Name, Phone, Password, and Type are required fields.'
            });
        }

        const cleanPhone = phone.trim().replace(/\D/g, "").slice(-10);
        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        // Duplicate check
        const query = [{ phone: cleanPhone }];
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const exists = await Hospital.findOne({ $or: query });
        if (exists) {
            return res.status(400).json({
                success: false,
                message: 'Hospital already exists with this Email or Phone number.'
            });
        }

        // 🚨 Real Firebase Phone Verification
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Firebase idToken is required for phone verification." 
                });
            }

            const fullPhoneToVerify = countryCode ? `${countryCode}${cleanPhone}` : cleanPhone;
            const verification = await verifyFirebasePhoneToken(idToken, fullPhoneToVerify);

            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newHospital = await Hospital.create({
            name,
            email: normalizedEmail || undefined,
            phone: cleanPhone,
            countryCode: countryCode || '+91',
            country: country || null,
            state: state || null,
            city: city || null,
            type,
            password: hashedPassword,
            isPhoneVerified: true,
            profileStatus: 'Incomplete' // Pehla step complete, documents upload baaki
        });

        const token = generateToken(newHospital._id, 'hospital');
        newHospital.token = token;
        await newHospital.save();

        res.status(201).json({
            success: true,
            message: 'Hospital registered & Phone verified successfully. Please upload legal documents.',
            token,
            hospitalId: newHospital._id,
            profileStatus: 'Incomplete'
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. LOGIN HOSPITAL (With FCM Push Token Capture)
// Endpoint: POST /api/auth/hospital/login
// ==========================================
const loginHospital = async (req, res) => {
    try {
        const { email, phone, password, fcmToken } = req.body;
        
        let query = email ? { email: email.toLowerCase().trim() } : { phone: phone ? phone.trim().replace(/\D/g, "").slice(-10) : null };

        const hospital = await Hospital.findOne(query).select('+password');
        if (!hospital || !(await bcrypt.compare(String(password), hospital.password))) {
            return res.status(400).json({ success: false, message: 'Invalid Credentials' });
        }

        if (hospital.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your hospital account is deactivated. Please contact administrator." 
            });
        }

        if (hospital.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Your hospital profile is under review. Please wait for Admin approval.' 
            });
        }

        if (hospital.profileStatus === 'Incomplete') {
            const token = hospital.token || generateToken(hospital._id, 'hospital');
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                token,
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload hospital documents to proceed.' 
            });
        }

        if (hospital.profileStatus === 'Rejected') {
            const token = hospital.token || generateToken(hospital._id, 'hospital');
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                token,
                profileStatus: 'Rejected',
                rejectionReason: hospital.rejectionReason,
                message: `Application Rejected: ${hospital.rejectionReason}. Please re-upload documents.` 
            });
        }

        let token = null;
        if (process.env.NODE_ENV === 'development' && hospital.token) {
            try {
                jwt.verify(hospital.token, process.env.JWT_SECRET);
                token = hospital.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(hospital._id, 'hospital');
            hospital.token = token;
        }

        // 🚨 CRITICAL FIX: Save FCM Token for Emergency Admission alerts!
        if (fcmToken) {
            hospital.fcmToken = fcmToken;
        }
        await hospital.save();

        hospital.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved', 
            data: hospital 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. NEW HOSPITAL STATUS TOGGLE API
const toggleHospitalOnlineStatus = async (req, res) => {
    try {
        const { isOnline } = req.body;
        const hospitalId = req.user.id;

        if (isOnline === undefined) {
            return res.status(400).json({ success: false, message: "isOnline status value is required." });
        }

        const updatedHospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            { $set: { isOnline: Boolean(isOnline) } },
            { new: true }
        ).select('-password');

        if (!updatedHospital) {
            return res.status(404).json({ success: false, message: "Hospital profile not found." });
        }

        res.json({
            success: true,
            message: `Hospital status successfully updated to ${isOnline ? 'Online' : 'Offline'}.`,
            isOnline: updatedHospital.isOnline
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. UPDATE HOSPITAL PROFILE ---
// Endpoint: PUT /api/auth/hospital/profile/update
const updateHospitalProfile = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const updates = { ...req.body };
 
        // 🚨 SECURITY LOCKS
        delete updates.email;
        delete updates.phone;
        delete updates.password;
        delete updates.role;
        delete updates.profileStatus;
        delete updates.rejectionReason;
        delete updates.hospitalImage;
        delete updates.licenseDocument;
        delete updates.otherDocuments;
 
        // Clean up previous unapproved pending request if exists
        await ProfileUpdateRequest.findOneAndDelete({ vendorId: hospitalId, vendorModel: 'Hospital', status: 'Pending' });

        const request = await ProfileUpdateRequest.create({
            vendorId: hospitalId,
            vendorModel: 'Hospital',
            updatedFields: updates,
            status: 'Pending'
        });
 
        res.json({
            success: true,
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.",
            data: request
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

 
const getMyHospitalProfile = async (req, res) => {
    try {
        const hospital = await Hospital.findById(req.user.id).select('-password');
        const wards = await Ward.find({ hospitalId: req.user.id });
        
        // Dynamic capacity calculation
        const totalBeds = wards.reduce((sum, w) => sum + w.totalBeds, 0);
        const allocated = wards.reduce((sum, w) => sum + (w.totalBeds - w.availableBeds), 0);

        res.json({
            success: true,
            data: {
                hospital,
                capacity: {
                    total: totalBeds,
                    allocated: allocated,
                    remaining: totalBeds - allocated
                },
                wards // Lists ICU and Ward Units separately
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// GET: Fetch latest profile update request status for logged-in Hospital
const getLatestHospitalProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Hospital'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH: Change Hospital Password
// Endpoint: PATCH /api/auth/hospital/change-password
const changeHospitalPassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        const hospital = await Hospital.findById(req.user.id).select('+password');
        if (!hospital) return res.status(404).json({ success: false, message: "Hospital not found." });

        const isMatch = await bcrypt.compare(String(oldPassword), hospital.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        hospital.password = await bcrypt.hash(String(newPassword), 10);
        await hospital.save();

        res.json({ success: true, message: "Hospital password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { checkHospitalExists, registerHospital, loginHospital,toggleHospitalOnlineStatus, updateHospitalProfile, getMyHospitalProfile, getLatestHospitalProfileRequest, changeHospitalPassword };  