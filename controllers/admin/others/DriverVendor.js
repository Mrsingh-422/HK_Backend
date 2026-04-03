const Driver = require('../../../models/Driver');

// 1. GET ALL DRIVERS (For Admin Table)
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
            onlineStatus: driver.status === 'Available', // UI Toggle logic
            vehicle: driver.vehicleType,
            vehicleNumber: driver.vehicleNumber,
            licenseNumber: driver.documents?.license,
            driverType: driver.vendorType,
            // ... baaki fields
        }));

        res.json({ success: true, data: transformedData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. TOGGLE DUTY STATUS (Online/Offline)
const toggleDriverStatus = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });

        // Toggle logic: Available <-> Offline
        driver.status = driver.status === 'Available' ? 'Offline' : 'Available';
        await driver.save();

        res.json({ 
            success: true, 
            message: `Driver is now ${driver.status}`, 
            status: driver.status 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
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