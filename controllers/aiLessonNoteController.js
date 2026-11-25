
const OpenAI = require('openai');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;
const prisma = require('../config/db');

// ============================================================
// CLOUDINARY CONFIGURATION
// ============================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ============================================================
// GROQ CONFIGURATION
// ============================================================

const GROQ_API_KEY =
    process.env.GROQ_API_KEY1 || process.env.GROQ_API_KEY;

const GROQ_MODEL =
    process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const groq = new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    timeout: 120000,
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const parseId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const sendError = (res, status, message) => {
    return res.status(status).json({
        success: false,
        message,
    });
};

const isValidObject = (value) => {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
};

const parseAIJson = (text) => {
    if (!text || typeof text !== 'string') {
        throw new Error('Groq returned an empty response.');
    }

    let cleaned = text.trim();

    cleaned = cleaned
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

    return JSON.parse(cleaned);
};

// ============================================================
// CLOUDINARY HELPERS
// ============================================================

const isCloudinaryConfigured = () => {
    return Boolean(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
};

// Upload a PDF Buffer to Cloudinary as a raw file.

const uploadPdfToCloudinary = (pdfBuffer, filename) => {
    return new Promise((resolve, reject) => {
        if (!isCloudinaryConfigured()) {
            return reject(
                new Error(
                    'Cloudinary is not configured. Check your environment variables.'
                )
            );
        }

        if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
            return reject(new Error('Invalid or empty PDF buffer.'));
        }

        const publicId =
            `rgss/ai-lesson-notes/${filename.replace(/\.pdf$/i, '')}`;

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: 'raw',
                type: 'upload',
                public_id: publicId + '.pdf',
                overwrite: true,
                invalidate: true,
                format: 'pdf',
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }

                if (!result || !result.secure_url || !result.public_id) {
                    return reject(
                        new Error(
                            'Cloudinary did not return a valid PDF URL.'
                        )
                    );
                }

                resolve({
                    pdfUrl: result.secure_url,
                    pdfPublicId: result.public_id,
                    pdfSize: pdfBuffer.length,
                });
            }
        );

        uploadStream.on('error', reject);
        uploadStream.end(pdfBuffer);
    });
};

// Delete a previously uploaded PDF.

const deleteCloudinaryPdf = async (publicId) => {
    if (!publicId) return;

    try {
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: 'raw',
            type: 'upload',
            invalidate: true,
        });

        if (
            result.result !== 'ok' &&
            result.result !== 'not found'
        ) {
            console.warn(
                '[CLOUDINARY PDF DELETE] Unexpected result:',
                result
            );
        } else {
            console.log(
                '[CLOUDINARY PDF DELETE] Result:',
                result.result,
                publicId
            );
        }
    } catch (error) {
        console.error(
            '[CLOUDINARY PDF DELETE ERROR]:',
            publicId,
            error.message
        );
    }
};

// ============================================================
// PDF HELPER FUNCTIONS
// ============================================================

