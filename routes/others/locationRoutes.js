const express = require('express');
const router = express.Router();
const { getCountries, getStates, getCities } = require('../../controllers/others/locationController');

// Public Routes (Isme koi Token check nahi hoga)
router.get('/countries', getCountries);
router.get('/states', getStates);
router.get('/cities', getCities);

module.exports = router;