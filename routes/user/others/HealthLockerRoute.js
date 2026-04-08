const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { lockerUpload } = require('../../../middleware/multer');
const { 
    verifyLockerPin, createFolder, uploadFile, 
    getLockerContent, renameItem, deleteItem, addMorePages 
} = require('../../../controllers/user/others/HealthLocker');

// Base: /api/user/locker

// Security
router.post('/verify-pin', protect('user'), verifyLockerPin);

// Content Discovery (Root/Folder Content)
router.get('/content', protect('user'), getLockerContent); 

// Create Folders & Files
router.post('/create-folder', protect('user'), createFolder);
router.post('/upload-file', protect('user'), lockerUpload.array('images', 10), uploadFile);

// Edit & Delete
router.patch('/rename/:id', protect('user'), renameItem);
router.delete('/delete/:id', protect('user'), deleteItem);

// Extra Pages (Figma Screen 11)
router.put('/add-pages/:id', protect('user'), lockerUpload.array('images', 10), addMorePages);

module.exports = router;