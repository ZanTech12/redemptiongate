
// ============================================================
// api/index.js
// SCHOOL MANAGEMENT SYSTEM - API ENTRY POINT
//
// Supports:
// - Vercel Serverless
// - Local development
// - School LAN / Desktop server
// - React frontend static serving
// - PostgreSQL / Prisma
// - Offline/Online synchronization v4.1
// - Groq AI Lesson Notes
// - Secure authenticated uploads
// - Result PIN Management
// ============================================================

require('dotenv').config();

const express = require('express');
const prisma = require('../config/db');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const { authenticateToken } = require('../middlewares/authMiddleware');

// ============================================================
// 1. INITIALIZE EXPRESS
// ============================================================

const app = express();

// ============================================================
// 2. PATH RESOLUTION
// ============================================================

const firstExisting = (candidates, mustContain) => {

    return candidates.find(p =>
        fs.existsSync(
            mustContain ? path.join(p, mustContain) : p
        )
    ) || null;

};

// ============================================================
// 3. CORS CONFIGURATION
// ============================================================

const allowedOrigins = process.env.CLIENT_URLS
    ? process.env.CLIENT_URLS.split(',').map(origin => origin.trim()).filter(Boolean)
    : [
        'https://okispecial.com.ng',
        'https://www.okispecial.com.ng',

        'https://fountainhillsschools.com.ng',
        'https://www.fountainhillsschools.com.ng',

        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',

        'https://datforte.bimtechsolutions.com.ng',
        'https://datforteschools.com.ng',
        'https://www.datforteschools.com.ng'
    ];

const corsOptions = {

    origin: function (origin, callback) {

        // Allow all origins during development
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // Allow requests without an Origin header
        if (!origin) {
            return callback(null, true);
        }

        // Explicitly allowed origins
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Approved development/domain aliases
        try {

            const host = new URL(origin).hostname;

            if (
                host === 'lvh.me' ||
                host.endsWith('.lvh.me') ||
                host === 'nip.io' ||
                host.endsWith('.nip.io') ||
                host === 'okispecial.com.ng' ||
                host.endsWith('.okispecial.com.ng') ||
                host === 'fountainhillsschools.com.ng' ||
                host.endsWith('.fountainhillsschools.com.ng') ||
                host === 'datforteschools.com.ng' ||
                host.endsWith('.datforteschools.com.ng') ||
                host === 'datforte.bimtechsolutions.com.ng'
            ) {
                return callback(null, true);
            }

            // Allow localhost and private-network origins
            if (
                host === 'localhost' ||
                host === '127.0.0.1' ||

                /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||

                /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||

                /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
            ) {
                return callback(null, true);
            }

        } catch (error) {
            // Invalid origin: continue to reject
        }

        console.log(`🚫 Blocked by CORS: ${origin}`);

        return callback(new Error('Not allowed by CORS'));
    },

    methods: [
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
        'OPTIONS'
    ],

    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-auth-token'
    ],

    credentials: true,

    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// ============================================================
// 4. GLOBAL MIDDLEWARES
// ============================================================

app.use(express.json({ limit: '50mb' }));

app.use(express.urlencoded({
    extended: true,
    limit: '50mb'
}));

// ============================================================
// 5. PUBLIC STATIC DIRECTORY
// ============================================================

const publicDir = firstExisting([
    path.join(__dirname, 'public'),
    path.join(__dirname, '..', 'public'),
    path.join(__dirname, '..', '..', 'public')
]);

if (publicDir) {
    app.use(express.static(publicDir));
}

// ============================================================
// 6. REACT FRONTEND STATIC FILES
// ============================================================

const frontendBuild = firstExisting([
    path.join(__dirname, '..', 'cschoolexam', 'build'),
    path.join(__dirname, '..', '..', 'cschoolexam', 'build'),
    path.join(__dirname, '..', '..', '..', 'cschoolexam', 'build')
], 'index.html');

if (frontendBuild) {
    app.use(express.static(frontendBuild));
}

// ============================================================
// 7. SPA ROUTES
// ============================================================

const SPA_ROUTES = [
    '/login',
    '/admin',
    '/teacher',
    '/student',
    '/register'
];

if (frontendBuild) {

    app.use((req, res, next) => {

        if (
            req.method === 'GET' &&
            (req.headers.accept || '').includes('text/html')
        ) {

            const matchesSpa = SPA_ROUTES.some(route =>
                req.path === route ||
                req.path.startsWith(route + '/')
            );

            if (matchesSpa) {

                return res.sendFile(
                    path.join(frontendBuild, 'index.html')
                );
            }
        }

        next();
    });
}

