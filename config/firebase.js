// config/firebase.js
const { getApps, initializeApp, cert } = require('firebase-admin/app'); // 👈 Modern modular SDK imports
const path = require('path');
const fs = require('fs');

try {
    // process.cwd() resolves path directly to your project root
    const rootPath = process.cwd(); 
    const serviceAccountPath = path.join(rootPath, 'firebase-service-account.json');
    
    console.log(`🔍 [Firebase Debug] Checking for credentials file at: ${serviceAccountPath}`);

    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(
            `\n\n❌ [CRITICAL] 'firebase-service-account.json' file not found!\n` +
            `👉 Please place the file exactly in this folder:\n` +
            `👉 Path: ${serviceAccountPath}\n`
        );
    }

    const serviceAccount = require(serviceAccountPath);
    
    const EXPECTED_PROJECT_ID = "hk-frontend-5b02d";
    if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
        console.warn(`⚠️  [WARNING] Loaded service account project_id (${serviceAccount.project_id}) does not match expected frontend project (${EXPECTED_PROJECT_ID}).`);
    }

    // 👈 Modern modular check (Works exactly like your frontend config)
    if (getApps().length === 0) {
        initializeApp({
            credential: cert(serviceAccount) // cert() wrapper for service account object
        });
        console.log(`💚 Firebase Admin Initialized Successfully for Project: [${serviceAccount.project_id}]`);
    } else {
        console.log("💚 Firebase Admin already active.");
    }
} catch (error) {
    console.error("\n==================================================");
    console.error("🔴 FIREBASE INITIALIZATION CRITICAL ERROR:");
    console.error(error.message);
    console.error("==================================================\n");
}

module.exports = {}; // Export empty object as we use modular imports inside controller