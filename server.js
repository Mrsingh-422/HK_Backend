const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const os = require('os');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const chatSocketHandler = require('./utils/chatSocket'); // Import our handler


///////// For bypassing the Windows DNS bug //////////
const dns = require('node:dns/promises'); // For bypassing the Windows DNS bug
dns.setServers(["1.1.1.1", "8.8.8.8"]); // Forces Node to bypass the Windows DNS bug
 ////////////////// end bypassing DNS bug //////////////////////////////////


// Config
const envFile = path.join(__dirname, '.env');
dotenv.config({ path: envFile });
const connectDB = require('./config/db');

// Connect DB
connectDB();

// --- Initialize Background Workers ---
const initCronJobs = require('./utils/cronJobs'); // 👈 Add this require
initCronJobs(); // 👈 Start the background scheduler on server startup

const app = express();


///////////////// websocket server //////////////////
const server = http.createServer(app);
// Socket.io initialization with CORS
const io = socketIo(server, {
    cors: {
        origin: "*", // allow dynamic connection
        methods: ["GET", "POST"]
    }
});
// Chat handlers register karein
chatSocketHandler(io);
//////////////// websocket server end //////////////////



////////////////////////// for console log format ----- start ----- ////////////////////////////
// 1. Indian Standard Time (IST) Token
morgan.token('local-date', () => {
    return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
});

// 2. Real Client IP Token
morgan.token('real-ip', (req) => {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) {
        return ip.split(',')[0].trim();
    }
    return ip;
});

// 3. User Name Token
morgan.token('user-name', (req) => {
    if (req.user && req.user.name) {
        return req.user.name;
    }
    if (req.doctor && req.doctor.name) {
        return req.doctor.name;
    }
    if (req.user) {
        return req.user.email || req.user.phone || 'Auth-User';
    }
    return 'Guest';
});

// 4. Custom Location Token (Multiple key options ko check karega)
morgan.token('location', (req) => {
    if (req.body && typeof req.body === 'object') {
        // Latitudes ke sabhi possible options
        const latKeys = ['lat', 'userlat', 'latitude', 'userLatitude'];
        // Longitudes ke sabhi possible options
        const lngKeys = ['lng', 'userlng', 'longitude', 'userLongitude'];

        let foundLat = null;
        let foundLng = null;

        // Sabse pehli matching latitude key dhundhein
        for (const key of latKeys) {
            if (req.body[key] !== undefined && req.body[key] !== null) {
                foundLat = req.body[key];
                break;
            }
        }

        // Sabse pehli matching longitude key dhundhein
        for (const key of lngKeys) {
            if (req.body[key] !== undefined && req.body[key] !== null) {
                foundLng = req.body[key];
                break;
            }
        }

        // Agar dono keys mil jati hain, toh print karein
        if (foundLat !== null && foundLng !== null) {
            return ` [Loc: ${foundLat}, ${foundLng}]`;
        }
    }
    return ''; // Agar location data nahi hai toh khali chhod dega
});

// 5. Final Custom Format (Sirf isi ek app.use(morgan...) ko pure file me rakhein)
app.use(morgan('[:local-date] [IP: :real-ip] [User: :user-name] :method :url :status:location - :response-time ms'));
/////////////////////////// for console log format ---- end ---- ////////////////////////////



// Middleware
app.use(cors({ origin: '*' })); // Allow all origins
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Form डेटा के लिए (Optional)

// Static folder for uploads
app.use('/uploads', express.static('public/uploads'));

////////////////// Admin Routes /////////////////////////
app.use('/api/auth/admin', require('./routes/admin/authAdmin'));
app.use('/api/admin', require('./routes/admin/user/insruranceAdd'));
app.use('/api/admin/approval', require('./routes/admin/approvalRoute'));
app.use('/admin/doctor-data', require('./routes/admin/others/doctorDataRoute'));
app.use('/admin/banners', require('./routes/admin/others/BannerRoute')); // Banner Management Route
app.use('/admin/emergency-contacts', require('./routes/admin/others/EmergencyContactRoute'));
app.use('/admin/articles', require('./routes/admin/others/AdminArticleRoute'));
app.use('/admin/ads', require('./routes/admin/others/AdManagerRoute')) // Ad Management Route
app.use('/admin/medical-masters', require('./routes/admin/others/MedicalMasterRoute'));
app.use('/admin/drivers/vendor', require('./routes/admin/others/DriverVendorRoute'));
app.use('/admin/vendor-km-limit', require('./routes/admin/others/VendorKMLimitRoute'));
app.use('/admin/users', require('./routes/admin/user/UserRoute'));
app.use('/admin/user/insurance', require('./routes/admin/user/insruranceAdd'));
app.use('/admin/roles', require('./routes/subAdmin/RoleRoute')); // Role Management Route
app.use('/admin/subscriptions', require('./routes/admin/others/AdminSubscriptionRoute'));

