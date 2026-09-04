// controllers/user/authUser.js
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // Built-in Node module for random numbers
const sendEmailOTP = require('../../utils/emailService'); // Email sending utility
const { deleteFile } = require('../../utils/fileHandler');
const HealthData = require('../../models/HealthData');
const PillReminder = require('../../models/PillReminder');
const HealthNews = require('../../models/HealthNews'); // New Model
const { getActiveSubscriptionMetadata } = require('../../utils/subscriptionBenefitHelper'); // New Helper
const { verifyFirebasePhoneToken } = require('../../utils/firebaseAuthHelper'); // 👈 Firebase Helper
const UnbanRequest = require('../../models/UnbanRequest');
const { checkAndConsumeOtpLimit } = require('../../utils/otpRateLimiterHelper');


// Helper: Token Generator
const generateToken = (id, role = 'user') => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// ==========================================
// USER PRE-CHECK (Already-Registered Check FIRST, Limiter Check SECOND)
// Endpoint: POST /api/auth/user/check-exists
// ==========================================
const checkUserExists = async (req, res) => {
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

        // 🚨 1. STEP A: FIRST CHECK IF USER ALREADY EXISTS IN DATABASE
        const query = [];
        if (cleanPhone) query.push({ phone: cleanPhone });
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const exists = await User.findOne({ $or: query });

        if (exists) {
            const isPhoneMatch = exists.phone === cleanPhone;
            // ❌ Directly return Already Registered (DO NOT consume rate limit!)
            return res.status(200).json({ 
                success: false, 
                exists: true, 
                message: isPhoneMatch 
                    ? "This mobile number is already registered. Please Login." 
                    : "This email address is already registered. Please Login."
            });
        }

        // 🚨 2. STEP B: USER DOES NOT EXIST ➔ NOW CHECK & CONSUME 'Registration-OTP' LIMIT
        if (cleanPhone) {
            const limitCheck = await checkAndConsumeOtpLimit(cleanPhone, 'phone', 'Registration-OTP', clientIp);
            if (!limitCheck.allowed) {
                return res.status(limitCheck.statusCode).json({
                    success: false,
                    errorType: "OTP_LIMIT_EXCEEDED",
                    message: limitCheck.message
                });
            }
        }

        // Available for registration & within rate limit
        res.status(200).json({ 
            success: true, 
            exists: false, 
            message: "Mobile number is available." 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 1. REGISTER USER (With Firebase Phone Verification)
// Endpoint: POST /api/auth/user/register
// ==========================================
const registerUser = async (req, res) => {
    try {
        const { 
            name, email, phone, countryCode,
            country, state, city, 
            password, confirmPassword, idToken 
        } = req.body;

        // 1. Validations
        if (!name || !phone || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, Phone number, and Password are required.' 
            });
        }

        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Passwords do not match.' 
            });
        }

        const normalizedEmail = email ? email.toLowerCase().trim() : null;
        const cleanPhone = phone.trim();

        // 2. Duplicate Check
        const query = [{ phone: cleanPhone }];
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const exists = await User.findOne({ $or: query });
        if (exists) {
            return res.status(400).json({ 
                success: false, 
                message: 'User already exists with this Email or Phone number.' 
            });
        }

        // 3. 🚨 Firebase Phone Verification Check
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
                return res.status(400).json({ 
                    success: false, 
                    message: verification.message 
                });
            }
        }

        // 4. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 5. Create User (Instantly Approved with Phone Verified)
        const user = await User.create({
            name,
            email: normalizedEmail || undefined,
            phone: cleanPhone,
            countryCode: countryCode || '+91',
            country: country || null,
            state: state || null,
            city: city || null,
            password: hashedPassword,
            role: 'user',
            isPhoneVerified: true, // Phone verified via Firebase
            profileStatus: 'Approved' // Users are directly approved
        });

        // 6. Generate Session Token
        const token = generateToken(user._id, 'user');
        user.token = token;
        await user.save();

        res.status(201).json({ 
            success: true,
            message: "User Registered & Phone Verified Successfully!",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                countryCode: user.countryCode,
                fullPhone: `${user.countryCode}${user.phone}`,
                location: `${user.city || ''}, ${user.state || ''}, ${user.country || ''}`.replace(/^, |, $/g, ''),
                role: user.role,
                profileStatus: user.profileStatus
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 1. UPDATED: LOGIN USER (With Banned Flag & Unban Prompt)// Endpoint: POST /api/auth/user/login
// ==========================================
const loginUser = async (req, res) => {
    try {
        const { email, phone, countryCode, password } = req.body;

        let query = {};
        if (email) {
            query = { email: email.toLowerCase().trim() };
        } else if (phone) {
            query = { phone: phone.trim().replace(/\D/g, "").slice(-10) };
        } else {
            return res.status(400).json({ success: false, message: 'Provide Email or Phone number' });
        }

        // Fetch user with password
        const user = await User.findOne(query).select('+password');

        if (!user || !(await bcrypt.compare(String(password), user.password))) {
            return res.status(400).json({ success: false, message: 'Invalid Credentials' });
        }

        // 🚨 1. DEACTIVATED CHECK: If Admin deactivated this user (isActive === false)
        if (user.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                isDeactivated: true,
                isActive: false,
                status: "Deactivated",
                message: "Access Denied: Your account has been deactivated by the Administrator. Please contact support." 
            });
        }

        // 🚨 2. AUTO-BAN CHECK: If user was auto-banned for 2 cancellations
        if (user.isBanned === true) {
            return res.status(403).json({ 
                success: false, 
                isBanned: true,
                canRequestUnban: true,
                phone: user.phone,
                message: user.banReason || "Your account has been suspended due to 2 accidental cancellations in 24 hours. Please submit an unban request to Admin." 
            });
        }

        // Generate Token
        let token = null;
        if (process.env.NODE_ENV === 'development' && user.token) {
            try {
                jwt.verify(user.token, process.env.JWT_SECRET);
                token = user.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(user._id, 'user');
            user.token = token;
            await user.save();
        }

        user.password = undefined;

        // ✅ Normal Active Login Response
        res.json({
            success: true,
            token,
            user: {
                ...user._doc,
                isActive: true,
                status: "Active",
                fullPhone: user.countryCode ? `${user.countryCode}${user.phone}` : null
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. FORGOT PASSWORD FLOW (Figma Screens)

// A. SEND OTP (Screen: Forgot Password -> Enter Email -> Submit)
// endpoint: POST /api/auth/user/forgot-password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ message: 'User not found with this email' });

        // --- ENV LOGIC FOR OTP ---
        let otp;
        if (process.env.NODE_ENV === 'development') {
            otp = '1111'; // Dev Mode: Fixed OTP
            console.log(`🟨 [DEV MODE] OTP for ${email} is: ${otp}`);
        } else {
            otp = Math.floor(100000 + Math.random() * 900000).toString(); // Prod Mode: Random 6 Digit
        }

        // Save OTP to DB
        user.resetPasswordOtp = otp;
        user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 Minutes
        await user.save();

        // Send Email (Only in Production)
        if (process.env.NODE_ENV === 'production') {
            const emailSent = await sendEmailOTP(email, otp);
            if (!emailSent) {
                return res.status(500).json({ message: "Failed to send email" });
            }
        }

        res.json({ success: true, message: 'OTP sent to your email' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// B. VERIFY OTP (Only for Forgot Password)
// endpoint: POST /api/auth/user/verify-otp
const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // Find user with matching Email AND OTP AND Not Expired
        const user = await User.findOne({
            email,
            resetPasswordOtp: otp,
            resetPasswordExpires: { $gt: Date.now() } 
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or Expired OTP' });
        }

        // OTP Verified
        res.json({ success: true, message: 'OTP Verified Successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// C. RESET PASSWORD (Final Step)
// endpoint: POST /api/auth/user/reset-password
const resetPassword = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Update Password
        user.password = await bcrypt.hash(newPassword, 10);

        // Clear OTP fields
        user.resetPasswordOtp = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ success: true, message: 'Password Reset Successfully. Please Login.' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 5. GET PROFILE (Fixed Populate)
// endpoint: GET /api/auth/user/profile
const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // 🚨 INTEGRATION CHECK: Fetch subscription metadata
        const subscriptionMeta = await getActiveSubscriptionMetadata(user._id);

        // Safe conversion of Mongoose Document to JS Object
        const userObj = user.toObject();

        res.status(200).json({
            success: true,
            data: {
                ...userObj, // Purane saare keys (abhaDetails, userAddress, familyMember etc.) safe rahenge
                activeSubscription: subscriptionMeta // 👈 Additive injection for Frontend UI Badge/Vitals
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// Update Profile (Existing Code)
// endpoint: PUT /api/auth/user/update
const updateUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Profile Pic handling
        if (req.file) {
            user.profilePic = `/uploads/users/${req.file.filename}`;
        }

        // Destructure all fields from Figma Image
        const { 
            name, fatherName, phone, countryCode, email, 
            weight, gender, dob, height,
            country, state, city, 
            insuranceId 
        } = req.body;

        // Basic Info
        if (name) user.name = name;
        if (fatherName) user.fatherName = fatherName;
        if (email) user.email = email;
        
        // Stats & Gender
        if (weight) user.weight = weight;
        if (gender) user.gender = gender;
        if (dob) user.dob = dob;
        if (height) user.height = height;

        // Phone Update
        if (phone && countryCode) {
            user.phone = phone;
            user.countryCode = countryCode;
        }

        // Location Info
        if (country) user.country = country;
        if (state) user.state = state;
        if (city) user.city = city;
        
        if (insuranceId) user.insuranceId = insuranceId;

        await user.save();

        res.json({ 
            success: true, 
            message: "Profile Updated Successfully", 
            data: user 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 1. UPDATE WORK DETAILS (Figma Screen 16) ---
const updateWorkDetails = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { workDetails: req.body },
            { new: true }
        );
        res.json({ success: true, message: "Work details updated", data: user.workDetails });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// --- 10. ADD FAMILY MEMBER ---
// endpoint: POST /api/auth/user/add-family
const addUserFamilyMember = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            memberName, relation, dob, phone, gender, 
            height, weight, insuranceNo, insuranceId, hasInsurance 
        } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const newMember = {
            memberName,
            relation,
            dob,
            phone,
            gender,
            height,
            weight,
            insuranceNo,
            insuranceId: insuranceId || null, // Dropdown se aayi ID
            hasInsurance: hasInsurance === 'true' || hasInsurance === true,
            profilePic: req.file ? `/uploads/users/${req.file.filename}` : null
        };

        user.familyMember.push(newMember);
        await user.save();

        res.status(201).json({ success: true, data: user.familyMember[user.familyMember.length - 1] });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// --- 18. GET FAMILY MEMBERS LIST (Figma Screen 4) ---
// endpoint: GET /api/auth/user/family-list
const getFamilyMembers = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('familyMember')
            .populate({
                path: 'familyMember.insuranceId',
                select: 'insuranceName provider type' // Sirf ye fields dikhayega
            });
        
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({ success: true, count: user.familyMember.length, data: user.familyMember });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// endpoint: GET /api/auth/user/family-count
const getFamilyMemberCount = async (req, res) => {
    try {
        const userId = req.user.id;

        // Hum sirf familyMember array ko select karenge performance ke liye
        const user = await User.findById(userId).select('familyMember');

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ 
            success: true, 
            totalMembers: user.familyMember.length 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// endpoint: PUT /api/auth/user/edit-family/:itemId
// --- 19. EDIT FAMILY MEMBER (Updated) ---
const editFamilyMember = async (req, res) => {
    try {
        const { itemId } = req.params;
        const user = await User.findById(req.user.id);
        const member = user.familyMember.id(itemId);

        if (!member) return res.status(404).json({ message: "Not found" });

        const { insuranceId, hasInsurance, ...rest } = req.body;

        // Update Text Fields
        Object.assign(member, rest);

        // Update ID from Dropdown
        if (insuranceId) member.insuranceId = insuranceId;

        // Update Boolean
        if (hasInsurance !== undefined) {
            member.hasInsurance = hasInsurance === 'true' || hasInsurance === true;
        }

        if (req.file) member.profilePic = `/uploads/users/${req.file.filename}`;

        await user.save();
        res.json({ success: true, data: member });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 20. DELETE FAMILY MEMBER ---
// endpoint: DELETE /api/auth/user/remove-family/:itemId
const removeFamilyMember = async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId } = req.params;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Mongoose pull method se array item remove karein
        user.familyMember.pull({ _id: itemId });
        await user.save();

        res.json({ 
            success: true, 
            message: "Family member removed successfully" 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};



// endpoint: PUT /api/auth/user/update-insurance
const updateInsuranceDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Destructure text data from req.body
        const { 
            hasInsurance, insuranceNumber, companyName, 
            insuranceType, startDate, endDate, masterInsuranceId 
        } = req.body;

        // Fetch current user details to check for an existing file
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Create update object
        let updateData = {
            "insuranceDetails.hasInsurance": hasInsurance === 'true' || hasInsurance === true,
            "insuranceDetails.insuranceNumber": insuranceNumber,
            "insuranceDetails.companyName": companyName,
            "insuranceDetails.insuranceType": insuranceType,
            "insuranceDetails.startDate": startDate,
            "insuranceDetails.endDate": endDate,
            "insuranceDetails.masterInsuranceId": (companyName === 'other' || !masterInsuranceId) ? null : masterInsuranceId
        };

        // File handling (Multer) with old file cleanup
        if (req.file) {
            // If the user already has a saved insurance document, delete it from the server disk first
            if (user.insuranceDetails && user.insuranceDetails.insuranceDocument) {
                deleteFile(user.insuranceDetails.insuranceDocument);
            }
            updateData["insuranceDetails.insuranceDocument"] = `/uploads/insurance/${req.file.filename}`;
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        res.json({ 
            success: true, 
            message: "Insurance details updated successfully", 
            data: updatedUser.insuranceDetails 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// endpoint: GET /api/auth/user/my-insurance
// for user
const getMyInsurance = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('insuranceDetails')
            .populate({
                path: 'insuranceDetails.masterInsuranceId',
                select: 'insuranceName provider type' // Flutter display ke liye
            });

        if (!user || !user.insuranceDetails) {
            return res.status(404).json({ success: false, message: "No data found" });
        }

        res.json({ 
            success: true, 
            data: user.insuranceDetails 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};




// endpoint: POST /api/auth/user/add-address
const addUserAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, addressType, phone, pincode, houseNo, city, state, isDefault, sector, landmark } = req.body;

        const user = await User.findById(userId);

        if (isDefault) {
            user.userAddress.forEach(addr => addr.isDefault = false);
        }

        // Naya address object create karna name ke saath
        const newAddress = {
            name, // Aapka naya field
            addressType,
            phone,
            pincode,
            houseNo,
            sector,
            landmark,
            city,
            state,
            isDefault: isDefault || false
        };

        user.userAddress.push(newAddress);
        await user.save();

        res.status(201).json({ 
            success: true, 
            message: "Address added successfully", 
            data: user.userAddress[user.userAddress.length - 1] 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// endpoint: POST /api/auth/user/add-emergency
const addUserEmergencyContact = async (req, res) => {
    try {
        const userId = req.user.id;
        const emergencyData = req.body;

        const user = await User.findById(userId);
        user.emergencyContact.push(emergencyData);
        await user.save();

        res.status(201).json({ 
            success: true, 
            message: "Emergency contact added successfully", 
            data: user.emergencyContact[user.emergencyContact.length - 1] 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- GET ADDRESS LIST ---
// endpoint: GET /api/auth/user/addresses
const getAddressList = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('userAddress');
        res.json({ success: true, data: user.userAddress });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- GET EMERGENCY CONTACTS LIST ---
// endpoint: GET /api/auth/user/emergency-contacts
const getEmergencyList = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('emergencyContact');
        res.json({ success: true, data: user.emergencyContact });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// --- DELETE ADDRESS ---
// endpoint: DELETE /api/auth/user/remove-address/:itemId
const removeAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.userAddress.pull({ _id: req.params.itemId });
        await user.save();

        res.json({ success: true, message: "Address deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- DELETE EMERGENCY CONTACT ---
// endpoint: DELETE /api/auth/user/remove-emergency/:itemId
const removeEmergency = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.emergencyContact.pull({ _id: req.params.itemId });
        await user.save();

        res.json({ success: true, message: "Emergency contact deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};







// --- 2. UPDATE FAMILY HISTORY (Figma Screen 17) ---
const updateFamilyHistory = async (req, res) => {
    try {
        const { diabetes, highCholesterol, hypertension, obesity } = req.body;

        // Validation (Optional): Check if provided strings are valid
        const validOptions = ['None', 'Either Parent', 'Both parents'];
        if ([diabetes, highCholesterol, hypertension, obesity].some(opt => opt && !validOptions.includes(opt))) {
            return res.status(400).json({ message: "Invalid option provided" });
        }

        const updateData = {
            "familyHistory.diabetes": diabetes,
            "familyHistory.highCholesterol": highCholesterol,
            "familyHistory.hypertension": hypertension,
            "familyHistory.obesity": obesity
        };

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true, runValidators: true } // runValidators ensures enum check
        );

        res.json({ 
            success: true, 
            message: "Family history updated successfully", 
            data: user.familyHistory 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// endpoint: GET /api/auth/user/get-family-history
const getFamilyHistory = async (req, res) => {
    try {
        const userId = req.user.id;

        // Hum sirf familyHistory object ko select karenge
        const user = await User.findById(userId).select('familyHistory');

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Agar user naya hai aur familyHistory abhi tak set nahi hui, 
        // toh schema ke default values automatic mil jayenge
        res.json({ 
            success: true, 
            data: user.familyHistory 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- 3. UPDATE MEDICAL CONDITIONS & ALLERGIES (Figma Screen 8, 12, 13) ---
const updateMedicalConditions = async (req, res) => {
    try {
        const { 
            conditionStatus, // Frontend se: { asthma: true, diabetes: false, ... }
            addedConditions, // Frontend se: ["Fever", "UTI"]
            addedAllergies   // Frontend se: ["Apple", "Egg"]
        } = req.body;

        // Hum $set ka use karenge taaki conditionStatus object ke andar ki specific keys update hon
        const updateData = {
            "conditionStatus.asthma": conditionStatus?.asthma,
            "conditionStatus.diabetes": conditionStatus?.diabetes,
            "conditionStatus.heartDisease": conditionStatus?.heartDisease,
            "conditionStatus.hypertension": conditionStatus?.hypertension,
            "conditionStatus.addedConditions": addedConditions,
            "conditionStatus.addedAllergies": addedAllergies
        };

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ 
            success: true, 
            message: "Medical details updated successfully", 
            data: user.conditionStatus 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};









// --- 5. CHANGE PASSWORD / PIN (Figma Screen 6, 15) ---
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmPassword } = req.body;
        if (newPassword !== confirmPassword) return res.status(400).json({ message: "Passwords don't match" });

        const user = await User.findById(req.user.id).select('+password');
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid old password" });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: "Password/Pin changed successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 6. EDIT SUB-ITEM (Fixed logic)
const editUserSubItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const { type, itemId } = req.params; // type: address/family/emergency
        const updateData = req.body;

        const fieldMap = { address: 'userAddress', family: 'familyMember', emergency: 'emergencyContact' };
        const fieldName = fieldMap[type];

        const user = await User.findById(userId);
        const subDoc = user[fieldName].id(itemId); // <--- Mongoose method to find by sub-ID
        
        if (!subDoc) return res.status(404).json({ message: "Item not found" });

        Object.assign(subDoc, updateData); // Merge changes
        await user.save();

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. REMOVE SUB-ITEM
const removeUserSubItem = async (req, res) => {
    try {
        const { type, itemId } = req.params;
        const fieldMap = { address: 'userAddress', family: 'familyMember', emergency: 'emergencyContact' };
        const fieldName = fieldMap[type];

        const user = await User.findById(req.user.id);
        user[fieldName].pull({ _id: itemId }); // <--- Fixed Pull logic
        await user.save();

        res.json({ success: true, message: "Removed successfully", user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// ==========================================
// 8. LOGOUT USER
// endpoint: POST /api/auth/user/logout
const logoutUser = async (req, res) => {
    try {
        const userId = req.user.id;

        // Server side par token null kar rahe hain taaki session terminate ho jaye
        await User.findByIdAndUpdate(userId, { token: null });

        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// --- 13. SET DEFAULT ADDRESS (Logic: One True, Others False) ---
// endpoint: PATCH /api/auth/user/set-default-address/:addressId
const setDefaultAddress = async (req, res) => {
    try {
        const { addressId } = req.params;
        const userId = req.user.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Check karne ke liye variable ki kya addressId exist karti hai
        let addressExists = false;

        // Loop through all addresses
        user.userAddress.forEach((addr) => {
            if (addr._id.toString() === addressId) {
                addr.isDefault = true;
                addressExists = true;
            } else {
                addr.isDefault = false; // Baaki sabko false kar do
            }
        });

        if (!addressExists) {
            return res.status(404).json({ success: false, message: "Address ID not found" });
        }

        await user.save();

        res.json({ 
            success: true, 
            message: "Default address updated successfully", 
            data: user.userAddress 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 14. UPLOAD PROFILE PIC (Dedicated) ---
const uploadProfilePic = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Please upload an image' });

        const profilePicUrl = `/uploads/users/${req.file.filename}`;
        await User.findByIdAndUpdate(req.user.id, { profilePic: profilePicUrl });

        res.json({ success: true, profilePic: profilePicUrl });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 15. DELETE ACCOUNT ---
const deleteAccount = async (req, res) => {
    try {
        await User.findByIdAndDelete(req.user.id);
        // Note: Yahan aap user se judi bookings ya records ko handle karne ka logic bhi add kar sakte hain
        res.json({ success: true, message: 'Account deleted permanently' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 16. CHANGE HEALTH LOCKER PIN (Figma Screen 15) ---
const updateLockerPin = async (req, res) => {
    try {
        const { oldPin, newPin } = req.body;
        const user = await User.findById(req.user.id).select('+healthLockerPin');

        // Agar pehli baar set kar raha hai toh oldPin ki zarurat nahi
        if (user.healthLockerPin) {
            const isMatch = (oldPin === user.healthLockerPin); // PIN usually simple string compare ya hash
            if (!isMatch) return res.status(400).json({ message: 'Incorrect old PIN' });
        }

        user.healthLockerPin = newPin;
        await user.save();
        res.json({ success: true, message: 'Health Locker PIN updated' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 17. GET REFERRAL DETAILS (Figma Screen 14 - Invite Friends) ---
const getReferralDetails = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('referralCode');
        
        // Agar code nahi hai toh generate karein (User's Name + Random String)
        if (!user.referralCode) {
            user.referralCode = user.name.split(' ')[0].toUpperCase() + Math.floor(1000 + Math.random() * 9000);
            await user.save();
        }

        res.json({ 
            success: true, 
            referralCode: user.referralCode,
            shareMessage: `Join Health Kangaroo using my code ${user.referralCode} and manage your health records!`
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 18. GET FAMILY ACCOUNTS (Figma Screen 4 & 11) ---
const getFamilyAccounts = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('familyMember');
        res.json({ 
            success: true, 
            count: user.familyMember.length, 
            data: user.familyMember 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getUserDashboard = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Fetch User Profile for Greeting (Screenshot 1: "Hello, Kautsar")
        const user = await User.findById(userId).select('name profilePic city');
        if (!user) return res.status(404).json({ message: "User not found" });

        // 2. Fetch Key Metrics (Screenshot 1: Heart Rate, Steps, Calories)
        // We get the most recent reading for each type
        const metricTypes = ['Heart rate', 'Steps', 'Calories', 'Blood Pressure'];
        const keyMetrics = {};

        for (const type of metricTypes) {
            const latest = await HealthData.findOne({ userId, type }).sort({ date: -1 });
            keyMetrics[type] = latest ? {
                value: latest.value,
                unit: latest.unit,
                status: "Stable today" // Static for now, can be calculated logic-wise
            } : { value: "0", unit: "", status: "No data" };
        }

        // 3. Pill Reminder Summary (Screenshot 1: "3 medication today")
        const todayPillsCount = await PillReminder.countDocuments({ 
            userId, 
            status: 'Active' 
        });

        // 4. Health Articles (Screenshot 1 Bottom)
        const articles = await HealthNews.find({ isActive: true })
            .sort({ createdAt: -1 })
            .limit(5); // Fetch top 5 for horizontal scroll

        // 5. Response Assembly
        res.status(200).json({
            success: true,
            data: {
                header: {
                    userName: user.name,
                    profilePic: user.profilePic,
                    location: user.city || "Mohali"
                },
                healthTracker: {
                    heartRate: keyMetrics['Heart rate'],
                    steps: keyMetrics['Steps'],
                    calories: keyMetrics['Calories'],
                    bloodPressure: keyMetrics['Blood Pressure']
                },
                pillReminder: {
                    count: todayPillsCount,
                    text: `${todayPillsCount} medication today`
                },
                articles: articles.map(art => ({
                    id: art._id,
                    title: art.title,
                    category: art.category,
                    image: art.image
                }))
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// =========================================================================
// VERIFY PHONE OTP & SET PERMANENT PASSWORD (For Short-Registered Users)
// Endpoint: POST /api/auth/user/verify-phone-and-set-password
// =========================================================================
const verifyPhoneAndSetPassword = async (req, res) => {
    try {
        const { idToken, newPassword, confirmPassword, name, email } = req.body;
        const userId = req.user.id;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        if (!idToken) {
            return res.status(400).json({ 
                success: false, 
                message: "Firebase idToken is required for phone verification." 
            });
        }

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: "Password must be at least 6 characters long." 
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: "New password and Confirm password do not match." 
            });
        }

        // 1. Verify Phone Number with Firebase
        const verification = await verifyFirebasePhoneToken(idToken, user.phone);
        if (!verification.success) {
            return res.status(400).json({ success: false, message: verification.message });
        }

        // 2. Hash New Permanent Password
        const hashedPassword = await bcrypt.hash(String(newPassword), 10);

        // 3. Update User Document Permanently
        user.password = hashedPassword;
        user.isPhoneVerified = true;
        user.isShortRegistered = false; // 👈 1-Time restriction lifted!
        if (name) user.name = name;
        if (email) user.email = email.toLowerCase().trim();

        await user.save();

        res.json({
            success: true,
            message: "Phone verified and permanent password set successfully! You can now use this password to login anytime.",
            user: {
                id: user._id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                isPhoneVerified: true,
                isShortRegistered: false
            }
        });

    } catch (error) {
        console.error("Set Password Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// =========================================================================
// 🚀 2. NEW: SUBMIT UNBAN REQUEST TO ADMIN (PUBLIC - WITHOUT LOGIN)
// Endpoint: POST /api/auth/user/request-unban
// =========================================================================
const requestUserUnban = async (req, res) => {
    try {
        const { phone, reason } = req.body;

        if (!phone || !reason || reason.trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "Registered Phone number and Explanation Reason are required to submit an unban request." 
            });
        }

        const cleanPhone = String(phone).trim().replace(/\D/g, "").slice(-10);

        // 1. Find User by phone
        const user = await User.findOne({ phone: cleanPhone });
        if (!user) {
            return res.status(404).json({ success: false, message: "No account registered with this phone number." });
        }

        // 2. Check if user is actually banned
        if (user.isBanned === false && user.isActive === true) {
            return res.status(400).json({ 
                success: false, 
                message: "Your account is not banned. You can login normally with your credentials." 
            });
        }

        // 3. Check if an unban request is already pending
        const existingPending = await UnbanRequest.findOne({ 
            userId: user._id, 
            status: 'Pending' 
        });

        if (existingPending) {
            return res.status(400).json({ 
                success: false, 
                message: "Your unban request is already under review by the Admin team. Please wait." 
            });
        }

        // 4. Create Unban Request
        const newRequest = await UnbanRequest.create({
            userId: user._id,
            name: user.name,
            phone: user.phone,
            reason: reason.trim(),
            status: 'Pending'
        });

        // 5. Notify Platform Admins
        try {
            await notifyAdminsAndVendor(
                null,
                'admin',
                "🚨 New Account Unban Request!",
                `User ${user.name} (${user.phone}) submitted an unban request: "${reason.trim()}"`,
                { requestId: newRequest._id.toString(), type: 'unban_request' }
            );
        } catch (e) {}

        res.status(201).json({
            success: true,
            message: "Unban request submitted to Admin successfully. You will be able to login once approved.",
            data: newRequest
        });

    } catch (error) {
        console.error("Unban Request Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { 
    checkUserExists,
    registerUser, 
    loginUser, 
    updateUserProfile,
    forgotPassword,
    verifyOtp,
    resetPassword,
    getUserProfile,
    removeUserSubItem,
    editUserSubItem,
    logoutUser,
    addUserAddress,
    addUserFamilyMember,
    getFamilyMembers,
    getFamilyMemberCount,
    editFamilyMember,
    removeFamilyMember,
    getMyInsurance,
    addUserEmergencyContact,
    setDefaultAddress,
    uploadProfilePic,
    deleteAccount,
    updateWorkDetails,
    updateFamilyHistory,
    getFamilyHistory,
    updateMedicalConditions,
    updateInsuranceDetails,
    changePassword,
    updateLockerPin,
    getReferralDetails,
    getFamilyAccounts,
      getAddressList,
    getEmergencyList,
    removeAddress,
    removeEmergency,
    getUserDashboard,
    verifyPhoneAndSetPassword,
    requestUserUnban
};