const safeFilename = (value) => {
    return String(value || 'lesson-note')
        .replace(/[^a-z0-9-_]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'lesson-note';
};

const pdfText = (value) => {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value
            .map(pdfText)
            .filter(Boolean)
            .join(', ');
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return '';
};

// PDF DESIGN COLOURS

const PDF_COLORS = {
    primary: '#174C45',
    secondary: '#28766B',
    accent: '#D5A84B',
    dark: '#252D2B',
    body: '#303735',
    muted: '#68736F',
    light: '#F3F7F5',
    border: '#DCE7E2',
    white: '#FFFFFF',
    paleGold: '#FBF7EC',
};

// PDF DIMENSIONS

const PDF_LAYOUT = {
    left: 58,
    right: 58,
    top: 78,
    bottom: 62,
};

const getPdfContentWidth = (doc) => {
    return (
        doc.page.width -
        doc.page.margins.left -
        doc.page.margins.right
    );
};

// Keep content away from the footer.

const ensurePdfSpace = (doc, requiredHeight = 45) => {
    const bottomLimit =
        doc.page.height - doc.page.margins.bottom;

    if (doc.y + requiredHeight > bottomLimit) {
        doc.addPage();
    }
};

// ============================================================
// PDF PAGE HEADER
// ============================================================

const drawPdfHeader = (doc) => {
    const pageWidth = doc.page.width;

    doc.save();

    // Main top banner.

    doc
        .rect(0, 0, pageWidth, 10)
        .fill(PDF_COLORS.primary);

    // Gold accent line.

    doc
        .rect(0, 10, pageWidth, 3)
        .fill(PDF_COLORS.accent);

    // Header branding.

    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(PDF_COLORS.primary)
        .text(
            'RGSS',
            PDF_LAYOUT.left,
            27,
            {
                lineBreak: false,
            }
        );

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(
            'AI LESSON NOTE',
            PDF_LAYOUT.left + 34,
            28,
            {
                lineBreak: false,
            }
        );

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(
            'TEACHER RESOURCE',
            pageWidth - PDF_LAYOUT.right - 110,
            28,
            {
                width: 110,
                align: 'right',
                lineBreak: false,
            }
        );

    doc.restore();
};

// ============================================================
// PDF FOOTER
// ============================================================

const addPdfFooter = (doc) => {
    const pageCount = doc.bufferedPageRange().count;

    for (let index = 0; index < pageCount; index++) {
        doc.switchToPage(index);

        const footerY = doc.page.height - 42;

        doc.save();

        doc
            .moveTo(
                PDF_LAYOUT.left,
                footerY - 10
            )
            .lineTo(
                doc.page.width - PDF_LAYOUT.right,
                footerY - 10
            )
            .lineWidth(0.7)
            .strokeColor(PDF_COLORS.border)
            .stroke();

        doc
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .fillColor(PDF_COLORS.primary)
            .text(
                'RGSS  |  AI LESSON NOTE',
                PDF_LAYOUT.left,
                footerY,
                {
                    lineBreak: false,
                }
            );

        doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor(PDF_COLORS.muted)
            .text(
                `Page ${index + 1} of ${pageCount}`,
                PDF_LAYOUT.left,
                footerY,
                {
                    width: getPdfContentWidth(doc),
                    align: 'right',
                    lineBreak: false,
                }
            );

        doc.restore();
    }
};

// ============================================================
// PDF SECTION HEADING
// ============================================================

const addPdfHeading = (
    doc,
    heading,
    options = {}
) => {
    const value = pdfText(heading);

    if (!value) return;

    const size = options.size || 12.5;
    const contentWidth = getPdfContentWidth(doc);
    const compact = options.compact === true;

    const textWidth = contentWidth - 30;

    const headingHeight = doc.heightOfString(value, {
        width: textWidth,
        font: 'Helvetica-Bold',
        fontSize: size,
        lineGap: 2,
    });

    const boxHeight = Math.max(
        27,
        headingHeight + 13
    );

    ensurePdfSpace(doc, boxHeight + 18);

    const x = doc.page.margins.left;
    const y = doc.y + (compact ? 3 : 8);

    // Heading background.

    doc
        .save()
        .roundedRect(
            x,
            y,
            contentWidth,
            boxHeight,
            5
        )
        .fill(PDF_COLORS.light)
        .restore();

    // Accent bar.

    doc
        .save()
        .roundedRect(
            x,
            y,
            4,
            boxHeight,
            2
        )
        .fill(PDF_COLORS.secondary)
        .restore();

    // Heading text.

    doc
        .font('Helvetica-Bold')
        .fontSize(size)
        .fillColor(
            options.color || PDF_COLORS.primary
        )
        .text(
            value,
            x + 14,
            y + 7,
            {
                width: textWidth,
                lineGap: 2,
            }
        );

    doc.y = y + boxHeight + 8;
};

// ============================================================
// NORMAL BODY PARAGRAPH
// ============================================================

const addPdfParagraph = (doc, value, options = {}) => {
    const text = pdfText(value);

    if (!text) return;

    const fontSize = options.fontSize || 11.5;
    const contentWidth = getPdfContentWidth(doc);

    const textHeight = doc.heightOfString(text, {
        width: contentWidth,
        font: 'Helvetica',
        fontSize,
        lineGap: 4,
    });

    ensurePdfSpace(doc, Math.min(textHeight + 15, 100));

    doc
        .font('Helvetica')
        .fontSize(fontSize)
        .fillColor(PDF_COLORS.body)
        .text(text, {
            width: contentWidth,
            align: 'left',
            lineGap: 4,
            paragraphGap: 7,
        });

    doc.moveDown(0.3);
};

// ============================================================
// ATTRACTIVE BULLET LIST
// ============================================================

const addPdfList = (doc, items, options = {}) => {
    if (!Array.isArray(items) || !items.length) {
        return;
    }

    const fontSize = options.fontSize || 11.2;
    const contentWidth = getPdfContentWidth(doc);

    items.forEach((item) => {
        const value = pdfText(item);

        if (!value) return;

        const textHeight = doc.heightOfString(value, {
            width: contentWidth - 24,
            font: 'Helvetica',
            fontSize,
            lineGap: 3.5,
        });

        ensurePdfSpace(doc, Math.min(textHeight + 12, 90));

        const bulletY = doc.y + 4;

        // Bullet marker.

        doc
            .save()
            .circle(
                doc.page.margins.left + 5,
                bulletY + 2,
                2
            )
            .fill(PDF_COLORS.accent)
            .restore();

        // Bullet text.

        doc
            .font('Helvetica')
            .fontSize(fontSize)
            .fillColor(PDF_COLORS.body)
            .text(
                value,
                doc.page.margins.left + 17,
                doc.y,
                {
                    width: contentWidth - 17,
                    align: 'left',
                    lineGap: 3.5,
                    paragraphGap: 5,
                }
            );

        doc.moveDown(0.2);
    });

    doc.moveDown(0.2);
};

// ============================================================
// LESSON INFORMATION PANEL
// ============================================================

const addLessonInformationPanel = (doc, information) => {
    const validInformation = information.filter(
        ([, value]) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== ''
    );

    if (!validInformation.length) return;

    const contentWidth = getPdfContentWidth(doc);
    const x = doc.page.margins.left;

    const columnGap = 18;
    const columnWidth = (contentWidth - columnGap) / 2;

    const rows = Math.ceil(validInformation.length / 2);
    const rowHeight = 39;

    const panelHeight = 39 + rows * rowHeight;

    ensurePdfSpace(doc, panelHeight + 20);

    const y = doc.y;

    // Main panel background.

    doc
        .save()
        .roundedRect(
            x,
            y,
            contentWidth,
            panelHeight,
            8
        )
        .fill(PDF_COLORS.light)
        .restore();

    // Panel top accent.

    doc
        .save()
        .roundedRect(
            x,
            y,
            contentWidth,
            5,
            3
        )
        .fill(PDF_COLORS.primary)
        .restore();

    // Panel title.

    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(PDF_COLORS.primary)
        .text(
            'LESSON OVERVIEW',
            x + 14,
            y + 15,
            {
                lineBreak: false,
                characterSpacing: 0.5,
            }
        );

    validInformation.forEach(([label, value], index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);

        const itemX =
            x + 14 + column * (columnWidth + columnGap);

        const itemY =
            y + 40 + row * rowHeight;

        const availableWidth = columnWidth - 15;

        // Field label.

        doc
            .font('Helvetica-Bold')
            .fontSize(8)
            .fillColor(PDF_COLORS.muted)
            .text(
                pdfText(label).toUpperCase(),
                itemX,
                itemY,
                {
                    width: availableWidth,
                    lineBreak: false,
                    ellipsis: true,
                }
            );

        // Field value.

        doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor(PDF_COLORS.dark)
            .text(
                pdfText(value),
                itemX,
                itemY + 12,
                {
                    width: availableWidth,
                    height: 22,
                    ellipsis: true,
                }
            );
    });

    doc.y = y + panelHeight + 12;
};