app.use('/api/homepage', require('./routes/admin/user/home/HomePageRoute')); // HomePage Content Management Route
app.use('/api/labpage', require('./routes/admin/user/home/LabPageRoute')) // LabPage Content Management Route
app.use('/api/appointmentpage', require('./routes/admin/user/home/AppointmentPageRoute')); // Appointment Page Content Management Route
app.use('/api/medicinepage', require('./routes/admin/user/home/MedicinePageRoute')); // Medicine Page Content Management Route
app.use('/api/ambulancepage', require('./routes/admin/user/home/AmbulancePageRoute')); // Ambulance Page Content Management Route
app.use('/api/hospitalpage', require('./routes/admin/user/home/HoppitalPageRoute')); // Hospital Page Content Management Route
app.use('/api/nursepage', require('./routes/admin/user/home/NursePageRoute')); // Nurse Page Content Management Route
app.use('/api/footer', require('./routes/admin/user/home/footerRoutes')); // Footer Management Route
app.use('/api/homepage/list', require('./routes/admin/user/home/ListRoute')); // List Management Route (Doctors, Hospitals, etc.)
//-- admin others folder routes ---
app.use('/api/admin/fire', require('./routes/admin/others/manageFireStationAndHeadquaterRoute')); // Fire Management Route
app.use('/api/admin/police', require('./routes/admin/others/PoliceHQ')); // Dashboard Management Route
app.use('/api/admin/policy-config', require('./routes/admin/others/PolicyConfigRoute')); // Policy Config Management Route
app.use('/api/admin/profile-update', require('./routes/admin/others/ProfileUpdateApprovalRoute')); // Profile Update Approval Management Route
// --- Admin pharmacy Routes ---
app.use('/admin/pharmacy', require('./routes/admin/Pharmacy/PharmacyAdminRoute')); // Pharmacy Management Route
app.use('/admin/pharmacy/medicine', require('./routes/admin/Pharmacy/MedicineUploadRoute')); // Medicine Upload Route
// --- Admin Lab Routes ---
app.use('/admin/lab', require('./routes/admin/Lab/LabAdminRoute')); // Lab Management Route
app.use('/admin/lab/tests', require('./routes/admin/Lab/TestUploadRoute')); // Master Lab Test Upload & List Route
// --- Admin Nurse Routes ---
app.use('/admin/nurse', require('./routes/admin/Nurse/NurseAdminRoute')); // Nurse Management Route
app.use('/admin/nurse-csv', require('./routes/admin/Nurse/CategoryUploadRoute')); // Master Nurse Category Upload & List Route
// --- Admin Hospital Routes ---
app.use('/admin/hospital', require('./routes/admin/Hospital/HospitalAdminRoute')); // Hospital Management Route
// --- Admin Doctor Routes ---
app.use('/admin/doctor', require('./routes/admin/Doctor/DoctorAdminRoute')); // Doctor Management Route
// --- Admin Ambulance Routes ---
app.use('/admin/ambulance', require('./routes/admin/Ambulance/AmbulanceAdminRoute')); // Ambulance Management Route
// --- Admin Dashboard Routes ---
app.use('/admin/dashboard', require('./routes/admin/Dashboard/DashboardRoute')); // Dashboard Management Route
// --- Admin Wallet Routes ---
app.use('/api/admin/wallet', require('./routes/admin/AdminWalletRoute')); // Wallet Management Route






/////////////  User Routes /////////////////////////
app.use('/user/homepage', require('./routes/user/SearchRoutes'));

