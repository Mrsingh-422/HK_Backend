const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const os = require('os');

// Config
const envFile = path.join(__dirname, '.env');
dotenv.config({ path: envFile });
const connectDB = require('./config/db');

// Connect DB
connectDB();

const app = express();

// Middleware
app.use(cors()); // Allow all origins
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Form डेटा के लिए (Optional)

// Static folder for uploads
app.use('/uploads', express.static('public/uploads'));

////////////////// Admin Routes /////////////////////////
app.use('/api/auth/admin', require('./routes/admin/authAdmin'));
app.use('/api/admin', require('./routes/admin/user/insruranceAdd'));
app.use('/api/admin/approval', require('./routes/admin/approvalRoute'));
app.use('/admin/doctor-data', require('./routes/admin/others/doctorDataRoute'));
app.use('/admin/roles', require('./routes/subAdmin/RoleRoute')); // Role Management Route

app.use('/api/homepage', require('./routes/admin/user/home/HomePageRoute')); // HomePage Content Management Route
app.use('/api/labpage', require('./routes/admin/user/home/LabPageRoute')) // LabPage Content Management Route
app.use('/api/appointmentpage', require('./routes/admin/user/home/AppointmentPageRoute')); // Appointment Page Content Management Route
app.use('/api/medicinepage', require('./routes/admin/user/home/MedicinePageRoute')); // Medicine Page Content Management Route
app.use('/api/ambulancepage', require('./routes/admin/user/home/AmbulancePageRoute')); // Ambulance Page Content Management Route
app.use('/api/hospitalpage', require('./routes/admin/user/home/HoppitalPageRoute')); // Hospital Page Content Management Route
app.use('/api/nursepage', require('./routes/admin/user/home/NursePageRoute')); // Nurse Page Content Management Route
app.use('/api/footer', require('./routes/admin/user/home/footerRoutes')); // Footer Management Route
app.use('/api/homepage/list', require('./routes/admin/user/home/ListRoute')); // List Management Route (Doctors, Hospitals, etc.)
// --- Admin pharmacy Routes ---
app.use('/admin/pharmacy/medicine', require('./routes/admin/Pharmacy/MedicineUploadRoute')); // Medicine Upload Route
// --- Admin Lab Routes ---
app.use('/admin/lab/tests', require('./routes/admin/Lab/TestUploadRoute')); // Master Lab Test Upload & List Route

/////////////  User Routes /////////////////////////
app.use('/api/auth/user', require('./routes/user/authUser')); 
// --- user doctor ---
app.use('/user/doctor/pills', require('./routes/user/Doctor/PillsRoute')); // Doctor's Prescription Management
app.use('/user/health-records', require('./routes/user/Doctor/HealthRoute')); // Health Records Management
app.use('/user/doctors', require('./routes/user/Doctor/BookAppointment')); // Doctor Appointment Booking
app.use('/user/review', require('./routes/user/Doctor/ReviewDoctorRoute')); // Doctor Review Route
// --- user lab ---
app.use('/user/labs', require('./routes/user/Lab/BookLabRoute'));

 

//////////////// Doctor Routes ///////////////////////
app.use('/api/auth/doctor', require('./routes/doctor/authDoctor'));
app.use('/doctor/appointments', require('./routes/doctor/AppointmentRoute')); // Doctor Appointments Route

//////////////// Hospital Routes /////////////////////
app.use('/api/auth/hospital', require('./routes/hospital/authHospital'));
app.use('/api/hospital/doctors', require('./routes/hospital/hospitalDoctor/hosDoctorRoute')); // Hospital Doctor Management
app.use('/hospital/doctor/appointments', require('./routes/hospital/hospitalDoctor/hosAppointment')); // Hospital Doctor Appointments Route
app.use('/api/hospital/ambulance', require('./routes/hospital/hospitalAmbulance/hosAmbulanceRoute')); // Hospital Ambulance Management

//////////////// Provider Routes /////////////////////
app.use('/api/auth/provider', require('./routes/provider/authProvider'));
app.use('/provider/wallet', require('./routes/provider/Common/WalletRoute')); // Wallet Management Route (Withdrawals)
app.use('/provider/promotions', require('./routes/provider/Common/CouponRoute')); // Promotions & Coupon Management Route
app.use('/provider/availability', require('./routes/provider/Common/AvailabilityRoute')); // Availability Management Route (Doctors, Labs, Ambulances)
// --- Provider Lab Routes ---
app.use('/provider/labs', require('./routes/provider/Lab/LabOrderRoute')); // Lab Order Management
app.use('/provider/labs/services', require('./routes/provider/Lab/LabsServiceRoute')); // Lab Test Management

// --- Provider Pharmacy Routes ---

// --- Provider Nurse Routes ---


//////////////// Ambulance Routes /////////////////////
app.use('/api/auth/ambulance', require('./routes/ambulance/authAmbulance'));

//////////////// others Routes or public routes  /////////////////////
app.use('/api/public', require('./routes/others/locationRoutes'));
app.use('/api/password', require('./routes/others/forgotPassword'));

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


app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIpAddress(); // IP Function call kiya
    // console.log(`🚀 Server running on port ${PORT}`);
    // console.log(`📡 Access locally: http://localhost:${PORT}`);
    console.log(`🌍 Access on Network: http://${ip}:${PORT}`); // Ab ye real IP dikhayega
});