const MaintenanceConfig = require('../../../models/MaintenanceConfig');
const { deleteFile } = require('../../../utils/fileHandler');

// =========================================================================
// 1. PUBLIC API: CHECK MAINTENANCE STATUS (For Website / App Frontend)
// =========================================================================
// Endpoint: GET /api/maintenance/status
const getPublicMaintenanceStatus = async (req, res) => {
    try {
        let config = await MaintenanceConfig.findOne().lean();

        if (!config) {
            config = {
                isEnabled: false,
                heroImage: null,
                title: 'System Under Maintenance',
                message: 'We will be back shortly.'
            };
        }

        res.status(200).json({
            success: true,
            isEnabled: config.isEnabled,
            data: {
                isEnabled: config.isEnabled,
                heroImage: config.heroImage,
                title: config.title,
                message: config.message,
                estimatedEndTime: config.estimatedEndTime
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 2. ADMIN API: GET MAINTENANCE CONFIG (For Admin Dashboard Screen)
// =========================================================================
// Endpoint: GET /api/admin/maintenance
const getAdminMaintenanceConfig = async (req, res) => {
    try {
        let config = await MaintenanceConfig.findOne()
            .populate('updatedBy', 'name email role')
            .lean();

        if (!config) {
            config = await MaintenanceConfig.create({
                isEnabled: false,
                heroImage: null
            });
        }

        res.status(200).json({
            success: true,
            data: config
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 3. ADMIN API: UPDATE MAINTENANCE CONFIG (Toggle ON/OFF & Upload Image)
// =========================================================================
// Endpoint: POST /api/admin/maintenance
const updateMaintenanceConfig = async (req, res) => {
    try {
        const { isEnabled, title, message, estimatedEndTime } = req.body;
        const adminId = req.user?._id;

        const updateData = {};

        // 1. Toggle Mode
        if (isEnabled !== undefined) {
            updateData.isEnabled = (isEnabled === 'true' || isEnabled === true);
        }

        // 2. Text Details
        if (title !== undefined) updateData.title = title.trim();
        if (message !== undefined) updateData.message = message.trim();
        if (estimatedEndTime) updateData.estimatedEndTime = new Date(estimatedEndTime);
        if (adminId) updateData.updatedBy = adminId;

        // 3. Handle File Upload (Delete old image if new one is uploaded)
        if (req.file) {
            const currentConfig = await MaintenanceConfig.findOne();
            if (currentConfig && currentConfig.heroImage) {
                deleteFile(currentConfig.heroImage);
            }
            updateData.heroImage = `/uploads/maintenance/${req.file.filename}`;
        }

        const updatedConfig = await MaintenanceConfig.findOneAndUpdate(
            {},
            { $set: updateData },
            { new: true, upsert: true }
        ).populate('updatedBy', 'name email');

        res.status(200).json({
            success: true,
            message: `Maintenance mode ${updatedConfig.isEnabled ? 'ENABLED (Site is now Offline)' : 'DISABLED (Site is Publicly Live)'}.`,
            data: updatedConfig
        });
    } catch (error) {
        console.error("Maintenance Update Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getPublicMaintenanceStatus,
    getAdminMaintenanceConfig,
    updateMaintenanceConfig
};