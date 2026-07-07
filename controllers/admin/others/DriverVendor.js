const Driver = require('../../../models/Driver');

// 1. GET ALL DRIVERS (For Admin Table with isActive & isOnline states)
const getAllDriversAdmin = async (req, res) => {
    try {
        // .populate('vendorId') se humein Vendor ka naam milega (Lab Name, Pharmacy Name etc.)
        const drivers = await Driver.find()
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
            onlineStatus: driver.isOnline !== false, // Treats undefined or true as Online
            isActive: driver.isActive !== false,     // 🚨 Passes account activation state to Admin Table UI
            vehicle: driver.vehicleType,
            vehicleNumber: driver.vehicleNumber,
            licenseNumber: driver.documents?.license,
            driverType: driver.vendorType,
        }));

        res.json({ success: true, data: transformedData });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. TOGGLE ACCOUNT ACTIVATION STATUS (Admin Account Suspension Blocker)
const toggleDriverStatus = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });

        // Toggle account validation state (Treats undefined as true and toggles to false)
        const newActiveState = driver.isActive === false ? true : false;
        driver.isActive = newActiveState;

        // Failsafe auto-sync:
        // Case A: If admin deactivates/suspends the account, force statuses to Offline
        if (newActiveState === false) {
            driver.status = 'Offline';
            driver.isOnline = false;
        } 
        // Case B: If admin re-enables the account, default status back to Available
        else {
            driver.status = 'Available';
            driver.isOnline = true;
        }

        await driver.save();

        res.json({ 
            success: true, 
            message: `Driver status updated. Active: ${driver.isActive}, Status: ${driver.status}`, 
            isActive: driver.isActive,
            status: driver.status 
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. GET SINGLE DRIVER DETAILS (For Modal)
const getDriverDetails = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id).populate('vendorId');
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        res.json({ success: true, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. DELETE DRIVER (Admin Action)
const deleteDriverAdmin = async (req, res) => {
    try {
        const deleted = await Driver.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Driver not found" });
        res.json({ success: true, message: "Driver removed successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getAllDriversAdmin, toggleDriverStatus, getDriverDetails, deleteDriverAdmin };