// ============================================================
// DOCUMENT TITLE PANEL
// ============================================================

const addPdfTitle = (doc, title) => {
    const contentWidth = getPdfContentWidth(doc);
    const x = doc.page.margins.left;

    const cleanTitle = pdfText(title || 'LESSON NOTE');

    const titleHeight = doc.heightOfString(cleanTitle, {
        width: contentWidth - 40,
        font: 'Helvetica-Bold',
        fontSize: 20,
        lineGap: 3,
        align: 'center',
    });

    const panelHeight = Math.max(
        88,
        titleHeight + 55
    );

    ensurePdfSpace(doc, panelHeight + 15);

    const y = doc.y;

    // Title background.

    doc
        .save()
        .roundedRect(
            x,
            y,
            contentWidth,
            panelHeight,
            9
        )
        .fill(PDF_COLORS.primary)
        .restore();

    // Gold accent.

    doc
        .save()
        .roundedRect(
            x + 18,
            y + 17,
            36,
            4,
            2
        )
        .fill(PDF_COLORS.accent)
        .restore();

    // Title.

    doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor(PDF_COLORS.white)
        .text(
            cleanTitle,
            x + 20,
            y + 31,
            {
                width: contentWidth - 40,
                align: 'center',
                lineGap: 3,
            }
        );

    doc.y = y + panelHeight + 9;

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(
            'PREPARED FOR CLASSROOM TEACHING',
            {
                align: 'center',
                characterSpacing: 0.7,
            }
        );

    doc.moveDown(0.8);
};

// ============================================================
// GENERATE PROFESSIONAL LESSON NOTE PDF
// ============================================================

