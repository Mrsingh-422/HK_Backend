const Driver = require('../../../models/Driver');
const Ambulance = require('../../../models/Ambulance');

// @desc    Get All Drivers for Admin (Vendor Drivers + Independent/Hospital Ambulance Drivers Merged)
// @route   GET /admin/drivers/vendor/list
// @access  Private (Admin)
const getAllDriversAdmin = async (req, res) => {
    try {
        const { country, city, state, district, driverType } = req.query;
 
        let filter = {};
        if (country) filter.country = { $regex: country, $options: 'i' };
        if (city) filter.city = { $regex: city, $options: 'i' };
 
        const stateOrDistrict = state || district;
        if (stateOrDistrict) {
            filter.state = { $regex: stateOrDistrict, $options: 'i' };
        }

        let transformedDrivers = [];
        let transformedAmbulances = [];

        // 1. Fetch Vendor Drivers (Lab, Pharmacy, Nurse)
        if (!driverType || ['Lab', 'Pharmacy', 'Nurse', 'All'].includes(driverType)) {
            const vendorFilter = { ...filter };
            if (driverType && driverType !== 'All') vendorFilter.vendorType = driverType;

            const drivers = await Driver.find(vendorFilter)
                .populate({ path: 'vendorId', select: 'name clinicName pharmacyName labName vendorType' })
                .sort({ createdAt: -1 })
                .lean();

            transformedDrivers = drivers.map(driver => ({
                id: driver._id,
                vendorName: driver.vendorId?.name || driver.vendorId?.labName || driver.vendorId?.pharmacyName || "N/A",
                username: driver.username || "N/A",
                driverName: driver.name,
                phone: driver.phone,
                email: driver.email || "N/A",
                imageUrl: driver.profilePic || null,
                onlineStatus: driver.status === 'Available',
                isActive: driver.isActive !== false,
                vehicle: driver.vehicleType || "Bike",
                vehicleNumber: driver.vehicleNumber || "N/A",
                licenseNumber: driver.documents?.license || "N/A",
                driverType: driver.vendorType, // 'Lab', 'Pharmacy', 'Nurse'
                country: driver.country || "India",
                state: driver.state || "N/A",
                city: driver.city || "N/A",
                address: driver.address || "N/A",
                createdAt: driver.createdAt
            }));
        }

        // 2. Fetch Ambulance Drivers if driverType is not restricted to Lab/Pharmacy/Nurse
        if (!driverType || ['Ambulance', 'All'].includes(driverType)) {
            const ambulances = await Ambulance.find(filter)
                .populate('hospitalId', 'name')
                .sort({ createdAt: -1 })
                .lean();

            transformedAmbulances = ambulances.map(amb => ({
                id: amb._id,
                vendorName: amb.hospitalId?.name || "Independent Ambulance",
                username: amb.email || amb.phone || "N/A",
                driverName: amb.driverInfo?.fullName || amb.name,
                phone: amb.phone,
                email: amb.email || "N/A",
                imageUrl: null,
                onlineStatus: Boolean(amb.isOnline && amb.availableForEmergency),
                isActive: amb.isActive !== false,
                vehicle: amb.vehicleType || "Ambulance",
                vehicleNumber: amb.vehicleNumber || "N/A",
                licenseNumber: amb.drivingLicenseNumber || amb.documents?.drivingLicenseFile || "N/A",
                driverType: 'Ambulance',
                country: amb.country || "India",
                state: amb.state || "N/A",
                city: amb.city || "N/A",
                address: amb.address || "N/A",
                createdAt: amb.createdAt
            }));
        }

        const combinedData = [...transformedDrivers, ...transformedAmbulances].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
 
        return res.status(200).json({
            success: true,
            count: combinedData.length,
            data: combinedData
        });
 
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 2. TOGGLE ACCOUNT ACTIVATION STATUS (Polymorphic Handler)
const toggleDriverStatus = async (req, res) => {
    try {
        const { id } = req.params;

        // Step A: Search inside regular drivers first
        let target = await Driver.findById(id);
        let modelType = 'Driver';

        // Step B: If not found, look up inside Ambulance schema
        if (!target) {
            target = await Ambulance.findById(id);
            modelType = 'Ambulance';
        }

        if (!target) {
            return res.status(404).json({ success: false, message: "Resource not found in Drivers or Ambulances" });
        }

        const newActiveState = target.isActive === false ? true : false;
        target.isActive = newActiveState;

        // Update operational statuses based on schema structural paths
        if (modelType === 'Driver') {
            if (newActiveState === false) {
                target.status = 'Offline';
                target.isOnline = false;
            } else {
                target.status = 'Available';
                target.isOnline = true;
            }
        } else {
            // Ambulance model specific status sync
            target.isOnline = newActiveState;
        }

        await target.save();

        res.json({ 
            success: true, 
            message: `${modelType} account status updated successfully.`, 
            isActive: target.isActive,
            isOnline: target.isOnline
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. GET SINGLE DRIVER DETAILS (Polymorphic Modal Detail Viewer)
const getDriverDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // Check inside Regular drivers first
        let driverDetails = await Driver.findById(id).populate('vendorId').lean();
        let sourceCollection = 'VendorDriver';

        // Check inside Ambulances if not found
        if (!driverDetails) {
            driverDetails = await Ambulance.findById(id).populate('hospitalId').lean();
            sourceCollection = 'Ambulance';
        }

        if (!driverDetails) {
            return res.status(404).json({ success: false, message: "Details not found" });
        }

        res.json({ 
            success: true, 
            source: sourceCollection, 
            data: driverDetails 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. DELETE DRIVER (Polymorphic Admin Action)
const deleteDriverAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        // Try deleting from Regular Drivers
        let deleted = await Driver.findByIdAndDelete(id);
        let type = 'Vendor Driver';

        // Try deleting from Ambulances if not found in first run
        if (!deleted) {
            deleted = await Ambulance.findByIdAndDelete(id);
            type = 'Ambulance Driver';
        }

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Resource not found to delete" });
        }

        res.json({ success: true, message: `${type} removed successfully from systems` });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    getAllDriversAdmin, 
    toggleDriverStatus, 
    getDriverDetails, 
    deleteDriverAdmin 
};