// ============================================================
// 8. HEALTH CHECK
// ============================================================

// Public application health check.
// This does not require a successful database connection.

app.get('/api/health', (req, res) => {

    res.status(200).json({

        success: true,

        status: 'ok',

        message: 'Server is online',

        syncVersion: 'v4.1',

        aiLessonNotes: true

    });
});

// ============================================================
// 9. SECURE STATIC FILE SERVING FOR UPLOADS
// Authenticated + path-traversal protection
// ============================================================

// IMPORTANT:
// Vercel serverless filesystem is not persistent.
// Use Cloudinary, S3 or another persistent storage provider
// for production uploads.

const uploadsDir = firstExisting([
    path.join(__dirname, 'uploads'),
    path.join(__dirname, '..', 'uploads'),
    path.join(__dirname, '..', '..', 'uploads')
]) || path.join(__dirname, '..', 'uploads');

app.use('/uploads', authenticateToken, (req, res) => {

    const resolvedRoot = path.resolve(uploadsDir);

    const filePath = path.resolve(
        uploadsDir,
        '.' + path.sep + req.path
    );

    // Prevent directory traversal
    if (
        filePath !== resolvedRoot &&
        !filePath.startsWith(resolvedRoot + path.sep)
    ) {

        return res.status(403).json({

            success: false,

            message: 'Forbidden'

        });
    }

    res.sendFile(filePath, (err) => {

        if (err) {

            console.error('File send error:', err);

            if (!res.headersSent) {

                res.status(404).json({

                    success: false,

                    message: 'File not found'

                });
            }
        }
    });
});

// ============================================================
// 10. DATABASE CONNECTION
// Local / Desktop / Vercel
// ============================================================

async function connectDB() {

    try {

        await prisma.$connect();

        console.log(
            '✅ PostgreSQL Database connected successfully!'
        );

    } catch (err) {

        console.error(
            '❌ PostgreSQL Connection Error:',
            err
        );

        throw err;
    }
}

// ============================================================
// 11. IMPORT ROUTES
// ============================================================

const authRoutes = require('../routes/authRoutes');

const superAdminRoutes = require('../routes/superAdminRoutes');

const dashboardRoutes = require('../routes/dashboardRoutes');

const teacherRoutes = require('../routes/teacherRoutes');

const subjectRoutes = require('../routes/subjectRoutes');

const classRoutes = require('../routes/classRoutes');

const studentRoutes = require('../routes/studentRoutes');

const studentFeesRoutes = require('../routes/studentFeesRoutes');

const studentTestRoutes = require('../routes/studentTestRoutes');

const testRoutes = require('../routes/testRoutes');

const testResultRoutes = require('../routes/testResultRoutes');

const questionSetRoutes = require('../routes/questionSetRoutes');

const studentSubmissionRoutes = require('../routes/studentSubmissionRoutes');

const questionUploadRoutes = require('../routes/questionUploadRoutes');

const classTeacherCommentRoutes = require('../routes/classTeacherCommentRoutes');

const teacherAssignmentRoutes = require('../routes/teacherAssignmentRoutes');

const principalCommentRoutes = require('../routes/principalCommentRoutes');

const teacherCommentRoutes = require('../routes/teacherCommentRoutes');

const sessionRoutes = require('../routes/sessionRoutes');

const termRoutes = require('../routes/termRoutes');

const gradingSystemRoutes = require('../routes/gradingSystemRoutes');

const continuousAssessmentRoutes = require('../routes/continuousAssessmentRoutes');

const adminUtilityRoutes = require('../routes/adminUtilityRoutes');

const adminCaRoutes = require('../routes/adminCaRoutes');

const analyticsRoutes = require('../routes/analyticsRoutes');

const diagnosticRoutes = require('../routes/diagnosticRoutes');

const attendanceRoutes = require('../routes/attendanceRoutes');

const reportCardRoutes = require('../routes/reportCardRoutes');

const publicRoutes = require('../routes/publicRoutes');

const studentResultRoutes = require('../routes/studentResultRoutes');

const adminStudentBlockRoutes = require('../routes/adminStudentBlockRoutes');

const siteInfoRoutes = require('../routes/siteInformationRoutes');

const resultScheduleRoutes = require('../routes/resultScheduleRoutes');

const broadsheetRoutes = require('../routes/broadsheetRoutes');

