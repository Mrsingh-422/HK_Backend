const Admin = require("../../models/Admin");
const Doctor = require("../../models/Doctor");
const Hospital = require("../../models/Hospital");
const User = require("../../models/User");
const Lab = require("../../models/Lab");
const Pharmacy = require("../../models/Pharmacy");
const Nurse = require("../../models/Nurse");
const PoliceHQ = require("../../models/PoliceHQ");
const PoliceStation = require("../../models/PoliceStation");
const PoliceStaff = require("../../models/PoliceStaff");
const FireHQ = require("../../models/FireHQ");
const FireStation = require("../../models/FireStation");
const FireStaff = require("../../models/FireStaff");

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { getAuth } = require('firebase-admin/auth'); 
const { sendEmailOTP } = require("../../utils/emailService");

// All active models in the project
const modelsList = [
    { name: "Admin", model: Admin, phoneKey: "phone", emailKey: "email" },
    { name: "Doctor", model: Doctor, phoneKey: "phone", emailKey: "email" },
    { name: "Hospital", model: Hospital, phoneKey: "phone", emailKey: "email" },
    { name: "User", model: User, phoneKey: "phone", emailKey: "email" },
    { name: "Lab", model: Lab, phoneKey: "phone", emailKey: "email" },
    { name: "Pharmacy", model: Pharmacy, phoneKey: "phone", emailKey: "email" },
    { name: "Nurse", model: Nurse, phoneKey: "phone", emailKey: "email" },
    { name: "PoliceHQ", model: PoliceHQ, phoneKey: "phone", emailKey: "email" },
    { name: "PoliceStation", model: PoliceStation, phoneKey: "phone", emailKey: "email" },
    { name: "PoliceStaff", model: PoliceStaff, phoneKey: "mobileNumber", emailKey: "officialEmail" }, 
    { name: "FireHQ", model: FireHQ, phoneKey: "phone", emailKey: "email" },
    { name: "FireStation", model: FireStation, phoneKey: "phone", emailKey: "email" },
    { name: "FireStaff", model: FireStaff, phoneKey: "mobileNumber", emailKey: "officialEmail" } 
];

// Helper: Normalize phone to clean 10 digits
const get10DigitPhone = (phone) => {
    if (!phone) return "";
    const clean = String(phone).replace(/\D/g, "");
    return clean.slice(-10);
};

// Helper: Fast indexed query for phone variations (+91, without 91, etc.)
const buildPhoneQuery = (phoneKey, rawPhone) => {
    const last10 = get10DigitPhone(rawPhone);
    return {
        $or: [
            { [phoneKey]: last10 },
            { [phoneKey]: `+91${last10}` },
            { [phoneKey]: `91${last10}` },
            { [phoneKey]: `0${last10}` },
            { [phoneKey]: rawPhone.trim() }
        ]
    };
};

// Helper: Mask email for privacy (e.g. a***n@gmail.com)
const maskEmail = (email) => {
    if (!email || email === "N/A") return "N/A";
    const [user, domain] = email.split("@");
    if (!domain) return email;
    const maskedUser = user.length > 2 ? user[0] + "***" + user[user.length - 1] : user[0] + "***";
    return `${maskedUser}@${domain}`;
};

// Helper: Hash sensitive reset tokens
const hashToken = (token) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

// Helper: Find account by Email across any schema
const findAccountByEmail = async (email) => {
    const cleanEmail = email.toLowerCase().trim();
    for (let item of modelsList) {
        const query = { [item.emailKey]: cleanEmail };
        const account = await item.model.findOne(query);
        if (account) return { account, Model: item.model, meta: item };
    }
    return null;
};

// =========================================================================
// 📱 MOBILE SMS FLOW (Firebase Phone OTP)
// =========================================================================

