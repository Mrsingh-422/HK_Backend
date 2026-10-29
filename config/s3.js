// config/s3.js
const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config();

// Check if AWS S3 credentials exist in .env
const hasAwsCredentials = Boolean(
    process.env.AWS_ACCESS_KEY_ID && 
    process.env.AWS_SECRET_ACCESS_KEY && 
    process.env.AWS_S3_BUCKET_NAME
);

let s3Client = null;

if (hasAwsCredentials) {
    s3Client = new S3Client({
        region: process.env.AWS_REGION || 'ap-south-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
    console.log("☁️ [AWS S3]: S3 Client initialized for bucket:", process.env.AWS_S3_BUCKET_NAME);
} else {
    console.log("📁 [Storage]: Local disk storage active (AWS S3 credentials not set in .env).");
}

module.exports = { s3Client, hasAwsCredentials };