const adminCaManagementRoutes = require('../routes/adminCaManagementRoutes');

const adminScoresRoutes = require('../routes/adminScoresRoutes');

const scoreManagementRoutes = require('../routes/scoreManagementRoutes');

const eNoteRoutes = require('../routes/eNoteRoutes');

// ============================================================
// RESULT PIN ROUTES
// ============================================================

const resultPinRoutes = require('../routes/resultPinRoutes');

// ============================================================
// 12. AI LESSON NOTE ROUTES - GROQ
// ============================================================

const aiLessonNoteRoutes = require('../routes/aiLessonNoteRoutes');

// ============================================================
// 13. SYNCHRONIZATION ROUTES
// ============================================================

const syncRoutes = require('../routes/syncRoutes');

// ============================================================
// 14. MOUNT ROUTES
// ============================================================

// Root API endpoint
app.get('/', (req, res) => {

    res.json({

        success: true,

        message: 'School Management API is running...'

    });
});

// Authentication
app.use('/login', authRoutes);

// SuperAdmin
app.use('/superadmin', superAdminRoutes);

// Dashboard
app.use('/dashboard', dashboardRoutes);

// Teachers
app.use('/teachers', teacherRoutes);

// Subjects
app.use('/subjects', subjectRoutes);

// Classes
app.use('/classes', classRoutes);

// Students
app.use('/students', studentRoutes);

app.use('/students', studentFeesRoutes);

app.use('/student', studentTestRoutes);

// Tests
app.use('/tests', testRoutes);

app.use('/test-results', testResultRoutes);

// Question sets
app.use('/question-sets', questionUploadRoutes);

app.use('/question-sets', questionSetRoutes);

// Student submissions
app.use('/student-submissions', studentSubmissionRoutes);

// Comments and assignments
app.use('/class-teacher-comments', classTeacherCommentRoutes);

app.use('/teacher-assignments', teacherAssignmentRoutes);

app.use('/principal-comments', principalCommentRoutes);

app.use('/teacher-comments', teacherCommentRoutes);

// Academic sessions
app.use('/sessions', sessionRoutes);

app.use('/terms', termRoutes);

app.use('/grading-systems', gradingSystemRoutes);

app.use('/continuous-assessments', continuousAssessmentRoutes);

// ============================================================
// 15. SPECIFIC ADMIN ROUTES
// These must come before generic /admin routes
// ============================================================

app.use('/admin/ca', adminCaRoutes);

app.use('/admin/result-pins', resultPinRoutes);

// Attendance
app.use('/attendance', attendanceRoutes);

// Report cards
app.use('/report-cards', reportCardRoutes);

// Analytics
app.use('/api', analyticsRoutes);

// Public routes
app.use('/public', publicRoutes);

// Result schedules
app.use('/result-schedules', resultScheduleRoutes);

// E-Notes
app.use('/e-notes', eNoteRoutes);

// AI Lesson Notes
// POST /api/ai/lesson-notes/generate
// GET  /api/ai/lesson-notes

app.use('/api/ai', aiLessonNoteRoutes);

// Synchronization
// POST /sync/to-online
// POST /sync/to-local

app.use('/sync', syncRoutes);

// Generic Admin routes
app.use('/admin', adminUtilityRoutes);

// ============================================================
// 16. ROOT-MOUNTED ROUTES
// Keep these LAST among specific routes
// ============================================================

app.use('/', diagnosticRoutes);

app.use('/', studentResultRoutes);

app.use('/site-information', siteInfoRoutes);

app.use('/', adminStudentBlockRoutes);

app.use('/', broadsheetRoutes);

app.use('/', adminCaManagementRoutes);

app.use('/', adminScoresRoutes);

app.use('/', scoreManagementRoutes);

// ============================================================
// 17. SPA FALLBACK
// ============================================================

if (frontendBuild) {

    app.use((req, res, next) => {

        if (
            req.method === 'GET' &&
            (req.headers.accept || '').includes('text/html')
        ) {

            return res.sendFile(
                path.join(frontendBuild, 'index.html')
            );
        }

        next();
    });
}

// ============================================================
// 18. GLOBAL 404 HANDLER
// ============================================================

app.use((req, res, next) => {

    res.status(404).json({

        success: false,

        message: 'Route not found'

    });
});

// ============================================================
// 19. GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {

    console.error(
        'Global Error:',
        err.stack || err
    );

    if (res.headersSent) {
        return next(err);
    }

    res.status(err.status || 500).json({

        success: false,

        message: err.message || 'Internal Server Error'

    });
});

