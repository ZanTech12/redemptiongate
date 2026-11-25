
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/db');

// ===================================================================
// CONFIGURATION
// ===================================================================

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

const SCHOOL_DOMAIN_SUFFIXES = [
    '.okispecial.com.ng',
    '.fountainhillsschools.com.ng',
    '.lvh.me',
    '.nip.io',
];

// ===================================================================
// HELPER: JWT SECRET
// ===================================================================

const getJwtSecret = () => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured.');
    }

    return process.env.JWT_SECRET;
};

// ===================================================================
// HELPER: EXTRACT SCHOOL CODE FROM SUBDOMAIN
// ===================================================================

const getSchoolCodeFromSubdomain = (req) => {
    let host = (
        req.headers['x-forwarded-host'] ||
        req.headers.host ||
        ''
    ).toLowerCase().trim();

    host = host.split(':')[0];

    // Ignore localhost and raw IP addresses
    if (
        host.includes('localhost') ||
        host.match(/^(\d{1,3}\.){3}\d{1,3}$/)
    ) {
        return null;
    }

    // Never treat Vercel domains as school subdomains
    if (host.endsWith('.vercel.app')) {
        return null;
    }

    const suffix = SCHOOL_DOMAIN_SUFFIXES.find(s =>
        host.endsWith(s)
    );

    if (!suffix) return null;

    const sub = host.slice(0, host.length - suffix.length);

    if (sub && sub !== 'www' && !sub.includes('.')) {
        return sub.toLowerCase().trim();
    }

    return null;
};

// ===================================================================
// HELPER: CHECK EXPIRY STATUS
// ===================================================================

const checkExpiryStatus = async (admin) => {
    if (admin.expiryDate && new Date() > admin.expiryDate) {
        if (admin.isActive) {
            await prisma.admin.update({
                where: { id: admin.id },
                data: {
                    isActive: false,
                    deactivatedAt: new Date()
                }
            });
        }

        return false;
    }

    return admin.isActive;
};

// ===================================================================
// HELPER: HASH REFRESH TOKEN
// ===================================================================

const hashRefreshToken = (token) => {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
};

// ===================================================================
// HELPER: CREATE ACCESS + REFRESH TOKENS
// ===================================================================

