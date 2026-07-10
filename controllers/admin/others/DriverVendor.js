const Driver = require('../../../models/Driver');
const Ambulance = require('../../../models/Ambulance');

// 1. GET ALL DRIVERS (Vendor Drivers + Ambulance Drivers Merged)
const getAllDriversAdmin = async (req, res) => {
    try {
        // Query parameters extract karein
        const { country, city, state, district } = req.query;
 
        // Dynamic MongoDB query object build karein
        let filter = {};
 
        // 1. Country Filter
        if (country) {
            filter.country = { $regex: country, $options: 'i' }; // Case-insensitive search
        }
 
        // 2. City Filter
        if (city) {
            filter.city = { $regex: city, $options: 'i' }; // Case-insensitive search
        }
 
        // 3. State / District Filter
        // Note: Model me 'state' field hai, isliye agar admin state ya district me se
        // kuch bhi bhejta hai, toh use hum database ke 'state' field se match karenge.
        const stateOrDistrict = state || district;
        if (stateOrDistrict) {
            filter.state = { $regex: stateOrDistrict, $options: 'i' }; // Case-insensitive search
        }
 
        // Filter lagakar Drivers fetch karein
        const drivers = await Driver.find(filter)
            .populate({ path: 'vendorId', select: 'name clinicName pharmacyName labName vendorType' })
            .sort({ createdAt: -1 });
 
        // Data transform karein taaki UI se match kare
        const transformedData = drivers.map(driver => ({
            id: driver._id,
            vendorName: driver.vendorId?.name || driver.vendorId?.labName || driver.vendorId?.pharmacyName || "N/A",
            username: driver.username,
            driverName: driver.name,
            phone: driver.phone,
            email: driver.email || "N/A",
            imageUrl: driver.profilePic,
            onlineStatus: driver.status === 'Available', // UI Toggle logic
            vehicle: driver.vehicleType,
            vehicleNumber: driver.vehicleNumber,
            licenseNumber: driver.documents?.license,
            driverType: driver.vendorType,
            // Location fields transform me include karein taaki UI par show ho sakein
            country: driver.country || "N/A",
            state: driver.state || "N/A",
            city: driver.city || "N/A",
            address: driver.address || "N/A"
        }));
 
        res.json({
            success: true,
            count: transformedData.length,
            data: transformedData
        });
 
    } catch (error) {
        res.status(500).json({ message: error.message });
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