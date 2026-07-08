const Driver = require('../../../models/Driver');
const Ambulance = require('../../../models/Ambulance');

// 1. GET ALL DRIVERS (Vendor Drivers + Ambulance Drivers Merged)
const getAllDriversAdmin = async (req, res) => {
    try {
        // Parallel queries execution for better efficiency
        const [drivers, ambulances] = await Promise.all([
            Driver.find()
                .populate({ path: 'vendorId', select: 'name clinicName pharmacyName labName vendorType' })
                .lean(),
            Ambulance.find()
                .populate({ path: 'hospitalId', select: 'name' })
                .lean()
        ]);

        // Transform Regular Vendor Drivers
        const transformedDrivers = drivers.map(driver => ({
            id: driver._id,
            vendorName: driver.vendorId?.name || driver.vendorId?.labName || driver.vendorId?.pharmacyName || "N/A",
            username: driver.username,
            driverName: driver.name,
            phone: driver.phone,
            email: driver.email || "N/A",
            imageUrl: driver.profilePic || null,
            onlineStatus: driver.isOnline !== false, 
            isActive: driver.isActive !== false,     
            vehicle: driver.vehicleType || "N/A",
            vehicleNumber: driver.vehicleNumber || "N/A",
            licenseNumber: driver.documents?.license || "N/A",
            driverType: driver.vendorType, // 'Lab', 'Pharmacy' etc.
            createdAt: driver.createdAt
        }));

        // Transform Ambulance Drivers
        const transformedAmbulances = ambulances.map(amb => ({
            id: amb._id,
            vendorName: amb.hospitalId?.name || "Independent", // Show Hospital Name, fallback to Independent
            username: amb.email || amb.phone || "N/A",         // Uses unique email/phone identifier
            driverName: amb.driverInfo?.fullName || amb.name,  // Fallback to general service name
            phone: amb.phone || "N/A",
            email: amb.email || "N/A",
            imageUrl: null,                                    // Ambulance schema doesn't have profile pic field
            onlineStatus: amb.isOnline !== false,
            isActive: amb.isActive !== false,
            vehicle: amb.vehicleType || "N/A",
            vehicleNumber: amb.vehicleNumber || "N/A",
            licenseNumber: amb.drivingLicenseNumber || "N/A",
            driverType: 'Ambulance',                           // Classified as Ambulance category
            createdAt: amb.createdAt
        }));

        // Merge both arrays and sort by creation date descending
        const combinedDriversList = [...transformedDrivers, ...transformedAmbulances].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );

        res.json({ success: true, data: combinedDriversList });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
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