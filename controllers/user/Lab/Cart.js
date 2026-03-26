const Cart = require('../../../models/Cart');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');

// 1. ADD TO LAB CART
// endpoint: /user/cart/lab/add
const addToLabCart = async (req, res) => {
    try {
        const { labId, itemId, productType, forceReplace } = req.body; 
        const userId = req.user.id;

        let itemData, newItemCategory;
        if (productType === 'LabTest') {
            itemData = await LabTest.findById(itemId);
            newItemCategory = itemData.mainCategory;
        } else {
            itemData = await LabPackage.findById(itemId);
            newItemCategory = 'Package';
        }

        let cart = await Cart.findOne({ userId });
        if (!cart) cart = new Cart({ userId, labCart: { items: [] } });

        // LOGIC: Check for Mismatch
        const hasItems = cart.labCart.items.length > 0;
        const isDifferentLab = hasItems && cart.labCart.labId.toString() !== labId;
        const isDifferentCat = hasItems && cart.labCart.categoryType !== newItemCategory;

        // Agar mismatch hai aur user ne "forceReplace" nahi bheja, toh error bhejo
        if ((isDifferentLab || isDifferentCat) && !forceReplace) {
            return res.status(400).json({ 
                success: false, 
                canReplace: true, // Frontend ko batane ke liye ki "Replace" button dikhao
                message: isDifferentLab ? "Different Lab detected." : `Cart already has ${cart.labCart.categoryType} items.`
            });
        }

        // Agar forceReplace true hai, toh purana labCart khali karo
        if (forceReplace) {
            cart.labCart.items = [];
        }

        cart.labCart.labId = labId;
        cart.labCart.categoryType = newItemCategory;

        const itemIndex = cart.labCart.items.findIndex(i => i.itemId.toString() === itemId);
        if (itemIndex > -1) {
            cart.labCart.items[itemIndex].quantity += 1;
        } else {
            cart.labCart.items.push({
                productType, itemId,
                name: productType === 'LabTest' ? itemData.testName : itemData.packageName,
                price: productType === 'LabTest' ? itemData.discountPrice : itemData.offerPrice,
                quantity: 1
            });
        }

        await cart.save();
        res.json({ success: true, message: "Cart Updated", data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE QUANTITY (Inc/Dec)
const updateCartQuantity = async (req, res) => {
    try {
        const { itemId, action } = req.body; // action: 'inc' or 'dec'
        const cart = await Cart.findOne({ userId: req.user.id });
        
        const itemIndex = cart.labCart.items.findIndex(i => i.itemId.toString() === itemId);
        if (itemIndex > -1) {
            if (action === 'inc') cart.labCart.items[itemIndex].quantity += 1;
            else cart.labCart.items[itemIndex].quantity -= 1;

            // Remove item if quantity becomes 0
            if (cart.labCart.items[itemIndex].quantity <= 0) {
                cart.labCart.items.splice(itemIndex, 1);
            }
        }

        if (cart.labCart.items.length === 0) {
            cart.labCart.categoryType = null;
            cart.labCart.labId = null;
        }

        await cart.save();
        res.json({ success: true, data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET CART
// endpoint: /user/cart
const getMyCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id })
            .populate('labCart.labId', 'name city address profileImage')
            .populate('labCart.items.itemId');

        if (!cart) return res.json({ success: true, message: "Cart is empty", data: { labCart: { items: [] }, pharmacyCart: { items: [] } } });

        res.json({ success: true, data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. REMOVE ITEM / CLEAR LAB CART
// endpoint: /user/cart/lab/clear
const clearLabCart = async (req, res) => {
    try {
        await Cart.findOneAndUpdate(
            { userId: req.user.id },
            { $set: { "labCart.items": [], "labCart.categoryType": null, "labCart.labId": null } }
        );
        res.json({ success: true, message: "Lab cart cleared" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. REMOVE ITEM
// endpoint: /user/cart/item/:itemId
const removeItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const cart = await Cart.findOne({ userId: req.user.id });
        
        cart.labCart.items = cart.labCart.items.filter(i => i.itemId.toString() !== itemId);
        
        // Reset category if cart becomes empty
        if (cart.labCart.items.length === 0) {
            cart.labCart.categoryType = null;
            cart.labCart.labId = null;
        }

        await cart.save();
        res.json({ success: true, message: "Item removed", data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { addToLabCart,updateCartQuantity, getMyCart, clearLabCart, removeItem };