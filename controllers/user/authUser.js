const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // Built-in Node module for random numbers
const sendEmailOTP = require('../../utils/emailService'); // Email sending utility

// Helper: Generate Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// ==========================================
// 1. REGISTER USER (Matches Figma Register Screen)
// endpoint: POST /api/auth/user/register
const registerUser = async (req, res) => {
    try {
        const { 
            name, email, phone, countryCode,
            country, state, city, 
            password, confirmPassword 
        } = req.body;

        // ==============================
        // 1. VALIDATION
        // ==============================
        if (!email && !phone) {
            return res.status(400).json({ message: 'Email or Phone required' });
        }

        if (!password) {
            return res.status(400).json({ message: 'Password is required' });
        }

        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        // ✅ Phone + Country Code validation
        if (phone && !countryCode) {
            return res.status(400).json({ message: 'Country code is required with phone' });
        }

        // ==============================
        // 2. DUPLICATE CHECK (FIXED)
        // ==============================
        let query = [];

        if (email) query.push({ email });
        if (phone && countryCode) query.push({ phone, countryCode });

        const exists = await User.findOne({ $or: query });

        if (exists) {
            return res.status(400).json({ 
                message: 'User already exists with this Email or Phone' 
            });
        }

        // ==============================
        // 3. HASH PASSWORD
        // ==============================
        const hashedPassword = await bcrypt.hash(password, 10);

        // ==============================
        // 4. CREATE USER
        // ==============================
        const user = await User.create({
            name,
            email: email || undefined,
            phone: phone || undefined,
            countryCode: phone ? countryCode : undefined,
            country,
            state,
            city,
            password: hashedPassword,
            role: 'user',
            profileStatus: 'Approved'
        });

        // ==============================
        // 5. GENERATE TOKEN
        // ==============================
        const token = generateToken(user._id);

        // ==============================
        // 6. RESPONSE
        // ==============================
        res.status(201).json({ 
            success: true,
            message: "User Registered Successfully",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                countryCode: user.countryCode,
                fullPhone: user.countryCode 
                    ? `${user.countryCode}${user.phone}` 
                    : null,
                location: `${user.city || ''}, ${user.state || ''}, ${user.country || ''}`
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 2. LOGIN USER (Matches Figma Login Screen)
// endpoint: POST /api/auth/user/login
const loginUser = async (req, res) => {
    try {
        const { email, phone, countryCode, password } = req.body;

        let query = {};

        if (email) {
            query = { email };
        } else if (phone && countryCode) {
            query = { phone, countryCode }; // ✅ FIXED
        } else {
            return res.status(400).json({ 
                message: 'Provide Email or Phone with Country Code' 
            });
        }

        const user = await User.findOne(query).select('+password');

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        let token = null;

        // DEV MODE TOKEN REUSE
        if (process.env.NODE_ENV === 'development' && user.token) {
            try {
                jwt.verify(user.token, process.env.JWT_SECRET);
                token = user.token;
            } catch (err) {
                token = null;
            }
        }

        if (!token) {
            token = generateToken(user._id);
            user.token = token;
            await user.save();
        }

        user.password = undefined;

        res.json({
            success: true,
            token,
            user: {
                ...user._doc,
                fullPhone: user.countryCode 
                    ? `${user.countryCode}${user.phone}` 
                    : null
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
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

// --- 9. ADD NEW ADDRESS ---
// endpoint: POST /api/auth/user/add-address
const addUserAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const addressData = req.body;

        const user = await User.findById(userId);

        // Agar naya address default hai, toh purane saare addresses ko isDefault: false kar do
        if (addressData.isDefault) {
            user.userAddress.forEach(addr => addr.isDefault = false);
        }

        user.userAddress.push(addressData);
        await user.save();

        res.status(201).json({ 
            success: true, 
            message: "Address added successfully", 
            data: user.userAddress[user.userAddress.length - 1] // Bheja gaya naya address
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 10. ADD FAMILY MEMBER ---
// endpoint: POST /api/auth/user/add-family
const addUserFamilyMember = async (req, res) => {
    try {
        const userId = req.user.id;
        const familyData = req.body;

        // Agar image upload hui hai
        if (req.file) {
            familyData.profilePic = `/uploads/users/${req.file.filename}`;
        }

        const user = await User.findById(userId);
        user.familyMember.push(familyData);
        await user.save();

        res.status(201).json({ 
            success: true, 
            message: "Family member added successfully", 
            data: user.familyMember[user.familyMember.length - 1] 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 11. ADD EMERGENCY CONTACT ---
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

// --- 4. UPDATE INSURANCE DETAILS (Figma Screen 2, 5, 10) ---
const updateInsuranceDetails = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { insuranceDetails: req.body },
            { new: true }
        );
        res.json({ success: true, message: "Insurance details saved", data: user.insuranceDetails });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

// 5. GET PROFILE (Fixed Populate)
const getUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        // NOTE: populate sirf insuranceId par chalega kyunki baaki sab user ke andar hi hain
        const user = await User.findById(userId)
            .select('-password -token')
            .populate('insuranceId', 'name'); 

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
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

// --- 13. SET DEFAULT ADDRESS ---
const setDefaultAddress = async (req, res) => {
    try {
        const { addressId } = req.params;
        const user = await User.findById(req.user.id);

        user.userAddress.forEach(addr => {
            addr.isDefault = addr._id.toString() === addressId;
        });

        await user.save();
        res.json({ success: true, message: 'Default address updated', data: user.userAddress });
    } catch (error) {
        res.status(500).json({ message: error.message });
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
module.exports = { 
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
    addUserEmergencyContact,
    setDefaultAddress,
    uploadProfilePic,
    deleteAccount,
    updateWorkDetails,
    updateFamilyHistory,
    updateMedicalConditions,
    updateInsuranceDetails,
    changePassword,
};