const createAuthTokens = async ({
    userId,
    role,
    adminId = null,
    payload = {},
    deviceId = null
}) => {
    const secret = getJwtSecret();

    const accessToken = jwt.sign(
        {
            ...payload,
            id: userId,
            role
        },
        secret,
        {
            expiresIn: ACCESS_TOKEN_EXPIRY
        }
    );

    // Refresh token is a cryptographically random bearer token.
    const refreshToken = crypto.randomBytes(64).toString('hex');

    const tokenHash = hashRefreshToken(refreshToken);

    const tokenFamilyId = crypto.randomUUID();

    const expiresAt = new Date(
        Date.now() +
        REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    await prisma.refreshToken.create({
        data: {
            tokenHash,
            tokenFamilyId,
            userId,
            role,
            adminId,
            deviceId,
            expiresAt
        }
    });

    return {
        token: accessToken,
        refreshToken
    };
};

// ===================================================================
// HELPER: REVOKE REFRESH TOKEN FAMILY
// ===================================================================

const revokeTokenFamily = async (tokenFamilyId) => {
    if (!tokenFamilyId) return;

    await prisma.refreshToken.updateMany({
        where: {
            tokenFamilyId,
            revokedAt: null
        },
        data: {
            revokedAt: new Date()
        }
    });
};

// ===================================================================
// HELPER: BUILD DEVICE ID
// ===================================================================

const getDeviceId = (req) => {
    const deviceId = req.body?.deviceId;

    if (typeof deviceId !== 'string') {
        return null;
    }

    const cleanDeviceId = deviceId.trim();

    return cleanDeviceId
        ? cleanDeviceId.slice(0, 200)
        : null;
};

// ===================================================================
// HELPER: GET SCHOOL FOR REFRESH
// ===================================================================

const getActiveSchool = async (adminId) => {
    if (!adminId) return null;

    const school = await prisma.admin.findUnique({
        where: {
            id: adminId
        }
    });

    if (!school) return null;

    const isActive = await checkExpiryStatus(school);

    if (!isActive || !school.isActive) {
        return null;
    }

    return school;
};

// ===================================================================
// HELPER: BUILD REFRESHED USER PAYLOAD
// ===================================================================

const getCurrentUserForRefresh = async (session) => {
    const role = String(session.role || '').toLowerCase();

    // ---------------------------------------------------------------
    // SUPERADMIN
    // ---------------------------------------------------------------

    if (role === 'superadmin') {
        const user = await prisma.superAdmin.findUnique({
            where: {
                id: session.userId
            }
        });

        if (!user) return null;

        return {
            userId: user.id,
            role: 'superadmin',
            payload: {
                name: user.username
            },
            userData: {
                _id: user.id,
                username: user.username,
                name: user.username,
                role: 'superadmin'
            }
        };
    }

    // ---------------------------------------------------------------
    // ADMIN
    // ---------------------------------------------------------------

    if (role === 'admin') {
        const admin = await prisma.admin.findUnique({
            where: {
                id: session.userId
            }
        });

        if (!admin) return null;

        const isActive = await checkExpiryStatus(admin);

        if (!isActive || !admin.isActive) {
            return null;
        }

        return {
            userId: admin.id,
            role: 'admin',
            adminId: admin.id,
            payload: {
                name: admin.name,
                schoolCode: admin.schoolCode,
                allowedFeatures: admin.allowedFeatures,
                networkSettings: admin.networkSettings
            },
            userData: {
                _id: admin.id,
                name: admin.name,
                username: admin.username,
                schoolName: admin.schoolName,
                schoolCode: admin.schoolCode,
                adminId: admin.id,
                role: 'admin',
                allowedFeatures: admin.allowedFeatures,
                networkSettings: admin.networkSettings
            }
        };
    }

    // ---------------------------------------------------------------
    // TEACHER
    // ---------------------------------------------------------------

    if (role === 'teacher') {
        const teacher = await prisma.teacher.findUnique({
            where: {
                id: session.userId
            }
        });

        if (!teacher) return null;

        if (
            session.adminId &&
            teacher.adminId !== session.adminId
        ) {
            return null;
        }

        const school = await getActiveSchool(teacher.adminId);

        if (!school) return null;

        return {
            userId: teacher.id,
            role: 'teacher',
            adminId: teacher.adminId,
            payload: {
                adminId: teacher.adminId,
                schoolCode: school.schoolCode,
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            },
            userData: {
                _id: teacher.id,
                adminId: teacher.adminId,
                schoolCode: school.schoolCode,
                username: teacher.username,
                firstName: teacher.firstName,
                lastName: teacher.lastName,
                role: 'teacher',
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            }
        };
    }

    // ---------------------------------------------------------------
    // STUDENT
    // ---------------------------------------------------------------

    if (role === 'student') {
        const student = await prisma.student.findUnique({
            where: {
                id: session.userId
            }
        });

        if (!student || student.isDeleted) {
            return null;
        }

        if (
            session.adminId &&
            student.adminId !== session.adminId
        ) {
            return null;
        }

        const school = await getActiveSchool(student.adminId);

        if (!school) return null;

        if (student.owingFees && !student.feesAccessGranted) {
            return null;
        }

        return {
            userId: student.id,
            role: 'student',
            adminId: student.adminId,
            payload: {
                adminId: student.adminId,
                schoolCode: school.schoolCode,
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            },
            userData: {
                _id: student.id,
                adminId: student.adminId,
                schoolCode: school.schoolCode,
                firstName: student.firstName,
                lastName: student.lastName,
                admissionNumber: student.admissionNumber,
                role: 'student',
                profileImage: student.profileImage || null,
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            }
        };
    }

    return null;
};

// ===================================================================
// 1. GENERAL LOGIN (ALL ROLES)
// ===================================================================

exports.login = async (req, res) => {
    const { role, ...credentials } = req.body;

    try {
        let user;

        console.log(
            `[LOGIN] role=${role} username=${JSON.stringify(credentials.username)}`
        );

        // -----------------------------------------------------------
        // SUPERADMIN LOGIN
        // -----------------------------------------------------------

        if (role === 'superadmin') {
            const cleanUsername = String(
                credentials.username || ''
            ).trim();

            user = await prisma.superAdmin.findFirst({
                where: {
                    username: {
                        equals: cleanUsername,
                        mode: 'insensitive'
                    }
                }
            });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'SuperAdmin not found'
                });
            }

            const isMatch = await bcrypt.compare(
                credentials.password,
                user.password
            );

            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Password mismatch'
                });
            }

            const tokens = await createAuthTokens({
                userId: user.id,
                role: 'superadmin',
                payload: {
                    name: user.username
                },
                deviceId: getDeviceId(req)
            });

            return res.json({
                success: true,
                ...tokens,
                user: {
                    _id: user.id,
                    name: user.username,
                    role: 'superadmin'
                }
            });
        }

        // -----------------------------------------------------------
        // ADMIN LOGIN
        // -----------------------------------------------------------

        else if (role === 'admin') {
            const cleanUsername = String(
                credentials.username || ''
            ).trim();

            user = await prisma.admin.findFirst({
                where: {
                    username: {
                        equals: cleanUsername,
                        mode: 'insensitive'
                    }
                }
            });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Admin not found'
                });
            }

            const isMatch = await bcrypt.compare(
                credentials.password,
                user.password
            );

            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Password mismatch'
                });
            }

            const isActive = await checkExpiryStatus(user);

            if (!isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Account deactivated due to subscription expiry.'
                });
            }

            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Account deactivated by SuperAdmin.'
                });
            }

            const tokens = await createAuthTokens({
                userId: user.id,
                role: 'admin',
                adminId: user.id,
                payload: {
                    name: user.name,
                    schoolCode: user.schoolCode,
                    allowedFeatures: user.allowedFeatures,
                    networkSettings: user.networkSettings
                },
                deviceId: getDeviceId(req)
            });

            return res.json({
                success: true,
                ...tokens,
                user: {
                    _id: user.id,
                    name: user.name,
                    username: user.username,
                    role: 'admin',
                    schoolName: user.schoolName,
                    schoolCode: user.schoolCode,
                    adminId: user.id,
                    allowedFeatures: user.allowedFeatures,
                    networkSettings: user.networkSettings
                }
            });
        }

        // -----------------------------------------------------------
        // TEACHER LOGIN
        // -----------------------------------------------------------

        else if (role === 'teacher') {
            let schoolCode = credentials.schoolCode
                ?.toLowerCase()
                .trim();

            const subdomainCode = getSchoolCodeFromSubdomain(req);

            if (subdomainCode) {
                schoolCode = subdomainCode;
            }

            if (!schoolCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Please login via your school portal link.'
                });
            }

            const school = await prisma.admin.findFirst({
                where: {
                    schoolCode: {
                        equals: schoolCode,
                        mode: 'insensitive'
                    }
                }
            });

            if (!school) {
                return res.status(404).json({
                    success: false,
                    message: 'Invalid school portal.'
                });
            }

            if (!school.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'This school portal is currently deactivated. Please contact the SuperAdmin.'
                });
            }

            const cleanUsername = String(
                credentials.username || ''
            ).trim();

            user = await prisma.teacher.findFirst({
                where: {
                    username: {
                        equals: cleanUsername,
                        mode: 'insensitive'
                    },
                    adminId: school.id
                }
            });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Teacher not found'
                });
            }

            const isMatch = await bcrypt.compare(
                credentials.password,
                user.password
            );

            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Password mismatch'
                });
            }

            const loginIP =
                req.ip ||
                req.headers['x-forwarded-for'] ||
                '';

            const loginDevice =
                req.headers['user-agent'] || '';

            await prisma.teacher.update({
                where: {
                    id: user.id
                },
                data: {
                    lastLogin: new Date(),
                    lastLoginIP: loginIP,
                    lastLoginDevice: loginDevice
                }
            });

            const tokens = await createAuthTokens({
                userId: user.id,
                role: 'teacher',
                adminId: user.adminId,
                payload: {
                    adminId: user.adminId,
                    schoolCode: school.schoolCode,
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                },
                deviceId: getDeviceId(req)
            });

            return res.json({
                success: true,
                ...tokens,
                user: {
                    _id: user.id,
                    adminId: user.adminId,
                    schoolCode: school.schoolCode,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    username: user.username,
                    role: 'teacher',
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                }
            });
        }

        // -----------------------------------------------------------
        // STUDENT LOGIN
        // -----------------------------------------------------------

        else if (role === 'student') {
            let schoolCode = credentials.schoolCode
                ?.toLowerCase()
                .trim();

            const subdomainCode = getSchoolCodeFromSubdomain(req);

            if (subdomainCode) {
                schoolCode = subdomainCode;
            }

            if (!schoolCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Please login via your school portal link.'
                });
            }

            const school = await prisma.admin.findFirst({
                where: {
                    schoolCode: {
                        equals: schoolCode,
                        mode: 'insensitive'
                    }
                }
            });

            if (!school) {
                return res.status(404).json({
                    success: false,
                    message: 'Invalid school portal.'
                });
            }

            if (!school.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'This school portal is currently deactivated. Please contact the SuperAdmin.'
                });
            }

            const cleanAdmissionNumber = String(
                credentials.admissionNumber || ''
            ).trim();

            const cleanFirstName = String(
                credentials.firstName || ''
            ).trim();

            user = await prisma.student.findFirst({
                where: {
                    adminId: school.id,
                    admissionNumber: {
                        equals: cleanAdmissionNumber,
                        mode: 'insensitive'
                    },
                    firstName: {
                        equals: cleanFirstName,
                        mode: 'insensitive'
                    },
                    isDeleted: {
                        not: true
                    }
                }
            });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Student not found'
                });
            }

            if (user.owingFees && !user.feesAccessGranted) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. Please contact the school administration regarding your outstanding fees.',
                    code: 'FEES_BLOCKED'
                });
            }

            const tokens = await createAuthTokens({
                userId: user.id,
                role: 'student',
                adminId: user.adminId,
                payload: {
                    adminId: user.adminId,
                    schoolCode: school.schoolCode,
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                },
                deviceId: getDeviceId(req)
            });

            return res.json({
                success: true,
                ...tokens,
                user: {
                    _id: user.id,
                    adminId: user.adminId,
                    schoolCode: school.schoolCode,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    admissionNumber: user.admissionNumber,
                    role: 'student',
                    profileImage: user.profileImage || null,
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                }
            });
        }

        return res.status(401).json({
            success: false,
            message: 'Invalid credentials (Role not recognized)'
        });

    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ===================================================================
