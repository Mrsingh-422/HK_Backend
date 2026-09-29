// controllers/ambulance/authAmbulance.js
const Ambulance = require('../../models/Ambulance');
const Availability = require('../../models/Availability');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest'); // For handling profile update requests
const { deleteFile } = require('../../utils/fileHandler');
const { sendEmailOTP } = require('../../utils/emailService');

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

// LOGIN AMBULANCE DRIVER (With FCM Push Token Capture)
// Endpoint: POST /api/auth/ambulance/login
const loginAmbulance = async (req, res) => {
    try {
        const { email, phone, password, fcmToken } = req.body;
        
        let query = email ? { email: email.toLowerCase().trim() } : { phone: phone ? phone.trim().replace(/\D/g, "").slice(-10) : null };

        const amb = await Ambulance.findOne(query).select('+password');
        if (!amb || !(await bcrypt.compare(String(password), amb.password))) {
            return res.status(400).json({ success: false, message: 'Invalid Credentials' });
        }

        // Block login if deactivated
        if (amb.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your driver account is inactive. Please contact support." 
            });
        }

        // Check Profile Statuses
        if (amb.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Profile under review. Waiting for Admin approval.' 
            });
        }

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
        }

        // 🚨 CRITICAL FIX: Save device FCM Token for live task alerts!
        if (fcmToken) {
            amb.fcmToken = fcmToken;
        }
        amb.isOnline = true;
        await amb.save();

        amb.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved', 
            data: amb 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1. COMPLETE AMBULANCE PROFILE (Step 2 Onboarding with Safe JSON Parsers) ---