// STEP 1: Check phone and return list of associated roles (Masked data)
// Endpoint: POST /api/password/forgot-password-phone
const forgotPasswordPhone = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });

        const last10 = get10DigitPhone(phone);
        if (last10.length < 10) {
            return res.status(400).json({ success: false, message: "Please provide a valid 10-digit phone number." });
        }

        const matchedProfiles = [];

        // Check accounts across all systems
        for (let item of modelsList) {
            const query = buildPhoneQuery(item.phoneKey, phone);
            const account = await item.model.findOne(query);
            if (account) {
                matchedProfiles.push({
                    role: item.name,
                    name: account.name || account.fullName || account.stationName || account.hqName || "Partner",
                    maskedEmail: maskEmail(account.email || account.officialEmail)
                });
            }
        }

        if (matchedProfiles.length === 0) {
            return res.status(404).json({ success: false, message: "No account registered with this phone number." });
        }

        res.json({ 
            success: true, 
            message: `${matchedProfiles.length} account(s) found. Verify OTP to reset password.`, 
            accounts: matchedProfiles 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// STEP 2: Verify Firebase ID Token & Return Secure Reset Token
// Endpoint: POST /api/password/verify-firebase-otp
const verifyFirebaseOtp = async (req, res) => {
    try {
        const { phone, idToken, selectedRole } = req.body;

        if (!phone || !idToken || !selectedRole) {
            return res.status(400).json({ success: false, message: "Phone, idToken and selectedRole are required." });
        }

        // 1. Verify token with Firebase Admin
        let decodedToken;
        try {
            decodedToken = await getAuth().verifyIdToken(idToken);
        } catch (authError) {
            console.error("Firebase token verification failed:", authError.message);
            return res.status(401).json({ success: false, message: "Invalid or expired Firebase ID token." });
        }

        // 2. Strict Phone Match (Exact 10-digit comparison)
        const firebasePhoneLast10 = get10DigitPhone(decodedToken.phone_number);
        const reqPhoneLast10 = get10DigitPhone(phone);

        if (firebasePhoneLast10 !== reqPhoneLast10) {
            return res.status(400).json({ success: false, message: "Security Block: Verified Firebase phone number does not match request phone." });
        }

        // 3. Find target model account
        const targetMeta = modelsList.find(m => m.name === selectedRole);
        if (!targetMeta) {
            return res.status(400).json({ success: false, message: "Invalid model role selected." });
        }

        const query = buildPhoneQuery(targetMeta.phoneKey, phone);
        const account = await targetMeta.model.findOne(query);
        if (!account) {
            return res.status(404).json({ success: false, message: `Account not found under role: ${selectedRole}` });
        }

        // 4. Generate 15-Minute Cryptographically Secure Reset Token
        const rawResetToken = crypto.randomBytes(32).toString("hex");
        const hashedResetToken = hashToken(rawResetToken);
        const tokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 Minutes

        await targetMeta.model.collection.updateOne(
            { _id: account._id },
            { 
                $set: { 
                    resetPasswordOtp: hashedResetToken,
                    resetPasswordExpires: tokenExpiry 
                } 
            }
        );

        res.json({
            success: true,
            message: "OTP Verified successfully! You can now reset your password.",
            resetToken: rawResetToken, // Frontend sends this raw token in Step 3
            role: selectedRole
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// STEP 3: Reset Password using Reset Token
// Endpoint: POST /api/password/reset-password-phone
const resetPasswordPhone = async (req, res) => {
    try {
        const { phone, resetToken, selectedRole, newPassword, confirmPassword } = req.body;

        if (!phone || !resetToken || !newPassword || !selectedRole) {
            return res.status(400).json({ success: false, message: "Phone, resetToken, selectedRole and newPassword are required." });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: "Passwords do not match." });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "Password must be at least 6 characters long." });
        }

        const targetMeta = modelsList.find(m => m.name === selectedRole);
        if (!targetMeta) {
            return res.status(400).json({ success: false, message: "Invalid role selected." });
        }

        const query = buildPhoneQuery(targetMeta.phoneKey, phone);
        const rawAccount = await targetMeta.model.collection.findOne(query);

        if (!rawAccount) {
            return res.status(404).json({ success: false, message: `Account not found under role: ${selectedRole}` });
        }

        // Verify Hashed Reset Token
        const incomingHashedToken = hashToken(resetToken);
        const savedToken = String(rawAccount.resetPasswordOtp || "").trim();

        if (!savedToken || savedToken !== incomingHashedToken) {
            return res.status(400).json({ success: false, message: "Access Denied: Invalid or already used Reset Token." });
        }

        // Check Expiry
        const dbExpiryTime = rawAccount.resetPasswordExpires ? new Date(rawAccount.resetPasswordExpires).getTime() : 0;
        if (dbExpiryTime < Date.now()) {
            return res.status(400).json({ success: false, message: "Access Denied: Reset Token has expired. Please verify OTP again." });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password, revoke all active sessions & clean up temporary tokens
        await targetMeta.model.collection.updateOne(
            { _id: rawAccount._id },
            {
                $set: { 
                    password: hashedPassword,
                    token: null // Invalidate existing session tokens
                },
                $unset: { resetPasswordOtp: "", resetPasswordExpires: "" }
            }
        );

        res.json({
            success: true,
            message: "Password Reset Successfully. Please Login with your new password."
        });

    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

// =========================================================================
// ✉️ EMAIL FLOW (Brevo OTP)
// =========================================================================

// =========================================================================
// ✉️ EMAIL FLOW (Universal Brevo OTP - Schema Bypassed)
// =========================================================================

// 1. SEND 6-DIGIT EMAIL OTP
// Endpoint: POST /api/password/forgot-password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        const cleanEmail = email.toLowerCase().trim();
        const result = await findAccountByEmail(cleanEmail);

        if (!result) {
            return res.status(404).json({ success: false, message: "Account not found with this email address." });
        }

        const { account, Model } = result;

        // 🎲 Generate Random 6-Digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiryDate = new Date(Date.now() + 10 * 60 * 1000); // 10 Minutes

        // 🚨 CRITICAL FIX: Direct MongoDB write to bypass Mongoose Schema omissions!
        await Model.collection.updateOne(
            { _id: account._id },
            { 
                $set: { 
                    resetPasswordOtp: String(otp).trim(),
                    resetPasswordExpires: expiryDate 
                } 
            }
        );

        console.log(`\n📧 [BREVO TRIGGER] Sending OTP to ${cleanEmail}: ${otp} for Model: ${Model.modelName}\n`);

        // Send Real Email via Brevo
        const emailSent = await sendEmailOTP(cleanEmail, otp);

        if (!emailSent) {
            return res.status(500).json({ 
                success: false, 
                message: "Failed to send email. Please check Brevo configuration." 
            });
        }

        res.json({ 
            success: true, 
            message: "OTP sent successfully to your email address."
        });

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. VERIFY EMAIL OTP (Universal Direct Match)
// Endpoint: POST /api/password/verify-otp
const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ success: false, message: "Email and OTP are required" });
        }

        const cleanEmail = email.toLowerCase().trim();
        const cleanOtp = String(otp).trim();
        let matchedAccount = null;

        for (let item of modelsList) {
            const query = {
                [item.emailKey]: { $regex: new RegExp(`^${cleanEmail}$`, 'i') },
                resetPasswordOtp: cleanOtp
            };
            
            const rawDoc = await item.model.collection.findOne(query);
            
            if (rawDoc) {
                // Check if OTP is expired
                const expiryTime = rawDoc.resetPasswordExpires ? new Date(rawDoc.resetPasswordExpires).getTime() : 0;
                if (expiryTime >= Date.now()) {
                    matchedAccount = rawDoc;
                    break;
                }
            }
        }

        if (!matchedAccount) {
            return res.status(400).json({ success: false, message: "Invalid or Expired OTP" });
        }

        res.json({ success: true, message: "OTP Verified Successfully" });

    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. RESET PASSWORD VIA EMAIL
// Endpoint: POST /api/password/reset-password
const resetPassword = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (!newPassword || newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: "Passwords do not match or missing" });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "Password must be at least 6 characters long" });
        }

        const cleanEmail = email.toLowerCase().trim();
        const result = await findAccountByEmail(cleanEmail);

        if (!result) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const { account, Model } = result;

        const hashedPassword = await bcrypt.hash(String(newPassword), 10);

        // 🚨 Update password, revoke JWT session & delete temporary OTP fields
        await Model.collection.updateOne(
            { _id: account._id },
            {
                $set: { 
                    password: hashedPassword,
                    token: null 
                },
                $unset: { 
                    resetPasswordOtp: "", 
                    resetPasswordExpires: "" 
                }
            }
        );

        res.json({ 
            success: true, 
            message: "Password Reset Successfully. Please Login with your new password." 
        });

    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = { 
    forgotPassword, verifyOtp, resetPassword,
    forgotPasswordPhone, verifyFirebaseOtp, resetPasswordPhone 
};