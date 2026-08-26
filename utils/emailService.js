// utils/emailService.js
// const SibApiV3Sdk = require('sib-api-v3-sdk');

// /**
//  * Sends a 6-digit OTP for Password Reset via Brevo API
//  * @param {string} email - Recipient email address
//  * @param {string} otp - 6-digit verification code
//  */
// const sendEmailOTP = async (email, otp) => {
//     try {
//         const apiKey = process.env.BREVO_API_KEY;
//         const senderEmail = process.env.BREVO_SENDER_EMAIL || "noreply@healthkangaroo.com";
//         const senderName = process.env.BREVO_SENDER_NAME || "Health Kangaroo";

//         if (!apiKey) {
//             console.error("❌ Brevo Error: BREVO_API_KEY is missing in .env file!");
//             return false;
//         }

//         // Brevo Client Configuration
//         const defaultClient = SibApiV3Sdk.ApiClient.instance;
//         const apiKeyAuth = defaultClient.authentications['api-key'];
//         apiKeyAuth.apiKey = apiKey;

//         const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
//         const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

//         sendSmtpEmail.subject = "Your Password Reset OTP - Health Kangaroo";
//         sendSmtpEmail.sender = { 
//             name: senderName, 
//             email: senderEmail 
//         };
//         sendSmtpEmail.to = [{ email: email.toLowerCase().trim() }];

//         // 🎨 Branded Health Kangaroo HTML Email Template
//         sendSmtpEmail.htmlContent = `
//         <!DOCTYPE html>
//         <html>
//         <head>
//             <meta charset="utf-8">
//             <meta name="viewport" content="width=device-width, initial-scale=1.0">
//             <title>Password Reset OTP</title>
//         </head>
//         <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
//             <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 10px;">
//                 <tr>
//                     <td align="center">
//                         <table role="presentation" width="100%" max-width="500" style="max-width: 500px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid #f1f5f9;">
                            
//                             <!-- Header -->
//                             <tr>
//                                 <td align="center" style="padding: 35px 30px 20px; background-color: #ffffff;">
//                                     <div style="display: inline-block; width: 60px; height: 60px; line-height: 60px; border-radius: 20px; background-color: #ecfdf5; color: #059669; font-size: 28px; text-align: center;">
//                                         🦘
//                                     </div>
//                                     <h2 style="margin: 15px 0 5px; color: #0f172a; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">Health Kangaroo</h2>
//                                     <p style="margin: 0; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">One-Stop Healthcare Solution</p>
//                                 </td>
//                             </tr>

//                             <!-- Body Content -->
//                             <tr>
//                                 <td style="padding: 10px 35px 30px; text-align: center;">
//                                     <h3 style="margin: 0 0 10px; color: #1e293b; font-size: 18px; font-weight: 700;">Password Reset Request</h3>
//                                     <p style="margin: 0 0 25px; color: #64748b; font-size: 14px; line-height: 22px;">
//                                         We received a request to reset your password. Use the verification code below to proceed:
//                                     </p>

//                                     <!-- 6-Digit OTP Box -->
//                                     <div style="background: #f0fdf4; border: 2px dashed #86efac; border-radius: 16px; padding: 18px 10px; margin-bottom: 25px;">
//                                         <span style="font-size: 32px; font-weight: 800; color: #059669; letter-spacing: 8px; font-family: monospace;">
//                                             ${otp}
//                                         </span>
//                                     </div>

//                                     <p style="margin: 0 0 5px; color: #64748b; font-size: 13px;">
//                                         ⏱️ This code is valid for <b>10 minutes</b>.
//                                     </p>
//                                     <p style="margin: 0; color: #94a3b8; font-size: 12px;">
//                                         If you didn't request a password reset, you can safely ignore this email.
//                                     </p>
//                                 </td>
//                             </tr>

//                             <!-- Footer -->
//                             <tr>
//                                 <td style="padding: 20px 30px; background-color: #f8fafc; text-align: center; border-top: 1px solid #f1f5f9;">
//                                     <p style="margin: 0; color: #94a3b8; font-size: 11px;">
//                                         © ${new Date().getFullYear()} Health Kangaroo. All rights reserved.
//                                     </p>
//                                 </td>
//                             </tr>

