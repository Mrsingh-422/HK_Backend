const mongoose = require('mongoose');
const Tab = require('./models/Tab'); // Path apne project ke hisaab se set karein
require('dotenv').config();

const tabsData = [
    { tabId: 1, name: "Users", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 2, name: "Vendors", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 3, name: "Drivers", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 4, name: "Hospital", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 5, name: "Manage Orders", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 6, name: "Manage Packages", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 7, name: "Manage Medicines", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 8, name: "Manage Cancellation", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 9, name: "Police Headquarter", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 10, name: "FireStation", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 11, name: "Manage Issues", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 12, name: "Request Issue", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 13, name: "App Banners", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 14, name: "Articles", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 15, name: "Subscribers", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 16, name: "Delivery Charges", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 17, name: "Minimum Delivery Amount", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 18, name: "Admin Coupon", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 19, name: "Vendor Offers", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 20, name: "Advertisement", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 21, name: "Insurance Companies", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 22, name: "HelpLine Details", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 23, name: "Withdraw Request", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 24, name: "Symptoms", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 25, name: "Settings", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 26, name: "Website Settings", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 27, name: "Notifications", parentId: 0, subParentId: 0, isActive: true },
    { tabId: 28, name: "Pharmacy Vendors", parentId: 2, subParentId: 0, isActive: true },
    { tabId: 29, name: "Lab Vendors", parentId: 2, subParentId: 0, isActive: true },
    { tabId: 30, name: "Nurse Vendors", parentId: 2, subParentId: 0, isActive: true },
    { tabId: 31, name: "Doctor Vendor", parentId: 2, subParentId: 0, isActive: true },
    { tabId: 32, name: "LabTest Reports", parentId: 2, subParentId: 29, isActive: true },
    { tabId: 33, name: "ManageLabTests", parentId: 2, subParentId: 29, isActive: true },
    { tabId: 34, name: "LabTest Packages", parentId: 2, subParentId: 29, isActive: true },
    { tabId: 35, name: "Nurses", parentId: 2, subParentId: 30, isActive: true },
    { tabId: 36, name: "Manage Nurses", parentId: 2, subParentId: 30, isActive: true },
    { tabId: 37, name: "Doctor Specialist", parentId: 2, subParentId: 31, isActive: true },
    { tabId: 38, name: "Qualification", parentId: 2, subParentId: 31, isActive: true },
    { tabId: 39, name: "Manage Ambulance", parentId: 4, subParentId: 0, isActive: true },
    { tabId: 40, name: "Web Home Page", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 41, name: "Web Hospital Page", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 42, name: "Web Ambulance Page", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 43, name: "Buy Medicine Page", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 44, name: "Dr.Appointment Page", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 45, name: "Book Lab Test Page", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 46, name: "Nursing Content", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 47, name: "Modal Content", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 48, name: "FAQs", parentId: 26, subParentId: 0, isActive: true },
    { tabId: 49, name: "Pharmacy Drivers", parentId: 3, subParentId: 0, isActive: true },
    { tabId: 50, name: "Lab Drivers", parentId: 3, subParentId: 0, isActive: true },
    { tabId: 51, name: "Nurse Drivers", parentId: 3, subParentId: 0, isActive: true },
    { tabId: 52, name: "Ambulance Drivers", parentId: 3, subParentId: 0, isActive: true }
];

const seedDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB...");

        await Tab.deleteMany({}); // Purana data delete karne ke liye
        console.log("Old Tabs cleared.");

        await Tab.insertMany(tabsData);
        console.log(`✅ ${tabsData.length} Tabs Seeded Successfully with isActive: true!`);

        process.exit();
    } catch (error) {
        console.error("Error seeding database:", error);
        process.exit(1);
    }
};

seedDB();