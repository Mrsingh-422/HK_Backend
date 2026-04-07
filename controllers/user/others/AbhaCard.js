const axios = require('axios');
const User = require('../../../models/User');

// ABDM Gateway se Token lene ka helper
const getAbdmToken = async () => {
    if (process.env.NODE_ENV === 'development') return "mock_gateway_token";
    
    const res = await axios.post('https://dev.abdm.gov.in/gateway/v0.5/sessions', {
        clientId: process.env.ABDM_CLIENT_ID,
        clientSecret: process.env.ABDM_CLIENT_SECRET
    });
    return res.data.accessToken;
};


// 1. Aadhaar OTP Generate karna
const generateAadhaarOtp = async (req, res) => {
    try {
        const { aadhaarNumber, consent } = req.body;
        if (!consent) return res.status(400).json({ message: "Please agree to terms" });

        // --- DEVELOPMENT MODE ---
        if (process.env.NODE_ENV === 'development') {
            const mockTxnId = "mock_txn_" + Date.now();
            await User.findByIdAndUpdate(req.user.id, { "abhaDetails.txnId": mockTxnId });
            return res.json({ 
                success: true, 
                message: "[DEV] OTP sent to Aadhaar linked mobile (Use 123456)", 
                txnId: mockTxnId 
            });
        }

        // --- PRODUCTION MODE ---
        const token = await getAbdmToken();
        const response = await axios.post('https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/generateOtp', {
            aadhaar: aadhaarNumber
        }, { headers: { 'Authorization': `Bearer ${token}` } });

        const txnId = response.data.txnId;
        await User.findByIdAndUpdate(req.user.id, { "abhaDetails.txnId": txnId });
        res.json({ success: true, message: "OTP sent successfully", txnId });

    } catch (error) {
        res.status(500).json({ message: error.response?.data?.message || "Failed to send OTP" });
    }
};
// 2. Aadhaar OTP Verify aur ABHA Card Generate karna
const verifyAadhaarOtp = async (req, res) => {
    try {
        const { otp, txnId } = req.body;

        // --- DEVELOPMENT MODE ---
        if (process.env.NODE_ENV === 'development') {
            if (otp !== "123456") return res.status(400).json({ message: "Invalid Mock OTP" });

            const updatedUser = await User.findByIdAndUpdate(req.user.id, {
                "abhaDetails.abhaNumber": "14-1234-5678-9012",
                "abhaDetails.abhaAddress": "user" + Date.now() + "@abdm",
                "abhaDetails.isAbhaVerified": true,
                "name": "Mock ABHA User",
                "gender": "M",
                "dob": "01-01-1990"
            }, { new: true });

            return res.json({ success: true, message: "[DEV] ABHA Created", data: updatedUser.abhaDetails });
        }

        // --- PRODUCTION MODE ---
        const token = await getAbdmToken();
        const verifyRes = await axios.post('https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/verifyOTP', 
            { otp, txnId }, 
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        const createRes = await axios.post('https://healthidsbx.abdm.gov.in/api/v1/registration/aadhaar/createHealthIdByAdhaar', 
            { txnId: verifyRes.data.txnId }, 
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
        res.status(500).json({ message: "OTP Verification Failed" });
    }
};

module.exports = { generateAadhaarOtp, verifyAadhaarOtp };