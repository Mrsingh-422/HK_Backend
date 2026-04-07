// config/constants.js
module.exports = {
    // Agar LOCAL hai to: /uploads/users/123.jpg
    // Agar S3 hai to: https://my-bucket.s3.amazonaws.com/uploads/users/123.jpg
    BASE_FILE_URL: process.env.NODE_ENV === 'production' 
        ? 'https://your-s3-bucket-url.com' 
        : 'http://localhost:5002' 
};