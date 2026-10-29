const axios = require('axios');
const User = require('../../../models/User');

// Helper: Get ABDM Gateway Token (Required for all Prod calls)
const getAbdmToken = async () => {
    if (process.env.NODE_ENV === 'development') return "mock_gateway_token";
    try {
        const res = await axios.post('https://dev.abdm.gov.in/gateway/v0.5/sessions', {
            clientId: process.env.ABDM_CLIENT_ID,
            clientSecret: process.env.ABDM_CLIENT_SECRET
        });
        return res.data.accessToken;
    } catch (err) { throw new Error("ABDM Session Failed"); }
};

// @desc    Generate Aadhaar OTP for ABHA Card Registration (Crash-proof validation)
// @route   POST /api/user/abha/step3-generate-otp
// @access  Private (User)
const generateAadhaarOtp = async (req, res) => {
    try {
        const { aadhaarNumber, consent } = req.body;

        if (!consent || consent === false || consent === 'false') {
            return res.status(400).json({ success: false, message: "User consent is required to proceed with ABHA creation." });
        }

        // 🚨 BUG FIX: Sanitize input to clean 12-digit string to prevent .length TypeError
        const cleanAadhaar = aadhaarNumber ? String(aadhaarNumber).replace(/\D/g, "") : "";

        if (cleanAadhaar.length !== 12) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid Aadhaar Number. Please provide a valid 12-digit number." 
            });
        }

        if (process.env.NODE_ENV === 'development') {
            const mockTxnId = "TXN_" + Math.random().toString(36).substr(2, 9);
            await User.findByIdAndUpdate(req.user.id, { $set: { "abhaDetails.txnId": mockTxnId } });
            return res.status(200).json({ success: true, message: "[DEV] OTP sent (Use 123456)", txnId: mockTxnId });
        }

        const token = await getAbdmToken();
        const response = await axios.post(
            'https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/generateOtp', 
            { aadhaar: cleanAadhaar }, 
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        const txnId = response.data.txnId;
        await User.findByIdAndUpdate(req.user.id, { $set: { "abhaDetails.txnId": txnId } });
        
        res.status(200).json({ success: true, txnId });
    } catch (error) {
        console.error("Generate Aadhaar OTP Error:", error);
        res.status(500).json({ 
            success: false, 
            message: error.response?.data?.message || "Failed to trigger Aadhaar OTP. Please try again." 
        });
    }
};

// --- STEP 4: Verify OTP ---
const verifyAadhaarOtp = async (req, res) => {
    try {
        const { otp, txnId } = req.body;

        if (process.env.NODE_ENV === 'development') {
            if (otp !== "123456") return res.status(400).json({ message: "Invalid OTP" });
            return res.json({ success: true, message: "OTP Verified", nextTxnId: txnId });
        }

        const token = await getAbdmToken();
        const verifyRes = await axios.post('https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/verifyOTP', 
            { otp, txnId }, 
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        res.json({ success: true, nextTxnId: verifyRes.data.txnId });
    } catch (error) {
        res.status(500).json({ message: "OTP Verification Failed" });
    }
};

// --- STEP 5: Final Submit & Create ABHA Card ---
const finalizeAbhaCreation = async (req, res) => {
    try {
        const { txnId } = req.body;

        if (process.env.NODE_ENV === 'development') {
            const mockData = {
                abhaNumber: "14-1111-2222-3333",
                abhaAddress: req.user.id + "@abdm",
                name: "Test User",
                isAbhaVerified: true
            };
            await User.findByIdAndUpdate(req.user.id, { abhaDetails: mockData });
            return res.json({ success: true, message: "[DEV] ABHA Card Generated", data: mockData });
        }

        const token = await getAbdmToken();
        const createRes = await axios.post('https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/createHealthIdByAdhaar', 
            { txnId }, 
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        const profile = createRes.data;
        const updatedUser = await User.findByIdAndUpdate(req.user.id, {
            "abhaDetails.abhaNumber": profile.healthIdNumber,
            "abhaDetails.abhaAddress": profile.healthId,
            "abhaDetails.isAbhaVerified": true
        }, { new: true });

        res.json({ success: true, data: updatedUser.abhaDetails });
    } catch (error) {
        res.status(500).json({ message: "Card Generation Failed" });
    }
};

// endpoint: GET /api/user/abha/details
const getAbhaDetails = async (req, res) => {
    try {
        const userId = req.user.id;

        // User model se sirf abhaDetails aur basic identity fields uthayenge
        const user = await User.findById(userId).select('abhaDetails name gender dob profilePic');

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Check agar ABHA linked hai ya nahi
        if (!user.abhaDetails || !user.abhaDetails.isAbhaVerified) {
            return res.status(200).json({ 
                success: true, 
                isLinked: false, 
                message: "ABHA ID not linked yet" 
            });
        }

        res.json({ 
            success: true, 
            isLinked: true,
            data: {
                abhaNumber: user.abhaDetails.abhaNumber,
                abhaAddress: user.abhaDetails.abhaAddress,
                isVerified: user.abhaDetails.isAbhaVerified,
                // Linked Profile Info
                linkedName: user.name,
                gender: user.gender,
                dob: user.dob
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { generateAadhaarOtp, verifyAadhaarOtp, finalizeAbhaCreation,getAbhaDetails };