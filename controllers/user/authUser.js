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


// 5. GET PROFILE (Fixed Populate)
// endpoint: GET /api/auth/user/profile
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

        // File handling (Multer)
        if (req.file) {
            updateData["insuranceDetails.insuranceDocument"] = `/uploads/insurance/${req.file.filename}`;
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        res.json({ 
            success: true, 
            message: "Insurance details updated successfully", 
            data: user.insuranceDetails 
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
};