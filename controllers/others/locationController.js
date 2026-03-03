// Data files import (Path adjust kiya hai aapke structure ke hisab se)
// Root folder me 'data' folder hona chahiye
const countries = require('../../data/countries.json');
const states = require('../../data/states.json');
const cities = require('../../data/cities.json');

// --- 1. GET COUNTRIES ---
// endpoint: GET /api/public/countries
const getCountries = (req, res) => {
    try {
        // Sirf jaruri fields bhejne ke liye map karein
        const list = countries.map(c => ({
            id: c.id,
            name: c.name,
            phonecode: c.phonecode,
            sortname: c.sortname
        }));
        res.status(200).json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: "Error fetching countries" });
    }
};

// --- 2. GET STATES (By Country ID) ---
// endpoint: GET /api/public/states?country_id=101
const getStates = (req, res) => {
    try {
        const { country_id } = req.query; // ?country_id=101

        if (!country_id) {
            return res.status(400).json({ message: "Country ID is required" });
        }

        // Filter States
        // Note: JSON me ID kabhi number hoti hai kabhi string, isliye '==' use kiya (safe side)
        const list = states.filter(s => s.country_id == country_id).map(s => ({
            id: s.id,
            name: s.name,
            country_id: s.country_id
        }));

        res.status(200).json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: "Error fetching states" });
    }
};

// --- 3. GET CITIES (By State ID) ---
// endpoint: GET /api/public/cities?state_id=38
const getCities = (req, res) => {
    try {
        const { state_id } = req.query; // ?state_id=38

        if (!state_id) {
            return res.status(400).json({ message: "State ID is required" });
        }

        // Filter Cities
        const list = cities.filter(c => c.state_id == state_id).map(c => ({
            id: c.id,
            name: c.name,
            state_id: c.state_id
        }));

        res.status(200).json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: "Error fetching cities" });
    }
};

module.exports = { getCountries, getStates, getCities };