// const Cart = require('../../../models/Cart');
// const MedicineInventory = require('../../../models/MedicineInventory');
// const Medicine = require('../../../models/Medicine');

// // --- PHARMACY CART LOGIC ---

// // 1. ADD TO PHARMACY CART
// // endpoint: /user/cart/pharmacy/add
// const addToPharmacyCart = async (req, res) => {
//     try {
//         const { pharmacyId, medicineId, quantity = 1, forceReplace } = req.body;
//         const userId = req.user.id;

//         // Inventory se price check karein
//         const inventory = await MedicineInventory.findOne({ pharmacyId, medicineId, is_available: true });
//         if (!inventory) return res.status(404).json({ message: "Medicine not available at this pharmacy" });

//         let cart = await Cart.findOne({ userId });
//         if (!cart) cart = new Cart({ userId, pharmacyCart: { items: [] } });

//         // Logic: Ek baar me ek hi pharmacy allow karein (Mismatch Check)
//         const hasItems = cart.pharmacyCart.items.length > 0;
//         const isDifferentPharmacy = hasItems && cart.pharmacyCart.pharmacyId.toString() !== pharmacyId;

//         if (isDifferentPharmacy && !forceReplace) {
//             return res.status(400).json({ 
//                 success: false, 
//                 canReplace: true, 
//                 message: "Your cart has items from another pharmacy. Replace cart?" 
//             });
//         }

//         if (forceReplace) {
//             cart.pharmacyCart.items = [];
//         }

//         cart.pharmacyCart.pharmacyId = pharmacyId;

//         const itemIndex = cart.pharmacyCart.items.findIndex(i => i.medicineId.toString() === medicineId);
        
//         if (itemIndex > -1) {
//             cart.pharmacyCart.items[itemIndex].quantity += quantity;
//         } else {
//             const medData = await Medicine.findById(medicineId);
//             cart.pharmacyCart.items.push({
//                 medicineId,
//                 name: medData.name,
//                 price: inventory.vendor_price,
//                 quantity
//             });
//         }

//         await cart.save();
//         res.json({ success: true, message: "Pharmacy Cart Updated", data: cart });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// // 2. UPDATE PHARMACY QUANTITY
// const updatePharmacyQuantity = async (req, res) => {
//     try {
//         const { medicineId, action } = req.body; // action: 'inc', 'dec'
//         const cart = await Cart.findOne({ userId: req.user.id });
        
//         const itemIndex = cart.pharmacyCart.items.findIndex(i => i.medicineId.toString() === medicineId);
//         if (itemIndex > -1) {
//             if (action === 'inc') cart.pharmacyCart.items[itemIndex].quantity += 1;
//             else cart.pharmacyCart.items[itemIndex].quantity -= 1;

//             if (cart.pharmacyCart.items[itemIndex].quantity <= 0) {
//                 cart.pharmacyCart.items.splice(itemIndex, 1);
//             }
//         }

//         if (cart.pharmacyCart.items.length === 0) cart.pharmacyCart.pharmacyId = null;

//         await cart.save();
//         res.json({ success: true, data: cart });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// // 3. GET COMBINED CART (Lab + Pharmacy)
// const getMyCart = async (req, res) => {
//     try {
//         const cart = await Cart.findOne({ userId: req.user.id })
//             .populate('labCart.labId', 'name city address profileImage')
//             .populate('pharmacyCart.pharmacyId', 'name address rating city')
//             .populate('pharmacyCart.items.medicineId', 'image_url manufacturers name');

//         if (!cart) return res.json({ success: true, data: { labCart: { items: [] }, pharmacyCart: { items: [] } } });

//         res.json({ success: true, data: cart });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };



// module.exports = { 
//     addToPharmacyCart, 
//     updatePharmacyQuantity, 
//     getMyCart,
//     // ... aapke purane lab functions yahan aayenge
// };