const generateLessonNotePdf = (note) => {
    return new Promise((resolve, reject) => {
        try {
            if (!note || !isValidObject(note.content)) {
                return reject(
                    new Error(
                        'Invalid lesson note content for PDF generation.'
                    )
                );
            }

            const content = note.content;

            const doc = new PDFDocument({
                size: 'A4',

                margins: {
                    top: PDF_LAYOUT.top,
                    bottom: PDF_LAYOUT.bottom,
                    left: PDF_LAYOUT.left,
                    right: PDF_LAYOUT.right,
                },

                bufferPages: true,

                autoFirstPage: true,

                info: {
                    Title: note.title || 'AI Lesson Note',
                    Author: 'RGSS',
                    Subject: note.topic || 'Lesson Note',
                    Creator: 'RGSS AI Lesson Note Generator',
                },
            });

            const chunks = [];

            doc.on('data', (chunk) => {
                chunks.push(chunk);
            });

            doc.on('error', reject);

            // Draw the branded header on every new page.

            doc.on('pageAdded', () => {
                drawPdfHeader(doc);
            });

            // Draw header on the first page.

            drawPdfHeader(doc);

            doc.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            // ----------------------------------------------------
            // DOCUMENT TITLE
            // ----------------------------------------------------

            addPdfTitle(
                doc,
                note.title ||
                content.title ||
                'LESSON NOTE'
            );

            // ----------------------------------------------------
            // LESSON INFORMATION
            // ----------------------------------------------------

            const information = [
                ['Subject', content.subject],
                ['Class', content.className],
                ['Class Level', content.classLevel],
                ['Academic Term', content.term || note.term],
                ['Week', content.week || note.weekTitle],
                ['Topic', content.topic || note.topic],
                [
                    'Duration',
                    content.lessonDuration
                        ? `${content.lessonDuration} minutes`
                        : note.lessonDuration
                            ? `${note.lessonDuration} minutes`
                            : '',
                ],
            ];

            addLessonInformationPanel(doc, information);

            // ----------------------------------------------------
            // SUBTOPICS
            // ----------------------------------------------------

            if (
                Array.isArray(content.subTopics) &&
                content.subTopics.length
            ) {
                addPdfHeading(doc, 'SUBTOPICS');
                addPdfList(doc, content.subTopics);
            }

            // ----------------------------------------------------
            // LEARNING OBJECTIVES
            // ----------------------------------------------------

            if (
                Array.isArray(content.learningObjectives) &&
                content.learningObjectives.length
            ) {
                addPdfHeading(doc, 'LEARNING OBJECTIVES');
                addPdfList(doc, content.learningObjectives);
            }

            // ----------------------------------------------------
            // INSTRUCTIONAL MATERIALS
            // ----------------------------------------------------

            if (
                Array.isArray(content.instructionalMaterials) &&
                content.instructionalMaterials.length
            ) {
                addPdfHeading(doc, 'INSTRUCTIONAL MATERIALS');
                addPdfList(doc, content.instructionalMaterials);
            }

            // ----------------------------------------------------
            // PREVIOUS KNOWLEDGE
            // ----------------------------------------------------

            if (content.previousKnowledge) {
                addPdfHeading(doc, 'PREVIOUS KNOWLEDGE');
                addPdfParagraph(doc, content.previousKnowledge);
            }

            // ----------------------------------------------------
            // INTRODUCTION
            // ----------------------------------------------------

            if (content.introduction) {
                addPdfHeading(doc, 'INTRODUCTION');
                addPdfParagraph(doc, content.introduction);
            }

            // ----------------------------------------------------
            // DETAILED LESSON CONTENT
            // ----------------------------------------------------

            if (
                Array.isArray(content.lessonContent) &&
                content.lessonContent.length
            ) {
                addPdfHeading(
                    doc,
                    'DETAILED LESSON CONTENT',
                    { size: 14 }
                );

                content.lessonContent.forEach((section, index) => {
                    if (!isValidObject(section)) return;

                    addPdfHeading(
                        doc,
                        section.heading ||
                        `Lesson Section ${index + 1}`,
                        {
                            size: 11.5,
                            compact: true,
                        }
                    );

                    if (section.explanation) {
                        addPdfParagraph(
                            doc,
                            section.explanation
                        );
                    }

                    if (
                        Array.isArray(section.examples) &&
                        section.examples.length
                    ) {
                        addPdfHeading(
                            doc,
                            'Examples',
                            {
                                size: 10.5,
                                compact: true,
                            }
                        );

                        addPdfList(
                            doc,
                            section.examples,
                            { fontSize: 10.8 }
                        );
                    }
                });
            }

            // ----------------------------------------------------
            // TEACHER ACTIVITIES
            // ----------------------------------------------------

            if (
                Array.isArray(content.teacherActivities) &&
                content.teacherActivities.length
            ) {
                addPdfHeading(doc, 'TEACHER ACTIVITIES');
                addPdfList(doc, content.teacherActivities);
            }

            // ----------------------------------------------------
            // STUDENT ACTIVITIES
            // ----------------------------------------------------

            if (
                Array.isArray(content.studentActivities) &&
                content.studentActivities.length
            ) {
                addPdfHeading(doc, 'STUDENT ACTIVITIES');
                addPdfList(doc, content.studentActivities);
            }

            // ----------------------------------------------------
            // EVALUATION QUESTIONS
            // ----------------------------------------------------

            if (
                Array.isArray(content.evaluationQuestions) &&
                content.evaluationQuestions.length
            ) {
                addPdfHeading(doc, 'EVALUATION QUESTIONS');
                addPdfList(doc, content.evaluationQuestions);
            }

            // ----------------------------------------------------
            // LESSON SUMMARY
            // ----------------------------------------------------

            if (content.summary) {
                addPdfHeading(doc, 'LESSON SUMMARY');
                addPdfParagraph(doc, content.summary);
            }

            // ----------------------------------------------------
            // ASSIGNMENT
            // ----------------------------------------------------

            if (
                Array.isArray(content.assignment) &&
                content.assignment.length
            ) {
                addPdfHeading(doc, 'ASSIGNMENT');
                addPdfList(doc, content.assignment);
            }

            // ----------------------------------------------------
            // REFERENCES
            // ----------------------------------------------------

            if (
                Array.isArray(content.references) &&
                content.references.length
            ) {
                addPdfHeading(doc, 'REFERENCES');

                addPdfList(
                    doc,
                    content.references,
                    { fontSize: 10.5 }
                );
            }

            // ----------------------------------------------------
            // FOOTERS AND PAGE NUMBERS
            // ----------------------------------------------------

            addPdfFooter(doc);

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
};

// ============================================================
// REMOVE UNNECESSARY PDF DATA FROM API RESPONSES
// ============================================================

const removePdfBinary = (note) => {
    if (!note) return note;

    return {
        ...note,
        pdfAvailable: Boolean(note.pdfUrl),
    };
};

// ============================================================
// AUTHENTICATION CONTEXT
// SUPPORTS ADMIN AND TEACHER
// ============================================================

const getUserContext = (req) => {
    const userId = parseId(req.user?.id);
    const role = String(req.user?.role || '').toLowerCase();

    if (!userId) return null;

    let adminId = null;
    let teacherId = null;

    if (role === 'admin') {
        adminId = userId;
    } else if (role === 'teacher') {
        adminId = parseId(req.user?.adminId);
        teacherId = userId;
    } else {
        return null;
    }

    if (!adminId) return null;

    return {
        userId,
        role,
        adminId,
        teacherId,
        isAdmin: role === 'admin',
        isTeacher: role === 'teacher',
    };
};

// ============================================================
// VERIFY CLASS AND SUBJECT ACCESS
// ============================================================

const verifyClassSubjectAccess = async ({
    context,
    classId,
    subjectId,
}) => {
    const [schoolClass, subject] = await Promise.all([
        prisma.class.findFirst({
            where: {
                id: classId,
                adminId: context.adminId,
                isActive: true,
            },
        }),

        prisma.subject.findFirst({
            where: {
                id: subjectId,
                adminId: context.adminId,
            },
        }),
    ]);

    if (!schoolClass || !subject) return null;

    if (context.isAdmin) {
        return {
            schoolClass,
            subject,
            assignment: null,
        };
    }

    const assignment = await prisma.teacherAssignment.findFirst({
        where: {
            adminId: context.adminId,
            teacherId: context.teacherId,
            classId,
            subjectId,
            isActive: true,
        },
    });

    if (!assignment) return null;

    return {
        schoolClass,
        subject,
        assignment,
    };
};

// ============================================================
// VERIFY TEACHER CLASS ACCESS
// ============================================================

const verifyTeacherClassAccess = async ({
    context,
    schoolClass,
    classId,
}) => {
    if (context.isAdmin) return true;

    const assignment = await prisma.teacherAssignment.findFirst({
        where: {
            adminId: context.adminId,
            teacherId: context.teacherId,
            classId,
            isActive: true,
        },
    });

    const isClassTeacher =
        Number(schoolClass.teacherId) === context.teacherId;

    return Boolean(assignment || isClassTeacher);
};

// ============================================================
// NOTE OWNERSHIP FILTER
// ============================================================

const getNoteAccessFilter = (context) => {
    const filter = {
        adminId: context.adminId,
    };

    if (context.isTeacher) {
        filter.teacherId = context.teacherId;
        filter.createdByRole = 'teacher';
    }

    return filter;
};

// ============================================================
// VERIFY NOTE CREATOR
// ============================================================

const getCreatorData = (context) => {
    return {
        teacherId: context.isTeacher
            ? context.teacherId
            : null,

        createdByRole: context.role,
    };
};

// ============================================================
// 1. GET AVAILABLE ACADEMIC TERMS
// GET /lesson-notes/terms
// ============================================================

exports.getAvailableTerms = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(
                res,
                403,
                'Invalid account or school administrator information.'
            );
        }

        const terms = await prisma.term.findMany({
            where: {
                adminId: context.adminId,
            },
            orderBy: {
                startDate: 'desc',
            },
            select: {
                id: true,
                name: true,
                sessionId: true,
                startDate: true,
                endDate: true,
                nextTermBegins: true,
                status: true,
                isActive: true,
            },
        });

        return res.json({
            success: true,
            count: terms.length,
            terms,
        });

    } catch (error) {
        console.error('[GET AVAILABLE TERMS ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve academic terms.'
        );
    }
};

