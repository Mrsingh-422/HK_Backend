// config/firebase.js
const { getApps, initializeApp, cert } = require('firebase-admin/app');
require('dotenv').config(); // Load environment variables first

try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    // A. Check if all required variables are present in .env
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
            "Missing Firebase Environment variables!\n" +
            "Please check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your .env file."
        );
    }

    // B. Fix double-escaped new lines from dotenv (.env formats \n as literal string)
    // Yeh replace logic process.env ke multi-line character parse issue ko fix karta hai.
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    // C. Initialize Firebase modular SDK (Double boot safe)
    if (getApps().length === 0) {
        initializeApp({
            credential: cert({
                projectId: projectId,
                clientEmail: clientEmail,
                privateKey: formattedPrivateKey
            })
        });
        console.log(`💚 Firebase Admin Initialized Successfully (ENV Mode) for Project: [${projectId}]`);
    } else {
        console.log("💚 Firebase Admin already active.");
    }
} catch (error) {
    console.error("\n==================================================");
    console.error("🔴 FIREBASE INITIALIZATION CRITICAL ERROR (ENV MODE):");
    console.error(error.message);
    console.error("==================================================\n");
}

module.exports = {};