// Endpoint: PUT /api/auth/ambulance/complete-profile
const completeAmbulanceProfile = async (req, res) => {
    try {
        const ambId = req.user.id;
        const updates = { ...req.body };
        const files = req.files || {};

        // Safe JSON Parsing for form-data stringified fields
        if (typeof updates.pricing === 'string') {
            try { updates.pricing = JSON.parse(updates.pricing); } catch (e) {}
        }
        if (typeof updates.supportStaff === 'string') {
            try { updates.supportStaff = JSON.parse(updates.supportStaff); } catch (e) {}
        }
        if (typeof updates.freeServices === 'string') {
            try { updates.freeServices = JSON.parse(updates.freeServices); } catch (e) {}
        }
        if (typeof updates.optionalServices === 'string') {
            try { updates.optionalServices = JSON.parse(updates.optionalServices); } catch (e) {}
        }

        // Map Clean Web-Accessible File Paths
        if (Object.keys(files).length > 0) {
            const documentPaths = {
                drivingLicenseFile: files.drivingLicenseFile ? `/uploads/ambulances/${files.drivingLicenseFile[0].filename}` : null,
                rcFile: files.rcFile ? `/uploads/ambulances/${files.rcFile[0].filename}` : null,
                insuranceFile: files.insuranceFile ? `/uploads/ambulances/${files.insuranceFile[0].filename}` : null,
                fitnessCertificate: files.fitnessCertificate ? `/uploads/ambulances/${files.fitnessCertificate[0].filename}` : null,
                ambulancePermit: files.ambulancePermit ? `/uploads/ambulances/${files.ambulancePermit[0].filename}` : null
            };
            
            updates.documents = documentPaths;

            if (files.drivingLicenseFile && files.rcFile) {
                updates.profileStatus = 'Pending';
                updates.rejectionReason = null;
            }
        }

        const updatedAmb = await Ambulance.findByIdAndUpdate(
            ambId, 
            { $set: updates }, 
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedAmb) {
            return res.status(404).json({ success: false, message: "Ambulance driver not found." });
        }

        res.json({ 
            success: true, 
            message: updates.profileStatus === 'Pending' ? 'Profile submitted for Admin review.' : 'Profile partially updated.', 
            data: updatedAmb 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const toggleDriverAvailability = async (req, res) => {
    try {
        const { available } = req.body; 

        if (available === undefined) {
            return res.status(400).json({ success: false, message: "available parameter is required." });
        }

        const isTargetAvailable = Boolean(available === true || available === 'true');

        // 🚀 SYNC FIX: Prevent driver from marking themselves available while actively driving a patient
        if (isTargetAvailable) {
            const Booking = require('../../models/AmbulanceBooking');
            const activeTrip = await Booking.findOne({
                ambulanceId: req.user.id,
                status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
            });

            if (activeTrip) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot toggle to available while an active trip is in progress. Please complete the ongoing ride first."
                });
            }
        }

        const ambulance = await Ambulance.findByIdAndUpdate(
            req.user.id,
            { 
                $set: { 
                    availableForEmergency: isTargetAvailable,
                    isOnline: isTargetAvailable 
                } 
            },
            { new: true }
        ).select('-password');

        if (!ambulance) return res.status(404).json({ success: false, message: "Driver profile not found." });

        res.json({ 
            success: true, 
            message: `Driver status updated to ${isTargetAvailable ? 'Online' : 'Offline'}`, 
            available: ambulance.availableForEmergency,
            isOnline: ambulance.isOnline
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

// 1. FORGOT PASSWORD (With Real Email Dispatch)
// Endpoint: POST /api/auth/ambulance/forgot-password
const forgotPasswordAmbulance = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email is required." });

        const driver = await Ambulance.findOne({ email: email.toLowerCase().trim() });
        if (!driver) return res.status(404).json({ success: false, message: "No driver registered with this email." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        driver.resetPasswordOtp = otp;
        driver.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 mins
        await driver.save();

        // 🚨 SEND REAL EMAIL OTP VIA BREVO
        const emailSent = await sendEmailOTP(driver.email, otp);
        if (!emailSent && process.env.NODE_ENV === 'production') {
            return res.status(500).json({ success: false, message: "Failed to send OTP email. Please try again." });
        }

        res.json({ 
            success: true, 
            message: "6-Digit Verification OTP sent to your registered email address.",
            debugOtp: process.env.NODE_ENV === 'production' ? undefined : otp 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 2. VERIFY RECOVERY OTP
// Endpoint: POST /api/auth/ambulance/verify-recovery-otp
const verifyRecoveryOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ success: false, message: "Email and OTP are required." });

        const driver = await Ambulance.findOne({ email: email.toLowerCase().trim() });
        if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found." });

        const savedOtp = String(driver.resetPasswordOtp || "").trim();
        const incomingOtp = String(otp).trim();

        if (!savedOtp || savedOtp !== incomingOtp) {
            return res.status(400).json({ success: false, message: "Invalid OTP code." });
        }

        if (Date.now() > driver.resetPasswordExpires) {
            return res.status(400).json({ success: false, message: "Recovery OTP has expired. Please request a new one." });
        }

        res.json({ success: true, message: "OTP Verified successfully. Please set a new password." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. RESET PASSWORD WITH OTP
// Endpoint: PATCH /api/auth/ambulance/reset-password-otp
const resetPasswordWithOtp = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;
        
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "Password must be at least 6 characters long." });
        }
        if (confirmPassword && newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: "Passwords do not match." });
        }

        const driver = await Ambulance.findOne({ email: email.toLowerCase().trim() });
        if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found." });

        driver.password = await bcrypt.hash(String(newPassword), 10);
        driver.resetPasswordOtp = undefined;
        driver.resetPasswordExpires = undefined;
        driver.token = null; // Invalidate sessions
        await driver.save();

        res.json({ success: true, message: "Password updated successfully. Please login with new password." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. UPDATE DRIVER PROFILE (Full Multi-field Staging via ProfileUpdateRequest) ---
// Endpoint: PATCH /api/auth/ambulance/profile/update
const updateAmbulanceProfile = async (req, res) => {
    try {
        const driverId = req.user.id;
        const { 
            name, phone, email, address, 
            vehicleType, vehicleNumber, serviceRadius,
            fixedPrice, baseDistance, pricePerKM,
            bloodGroup, experienceYears
        } = req.body;

        const currentDriver = await Ambulance.findById(driverId);
        if (!currentDriver) {
            return res.status(404).json({ success: false, message: "Driver not found." });
        }

        // Prepare staged updates dictionary
        const updates = { 
            name: name ? String(name).trim() : currentDriver.name,
            phone: phone ? String(phone).trim() : currentDriver.phone,
            email: email ? String(email).toLowerCase().trim() : currentDriver.email,
            address: address ? String(address).trim() : currentDriver.address,
            vehicleType: vehicleType || currentDriver.vehicleType,
            vehicleNumber: vehicleNumber || currentDriver.vehicleNumber,
            serviceRadius: serviceRadius || currentDriver.serviceRadius,
            bloodGroup: bloodGroup || currentDriver.bloodGroup,
            experienceYears: experienceYears || currentDriver.experienceYears,
            pricing: {
                fixedPrice: fixedPrice !== undefined ? Number(fixedPrice) : (currentDriver.pricing?.fixedPrice || 0),
                baseDistance: baseDistance !== undefined ? Number(baseDistance) : (currentDriver.pricing?.baseDistance || 5),
                pricePerKM: pricePerKM !== undefined ? Number(pricePerKM) : (currentDriver.pricing?.pricePerKM || 0)
            }
        };

        // Handle profile photo upload if provided
        if (req.files?.profilePic && req.files.profilePic[0]) {
            updates.profilePic = `/uploads/ambulances/${req.files.profilePic[0].filename}`;
        }

        // Clean previous unapproved pending requests & uploaded temp files
        const existingPending = await ProfileUpdateRequest.findOne({ 
            vendorId: driverId, 
            vendorModel: 'Ambulance', 
            status: 'Pending' 
        });

        if (existingPending) {
            if (updates.profilePic && existingPending.updatedFields?.profilePic) {
                deleteFile(existingPending.updatedFields.profilePic);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }

        const request = await ProfileUpdateRequest.create({
            vendorId: driverId,
            vendorModel: 'Ambulance',
            updatedFields: updates,
            status: 'Pending'
        });

        res.json({ 
            success: true, 
            message: "Profile changes submitted to Admin for review. Updates will reflect upon approval.", 
            data: request 
        });
    } catch (error) { 
        console.error("Update Ambulance Profile Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// GET: Fetch latest profile update request status for logged-in Ambulance provider
const getLatestAmbulanceProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Ambulance'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const changeDriverPassword = async (req, res) => {
    try {
        const driverId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const driver = await Ambulance.findById(driverId).select('+password');
        if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

        // Verify Old Password
        const isMatch = await bcrypt.compare(oldPassword, driver.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        // Hash and Save New Password
        driver.password = await bcrypt.hash(newPassword, 10);
        await driver.save();

        res.json({ success: true, message: "Password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 4. SET AMBULANCE AVAILABILITY & SHIFTS
// Endpoint: POST /api/auth/ambulance/availability/set
const setAmbulanceAvailability = async (req, res) => {
    try {
        const ambulanceId = req.user.id;
        const { startTime, endTime, slotDuration, offDays, unavailableSlots } = req.body;

        if (startTime && endTime && startTime >= endTime) {
            return res.status(400).json({ success: false, message: "Shift start time must be before end time." });
        }

        const config = await Availability.findOneAndUpdate(
            { vendorId: ambulanceId, vendorType: 'Ambulance' },
            {
                $set: {
                    vendorId: ambulanceId,
                    vendorType: 'Ambulance',
                    startTime: startTime || "08:00",
                    endTime: endTime || "20:00",
                    slotDuration: Number(slotDuration) || 120, // 2-Hour buffer
                    offDays: offDays || [],
                    unavailableSlots: unavailableSlots || []
                }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: "Ambulance shift timings and slots updated successfully.",
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. GET DRIVER AVAILABILITY CONFIG
// Endpoint: GET /api/auth/ambulance/availability/my-config
const getMyAmbulanceAvailability = async (req, res) => {
    try {
        const ambulanceId = req.user.id;
        let config = await Availability.findOne({ vendorId: ambulanceId, vendorType: 'Ambulance' });

        if (!config) {
            config = {
                startTime: "00:00",
                endTime: "23:59",
                slotDuration: 120,
                offDays: [],
                unavailableSlots: []
            };
        }

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// =========================================================================
// 1. AMBULANCE DRIVER PRE-CHECK (Duplicate & OTP Rate Limit Check)
// Endpoint: POST /api/auth/ambulance/check-exists
// =========================================================================
const checkAmbulanceExists = async (req, res) => {
    try {
        const { phone, email } = req.body;

        if (!phone && !email) {
            return res.status(400).json({ success: false, message: "Phone number or Email is required." });
        }

        const cleanPhone = phone ? String(phone).trim().replace(/\D/g, "").slice(-10) : null;
        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        const clientIp = req.headers['cf-connecting-ip'] || 
                         req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                         req.socket.remoteAddress;

        // 1. Check if Driver already exists in database
        const query = [];
        if (cleanPhone) query.push({ phone: cleanPhone });
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const exists = await Ambulance.findOne({ $or: query });

        if (exists) {
            const isPhoneMatch = exists.phone === cleanPhone;
            return res.status(200).json({ 
                success: false, 
                exists: true, 
                message: isPhoneMatch 
                    ? "This mobile number is already registered as an Ambulance Driver. Please Login." 
                    : "This email address is already registered as an Ambulance Driver. Please Login."
            });
        }

        // 2. Consume Registration-OTP limit
        if (cleanPhone) {
            const { checkAndConsumeOtpLimit } = require('../../utils/otpRateLimiterHelper');
            const limitCheck = await checkAndConsumeOtpLimit(cleanPhone, 'phone', 'Registration-OTP', clientIp);
            if (!limitCheck.allowed) {
                return res.status(limitCheck.statusCode).json({
                    success: false,
                    errorType: "OTP_LIMIT_EXCEEDED",
                    message: limitCheck.message
                });
            }
        }

        res.status(200).json({ 
            success: true, 
            exists: false, 
            message: "Phone number and email are available for Ambulance registration." 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. UPDATE DRIVER FCM PUSH TOKEN (For Live Emergency Sirens)
// Endpoint: PATCH /api/auth/ambulance/fcm-token
// =========================================================================
const updateAmbulanceFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const ambulanceId = req.user.id;

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: "fcmToken is required." });
        }

        await Ambulance.findByIdAndUpdate(ambulanceId, { 
            $set: { fcmToken: String(fcmToken).trim() } 
        });

        res.json({ 
            success: true, 
            message: "Ambulance driver FCM token synchronized successfully." 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { registerAmbulance, loginAmbulance, completeAmbulanceProfile,toggleDriverAvailability,getMyAmbulanceProfile,resetPasswordTest, forgotPasswordAmbulance, verifyRecoveryOtp, resetPasswordWithOtp, updateAmbulanceProfile,getLatestAmbulanceProfileRequest, changeDriverPassword, setAmbulanceAvailability, getMyAmbulanceAvailability, checkAmbulanceExists, updateAmbulanceFcmToken };