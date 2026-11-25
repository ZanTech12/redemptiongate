
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ===================================================================
// AUTH ROUTES
// ===================================================================

// @route   POST /login
// @desc    General Login (superadmin, admin, teacher, student)
router.post('/', authController.login);

// @route   POST /login/superadmin
// @desc    Dedicated SuperAdmin Login
router.post('/superadmin', authController.loginSuperAdmin);

// @route   POST /login/admin
// @desc    Dedicated Admin Login (checks expiry and active status)
router.post('/admin', authController.loginAdmin);

// @route   POST /login/teacher
// @desc    Dedicated Teacher Login (tracks last login IP/device)
router.post('/teacher', authController.loginTeacher);

// @route   POST /login/student
// @desc    Dedicated Student Login (checks fees and admission number)
router.post('/student', authController.loginStudent);

// ===================================================================
// REFRESH TOKEN ROUTES
// ===================================================================

// @route   POST /login/refresh
// @desc    Validate and rotate refresh token
router.post('/refresh', authController.refreshToken);

// ===================================================================
// LOGOUT ROUTES
// ===================================================================

// @route   POST /login/logout
// @desc    Revoke refresh token
router.post('/logout', authController.logout);

module.exports = router;
