const MaintenanceConfig = require('../models/MaintenanceConfig');

// ⚡ In-Memory Cache (Taaki har API call par DB query na ho aur server fast chale)
let cachedMaintenance = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5000; // 5 Seconds cache

const checkMaintenanceMode = async (req, res, next) => {
    try {
        const url = req.originalUrl || req.url;

        // =========================================================================
        // 🟢 1. WHITELISTED ROUTES (Yeh routes Maintenance me bhi HAMESHA OPEN rahenge)
        // =========================================================================
        const isWhitelisted = 
            url.startsWith('/api/auth/admin') ||
            url.startsWith('/api/admin') ||
            url.startsWith('/admin') ||
            url.startsWith('/api/maintenance') ||  // Public Status check API
            url.startsWith('/public') ||           // Images/Banners
            url.startsWith('/uploads') ||          // Images/Banners
            url === '/' ||
            url.startsWith('/forgotpassword.html') ||
            url.startsWith('/doctor_register.html');

        // Agar route Admin ka hai ya Static file hai -> seedha aage jaane do
        if (isWhitelisted) {
            return next();
        }

        // =========================================================================
        // 🔍 2. FETCH MAINTENANCE STATUS (From Cache or DB)
        // =========================================================================
        const now = Date.now();
        if (!cachedMaintenance || (now - lastFetchTime) > CACHE_DURATION) {
            cachedMaintenance = await MaintenanceConfig.findOne().lean();
            lastFetchTime = now;
        }

        // Agar maintenance OFF hai (isEnabled: false) ya DB me record nahi hai -> Normal Flow
        if (!cachedMaintenance || !cachedMaintenance.isEnabled) {
            return next();
        }

        // =========================================================================
        // 🔴 3. BLOCK ALL PUBLIC / USER / DOCTOR / PROVIDER APIS (503 Status)
        // =========================================================================
        return res.status(503).json({
            success: false,
            isMaintenanceMode: true,
            message: cachedMaintenance.message || "Site is currently under scheduled maintenance.",
            data: {
                heroImage: cachedMaintenance.heroImage || null,
                title: cachedMaintenance.title || "System Under Scheduled Maintenance",
                message: cachedMaintenance.message || "We are improving our platform to serve you better. Please check back shortly.",
                estimatedEndTime: cachedMaintenance.estimatedEndTime || null
            }
        });

    } catch (error) {
        console.error("Maintenance Middleware Error:", error);
        // Agar database read me error aaye toh system band na ho, request proceed ho jaye
        next();
    }
};

module.exports = { checkMaintenanceMode };