// // utils/chatSocket.js
// const Appointment = require('../models/Appointment');
// const Message = require('../models/Message');

// const chatSocketHandler = (io) => {
//     io.on('connection', (socket) => {
//         console.log(`🔌 Socket Connected: ${socket.id}`);

//         // 1. Join Chat Room (Dono patient aur doctor appointmentId room join karenge)
//         socket.on('join_room', ({ appointmentId }) => {
//             socket.join(appointmentId);
//             console.log(`👤 User joined room: ${appointmentId}`);
//         });

//         // 2. Send Message (With Status check validation)
//         socket.on('send_message', async (data) => {
//             try {
//                 const { appointmentId, senderId, senderType, text } = data;

//                 // 🚨 CRITICAL RULE: Check karein kya appointment active (In-Progress) hai?
//                 const appointment = await Appointment.findById(appointmentId);
                
//                 if (!appointment) {
//                     socket.emit('error_response', { message: "Appointment record not found." });
//                     return;
//                 }

//                 // Chat timing restriction logic
//                 if (appointment.status !== 'In-Progress') {
//                     socket.emit('error_response', { 
//                         message: "Chat has expired. You can only chat while the appointment is In-Progress." 
//                     });
//                     return;
//                 }

//                 // Agar in-progress hai, toh message save karein aur broadcast karein
//                 const newMessage = await Message.create({
//                     appointmentId,
//                     senderId,
//                     senderType,
//                     text
//                 });

//                 // Chat room me baaki log (Doctor/User) ko real-time forward karein
//                 io.to(appointmentId).emit('receive_message', newMessage);

//             } catch (error) {
//                 console.error("Socket send_message error:", error);
//                 socket.emit('error_response', { message: error.message });
//             }
//         });

//         socket.on('disconnect', () => {
//             console.log(`❌ Socket Disconnected: ${socket.id}`);
//         });
//     });
// };

// module.exports = chatSocketHandler;






// @desc    Socket.io Chat Handler with JWT Authentication & In-Progress Verification
const jwt = require('jsonwebtoken');
const Appointment = require('../models/Appointment');
const Message = require('../models/Message');

const chatSocketHandler = (io) => {
    // 🚨 1. SOCKET JWT AUTHENTICATION MIDDLEWARE
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
        if (!token) {
            return next(new Error("Authentication error: Token required to establish chat connection."));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded; // Contains user ID & role
            next();
        } catch (err) {
            return next(new Error("Authentication error: Invalid or expired token."));
        }
    });

    io.on('connection', (socket) => {
        console.log(`🔌 [Authenticated Socket Connected]: ${socket.id} (User: ${socket.user?.id})`);

        // 2. Join Appointment Chat Room
        socket.on('join_room', async ({ appointmentId }) => {
            if (!appointmentId) return;

            // Security check: User must be either the patient or the doctor of this appointment
            const appointment = await Appointment.findById(appointmentId).select('userId doctorId status');
            if (!appointment) {
                socket.emit('error_response', { message: "Appointment not found." });
                return;
            }

            const currentUserId = String(socket.user.id);
            const isAuthorized = String(appointment.userId) === currentUserId || String(appointment.doctorId) === currentUserId;

            if (!isAuthorized) {
                socket.emit('error_response', { message: "Unauthorized: You are not part of this medical consultation." });
                return;
            }

            socket.join(appointmentId);
            console.log(`👤 User ${currentUserId} securely joined room: ${appointmentId}`);
        });

        // 3. Send Message with Appointment Status Lock
        socket.on('send_message', async (data) => {
            try {
                const { appointmentId, text } = data;
                const senderId = socket.user.id;
                const senderType = socket.user.role === 'doctor' || socket.user.role === 'hospital-doctor' ? 'Doctor' : 'User';

                const appointment = await Appointment.findById(appointmentId);
                if (!appointment) {
                    socket.emit('error_response', { message: "Appointment record not found." });
                    return;
                }

                if (appointment.status !== 'In-Progress') {
                    socket.emit('error_response', { 
                        message: "Chat session closed. Consultation is no longer active." 
                    });
                    return;
                }

                const newMessage = await Message.create({
                    appointmentId,
                    senderId,
                    senderType,
                    text
                });

                io.to(appointmentId).emit('receive_message', newMessage);

            } catch (error) {
                console.error("Socket send_message error:", error);
                socket.emit('error_response', { message: error.message });
            }
        });

        socket.on('disconnect', () => {
            console.log(`❌ Socket Disconnected: ${socket.id}`);
        });
    });
};

module.exports = chatSocketHandler;