// ============================================================
// 2. GET AVAILABLE E-NOTES WEEKS
// GET /lesson-notes/weeks?classId=1&termId=2
// ============================================================

exports.getAvailableWeeks = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(
                res,
                403,
                'Invalid account or school administrator information.'
            );
        }

        const { adminId } = context;

        const classId = parseId(req.query.classId);
        const termId = parseId(req.query.termId);

        if (!classId || !termId) {
            return sendError(
                res,
                400,
                'Valid class and academic term are required.'
            );
        }

        const [schoolClass, term] = await Promise.all([
            prisma.class.findFirst({
                where: {
                    id: classId,
                    adminId,
                    isActive: true,
                },
            }),

            prisma.term.findFirst({
                where: {
                    id: termId,
                    adminId,
                },
            }),
        ]);

        if (!schoolClass) {
            return sendError(
                res,
                404,
                'Selected class was not found in your school.'
            );
        }

        if (!term) {
            return sendError(
                res,
                404,
                'Selected academic term was not found.'
            );
        }

        const hasAccess = await verifyTeacherClassAccess({
            context,
            schoolClass,
            classId,
        });

        if (!hasAccess) {
            return sendError(
                res,
                403,
                'You are not assigned to this class.'
            );
        }

        const weeks = await prisma.eNoteWeek.findMany({
            where: {
                adminId,
                classId,
                termId,
            },
            orderBy: {
                createdAt: 'asc',
            },
            select: {
                id: true,
                title: true,
                classId: true,
                termId: true,
                createdAt: true,
            },
        });

        return res.status(200).json({
            success: true,
            count: weeks.length,
            role: context.role,

            class: {
                id: schoolClass.id,
                name: schoolClass.name,
            },

            term: {
                id: term.id,
                name: term.name,
                sessionId: term.sessionId,
            },

            weeks,
        });

    } catch (error) {
        console.error('[GET AVAILABLE WEEKS ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve E-Notes weeks.'
        );
    }
};

// ============================================================
// 3. GENERATE AI LESSON NOTE
// POST /lesson-notes/generate
//
// GENERATES AND SAVES A DRAFT.
// PDF IS GENERATED LATER WHEN THE NOTE IS SAVED.
// ============================================================

