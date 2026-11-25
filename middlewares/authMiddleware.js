
const jwt = require('jsonwebtoken');

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

exports.authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');

        console.log('\n========== AUTHENTICATION CHECK ==========');
        console.log('METHOD:', req.method);
        console.log('URL:', req.originalUrl);
        console.log(
            '[DEBUG Auth] Authorization Header:',
            authHeader
                ? authHeader.substring(0, 30) + '...'
                : 'MISSING'
        );

        let token = null;

        // ----------------------------------------------------
        // 1. Extract token from Authorization header
        // ----------------------------------------------------

        if (authHeader) {
            const parts = authHeader.trim().split(/\s+/);

            if (
                parts.length === 2 &&
                parts[0].toLowerCase() === 'bearer'
            ) {
                token = parts[1];
            }
        }

        // ----------------------------------------------------
        // 2. Fallback to query parameter
        // Used by WebBrowser/PDF viewers
        // ----------------------------------------------------

        if (!token && req.query && req.query.token) {
            token = req.query.token;

            console.log(
                '[DEBUG Auth] SUCCESS: Found token in URL query parameter.'
            );
        }

        // ----------------------------------------------------
        // 3. Check whether token exists
        // ----------------------------------------------------

        if (!token) {
            console.log('[DEBUG Auth] FAILED: No token provided');
            console.log('==========================================\n');

            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        // ----------------------------------------------------
        // 4. Verify JWT
        // ----------------------------------------------------

        if (!process.env.JWT_SECRET) {
            console.error(
                '[DEBUG Auth] FAILED: JWT_SECRET is not configured.'
            );

            return res.status(500).json({
                success: false,
                message: 'Authentication configuration error.'
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // ----------------------------------------------------
        // 5. Normalize decoded user information
        // ----------------------------------------------------

        const user =
            decoded.user && typeof decoded.user === 'object'
                ? decoded.user
                : decoded;

        const normalizedRole = String(
            user.role || ''
        ).trim().toLowerCase();

        req.user = {
            ...user,
            role: normalizedRole
        };

        // ----------------------------------------------------
        // 6. Authentication diagnostics
        // ----------------------------------------------------

        console.log('[DEBUG Auth] SUCCESS: Token verified.');
        console.log('USER ID:', req.user.id || req.user.userId || 'N/A');
        console.log('USER ROLE:', req.user.role || 'MISSING');
        console.log('ADMIN ID:', req.user.adminId || 'N/A');
        console.log('SCHOOL CODE:', req.user.schoolCode || 'N/A');
        console.log('==========================================\n');

        return next();

    } catch (error) {
        console.error(
            '\n[DEBUG Auth] FAILED:',
            error.message
        );

        console.log('METHOD:', req.method);
        console.log('URL:', req.originalUrl);
        console.log('==========================================\n');

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token has expired. Please log in again.',
                code: 'TOKEN_EXPIRED'
            });
        }

        return res.status(401).json({
            success: false,
            message: 'Token is not valid.'
        });
    }
};


// ============================================================
// TEACHER OR ADMIN MIDDLEWARE
// ============================================================

exports.isTeacherOrAdmin = (req, res, next) => {

    const role = String(
        req.user?.role || ''
    ).trim().toLowerCase();

    console.log('\n========== TEACHER/ADMIN ROLE CHECK ==========');
    console.log('METHOD:', req.method);
    console.log('URL:', req.originalUrl);
    console.log('USER ID:', req.user?.id || 'N/A');
    console.log('USER ROLE:', role);
    console.log('==============================================\n');

    if (!['teacher', 'admin', 'superadmin'].includes(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Teacher or Admin role required.'
        });
    }

    return next();
};


// ============================================================
// ADMIN OR SUPERADMIN MIDDLEWARE
// ============================================================

exports.isAdmin = (req, res, next) => {

    const role = String(
        req.user?.role || ''
    ).trim().toLowerCase();

    // Diagnostic: identifies exactly which route invokes isAdmin
    console.log('\n========== ADMIN MIDDLEWARE HIT ==========');
    console.log('METHOD:', req.method);
    console.log('ORIGINAL URL:', req.originalUrl);
    console.log('BASE URL:', req.baseUrl);
    console.log('PATH:', req.path);
    console.log('USER ID:', req.user?.id || 'N/A');
    console.log('USER ROLE:', role || 'MISSING');
    console.log('ADMIN ID:', req.user?.adminId || 'N/A');
    console.log('SCHOOL CODE:', req.user?.schoolCode || 'N/A');
    console.log('==========================================\n');

    if (!['admin', 'superadmin'].includes(role)) {
        console.error(
            '[DEBUG Auth] ADMIN ACCESS DENIED:',
            req.method,
            req.originalUrl,
            'ROLE:',
            role
        );

        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin role required.'
        });
    }

    console.log(
        '[DEBUG Auth] ADMIN ACCESS GRANTED:',
        req.originalUrl
    );

    return next();
};


// ============================================================
// SUPERADMIN MIDDLEWARE
// ============================================================

exports.isSuperAdmin = (req, res, next) => {

    const role = String(
        req.user?.role || ''
    ).trim().toLowerCase();

    console.log('\n========== SUPERADMIN ROLE CHECK ==========');
    console.log('METHOD:', req.method);
    console.log('URL:', req.originalUrl);
    console.log('USER ID:', req.user?.id || 'N/A');
    console.log('USER ROLE:', role);
    console.log('===========================================\n');

    if (role !== 'superadmin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. SuperAdmin role required.'
        });
    }

    return next();
};
