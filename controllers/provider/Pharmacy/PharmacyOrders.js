const PharmacyBooking = require('../../../models/PharmacyBooking');
const Driver = require('../../../models/Driver');

// 1. DASHBOARD LISTING (Figma Tabs: General | Prescription)
// Endpoint: GET /provider/pharmacy/orders/list?orderType=General&status=Placed
const getPharmacyOrders = async (req, res) => {
    try {
        const { orderType, status } = req.query; 
        let query = { pharmacyId: req.user.id };
        
        if (orderType) query.orderType = orderType; // 'General' or 'Prescription'
        if (status) query.status = status;

        const orders = await PharmacyBooking.find(query)
            .populate('userId', 'name phone')
            .populate('driverId', 'name phone profilePic vehicleNumber')
            .sort({ createdAt: -1 });

        res.json({ 
            success: true, 
            count: orders.length,
            data: orders 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET AVAILABLE DRIVERS (Figma: Assign Delivery Boy list)
// Endpoint: GET /provider/pharmacy/orders/available-drivers
const getAvailableDrivers = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        // Sirf wahi drivers jo is pharmacy se linked hain aur 'Available' hain
        const drivers = await Driver.find({
            vendorId: pharmacyId,
            status: 'Available'
        }).select('name phone profilePic status vehicleNumber vehicleType');

        res.json({ success: true, data: drivers });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. MANUAL ASSIGN DRIVER
// Endpoint: POST /provider/pharmacy/orders/assign-manual
const assignDriverManual = async (req, res) => {
    try {
        const { orderId, driverId } = req.body;
        
        const driver = await Driver.findById(driverId);
        if (!driver || driver.status !== 'Available') {
            return res.status(400).json({ message: "Driver is no longer available" });
        }

        const order = await PharmacyBooking.findByIdAndUpdate(orderId, {
            driverId,
            deliveryStatus: 'Assigned',
            status: 'Shipped', // Jab driver assign ho jaye toh status Shipped kar sakte hain
            assignedAt: new Date()
        }, { new: true });

        // Driver ko Busy mark karein
        await Driver.findByIdAndUpdate(driverId, { status: 'Busy' });

        res.json({ success: true, message: "Driver assigned successfully", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. AUTO-ASSIGN LOGIC (Background Process)
const triggerAutoAssignment = async (orderId) => {
    const order = await PharmacyBooking.findById(orderId);
    if (!order || order.deliveryStatus !== 'PendingAssignment') return;

    const nextDriver = await Driver.findOne({
        vendorId: order.pharmacyId,
        status: 'Available',
        _id: { $nin: order.rejectedBy }
    });

    if (nextDriver) {
        order.driverId = nextDriver._id;
        order.deliveryStatus = 'Assigned';
        order.assignedAt = new Date();
        await order.save();

        // 2 Minute Timer: Agar driver respond nahi karta toh next ko bhejo
        setTimeout(async () => {
            const checkOrder = await PharmacyBooking.findById(orderId);
            if (checkOrder.deliveryStatus === 'Assigned') {
                checkOrder.rejectedBy.push(checkOrder.driverId);
                checkOrder.driverId = null;
                checkOrder.deliveryStatus = 'PendingAssignment';
                await checkOrder.save();
                triggerAutoAssignment(orderId); 
            }
        }, 120000); 
    }
};

module.exports = { getPharmacyOrders, getAvailableDrivers, assignDriverManual, triggerAutoAssignment };