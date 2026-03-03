// const User = require('../models/User');
// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
// const config = require('../../config/config');

// const generateToken = (id) => {
//     return jwt.sign({ id }, config.JWT_SECRET, { expiresIn: '30d' });
// };

// // @desc    Login user (Common for all roles)
// // @route   POST /api/auth/login
// // @access  Public
// const loginUser = async (req, res) => {
//     try {
//         const { email, phone, password } = req.body;

//         // Validation
//         if (!email && !phone) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Please provide Email or Phone to login'
//             });
//         }

//         if (!password) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Please provide password'
//             });
//         }

//         // Find user
//         let query = {};
//         if (email) query.email = email;
//         if (phone) query.phone = phone;

//         const user = await User.findOne(query).select('+password');
        
//         if (!user) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Invalid credentials'
//             });
//         }

//         // Check password
//         const isMatch = await bcrypt.compare(password, user.password);
//         if (!isMatch) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Invalid credentials'
//             });
//         }

//         // Check approval status for non-patient/non-admin roles
//         if (['doctor', 'hospital', 'provider'].includes(user.role)) {
//             if (user.profileStatus === 'Pending') {
//                 return res.status(403).json({
//                     success: false,
//                     message: 'Your account is pending approval. Please wait for admin verification.',
//                     status: 'PENDING'
//                 });
//             }
//             if (user.profileStatus === 'Rejected') {
//                 return res.status(403).json({
//                     success: false,
//                     message: user.rejectionReason || 'Your application has been rejected.',
//                     status: 'REJECTED',
//                     reason: user.rejectionReason
//                 });
//             }
//         }

//         // Remove password from response
//         user.password = undefined;

//         res.json({
//             success: true,
//             message: 'Login successful',
//             token: generateToken(user._id),
//             user: {
//                 id: user._id,
//                 email: user.email,
//                 phone: user.phone,
//                 role: user.role,
//                 status: user.profileStatus
//             }
//         });

//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };

// module.exports = { loginUser };