app.use('/api/auth/user', require('./routes/user/authUser')); 
app.use('/api/user/abha', require('./routes/user/others/AbhaCardRoute')); // ABHA Card Management Route
app.use('/api/user/locker', require('./routes/user/others/HealthLockerRoute')); // Locker Management Route
app.use('/api/user/review', require('./routes/user/others/ReviewRoute')); // Review Management Route
// --- user doctor ---
app.use('/user/doctor/pills', require('./routes/user/Doctor/PillsRoute')); // Doctor's Prescription Management
app.use('/user/health-records', require('./routes/user/Doctor/HealthRoute')); // Health Records Management
app.use('/user/doctors', require('./routes/user/Doctor/BookAppointment')); // Doctor Appointment Booking
app.use('/user/doctor/menstrual', require('./routes/user/Doctor/MenstrualTrackerRoute')); // Menstrual Cycle Tracking
app.use('/user/review', require('./routes/user/Doctor/ReviewDoctorRoute')); // Doctor Review Route
app.use('/user/doctor/video-call', require('./routes/user/Doctor/VideoCallRoute')); // Doctor Video Call Route
app.use('/api/chat', require('./routes/user/Doctor/ChatRoutes')); // Doctor-User Chat Route
// --- user hospital ---
app.use('/user/hospital', require('./routes/user/Hospital/BookHospitalRoute'));
// --- user others ---
app.use('/user/subscriptions', require('./routes/user/others/SubscriptionRoute'));
// --- user lab ---
app.use('/user/labs', require('./routes/user/Lab/BookLabRoute'));
app.use('/user/cart', require('./routes/user/Lab/CartRoute'));
// --- user nurse ---
app.use('/user/nurse', require('./routes/user/Nurse/BookNurseRoute'));
app.use('/user/nurse/prescription', require('./routes/user/Nurse/NursingPrescriptionRoutes')); // 👈 Add this line here
// --- user pharmacy ---
app.use('/user/pharmacy', require('./routes/user/Pharmacy/BookPharmacyRoute'));
app.use('/user/medicine', require('./routes/user/Pharmacy/MedicineInventoryUserRoute'));
// --- user ambulance ---
app.use('/user/ambulance', require('./routes/user/Ambulance/AmbulanceBookRoute'));

//////////////// Doctor Routes ///////////////////////
app.use('/api/auth/doctor', require('./routes/doctor/authDoctor'));
app.use('/doctor/settings', require('./routes/doctor/DoctorSettingsRoute')); // Doctor Panel Route (Dashboard, Profile, etc.)
app.use('/doctor/appointments', require('./routes/doctor/AppointmentRoute')); // Doctor Appointments Route
app.use('/doctor/coupon', require('./routes/doctor/DoctorCouponRoute')); // Doctor Coupons Route
app.use('/doctor/wallet', require('./routes/doctor/DoctorWalletRoute')); // Doctor Wallet Route
app.use('/doctor/visit-charges', require('./routes/doctor/DoctorVisitChargeRoute')); // Doctor Visit Charges Route
app.use('/doctor/availability', require('./routes/doctor/DoctorSlotsRoute')); // Doctor Availability Route
app.use('/doctor/video-call', require('./routes/doctor/VideoCallRoute')); // Doctor Video Call Route


 

//////////////// Hospital Routes /////////////////////
app.use('/api/auth/hospital', require('./routes/hospital/authHospital'));
app.use('/hospital/panel', require('./routes/hospital/HospitalPanelRoute'));
app.use('/hospital/wallet', require('./routes/hospital/HospitalWalletRoute')); // Hospital Wallet Route
app.use('/api/hospital/doctors', require('./routes/hospital/hospitalDoctor/hosDoctorRoute')); // Hospital Doctor Management
app.use('/hospital/doctor/appointments', require('./routes/hospital/hospitalDoctor/hosAppointment')); // Hospital Doctor Appointments Route
app.use('/api/hospital/ambulance', require('./routes/hospital/hospitalAmbulance/hosAmbulanceRoute')); // Hospital Ambulance Management
//--------- Hospital Doctor Panel (Separate routes for doctor-specific actions within hospital) ---------
app.use('/hospital-doctor/panel', require('./routes/hospital/Doctor/hosDocPanelRoute')); // Hospital Doctor Panel Route (Dashboard, Prescriptions, etc.)




//////////////// Provider Routes /////////////////////
app.use('/api/auth/provider', require('./routes/provider/authProvider'));
app.use('/provider/wallet', require('./routes/provider/Common/WalletRoute')); // Wallet Management Route (Withdrawals)
app.use('/provider/coupons', require('./routes/provider/Common/CouponRoute')); // Promotions & Coupon Management Route
app.use('/provider/availability', require('./routes/provider/Common/AvailabilityRoute')); // Availability Management Route (Doctors, Labs, Ambulances)
app.use('/provider/driver', require('./routes/provider/Common/DriverRoute')); // Availability Management Route (Doctors, Labs, Ambulances)
app.use('/provider/delivery-charges', require('./routes/provider/Common/DeliveryRoute')); // Delivery Charges Management Route

// --- Provider Lab Routes ---
app.use('/provider/labs/profile', require('./routes/provider/Lab/LabProfileRoute'));
app.use('/provider/labs', require('./routes/provider/Lab/LabOrderRoute')); // Lab Order Management
app.use('/provider/labs/services', require('./routes/provider/Lab/LabsServiceRoute')); // Lab Test Management
// app.use('/provider/labs/driver', require('./routes/provider/Lab/LabDriverRoute')); // Lab Test Management