//                         </table>
//                     </td>
//                 </tr>
//             </table>
//         </body>
//         </html>
//         `;

//         const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
//         console.log(`✅ [BREVO EMAIL SUCCESS] OTP sent to: ${email} | MessageId: ${data.messageId}`);
//         return true;

//     } catch (error) {
//         if (error.response && error.response.body) {
//             console.error('❌ [BREVO API ERROR]:', error.response.body.message || error.response.body);
//         } else {
//             console.error('❌ [BREVO ERROR]:', error.message);
//         }
//         return false;
//     }
// };

// module.exports = { sendEmailOTP };


// utils/emailService.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a 6-digit OTP for Password Reset via Resend API
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit verification code
 */
const sendEmailOTP = async (email, otp) => {
    try {
        const apiKey = process.env.RESEND_API_KEY;
        const senderEmail = process.env.RESEND_SENDER_EMAIL || "onboarding@resend.dev";

        if (!apiKey) {
            console.error("❌ Resend Error: RESEND_API_KEY is missing in .env file!");
            return false;
        }

        const { data, error } = await resend.emails.send({
            from: `Health Kangaroo <${senderEmail}>`,
            to: [email.toLowerCase().trim()],
            subject: "Your Password Reset OTP - Health Kangaroo",
            html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 10px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="100%" style="max-width: 500px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid #f1f5f9;">
                                
                                <!-- Header -->
                                <tr>
                                    <td align="center" style="padding: 35px 30px 20px;">
                                        <div style="display: inline-block; width: 60px; height: 60px; line-height: 60px; border-radius: 20px; background-color: #ecfdf5; color: #059669; font-size: 28px; text-align: center;">
                                            🦘
                                        </div>
                                        <h2 style="margin: 15px 0 5px; color: #0f172a; font-size: 22px; font-weight: 800;">Health Kangaroo</h2>
                                        <p style="margin: 0; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">One-Stop Healthcare Solution</p>
                                    </td>
                                </tr>

                                <!-- Body -->
                                <tr>
                                    <td style="padding: 10px 35px 30px; text-align: center;">
                                        <h3 style="margin: 0 0 10px; color: #1e293b; font-size: 18px; font-weight: 700;">Password Reset Request</h3>
                                        <p style="margin: 0 0 25px; color: #64748b; font-size: 14px; line-height: 22px;">
                                            We received a request to reset your password. Use the verification code below to proceed:
                                        </p>

                                        <!-- OTP Box -->
                                        <div style="background: #f0fdf4; border: 2px dashed #86efac; border-radius: 16px; padding: 18px 10px; margin-bottom: 25px;">
                                            <span style="font-size: 32px; font-weight: 800; color: #059669; letter-spacing: 8px; font-family: monospace;">
                                                ${otp}
                                            </span>
                                        </div>

                                        <p style="margin: 0 0 5px; color: #64748b; font-size: 13px;">
                                            ⏱️ This code is valid for <b>10 minutes</b>.
                                        </p>
                                        <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                                            If you didn't request this, you can safely ignore this email.
                                        </p>
                                    </td>
                                </tr>

                                <!-- Footer -->
                                <tr>
                                    <td style="padding: 20px 30px; background-color: #f8fafc; text-align: center; border-top: 1px solid #f1f5f9;">
                                        <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                                            © ${new Date().getFullYear()} Health Kangaroo. All rights reserved.
                                        </p>
                                    </td>
                                </tr>

                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
            `
        });

        if (error) {
            console.error("❌ [RESEND API ERROR]:", error.message);
            return false;
        }

        console.log(`✅ [RESEND EMAIL SUCCESS] OTP sent to: ${email} | EmailId: ${data.id}`);
        return true;

    } catch (err) {
        console.error("❌ [RESEND SYSTEM ERROR]:", err.message);
        return false;
    }
};

module.exports = { sendEmailOTP };