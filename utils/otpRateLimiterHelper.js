// utils/otpRateLimiterHelper.js
const OtpRateLimitConfig = require('../models/OtpRateLimitConfig');
const OtpRequestLog = require('../models/OtpRequestLog');

/**
 * Checks and consumes rate limit for a specific identifier under an isolated OTP bucket
 * @param {string} identifier - Clean 10-digit Phone or Email
 * @param {'phone' | 'email'} identifierType 
 * @param {'Phone-OTP' | 'Email-OTP' | 'Registration-OTP'} otpType - Isolated Bucket
 * @param {string} clientIp 
 * @returns {Promise<{ allowed: boolean, statusCode: number, message?: string }>}
 */
// @desc    Isolate Identifier (Phone/Email) vs Shared Network IP to prevent CGNAT collateral blocking
const checkAndConsumeOtpLimit = async (identifier, identifierType, otpType, clientIp) => {
    try {
        if (!identifier && !clientIp) return { allowed: true };

        const now = new Date();

        // 1. Fetch Config for this specific isolated bucket
        let config = await OtpRateLimitConfig.findOne({ otpType, isActive: true });
        if (!config) {
            config = await OtpRateLimitConfig.findOne({ otpType: 'Universal-All', isActive: true });
        }

        const maxAttempts = config?.maxAttempts || 3;
        const windowHours = config?.windowInHours || 24;
        const windowThreshold = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

        // 2. Strict Check for Phone / Email Identifier (Primary Account Protection)
        if (identifier) {
            const idCount = await OtpRequestLog.countDocuments({
                identifier: String(identifier).trim(),
                identifierType,
                otpType,
                requestedAt: { $gte: windowThreshold }
            });

            if (idCount >= maxAttempts) {
                const oldestAttempt = await OtpRequestLog.findOne({
                    identifier: String(identifier).trim(),
                    otpType,
                    requestedAt: { $gte: windowThreshold }
                }).sort({ requestedAt: 1 }).lean();

                const unlockTime = new Date(new Date(oldestAttempt.requestedAt).getTime() + windowHours * 60 * 60 * 1000);
                const diffMs = Math.max(0, unlockTime.getTime() - Date.now());
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffMins = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                const waitTime = diffHours > 0 ? `${diffHours} hour(s) ${diffMins} min(s)` : `${diffMins} min(s)`;

                return {
                    allowed: false,
                    statusCode: 429,
                    message: `Security Limit: Maximum ${maxAttempts} ${otpType} requests reached for this ${identifierType}. Please try again after ${waitTime}.`
                };
            }
        }

        // 3. Shared Network IP Check (Threshold is relaxed to 50/hour to prevent blocking whole hospital/office Wi-Fi)
        if (clientIp && !['127.0.0.1', '::1', 'localhost'].includes(clientIp)) {
            const ipThreshold = new Date(now.getTime() - 60 * 60 * 1000); // 1-Hour window for IP
            const ipAttempts = await OtpRequestLog.countDocuments({
                identifier: String(clientIp).trim(),
                identifierType: 'ip',
                requestedAt: { $gte: ipThreshold }
            });

            if (ipAttempts >= 50) { // Max 50 requests/hr per IP block
                return {
                    allowed: false,
                    statusCode: 429,
                    message: "High traffic detected from this network connection. Please try again after some time."
                };
            }
        }

        // 4. Record Log
        const logsToInsert = [];
        if (identifier) {
            logsToInsert.push({ identifier: String(identifier).trim(), identifierType, otpType, clientIp, requestedAt: now });
        }
        if (clientIp) {
            logsToInsert.push({ identifier: String(clientIp).trim(), identifierType: 'ip', otpType, clientIp, requestedAt: now });
        }

        if (logsToInsert.length > 0) {
            await OtpRequestLog.insertMany(logsToInsert);
        }

        return { allowed: true };

    } catch (error) {
        console.error("OTP Rate Limit Helper Error:", error.message);
        return { allowed: true }; // Fail-open to avoid locking out genuine users during DB glitches
    }
};

module.exports = { checkAndConsumeOtpLimit };