exports.generateLessonNote = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(
                res,
                403,
                'Invalid account or school administrator information.'
            );
        }

        if (!GROQ_API_KEY) {
            return sendError(
                res,
                503,
                'Groq AI is not configured. Check your API key.'
            );
        }

        const {
            topic,
            subTopics,
            lessonDuration,
            additionalInstructions,
        } = req.body;

        const classId = parseId(req.body.classId);
        const subjectId = parseId(req.body.subjectId);
        const termId = parseId(req.body.termId);
        const weekId = parseId(req.body.weekId);

        if (!classId || !subjectId) {
            return sendError(
                res,
                400,
                'Please select a valid class and subject.'
            );
        }

        if (!termId || !weekId) {
            return sendError(
                res,
                400,
                'Please select an academic term and E-Notes week.'
            );
        }

        if (typeof topic !== 'string' || !topic.trim()) {
            return sendError(
                res,
                400,
                'Please enter the lesson topic.'
            );
        }

        if (topic.trim().length > 300) {
            return sendError(
                res,
                400,
                'Lesson topic must not exceed 300 characters.'
            );
        }

        if (
            additionalInstructions !== undefined &&
            typeof additionalInstructions !== 'string'
        ) {
            return sendError(
                res,
                400,
                'Additional instructions must be text.'
            );
        }

        const duration =
            lessonDuration === undefined ||
            lessonDuration === null ||
            lessonDuration === ''
                ? 40
                : Number(lessonDuration);

        if (
            !Number.isInteger(duration) ||
            duration < 10 ||
            duration > 240
        ) {
            return sendError(
                res,
                400,
                'Lesson duration must be between 10 and 240 minutes.'
            );
        }

        if (
            subTopics !== undefined &&
            (
                !Array.isArray(subTopics) ||
                !subTopics.every(item => typeof item === 'string')
            )
        ) {
            return sendError(
                res,
                400,
                'Subtopics must be an array of text values.'
            );
        }

        const verified = await verifyClassSubjectAccess({
            context,
            classId,
            subjectId,
        });

        if (!verified) {
            return sendError(
                res,
                403,
                'You are not authorized to generate a lesson note for this class and subject.'
            );
        }

        const { schoolClass, subject } = verified;

        const selectedTerm = await prisma.term.findFirst({
            where: {
                id: termId,
                adminId: context.adminId,
            },
        });

        if (!selectedTerm) {
            return sendError(
                res,
                404,
                'Selected academic term was not found.'
            );
        }

        const selectedWeek = await prisma.eNoteWeek.findFirst({
            where: {
                id: weekId,
                adminId: context.adminId,
                classId,
                termId,
            },
        });

        if (!selectedWeek) {
            return sendError(
                res,
                404,
                'Selected E-Notes week does not belong to this class and term.'
            );
        }

        const className = schoolClass.name;
        const classLevel = schoolClass.level || schoolClass.name;
        const subjectName = subject.name;
        const termName = selectedTerm.name;
        const weekTitle = selectedWeek.title;

        const weekMatch = weekTitle.match(/\b(\d+)\b/);
        const weekNumber = weekMatch ? Number(weekMatch[1]) : null;

        const topicSubTopics = Array.isArray(subTopics)
            ? subTopics
                .filter(item => item.trim())
                .map(item => item.trim())
            : [];

        const cleanTopic = topic.trim();

        const extraInstructions =
            String(additionalInstructions || 'None').slice(0, 3000);

        const systemPrompt = `
You are an experienced Nigerian secondary school teacher,
professional curriculum developer and educational content writer.

Prepare comprehensive, accurate and well-structured lesson notes
for Nigerian schools.

Use clear educational English suitable for the specified class,
subject and age group.

Use Nigerian educational examples where appropriate.

Do not claim that a lesson has been officially verified by NERDC.

Do not invent official curriculum references, textbook editions,
page numbers or examination requirements.

Ensure scientific, mathematical and technical explanations are accurate.

Return ONLY valid JSON. Do not include Markdown code fences.
`;

        const userPrompt = `
Prepare a comprehensive teacher's lesson note.

SCHOOL CLASS: ${className}
CLASS LEVEL: ${classLevel}
SUBJECT: ${subjectName}
ACADEMIC TERM: ${termName}
SCHOOL E-NOTES WEEK: ${weekTitle}
LESSON TOPIC: ${cleanTopic}
LESSON DURATION: ${duration} minutes

TEACHER-PROVIDED SUBTOPICS:
${JSON.stringify(topicSubTopics)}

ADDITIONAL INSTRUCTIONS:
${extraInstructions}

Include:

1. Lesson title
2. Subject and class information
3. Learning objectives
4. Instructional materials
5. Previous knowledge
6. Introduction
7. Detailed lesson content
8. Practical examples
9. Teacher activities
10. Student activities
11. Evaluation questions
12. Lesson summary
13. Assignment
14. References where reliable references are known

Provide detailed explanations, not just headings.

Return JSON using this structure:

${JSON.stringify({
    title: 'Lesson title',
    subject: subjectName,
    className,
    classLevel,
    term: termName,
    week: weekTitle,
    topic: cleanTopic,
    subTopics: [],
    lessonDuration: duration,
    learningObjectives: [],
    instructionalMaterials: [],
    previousKnowledge: '',
    introduction: '',
    lessonContent: [
        {
            heading: '',
            explanation: '',
            examples: [],
        },
    ],
    teacherActivities: [],
    studentActivities: [],
    evaluationQuestions: [],
    summary: '',
    assignment: [],
    references: [],
}, null, 2)}

All list fields must be arrays.
All explanations must be meaningful and detailed.
`;

        const completion = await groq.chat.completions.create({
            model: GROQ_MODEL,

            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: userPrompt,
                },
            ],

            temperature: 0.5,
            max_tokens: 8000,

            response_format: {
                type: 'json_object',
            },
        });

        const aiResponse =
            completion.choices?.[0]?.message?.content;

        const generatedContent = parseAIJson(aiResponse);

        if (
            !isValidObject(generatedContent) ||
            typeof generatedContent.title !== 'string' ||
            !generatedContent.title.trim() ||
            !Array.isArray(generatedContent.lessonContent)
        ) {
            throw new Error(
                'The AI response did not contain a valid lesson note.'
            );
        }

        const creatorData = getCreatorData(context);

        const noteData = {
            adminId: context.adminId,

            ...creatorData,

            classId,
            subjectId,

            termId,
            term: termName,

            weekId,
            weekTitle,
            week: weekNumber,

            topic: cleanTopic,

            subTopics: topicSubTopics,
            lessonDuration: duration,

            curriculumSource: 'Teacher-entered topic',

            title: generatedContent.title.trim(),
            content: generatedContent,

            aiProvider: 'groq',
            aiModel: GROQ_MODEL,

            status: 'draft',

            pdfUrl: null,
            pdfPublicId: null,
            pdfFileName: null,
            pdfMimeType: 'application/pdf',
            pdfSize: null,
            pdfGeneratedAt: null,
        };

        const savedNote = await prisma.aILessonNote.create({
            data: noteData,
        });

        console.log(
            '[AI LESSON NOTE] Draft created. ID:',
            savedNote.id
        );

        return res.status(201).json({
            success: true,
            message:
                'Lesson note generated successfully. Review it and save it to create the PDF.',
            note: removePdfBinary(savedNote),
        });

    } catch (error) {
        console.error('[AI LESSON NOTE GENERATION ERROR]:', error);

        if (error.status === 429) {
            return sendError(
                res,
                429,
                'Groq AI rate limit reached. Please try again later.'
            );
        }

        if (error.status === 401) {
            return sendError(
                res,
                503,
                'Groq API authentication failed. Check your API key.'
            );
        }

        if (error.status === 400) {
            return sendError(
                res,
                400,
                error.message || 'Groq rejected the generation request.'
            );
        }

        return sendError(
            res,
            500,
            error.message || 'Unable to generate lesson note.'
        );
    }
};

