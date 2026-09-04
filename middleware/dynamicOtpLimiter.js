// // utils/otpRateLimiterHelper.js
// const OtpRateLimitConfig = require('../models/OtpRateLimitConfig');
// const OtpRequestLog = require('../models/OtpRequestLog');

// /**
//  * Checks and consumes rate limit for a specific identifier under an isolated OTP bucket
//  * @param {string} identifier - Clean 10-digit Phone or Email
//  * @param {'phone' | 'email'} identifierType 
//  * @param {'Phone-OTP' | 'Email-OTP' | 'Registration-OTP'} otpType - Isolated Bucket
//  * @param {string} clientIp 
//  * @returns {Promise<{ allowed: boolean, statusCode: number, message?: string }>}
//  */
// const checkAndConsumeOtpLimit = async (identifier, identifierType, otpType, clientIp) => {
//     try {
//         if (!identifier && !clientIp) return { allowed: true };

//         // 1. Fetch Config for this specific isolated bucket
//         let config = await OtpRateLimitConfig.findOne({ otpType, isActive: true });
//         if (!config) {
//             config = await OtpRateLimitConfig.findOne({ otpType: 'Universal-All', isActive: true });
//         }

//         const maxAttempts = config?.maxAttempts || 3;
//         const windowHours = config?.windowInHours || 24;
//         const windowThreshold = new Date(Date.now() - windowHours * 60 * 60 * 1000);

//         // 2. Check Attempts strictly for this (identifier + otpType) combination
//         const identifiersToCheck = [];
//         if (identifier) identifiersToCheck.push({ identifier, type: identifierType });
//         if (clientIp) identifiersToCheck.push({ identifier: clientIp, type: 'ip' });

//         for (const item of identifiersToCheck) {
//             // 🚨 STRICT BUCKET QUERY: Only counts logs for THIS specific otpType
//             const recentCount = await OtpRequestLog.countDocuments({
//                 identifier: item.identifier,
//                 otpType: otpType, // 👈 Isolated bucket isolation
//                 requestedAt: { $gte: windowThreshold }
//             });

//             if (recentCount >= maxAttempts) {
//                 const oldestAttempt = await OtpRequestLog.findOne({
//                     identifier: item.identifier,
//                     otpType: otpType,
//                     requestedAt: { $gte: windowThreshold }
//                 }).sort({ requestedAt: 1 });

//                 const unlockTime = new Date(new Date(oldestAttempt.requestedAt).getTime() + windowHours * 60 * 60 * 1000);
//                 const diffMs = Math.max(0, unlockTime.getTime() - Date.now());
//                 const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
//                 const diffMins = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));

//                 const waitTime = diffHours > 0 ? `${diffHours} hour(s) ${diffMins} min(s)` : `${diffMins} min(s)`;
//                 const targetLabel = item.type === 'phone' ? `mobile (+91 ${identifier})` : (item.type === 'email' ? `email (${identifier})` : 'network IP');

//                 return {
//                     allowed: false,
//                     statusCode: 429,
//                     message: `Security Limit: Maximum ${maxAttempts} ${otpType} requests reached for this ${targetLabel} in ${windowHours} hours. Please try again after ${waitTime}.`
//                 };
//             }
//         }

//         // 3. Log This Valid Attempt
//         const logs = [];
//         if (identifier) logs.push({ identifier, identifierType, otpType, clientIp });
//         if (clientIp) logs.push({ identifier: clientIp, identifierType: 'ip', otpType, clientIp });

//         if (logs.length > 0) {
//             await OtpRequestLog.insertMany(logs);
//         }

//         return { allowed: true };

//     } catch (error) {
//         console.error("OTP Rate Limit Helper Error:", error);
//         return { allowed: true }; // Fail-open on database exception
//     }
// };

// module.exports = { checkAndConsumeOtpLimit };