// ============================================================
// 20. AUTOMATIC SUPERADMIN INITIALIZATION
// Local / Desktop / Vercel
// ============================================================

const initializeSuperAdmin = async () => {

    try {

        const username =
            process.env.SUPERADMIN_USERNAME || 'superadmin';

        const email =
            process.env.SUPERADMIN_EMAIL ||
            'superadmin@yourschool.com';

        const password =
            process.env.SUPERADMIN_PASSWORD ||
            'SuperSecretPassword123';

        const superAdminExists =
            await prisma.superAdmin.findUnique({

                where: { username }

            });

        if (!superAdminExists) {

            const salt = await bcrypt.genSalt(10);

            const hashedPassword =
                await bcrypt.hash(password, salt);

            await prisma.superAdmin.create({

                data: {

                    username,

                    email,

                    password: hashedPassword

                }

            });

            console.log(
                '✅ Default SuperAdmin created successfully!'
            );
        } else {

            console.log(
                '✅ SuperAdmin already exists.'
            );

        }

    } catch (error) {

        console.error(
            '❌ Error initializing SuperAdmin:',
            error.message
        );

        throw error;
    }
};

// ============================================================
// 21. VERCEL DATABASE INITIALIZATION
// ============================================================

// Cache initialization within each warm serverless instance.
// Different Vercel instances have independent caches.

let databaseInitializationPromise = null;

async function ensureDatabaseInitialized() {

    if (!databaseInitializationPromise) {

        databaseInitializationPromise = (async () => {

            try {

                await connectDB();

                await initializeSuperAdmin();

                console.log(
                    '☁️ Vercel database initialization completed.'
                );

            } catch (error) {

                databaseInitializationPromise = null;

                throw error;
            }

        })();
    }

    return databaseInitializationPromise;
}

// Health check above remains public and does not require
// a database connection.

const isServerless = !!process.env.VERCEL;

if (isServerless) {

    app.use(async (req, res, next) => {

        try {

            await ensureDatabaseInitialized();

            next();

        } catch (error) {

            console.error(
                '❌ Vercel database initialization error:',
                error
            );

            if (!res.headersSent) {

                res.status(503).json({

                    success: false,

                    message: 'Database connection or initialization failed.',

                    error: process.env.NODE_ENV === 'production'
                        ? 'Service temporarily unavailable'
                        : error.message

                });
            }
        }
    });

}

// ============================================================
// 22. START SERVER LOCALLY / EXPORT FOR VERCEL
// ============================================================

// Vercel automatically provides process.env.VERCEL.
// Do not use NODE_ENV to determine serverless mode.

if (!isServerless) {

    const PORT = process.env.PORT || 5000;

    connectDB().then(async () => {

        await initializeSuperAdmin();

        try {

            app.listen(PORT, () => {

                console.log(
                    `🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
                );

                console.log(
                    `🌐 Allowed CORS Origins: ${allowedOrigins.join(', ')}`
                );

                console.log(
                    '🤖 Groq AI Lesson Note routes registered at /api/ai'
                );

                console.log(
                    '🔄 Synchronization routes registered at /sync'
                );

                console.log(
                    '📚 React frontend:',
                    frontendBuild || 'Not found'
                );

                console.log(
                    '📁 Upload directory:',
                    uploadsDir
                );

            });

        } catch (err) {

            console.error(
                `❌ Failed to start server on port ${PORT}:`,
                err.message
            );

        }

    }).catch(err => {

        console.error(
            '❌ Failed to connect to database or start server:',
            err
        );

        process.exitCode = 1;

    });

    // Process error handlers
    process.on('exit', (code) => {

        console.log(
            `\n⚠️ Process is exiting with code: ${code}`
        );

    });

    process.on('uncaughtException', (err) => {

        console.error(
            '❌ UNCAUGHT EXCEPTION:',
            err
        );

        process.exit(1);

    });

    process.on('unhandledRejection', (reason) => {

        console.error(
            '❌ UNHANDLED REJECTION:',
            reason
        );

    });

    // Keep Node alive for desktop / packaged environments
    setInterval(() => {}, 1000);

} else {

    console.log(
        '☁️ Serverless (Vercel) mode — app exported; Prisma connects lazily.'
    );

}

// ============================================================
// 23. EXPORT EXPRESS APPLICATION
// ============================================================

module.exports = app;
