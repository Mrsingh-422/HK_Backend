// controllers/admin/others/OtpLimitAdmin.js
const OtpRateLimitConfig = require('../../../models/OtpRateLimitConfig');
const OtpRequestLog = require('../../../models/OtpRequestLog');

// ==========================================
// 1. 🚨 GET LIVE BLOCKED IDENTIFIERS LIST (Phones / Emails / IPs)
// Endpoint: GET /api/admin/otp-limits/blocked-list
// ==========================================
const getBlockedOtpList = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, otpType, identifierType } = req.query;

        // 1. Fetch active configs to map limits
        const configs = await OtpRateLimitConfig.find({ isActive: true }).lean();
        const configMap = {};
        configs.forEach(c => { configMap[c.otpType] = c; });

        // Max window threshold (default 24h)
        const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const matchStage = { requestedAt: { $gte: threshold } };
        if (otpType && otpType !== 'All') {
            matchStage.otpType = otpType;
        }
        if (identifierType) {
            matchStage.identifierType = identifierType;
        }
        if (search) {
            matchStage.identifier = { $regex: search, $options: 'i' };
        }

        // 2. Aggregate attempts per identifier & bucket
        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        identifier: "$identifier",
                        identifierType: "$identifierType",
                        otpType: "$otpType"
                    },
                    attemptsCount: { $sum: 1 },
                    firstAttemptAt: { $min: "$requestedAt" },
                    lastAttemptAt: { $max: "$requestedAt" },
                    clientIps: { $addToSet: "$clientIp" }
                }
            }
        ];

        const aggregated = await OtpRequestLog.aggregate(pipeline);

        // 3. Filter only those who exceeded limit and are still in cooldown
        const blockedList = [];

        for (let item of aggregated) {
            const cfg = configMap[item._id.otpType] || configMap['Universal-All'] || { maxAttempts: 3, windowInHours: 24 };
            const windowMs = (cfg.windowInHours || 24) * 60 * 60 * 1000;
            const oldestTime = new Date(item.firstAttemptAt).getTime();
            const unblockTime = new Date(oldestTime + windowMs);

            if (item.attemptsCount >= cfg.maxAttempts && unblockTime.getTime() > Date.now()) {
                const remainingMs = unblockTime.getTime() - Date.now();
                const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
                const remainingMins = Math.ceil((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

                blockedList.push({
                    identifier: item._id.identifier,
                    identifierType: item._id.identifierType,
                    otpType: item._id.otpType,
                    attemptsCount: item.attemptsCount,
                    maxAllowed: cfg.maxAttempts,
                    windowHours: cfg.windowInHours,
                    firstAttemptAt: item.firstAttemptAt,
                    lastAttemptAt: item.lastAttemptAt,
                    blockedUntil: unblockTime,
                    remainingTimeDisplay: `${remainingHours}h ${remainingMins}m`,
                    clientIps: item.clientIps.filter(ip => ip)
                });
            }
        }

        // Sort latest first
        blockedList.sort((a, b) => new Date(b.lastAttemptAt) - new Date(a.lastAttemptAt));
        const paginated = blockedList.slice(skip, skip + limit);

        res.json({
            success: true,
            totalBlocked: blockedList.length,
            totalPages: Math.ceil(blockedList.length / limit),
            currentPage: page,
            limit,
            data: paginated
        });

    } catch (error) {
        console.error("Get Blocked OTP List Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. UNBLOCK / RESET OTP LIMIT (1-Click Instant Unblock)
// Endpoint: POST /api/admin/otp-limits/reset-identifier
// ==========================================
const resetIdentifierLimit = async (req, res) => {
    try {
        const { identifier, otpType } = req.body; // Phone number or Email or IP

        if (!identifier) {
            return res.status(400).json({ success: false, message: "identifier (Phone, Email, or IP) is required." });
        }

        const cleanIdentifier = String(identifier).trim().replace(/\D/g, "").slice(-10) || String(identifier).trim().toLowerCase();

        const query = {
            $or: [
                { identifier: cleanIdentifier },
                { identifier: String(identifier).trim() }
            ]
        };

        // Agar specific otpType clear karna ho
        if (otpType && otpType !== 'All') {
            query.otpType = otpType;
        }

        const result = await OtpRequestLog.deleteMany(query);

        res.json({
            success: true,
            message: `Successfully unblocked '${identifier}'. Cleared ${result.deletedCount} attempt logs. User can request OTP immediately.`,
            clearedLogsCount: result.deletedCount
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET CONFIGS & 24H TRAFFIC STATS
// Endpoint: GET /api/admin/otp-limits
// ==========================================
const getOtpLimitConfigs = async (req, res) => {
    try {
        const types = ['Registration-OTP', 'Phone-OTP', 'Email-OTP', 'Universal-All'];
        const existingConfigs = await OtpRateLimitConfig.find();

        const configs = types.map(type => {
            const match = existingConfigs.find(c => c.otpType === type);
            return match || {
                otpType: type,
                maxAttempts: 3,
                windowInHours: 24,
                isActive: true
            };
        });

        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [totalReg24h, totalPhone24h, totalEmail24h] = await Promise.all([
            OtpRequestLog.countDocuments({ otpType: 'Registration-OTP', requestedAt: { $gte: last24h } }),
            OtpRequestLog.countDocuments({ otpType: 'Phone-OTP', requestedAt: { $gte: last24h } }),
            OtpRequestLog.countDocuments({ otpType: 'Email-OTP', requestedAt: { $gte: last24h } })
        ]);

        res.json({
            success: true,
            data: {
                configs,
                stats24h: {
                    totalRegistrationRequests: totalReg24h,
                    totalPhoneForgotRequests: totalPhone24h,
                    totalEmailForgotRequests: totalEmail24h
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. UPDATE OTP LIMIT CONFIG (Admin Changes 3/24h Rule)
// Endpoint: POST /api/admin/otp-limits/update
// ==========================================
const updateOtpLimitConfig = async (req, res) => {
    try {
        const { otpType, maxAttempts, windowInHours, isActive } = req.body;

        if (!otpType) {
            return res.status(400).json({ success: false, message: "otpType is required." });
        }

        const config = await OtpRateLimitConfig.findOneAndUpdate(
            { otpType },
            {
                $set: {
                    maxAttempts: Number(maxAttempts || 3),
                    windowInHours: Number(windowInHours || 24),
                    isActive: isActive ?? true
                }
            },
            { new: true, upsert: true }
        );

        res.json({
            success: true,
            message: `OTP Limit for ${otpType} updated to ${config.maxAttempts} attempts per ${config.windowInHours} hour(s).`,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getBlockedOtpList,
    resetIdentifierLimit,
    getOtpLimitConfigs,
    updateOtpLimitConfig
};