// --- Provider Pharmacy Routes ---
// app.use('/provider/pharmacy/driver', require('./routes/provider/Pharmacy/DriverPharmacyRoute')); // Lab Test Management
app.use('/provider/pharmacy/profile', require('./routes/provider/Pharmacy/PharmacyProfileRoute'));
app.use('/provider/pharmacy/inventory', require('./routes/provider/Pharmacy/MedicineInventoryRoute'));
app.use('/provider/pharmacy/orders', require('./routes/provider/Pharmacy/PharmacyOrdersRoute'));
app.use('/provider/pharmacy/combo-offers', require('./routes/provider/Pharmacy/ComboOffersRoute')); // Combo Offers Management Route (BOGO, etc.)


// --- Provider Nurse Routes ---
app.use('/provider/nurse/dash', require('./routes/provider/Nurse/NurseDashboardRoute'));
app.use('/provider/nurse/service', require('./routes/provider/Nurse/NurseServiceRoute'));
app.use('/provider/nurse/management', require('./routes/provider/Nurse/NurseStaffManagementRoute'));
app.use('/provider/nurse/package', require('./routes/provider/Nurse/NursePackageRoute'));
app.use('/provider/nurse/prescription', require('./routes/provider/Nurse/NursePrescriptionRoute'));

////////////////////// Driver Routes /////////////////////
app.use('/driver/pharmacy', require('./routes/driver/driverPharmacy/OrdersRoute'));  
app.use('/driver/lab', require('./routes/driver/driverLab/driverLabOrdersRoute')); 
app.use('/driver/nurse', require('./routes/driver/driverNurse/NurseDriverOrdersRoute'));

//////////////// Ambulance Routes /////////////////////
app.use('/api/auth/ambulance', require('./routes/ambulance/authAmbulance'));
app.use('/driver/ambulance', require('./routes/ambulance/AmbulanceJourneyRoute')); // Ambulance Booking Management
app.use('/ambulance/booking', require('./routes/ambulance/BookingAmbRoute')); // Ambulance Booking Management
app.use('/driver/ambulance/wallet', require('./routes/ambulance/AmbulanceWalletRoute')); // Ambulance Wallet Route

//////////////// others Routes or public routes  /////////////////////
app.use('/api/public', require('./routes/others/locationRoutes'));
app.use('/api/password', require('./routes/others/forgotPassword'));


///////////////////////// fireHQ Routes /////////////////////////
app.use('/fireHQ/auth', require('./routes/fireHQ/authFireHQRoute')); // FireHQ Authentication Route
app.use('/fireHQ/management', require('./routes/fireHQ/fireHqManageRoute'));
// --- Fire Station Operations ---
app.use('/fireStation/auth', require('./routes/fireHQ/fireStation/authFireStationRoute')); // Fire Station Management Route
app.use('/fireStation/ops', require('./routes/fireHQ/fireStation/opsRoute')); // Fire Station Operations Route (Roster, Leaves, Case Updates)
app.use('/fireStation/management', require('./routes/fireHQ/fireStation/stationManageRoute')); // Fire Station Management Route
// --- Fire Station Staff ---
app.use('/fireStaff/auth', require('./routes/fireHQ/fireStationStaff/authStaff')); // Fire Station Staff Authentication Route
app.use('/fireStaff/ops', require('./routes/fireHQ/fireStationStaff/staffOpsRoutes')); // Fire Station Staff Operations Route (Check-in, Leaves, Assigned Cases)


///////////////////////////// policeHQ Routes /////////////////////////
app.use('/policeHQ/auth', require('./routes/policeHQ/authPoliceHQRoute'));
app.use('/policeHQ/management', require('./routes/policeHQ/hqManagementRoute')); // Police HQ Management Route (Dashboard, Station Creation, Global History)
 
// --- Police Station ---
app.use('/policeStation/auth', require('./routes/policeHQ/policeStation/authPoliceStationRoute'));
app.use('/policeStation/station', require('./routes/policeHQ/policeStation/stationRoutes'));
 
// --- Police Station Staff ---
app.use('/policeStationStaff/auth', require('./routes/policeHQ/policeStationStaff/authStaff'));
app.use('/policeStationStaff/staff', require('./routes/policeHQ/policeStationStaff/staffRoutes'));


app.get('/', (req, res) => {
    res.send('HK Backend is running...');
}); 

// --- HELPER FUNCTION TO GET IP ---
const getLocalIpAddress = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal (localhost) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
};
 
const PORT = process.env.PORT;


server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIpAddress(); // IP Function call kiya
    // console.log(`🚀 Server running on port ${PORT}`);
    // console.log(`📡 Access locally: http://localhost:${PORT}`);
    console.log(`🌍 Access on Network: http://${ip}:${PORT}`); // Ab ye real IP dikhayega
});  