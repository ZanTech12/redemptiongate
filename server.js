
require('dotenv').config();

const express = require('express');
const prisma = require('./config/db');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const { authenticateToken } = require('./middlewares/authMiddleware');

const app = express();

// ===================================================================
// 1. CORS CONFIGURATION
// ===================================================================

const allowedOrigins = process.env.CLIENT_URLS
    ? process.env.CLIENT_URLS.split(',').map(origin => origin.trim())
    : [
        'https://okispecial.com.ng',
        'https://www.okispecial.com.ng',
        'http://localhost:3000',
        'http://localhost:3001'
    ];

const corsOptions = {
    origin: function (origin, callback) {

        // Allow all origins in development mode
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // Production CORS rules
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        if (
            origin.includes('lvh.me') ||
            origin.includes('nip.io') ||
            origin.includes('okispecial.com.ng')
        ) {
            return callback(null, true);
        }

        // Allow localhost and private-network origins
        try {
            const host = new URL(origin).hostname;

            if (
                host === 'localhost' ||
                host === '127.0.0.1' ||
                /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
                /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
            ) {
                return callback(null, true);
            }

        } catch (e) {
            // Malformed origin - continue to block
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

// ===================================================================
// 2. GLOBAL MIDDLEWARES
// ===================================================================

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ===================================================================
// SERVE REACT FRONTEND - STATIC FILES
// ===================================================================

const frontendBuild = path.join(
    __dirname,
    '..',
    'cschoolexam',
    'build'
);

if (fs.existsSync(frontendBuild)) {
    app.use(express.static(frontendBuild));
}

// ===================================================================
// SPA ROUTES
// ===================================================================

const SPA_ROUTES = [
    '/login',
    '/admin',
    '/teacher',
    '/student',
    '/register'
];

if (fs.existsSync(frontendBuild)) {
    app.use((req, res, next) => {

        if (
            req.method === 'GET' &&
            (req.headers.accept || '').includes('text/html')
        ) {
            const matchesSpa = SPA_ROUTES.some(
                route =>
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

// ===================================================================
// HEALTH CHECK
// ===================================================================

app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        status: 'ok',
        message: 'Server is online',
        syncVersion: 'v4.1',
        aiLessonNotes: true
    });
});

// ===================================================================
// SECURE STATIC FILE SERVING FOR UPLOADS
// ===================================================================

app.use('/uploads', authenticateToken, (req, res) => {

    const filePath = path.join(
        __dirname,
        'uploads',
        req.path
    );

    res.sendFile(filePath, (err) => {

        if (err) {
            console.error('File send error:', err);

            res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

    });
});

// ===================================================================
// 3. DATABASE CONNECTION
// ===================================================================

async function connectDB() {

    try {

        await prisma.$connect();

        console.log('✅ PostgreSQL Database connected successfully!');

    } catch (err) {

        console.error('❌ PostgreSQL Connection Error:', err);

        process.exit(1);
    }
}

// ===================================================================
// 4. IMPORT ROUTES
// ===================================================================

const authRoutes = require('./routes/authRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const classRoutes = require('./routes/classRoutes');
const studentRoutes = require('./routes/studentRoutes');
const studentFeesRoutes = require('./routes/studentFeesRoutes');
const studentTestRoutes = require('./routes/studentTestRoutes');
const testRoutes = require('./routes/testRoutes');
const testResultRoutes = require('./routes/testResultRoutes');
const questionSetRoutes = require('./routes/questionSetRoutes');
const studentSubmissionRoutes = require('./routes/studentSubmissionRoutes');
const questionUploadRoutes = require('./routes/questionUploadRoutes');
const classTeacherCommentRoutes = require('./routes/classTeacherCommentRoutes');
const teacherAssignmentRoutes = require('./routes/teacherAssignmentRoutes');
const principalCommentRoutes = require('./routes/principalCommentRoutes');
const teacherCommentRoutes = require('./routes/teacherCommentRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const termRoutes = require('./routes/termRoutes');
const gradingSystemRoutes = require('./routes/gradingSystemRoutes');
const continuousAssessmentRoutes = require('./routes/continuousAssessmentRoutes');
const adminUtilityRoutes = require('./routes/adminUtilityRoutes');
const adminCaRoutes = require('./routes/adminCaRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const diagnosticRoutes = require('./routes/diagnosticRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const reportCardRoutes = require('./routes/reportCardRoutes');
const publicRoutes = require('./routes/publicRoutes');
const studentResultRoutes = require('./routes/studentResultRoutes');
const adminStudentBlockRoutes = require('./routes/adminStudentBlockRoutes');
const siteInfoRoutes = require('./routes/siteInformationRoutes');
const resultScheduleRoutes = require('./routes/resultScheduleRoutes');
const broadsheetRoutes = require('./routes/broadsheetRoutes');
const adminCaManagementRoutes = require('./routes/adminCaManagementRoutes');
const adminScoresRoutes = require('./routes/adminScoresRoutes');
const scoreManagementRoutes = require('./routes/scoreManagementRoutes');
const eNoteRoutes = require('./routes/eNoteRoutes');

// ===================================================================
// AI LESSON NOTE ROUTES - GROQ
// ===================================================================

const aiLessonNoteRoutes = require('./routes/aiLessonNoteRoutes');

// ===================================================================
// SYNC ROUTES
// ===================================================================

const syncRoutes = require('./routes/syncRoutes');

// ===================================================================
// 5. MOUNT ROUTES
// ===================================================================

app.use('/login', authRoutes);
app.use('/superadmin', superAdminRoutes);

app.use(express.static('public'));

app.use('/dashboard', dashboardRoutes);
app.use('/teachers', teacherRoutes);
app.use('/subjects', subjectRoutes);
app.use('/classes', classRoutes);

app.use('/students', studentRoutes);
app.use('/students', studentFeesRoutes);
app.use('/student', studentTestRoutes);

app.use('/tests', testRoutes);
app.use('/test-results', testResultRoutes);

app.use('/question-sets', questionUploadRoutes);
app.use('/question-sets', questionSetRoutes);

app.use('/student-submissions', studentSubmissionRoutes);

app.use('/class-teacher-comments', classTeacherCommentRoutes);
app.use('/teacher-assignments', teacherAssignmentRoutes);
app.use('/principal-comments', principalCommentRoutes);
app.use('/teacher-comments', teacherCommentRoutes);

app.use('/sessions', sessionRoutes);
app.use('/terms', termRoutes);
app.use('/grading-systems', gradingSystemRoutes);
app.use('/continuous-assessments', continuousAssessmentRoutes);

app.use('/admin/ca', adminCaRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/report-cards', reportCardRoutes);

app.use('/admin', adminUtilityRoutes);
app.use('/api', analyticsRoutes);

app.use('/public', publicRoutes);
app.use('/result-schedules', resultScheduleRoutes);

// ===================================================================
// EXISTING E-NOTES ROUTES
// ===================================================================

app.use('/e-notes', eNoteRoutes);

// ===================================================================
// NEW AI LESSON NOTE ROUTES
// POST /api/ai/lesson-notes/generate
// GET  /api/ai/lesson-notes
// ===================================================================

app.use('/api/ai', aiLessonNoteRoutes);

// ===================================================================
// SYNC ROUTES
// ===================================================================

app.use('/sync', syncRoutes);

// ===================================================================
// ROOT MOUNTED ROUTES
// These must remain LAST among specific routes
// ===================================================================

app.use('/', diagnosticRoutes);
app.use('/', studentResultRoutes);
app.use('/site-information', siteInfoRoutes);
app.use('/', adminStudentBlockRoutes);
app.use('/', broadsheetRoutes);
app.use('/', adminCaManagementRoutes);
app.use('/', adminScoresRoutes);
app.use('/', scoreManagementRoutes);

// ===================================================================
// SPA FALLBACK
// ===================================================================

if (fs.existsSync(frontendBuild)) {

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

// ===================================================================
// 6. GLOBAL ERROR HANDLER
// ===================================================================

app.use((req, res, next) => {

    res.status(404).json({
        success: false,
        message: 'Route not found'
    });

});

app.use((err, req, res, next) => {

    console.error('Global Error:', err.stack);

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });

});

// ===================================================================
// 7. AUTOMATIC SUPERADMIN INITIALIZATION
// ===================================================================

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
        }

    } catch (error) {

        console.error(
            '❌ Error initializing SuperAdmin:',
            error.message
        );

    }
};

// ===================================================================
// 8. START SERVER
// ===================================================================

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

});

// ===================================================================
// PROCESS ERROR HANDLERS
// ===================================================================

process.on('exit', (code) => {
    console.log(`\n⚠️ Process is exiting with code: ${code}`);
});

process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
});

setInterval(() => {}, 1000);