// ============================================================
// 4. UPDATE / EDIT LESSON NOTE
// PUT /lesson-notes/:id
// ============================================================

exports.updateLessonNote = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

        const noteId = parseId(req.params.id);

        if (!noteId) {
            return sendError(res, 400, 'Invalid lesson note ID.');
        }

        const accessFilter = getNoteAccessFilter(context);

        const existingNote = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...accessFilter,
            },
        });

        if (!existingNote) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        const {
            title,
            content,
            topic,
            subTopics,
            lessonDuration,
        } = req.body;

        const updateData = {};

        if (title !== undefined) {
            if (
                typeof title !== 'string' ||
                !title.trim() ||
                title.trim().length > 300
            ) {
                return sendError(
                    res,
                    400,
                    'A valid title is required.'
                );
            }

            updateData.title = title.trim();
        }

        if (topic !== undefined) {
            if (
                typeof topic !== 'string' ||
                !topic.trim() ||
                topic.trim().length > 300
            ) {
                return sendError(
                    res,
                    400,
                    'A valid topic is required.'
                );
            }

            updateData.topic = topic.trim();
        }

        if (content !== undefined) {
            if (!isValidObject(content)) {
                return sendError(
                    res,
                    400,
                    'Lesson content must be a valid JSON object.'
                );
            }

            updateData.content = content;
        }

        if (subTopics !== undefined) {
            if (
                !Array.isArray(subTopics) ||
                !subTopics.every(item => typeof item === 'string')
            ) {
                return sendError(
                    res,
                    400,
                    'Subtopics must be an array of text values.'
                );
            }

            updateData.subTopics = subTopics
                .map(item => item.trim())
                .filter(Boolean);
        }

        if (lessonDuration !== undefined) {
            const duration = Number(lessonDuration);

            if (
                !Number.isInteger(duration) ||
                duration < 10 ||
                duration > 240
            ) {
                return sendError(
                    res,
                    400,
                    'Invalid lesson duration.'
                );
            }

            updateData.lessonDuration = duration;
        }

        if (Object.keys(updateData).length === 0) {
            return sendError(
                res,
                400,
                'No valid changes were provided.'
            );
        }

        const oldPdfPublicId = existingNote.pdfPublicId;

        updateData.pdfUrl = null;
        updateData.pdfPublicId = null;
        updateData.pdfFileName = null;
        updateData.pdfMimeType = 'application/pdf';
        updateData.pdfSize = null;
        updateData.pdfGeneratedAt = null;

        const updatedNoteResult = await prisma.aILessonNote.updateMany({
            where: {
                id: noteId,
                ...accessFilter,
            },
            data: updateData,
        });

        if (updatedNoteResult.count === 0) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        if (oldPdfPublicId) {
            await deleteCloudinaryPdf(oldPdfPublicId);
        }

        const note = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...accessFilter,
            },
        });

        return res.json({
            success: true,
            message:
                'Lesson note updated successfully. Save it again to generate its updated PDF.',
            note: removePdfBinary(note),
        });

    } catch (error) {
        console.error('[UPDATE LESSON NOTE ERROR]:', error);

        return sendError(
            res,
            500,
            error.message || 'Unable to update lesson note.'
        );
    }
};

// ============================================================
// 5. SAVE COMPLETED LESSON NOTE
// POST /lesson-notes/:id/save
// ============================================================

exports.saveLessonNote = async (req, res) => {
    let uploadedPdfPublicId = null;

    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

        if (!isCloudinaryConfigured()) {
            return sendError(
                res,
                503,
                'Cloudinary is not configured. Please configure your Cloudinary environment variables.'
            );
        }

        const noteId = parseId(req.params.id);

        if (!noteId) {
            return sendError(res, 400, 'Invalid lesson note ID.');
        }

        const accessFilter = getNoteAccessFilter(context);

        const existingNote = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...accessFilter,
            },
        });

        if (!existingNote) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        if (!isValidObject(existingNote.content)) {
            return sendError(
                res,
                400,
                'This lesson note has invalid content and cannot be converted to PDF.'
            );
        }

        console.log(
            '[AI LESSON NOTE] Generating PDF for note:',
            noteId
        );

        // Generate the professionally designed PDF.

        const pdfBuffer = await generateLessonNotePdf(existingNote);

        if (!pdfBuffer || !pdfBuffer.length) {
            throw new Error('Generated PDF is empty.');
        }

        const pdfFilename =
            `${safeFilename(existingNote.title)}-${noteId}-${Date.now()}.pdf`;

        // Upload PDF to Cloudinary.

        const uploadResult = await uploadPdfToCloudinary(
            pdfBuffer,
            pdfFilename
        );

        uploadedPdfPublicId = uploadResult.pdfPublicId;

        console.log(
            '[AI LESSON NOTE] PDF uploaded to Cloudinary:',
            uploadResult.pdfUrl
        );

        // Save PDF metadata in PostgreSQL.

        const updatedNoteResult = await prisma.aILessonNote.updateMany({
            where: {
                id: noteId,
                ...accessFilter,
            },

            data: {
                status: 'saved',

                pdfUrl: uploadResult.pdfUrl,
                pdfPublicId: uploadResult.pdfPublicId,
                pdfFileName: pdfFilename,
                pdfMimeType: 'application/pdf',
                pdfSize: uploadResult.pdfSize,
                pdfGeneratedAt: new Date(),
            },
        });

        if (updatedNoteResult.count === 0) {
            throw new Error(
                'Lesson note could not be updated after PDF upload.'
            );
        }

        // Remove the previous PDF after the new PDF is saved.

        if (
            existingNote.pdfPublicId &&
            existingNote.pdfPublicId !== uploadResult.pdfPublicId
        ) {
            await deleteCloudinaryPdf(existingNote.pdfPublicId);
        }

        const note = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...accessFilter,
            },
        });

        uploadedPdfPublicId = null;

        console.log(
            '[AI LESSON NOTE] Saved successfully with Cloudinary PDF. ID:',
            noteId
        );

        return res.json({
            success: true,
            message:
                'Lesson note saved successfully and PDF uploaded to Cloudinary.',
            note: removePdfBinary(note),
        });

    } catch (error) {
        if (uploadedPdfPublicId) {
            await deleteCloudinaryPdf(uploadedPdfPublicId);
        }

        console.error('[SAVE LESSON NOTE ERROR]:', error);

        return sendError(
            res,
            500,
            error.message || 'Unable to save lesson note.'
        );
    }
};

