const mongoose = require('mongoose');
const Tab = require('./models/Tab'); // Path sahi kar lena
require('dotenv').config();

const tabsData = [
    { tabId: 1, name: 'Users', parentId: 0, subParentId: 0 },
    { tabId: 2, name: 'Vendors', parentId: 0, subParentId: 0 },
    { tabId: 3, name: 'Drivers', parentId: 0, subParentId: 0 },
    { tabId: 28, name: 'Pharmacy Vendors', parentId: 2, subParentId: 0 },
    { tabId: 31, name: 'Doctor Vendor', parentId: 2, subParentId: 0 },
    { tabId: 32, name: 'LabTest Reports', parentId: 2, subParentId: 29 },
    // ... Baki saara PHP ka data yahan array mein daal dein
];

const seedDB = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await Tab.deleteMany({}); // Purana data clear karne ke liye
    await Tab.insertMany(tabsData);
    console.log("✅ Tabs Seeded Successfully!");
    process.exit();
};

seedDB();