// 2. DEDICATED SUPERADMIN LOGIN
// ===================================================================

exports.loginSuperAdmin = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required.'
        });
    }

    try {
        const cleanUsername = String(username).trim();

        const superAdmin = await prisma.superAdmin.findFirst({
            where: {
                username: {
                    equals: cleanUsername,
                    mode: 'insensitive'
                }
            }
        });

        if (!superAdmin) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const isMatch = await bcrypt.compare(
            password,
            superAdmin.password
        );

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const tokens = await createAuthTokens({
            userId: superAdmin.id,
            role: 'superadmin',
            payload: {},
            deviceId: getDeviceId(req)
        });

        return res.status(200).json({
            success: true,
            ...tokens,
            user: {
                _id: superAdmin.id,
                username: superAdmin.username,
                role: 'superadmin'
            }
        });

    } catch (err) {
        console.error('SuperAdmin login error:', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ===================================================================
// 3. DEDICATED ADMIN LOGIN
// ===================================================================

exports.loginAdmin = async (req, res) => {
    const {
        username,
        password,
        schoolCode: bodyCode
    } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required.'
        });
    }

    try {
        let schoolCode = bodyCode
            ?.toLowerCase()
            .trim();

        const subdomainCode = getSchoolCodeFromSubdomain(req);

        if (subdomainCode) {
            schoolCode = subdomainCode;
        }

        if (!schoolCode) {
            return res.status(400).json({
                success: false,
                message: 'Please login via your school portal link.'
            });
        }

        const cleanUsername = String(username).trim();

        const admin = await prisma.admin.findFirst({
            where: {
                username: {
                    equals: cleanUsername,
                    mode: 'insensitive'
                },
                schoolCode: {
                    equals: schoolCode,
                    mode: 'insensitive'
                }
            }
        });

        if (!admin) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const isMatch = await bcrypt.compare(
            password,
            admin.password
        );

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const isActive = await checkExpiryStatus(admin);

        if (!isActive || !admin.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Account deactivated due to subscription expiry.'
            });
        }

        const tokens = await createAuthTokens({
            userId: admin.id,
            role: 'admin',
            adminId: admin.id,
            payload: {
                name: admin.name,
                schoolCode: admin.schoolCode,
                allowedFeatures: admin.allowedFeatures,
                networkSettings: admin.networkSettings
            },
            deviceId: getDeviceId(req)
        });

        return res.status(200).json({
            success: true,
            ...tokens,
            user: {
                _id: admin.id,
                name: admin.name,
                username: admin.username,
                schoolName: admin.schoolName,
                schoolCode: admin.schoolCode,
                adminId: admin.id,
                role: 'admin',
                allowedFeatures: admin.allowedFeatures,
                networkSettings: admin.networkSettings
            }
        });

    } catch (err) {
        console.error('Admin login error:', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ===================================================================
// 4. DEDICATED TEACHER LOGIN
// ===================================================================

exports.loginTeacher = async (req, res) => {
    const {
        username,
        password,
        schoolCode: bodyCode
    } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required.'
        });
    }

    try {
        let schoolCode = bodyCode
            ?.toLowerCase()
            .trim();

        const subdomainCode = getSchoolCodeFromSubdomain(req);

        if (subdomainCode) {
            schoolCode = subdomainCode;
        }

        if (!schoolCode) {
            return res.status(400).json({
                success: false,
                message: 'Please login via your school portal link.'
            });
        }

        console.log(
            `[TEACHER LOGIN] host=${req.headers.host} bodyCode=${bodyCode} subdomainCode=${subdomainCode} final=${schoolCode}`
        );

        const school = await prisma.admin.findFirst({
            where: {
                schoolCode: {
                    equals: schoolCode,
                    mode: 'insensitive'
                }
            }
        });

        if (!school) {
            return res.status(404).json({
                success: false,
                message: 'Invalid school portal.'
            });
        }

        if (!school.isActive) {
            return res.status(403).json({
                success: false,
                message: 'This school portal is currently deactivated. Please contact the SuperAdmin.'
            });
        }

        const cleanUsername = String(username).trim();

        const teacher = await prisma.teacher.findFirst({
            where: {
                username: {
                    equals: cleanUsername,
                    mode: 'insensitive'
                },
                adminId: school.id
            }
        });

        if (!teacher) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const isMatch = await bcrypt.compare(
            password,
            teacher.password
        );

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const loginIP =
            req.ip ||
            req.headers['x-forwarded-for'] ||
            '';

        const loginDevice =
            req.headers['user-agent'] || '';

        await prisma.teacher.update({
            where: {
                id: teacher.id
            },
            data: {
                lastLogin: new Date(),
                lastLoginIP: loginIP,
                lastLoginDevice: loginDevice
            }
        });

        const tokens = await createAuthTokens({
            userId: teacher.id,
            role: 'teacher',
            adminId: teacher.adminId,
            payload: {
                adminId: teacher.adminId,
                schoolCode: school.schoolCode,
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            },
            deviceId: getDeviceId(req)
        });

        return res.status(200).json({
            success: true,
            ...tokens,
            user: {
                _id: teacher.id,
                adminId: teacher.adminId,
                schoolCode: school.schoolCode,
                username: teacher.username,
                firstName: teacher.firstName,
                lastName: teacher.lastName,
                role: 'teacher',
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            }
        });

    } catch (err) {
        console.error('Teacher login error:', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ===================================================================
// 5. DEDICATED STUDENT LOGIN
// ===================================================================

exports.loginStudent = async (req, res) => {
    const {
        admissionNumber,
        firstName,
        lastName,
        schoolCode: bodyCode
    } = req.body;

    if (!admissionNumber || !firstName) {
        return res.status(400).json({
            success: false,
            message: 'Admission Number and First Name are required.'
        });
    }

    try {
        let schoolCode = bodyCode
            ?.toLowerCase()
            .trim();

        const subdomainCode = getSchoolCodeFromSubdomain(req);

        if (subdomainCode) {
            schoolCode = subdomainCode;
        }

        if (!schoolCode) {
            return res.status(400).json({
                success: false,
                message: 'Please login via your school portal link.'
            });
        }

        console.log(
            `[STUDENT LOGIN] host=${req.headers.host} bodyCode=${bodyCode} subdomainCode=${subdomainCode} final=${schoolCode}`
        );

        const school = await prisma.admin.findFirst({
            where: {
                schoolCode: {
                    equals: schoolCode,
                    mode: 'insensitive'
                }
            }
        });

        if (!school) {
            return res.status(404).json({
                success: false,
                message: 'Invalid school portal.'
            });
        }

        if (!school.isActive) {
            return res.status(403).json({
                success: false,
                message: 'This school portal is currently deactivated. Please contact the SuperAdmin.'
            });
        }

        const cleanAdmissionNumber = String(
            admissionNumber
        ).trim();

        const cleanFirstName = String(firstName).trim();

        const cleanLastName = lastName
            ? String(lastName).trim()
            : null;

        const student = await prisma.student.findFirst({
            where: {
                adminId: school.id,
                admissionNumber: {
                    equals: cleanAdmissionNumber,
                    mode: 'insensitive'
                },
                firstName: {
                    equals: cleanFirstName,
                    mode: 'insensitive'
                },
                isDeleted: {
                    not: true
                }
            }
        });

        if (!student) {
            return res.status(401).json({
                success: false,
                message: 'Invalid admission number or first name.'
            });
        }

        if (
            cleanLastName &&
            student.lastName &&
            student.lastName.toLowerCase() !== cleanLastName.toLowerCase()
        ) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        if (student.owingFees && !student.feesAccessGranted) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Please contact the school administration regarding your outstanding fees.',
                code: 'FEES_BLOCKED'
            });
        }

        const tokens = await createAuthTokens({
            userId: student.id,
            role: 'student',
            adminId: student.adminId,
            payload: {
                adminId: student.adminId,
                schoolCode: school.schoolCode,
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            },
            deviceId: getDeviceId(req)
        });

        return res.status(200).json({
            success: true,
            ...tokens,
            user: {
                _id: student.id,

                // Required for offline SQLite ownership
                adminId: student.adminId,
                schoolCode: school.schoolCode,

                firstName: student.firstName,
                lastName: student.lastName,
                admissionNumber: student.admissionNumber,
                role: 'student',
                profileImage: student.profileImage || null,
                allowedFeatures: school.allowedFeatures,
                networkSettings: school.networkSettings
            }
        });

    } catch (err) {
        console.error('Student login error:', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ===================================================================
// 6. REFRESH ACCESS TOKEN
// POST /login/refresh
// ===================================================================

exports.refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (
        !refreshToken ||
        typeof refreshToken !== 'string' ||
        refreshToken.length < 32
    ) {
        return res.status(400).json({
            success: false,
            message: 'A valid refresh token is required.',
            code: 'REFRESH_TOKEN_REQUIRED'
        });
    }

    try {
        const tokenHash = hashRefreshToken(refreshToken);

        const storedToken = await prisma.refreshToken.findUnique({
            where: {
                tokenHash
            }
        });

        if (!storedToken) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token is invalid or expired.',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }

        // -----------------------------------------------------------
        // DETECT REUSE OF A PREVIOUSLY ROTATED TOKEN
        // -----------------------------------------------------------

        if (storedToken.revokedAt) {
            await revokeTokenFamily(storedToken.tokenFamilyId);

            return res.status(401).json({
                success: false,
                message: 'Refresh token reuse detected. Please log in again.',
                code: 'REFRESH_TOKEN_REUSED'
            });
        }

        if (new Date() > storedToken.expiresAt) {
            await prisma.refreshToken.updateMany({
                where: {
                    id: storedToken.id,
                    revokedAt: null
                },
                data: {
                    revokedAt: new Date()
                }
            });

            return res.status(401).json({
                success: false,
                message: 'Refresh token has expired. Please log in again.',
                code: 'REFRESH_TOKEN_EXPIRED'
            });
        }

        // -----------------------------------------------------------
        // REVALIDATE THE USER AND SCHOOL
        // -----------------------------------------------------------

        const currentUser = await getCurrentUserForRefresh(
            storedToken
        );

        if (!currentUser) {
            await revokeTokenFamily(storedToken.tokenFamilyId);

            return res.status(403).json({
                success: false,
                message: 'Your account is no longer active. Please log in again.',
                code: 'ACCOUNT_INACTIVE'
            });
        }

        // -----------------------------------------------------------
        // ROTATE TOKEN
        // -----------------------------------------------------------

        const newRefreshToken = crypto
            .randomBytes(64)
            .toString('hex');

        const newTokenHash = hashRefreshToken(newRefreshToken);

        const newExpiresAt = new Date(
            Date.now() +
            REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
        );

        const accessToken = jwt.sign(
            {
                ...currentUser.payload,
                id: currentUser.userId,
                role: currentUser.role
            },
            getJwtSecret(),
            {
                expiresIn: ACCESS_TOKEN_EXPIRY
            }
        );

        // Use a transaction so the old token cannot be rotated twice.
        const rotationResult = await prisma.$transaction(
            async (tx) => {
                const revokeResult = await tx.refreshToken.updateMany({
                    where: {
                        id: storedToken.id,
                        revokedAt: null
                    },
                    data: {
                        revokedAt: new Date()
                    }
                });

                if (revokeResult.count !== 1) {
                    return false;
                }

                await tx.refreshToken.create({
                    data: {
                        tokenHash: newTokenHash,

                        // Preserve the original family ID.
                        tokenFamilyId: storedToken.tokenFamilyId,

                        userId: currentUser.userId,
                        role: currentUser.role,
                        adminId: currentUser.adminId || null,
                        deviceId: storedToken.deviceId,
                        expiresAt: newExpiresAt
                    }
                });

                return true;
            }
        );

        if (!rotationResult) {
            await revokeTokenFamily(storedToken.tokenFamilyId);

            return res.status(401).json({
                success: false,
                message: 'Refresh token has already been used. Please log in again.',
                code: 'REFRESH_TOKEN_REUSED'
            });
        }

        return res.status(200).json({
            success: true,
            token: accessToken,
            refreshToken: newRefreshToken,
            user: currentUser.userData
        });

    } catch (error) {
        console.error('Refresh token error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to refresh session.',
            code: 'REFRESH_FAILED'
        });
    }
};

// ===================================================================
// 7. LOGOUT / REVOKE REFRESH TOKEN
// POST /login/logout
// ===================================================================

exports.logout = async (req, res) => {
    const { refreshToken } = req.body;

    if (
        !refreshToken ||
        typeof refreshToken !== 'string'
    ) {
        return res.status(200).json({
            success: true,
            message: 'Logged out.'
        });
    }

    try {
        const tokenHash = hashRefreshToken(refreshToken);

        const storedToken = await prisma.refreshToken.findUnique({
            where: {
                tokenHash
            }
        });

        if (storedToken && !storedToken.revokedAt) {
            await prisma.refreshToken.updateMany({
                where: {
                    id: storedToken.id,
                    revokedAt: null
                },
                data: {
                    revokedAt: new Date()
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Logged out successfully.'
        });

    } catch (error) {
        console.error('Logout error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to complete logout.'
        });
    }
};
