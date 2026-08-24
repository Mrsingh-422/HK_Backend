const { getAuth } = require('firebase-admin/auth');

/**
 * Verify Firebase ID Token and check if phone matches
 */
const verifyFirebasePhoneToken = async (idToken, expectedPhone) => {
    try {
        if (!idToken) {
            return { success: false, message: "Firebase idToken is required for phone verification." };
        }

        const decodedToken = await getAuth().verifyIdToken(idToken);
        const firebasePhone = decodedToken.phone_number ? decodedToken.phone_number.replace(/\D/g, "") : "";
        const cleanExpectedPhone = expectedPhone.replace(/\D/g, "");

        if (!firebasePhone.includes(cleanExpectedPhone)) {
            return { success: false, message: "Security Warning: Verified Firebase phone number does not match request phone number." };
        }

        return { success: true, decodedToken };
    } catch (error) {
        return { success: false, message: "Invalid or expired Firebase ID token: " + error.message };
    }
};

module.exports = { verifyFirebasePhoneToken };