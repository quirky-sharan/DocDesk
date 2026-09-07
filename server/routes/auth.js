const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');

// POST /api/auth/register
router.post('/register', auth.register);

// POST /api/auth/login
router.post('/login', auth.login);

module.exports = router;
