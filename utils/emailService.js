const SibApiV3Sdk = require('sib-api-v3-sdk');

const sendEmailOTP = async (email, otp) => {
    try {
        const defaultClient = SibApiV3Sdk.ApiClient.instance;
        const apiKey = defaultClient.authentications['api-key'];
        
        // Aapki API Key
        apiKey.apiKey = process.env.BREVO_API_KEY; 

        const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

        sendSmtpEmail.subject = "Your OTP - Health Kangaroo";
        sendSmtpEmail.htmlContent = `Your OTP is: <b>${otp}</b>`;
        
        // Sender MUST be verified in Brevo
        sendSmtpEmail.sender = { "name": "Health Kangaroo", "email": "noreply@healthkangaroo.com" };
        sendSmtpEmail.to = [{ "email": email }];

        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('✅ Success! Email sent. MessageId:', data.messageId);
        return true;
    } catch (error) {
        if (error.response && error.response.body) {
            console.error('❌ BREVO ERROR:', error.response.body.message);
        } else {
            console.error('❌ ERROR:', error.message);
        }
        return false; // Email fail hone par false return karega
    }
};

module.exports = { sendEmailOTP };