// ============================================================
// 6. GET ALL LESSON NOTES
// GET /lesson-notes
// ============================================================

exports.getLessonNotes = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

        const where = getNoteAccessFilter(context);

        if (req.query.classId) {
            const classId = parseId(req.query.classId);

            if (!classId) {
                return sendError(res, 400, 'Invalid class ID.');
            }

            where.classId = classId;
        }

        if (req.query.subjectId) {
            const subjectId = parseId(req.query.subjectId);

            if (!subjectId) {
                return sendError(res, 400, 'Invalid subject ID.');
            }

            where.subjectId = subjectId;
        }

        if (req.query.termId) {
            const termId = parseId(req.query.termId);

            if (!termId) {
                return sendError(res, 400, 'Invalid term ID.');
            }

            where.termId = termId;
        }

        if (req.query.weekId) {
            const weekId = parseId(req.query.weekId);

            if (!weekId) {
                return sendError(res, 400, 'Invalid week ID.');
            }

            where.weekId = weekId;
        }

        if (req.query.term) {
            where.term = String(req.query.term);
        }

        if (req.query.status) {
            const allowedStatuses = [
                'draft',
                'saved',
                'archived',
            ];

            if (!allowedStatuses.includes(req.query.status)) {
                return sendError(res, 400, 'Invalid note status.');
            }

            where.status = req.query.status;
        }

        const notes = await prisma.aILessonNote.findMany({
            where,
            orderBy: {
                updatedAt: 'desc',
            },
        });

        return res.json({
            success: true,
            count: notes.length,
            role: context.role,
            notes: notes.map(removePdfBinary),
        });

    } catch (error) {
        console.error('[GET LESSON NOTES ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve lesson notes.'
        );
    }
};

// ============================================================
// 7. GET ONE LESSON NOTE
// GET /lesson-notes/:id
// ============================================================

exports.getLessonNote = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

        const noteId = parseId(req.params.id);

        if (!noteId) {
            return sendError(res, 400, 'Invalid lesson note ID.');
        }

        const note = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...getNoteAccessFilter(context),
            },
        });

        if (!note) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        return res.json({
            success: true,
            note: removePdfBinary(note),
        });

    } catch (error) {
        console.error('[GET LESSON NOTE ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve lesson note.'
        );
    }
};

// ============================================================
// 8. GET LESSON NOTE PDF
// GET /lesson-notes/:id/pdf
// ============================================================

exports.getLessonNotePdf = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

        const noteId = parseId(req.params.id);

        if (!noteId) {
            return sendError(res, 400, 'Invalid lesson note ID.');
        }

        const note = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...getNoteAccessFilter(context),
            },

            select: {
                id: true,
                title: true,
                pdfUrl: true,
                pdfFileName: true,
                pdfMimeType: true,
                pdfGeneratedAt: true,
            },
        });

        if (!note) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        if (!note.pdfUrl) {
            return sendError(
                res,
                404,
                'PDF is not available for this lesson note. Save the lesson note to generate it.'
            );
        }

        res.setHeader('Cache-Control', 'private, no-store');

        return res.redirect(302, note.pdfUrl);

    } catch (error) {
        console.error('[GET LESSON NOTE PDF ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve lesson note PDF.'
        );
    }
};

// ============================================================
// 9. DELETE LESSON NOTE
// DELETE /lesson-notes/:id
// ============================================================

exports.deleteLessonNote = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

        const noteId = parseId(req.params.id);

        if (!noteId) {
            return sendError(res, 400, 'Invalid lesson note ID.');
        }

        const accessFilter = getNoteAccessFilter(context);

        const existingNote = await prisma.aILessonNote.findFirst({
            where: {
                id: noteId,
                ...accessFilter,
            },

            select: {
                id: true,
                pdfPublicId: true,
            },
        });

        if (!existingNote) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        const deletedNote = await prisma.aILessonNote.deleteMany({
            where: {
                id: noteId,
                ...accessFilter,
            },
        });

        if (deletedNote.count === 0) {
            return sendError(res, 404, 'Lesson note not found.');
        }

        if (existingNote.pdfPublicId) {
            await deleteCloudinaryPdf(existingNote.pdfPublicId);
        }

        return res.json({
            success: true,
            message:
                'Lesson note and its Cloudinary PDF deleted successfully.',
        });

    } catch (error) {
        console.error('[DELETE LESSON NOTE ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to delete lesson note.'
        );
    }
};
