// utils/chatSocket.js
const Appointment = require('../models/Appointment');
const Message = require('../models/Message');

const chatSocketHandler = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Socket Connected: ${socket.id}`);

        // 1. Join Chat Room (Dono patient aur doctor appointmentId room join karenge)
        socket.on('join_room', ({ appointmentId }) => {
            socket.join(appointmentId);
            console.log(`👤 User joined room: ${appointmentId}`);
        });

        // 2. Send Message (With Status check validation)
        socket.on('send_message', async (data) => {
            try {
                const { appointmentId, senderId, senderType, text } = data;

                // 🚨 CRITICAL RULE: Check karein kya appointment active (In-Progress) hai?
                const appointment = await Appointment.findById(appointmentId);
                
                if (!appointment) {
                    socket.emit('error_response', { message: "Appointment record not found." });
                    return;
                }

                // Chat timing restriction logic
                if (appointment.status !== 'In-Progress') {
                    socket.emit('error_response', { 
                        message: "Chat has expired. You can only chat while the appointment is In-Progress." 
                    });
                    return;
                }

                // Agar in-progress hai, toh message save karein aur broadcast karein
                const newMessage = await Message.create({
                    appointmentId,
                    senderId,
                    senderType,
                    text
                });

                // Chat room me baaki log (Doctor/User) ko real-time forward karein
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