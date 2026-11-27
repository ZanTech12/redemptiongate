
const OpenAI = require('openai');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const cloudinary = require('cloudinary').v2;
const prisma = require('../config/db');

// ============================================================
// RGSS ADVANCED AI LESSON NOTE GENERATOR
// GROQ + LATEX + MATHJAX + PDFKIT + CLOUDINARY
// ============================================================

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
    timeout: 180000,
});

// ============================================================
// MATHJAX CONFIGURATION
// ============================================================

let mathJaxDocument = null;
let mathJaxAdaptor = null;

const initializeMathJax = () => {
    if (mathJaxDocument) return;

    const { mathjax } = require('mathjax-full/js/mathjax.js');
    const { TeX } = require('mathjax-full/js/input/tex.js');
    const { SVG } = require('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
    const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

    mathJaxAdaptor = liteAdaptor();

    RegisterHTMLHandler(mathJaxAdaptor);

    const tex = new TeX({
        packages: AllPackages,
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']],
        processEscapes: true,
    });

    const svg = new SVG({
        fontCache: 'none',
        scale: 1,
    });

    mathJaxDocument = mathjax.document('', {
        InputJax: tex,
        OutputJax: svg,
    });
};

const renderLatexToSvg = (latex, display = true) => {
    initializeMathJax();

    if (typeof latex !== 'string' || !latex.trim()) {
        throw new Error('Invalid mathematical expression.');
    }

    const node = mathJaxDocument.convert(latex.trim(), {
        display,
    });

    return mathJaxAdaptor.outerHTML(node);
};

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

const cleanArray = (value) => {
    return Array.isArray(value) ? value : [];
};

const cleanString = (value, fallback = '') => {
    return typeof value === 'string' ? value.trim() : fallback;
};

const normalizeLessonContent = (content) => {
    const arrayFields = [
        'subTopics',
        'learningObjectives',
        'instructionalMaterials',
        'keyTerms',
        'formulaSheet',
        'workedExamples',
        'practicalApplications',
        'diagramDescriptions',
        'teacherActivities',
        'studentActivities',
        'differentiatedLearning',
        'commonMisconceptions',
        'evaluationQuestions',
        'evaluationAnswers',
        'assignment',
        'references',
        'furtherReading',
    ];

    arrayFields.forEach((field) => {
        if (!Array.isArray(content[field])) {
            content[field] = [];
        }
    });

    if (!Array.isArray(content.lessonContent)) {
        content.lessonContent = [];
    }

    content.lessonContent = content.lessonContent.filter(
        isValidObject
    );

    content.lessonContent.forEach((section) => {
        section.examples = cleanArray(section.examples);
        section.keyTerms = cleanArray(section.keyTerms);
        section.formulas = cleanArray(section.formulas);
        section.workedExamples = cleanArray(section.workedExamples);
        section.practicalApplications = cleanArray(section.practicalApplications);
        section.diagramDescriptions = cleanArray(section.diagramDescriptions);
        section.commonMisconceptions = cleanArray(section.commonMisconceptions);
        section.activities = cleanArray(section.activities);
    });

    return content;
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

const uploadPdfToCloudinary = (pdfBuffer, filename) => {
    return new Promise((resolve, reject) => {
        if (!isCloudinaryConfigured()) {
            return reject(
                new Error('Cloudinary is not configured.')
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
                if (error) return reject(error);

                if (!result || !result.secure_url || !result.public_id) {
                    return reject(
                        new Error('Cloudinary did not return a valid PDF URL.')
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
            console.warn('[CLOUDINARY DELETE]:', result);
        }
    } catch (error) {
        console.error(
            '[CLOUDINARY DELETE ERROR]:',
            error.message
        );
    }
};

// ============================================================
// PDF CONFIGURATION
// ============================================================

const safeFilename = (value) => {
    return String(value || 'lesson-note')
        .replace(/[^a-z0-9-_]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'lesson-note';
};

const pdfText = (value) => {
    if (value === null || value === undefined) return '';

    if (typeof value === 'string') return value.trim();

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map(pdfText).filter(Boolean).join(', ');
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return '';
};

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

const ensurePdfSpace = (doc, requiredHeight = 45) => {
    const bottomLimit =
        doc.page.height - doc.page.margins.bottom;

    if (doc.y + requiredHeight > bottomLimit) {
        doc.addPage();
    }
};

// ============================================================
// PDF HEADER
// ============================================================

const drawPdfHeader = (doc) => {
    const pageWidth = doc.page.width;

    doc.save();

    doc.rect(0, 0, pageWidth, 10)
        .fill(PDF_COLORS.primary);

    doc.rect(0, 10, pageWidth, 3)
        .fill(PDF_COLORS.accent);

    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(PDF_COLORS.primary)
        .text('RGSS', PDF_LAYOUT.left, 27, {
            lineBreak: false,
        });

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text('AI LESSON NOTE', PDF_LAYOUT.left + 34, 28, {
            lineBreak: false,
        });

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text(
            'ADVANCED TEACHER RESOURCE',
            pageWidth - PDF_LAYOUT.right - 150,
            28,
            {
                width: 150,
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
            .moveTo(PDF_LAYOUT.left, footerY - 10)
            .lineTo(doc.page.width - PDF_LAYOUT.right, footerY - 10)
            .lineWidth(0.7)
            .strokeColor(PDF_COLORS.border)
            .stroke();

        doc
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .fillColor(PDF_COLORS.primary)
            .text(
                'RGSS | ADVANCED AI LESSON NOTE',
                PDF_LAYOUT.left,
                footerY,
                { lineBreak: false }
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

const addPdfHeading = (doc, heading, options = {}) => {
    const value = pdfText(heading);
    if (!value) return;

    const size = options.size || 12.5;
    const contentWidth = getPdfContentWidth(doc);

    const textWidth = contentWidth - 30;

    const headingHeight = doc.heightOfString(value, {
        width: textWidth,
        font: 'Helvetica-Bold',
        fontSize: size,
        lineGap: 2,
    });

    const boxHeight = Math.max(27, headingHeight + 13);

    ensurePdfSpace(doc, boxHeight + 18);

    const x = doc.page.margins.left;
    const y = doc.y + (options.compact ? 3 : 8);

    doc
        .save()
        .roundedRect(x, y, contentWidth, boxHeight, 5)
        .fill(PDF_COLORS.light)
        .restore();

    doc
        .save()
        .roundedRect(x, y, 4, boxHeight, 2)
        .fill(PDF_COLORS.secondary)
        .restore();

    doc
        .font('Helvetica-Bold')
        .fontSize(size)
        .fillColor(options.color || PDF_COLORS.primary)
        .text(value, x + 14, y + 7, {
            width: textWidth,
            lineGap: 2,
        });

    doc.y = y + boxHeight + 8;
};

// ============================================================
// BASIC PDF PARAGRAPH
// ============================================================

const addPdfPlainParagraph = (doc, value, options = {}) => {
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
// LATEX DETECTION
// SUPPORTS:
// $...$
// $$...$$
// \(...\)
// \[...\]
// ============================================================

const splitLatexContent = (value) => {
    const text = String(value || '');

    const regex =
        /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\]|(?<!\\)\$[^$\n]+\$)/g;

    const segments = [];

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({
                type: 'text',
                value: text.slice(lastIndex, match.index),
            });
        }

        const expression = match[0];

        let latex = expression;

        if (expression.startsWith('$$')) {
            latex = expression.slice(2, -2);
        } else if (expression.startsWith('\\[')) {
            latex = expression.slice(2, -2);
        } else if (expression.startsWith('\\(')) {
            latex = expression.slice(2, -2);
        } else if (expression.startsWith('$')) {
            latex = expression.slice(1, -1);
        }

        segments.push({
            type: 'math',
            value: latex.trim(),
        });

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        segments.push({
            type: 'text',
            value: text.slice(lastIndex),
        });
    }

    return segments;
};

// ============================================================
// RENDER LATEX INTO PDF
// ============================================================

const addPdfMath = async (doc, latex, options = {}) => {
    try {
        const svgMarkup = renderLatexToSvg(latex, true);

        const viewBoxMatch = svgMarkup.match(
            /viewBox=["']([^"']+)["']/
        );

        if (!viewBoxMatch) {
            throw new Error('Invalid MathJax SVG viewBox.');
        }

        const dimensions = viewBoxMatch[1]
            .trim()
            .split(/\s+/)
            .map(Number);

        const originalWidth = dimensions[2];
        const originalHeight = dimensions[3];

        if (
            !originalWidth ||
            !originalHeight ||
            !Number.isFinite(originalWidth) ||
            !Number.isFinite(originalHeight)
        ) {
            throw new Error('Invalid mathematical dimensions.');
        }

        const contentWidth = getPdfContentWidth(doc);

        const desiredWidth = Math.min(
            contentWidth,
            Math.max(70, originalWidth * 0.55)
        );

        const desiredHeight =
            desiredWidth * (originalHeight / originalWidth);

        ensurePdfSpace(doc, desiredHeight + 20);

        const x =
            doc.page.margins.left +
            (contentWidth - desiredWidth) / 2;

        const y = doc.y + 5;

        doc.save();

        SVGtoPDF(
            doc,
            svgMarkup,
            x,
            y,
            {
                width: desiredWidth,
                height: desiredHeight,
                preserveAspectRatio: 'xMidYMid meet',
            }
        );

        doc.restore();

        doc.y = y + desiredHeight + 10;

    } catch (error) {
        console.error(
            '[LATEX PDF RENDER ERROR]:',
            error.message
        );

        addPdfPlainParagraph(
            doc,
            `Mathematical expression: ${latex}`,
            { fontSize: 9.5 }
        );
    }
};

// ============================================================
// LATEX-AWARE PARAGRAPH
// ============================================================

const addPdfParagraph = async (doc, value, options = {}) => {
    const segments = splitLatexContent(pdfText(value));

    for (const segment of segments) {
        if (!segment.value.trim()) continue;

        if (segment.type === 'math') {
            await addPdfMath(doc, segment.value, options);
        } else {
            await addPdfPlainParagraph(doc, segment.value, options);
        }
    }
};

// ============================================================
// PDF BULLET LIST
// ============================================================

const addPdfList = async (doc, items, options = {}) => {
    if (!Array.isArray(items) || !items.length) return;

    const fontSize = options.fontSize || 11.2;
    const contentWidth = getPdfContentWidth(doc);

    for (const item of items) {
        const value = pdfText(item);
        if (!value) continue;

        const segments = splitLatexContent(value);

        const containsMath = segments.some(
            segment => segment.type === 'math'
        );

        if (containsMath) {
            doc
                .save()
                .circle(
                    doc.page.margins.left + 5,
                    doc.y + 7,
                    2
                )
                .fill(PDF_COLORS.accent)
                .restore();

            await addPdfParagraph(doc, value, {
                fontSize,
            });

            continue;
        }

        const textHeight = doc.heightOfString(value, {
            width: contentWidth - 24,
            font: 'Helvetica',
            fontSize,
            lineGap: 3.5,
        });

        ensurePdfSpace(doc, Math.min(textHeight + 12, 90));

        const bulletY = doc.y + 4;

        doc
            .save()
            .circle(
                doc.page.margins.left + 5,
                bulletY + 2,
                2
            )
            .fill(PDF_COLORS.accent)
            .restore();

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
                    lineGap: 3.5,
                    paragraphGap: 5,
                }
            );

        doc.moveDown(0.2);
    }

    doc.moveDown(0.2);
};

// ============================================================
// KEY TERM / DEFINITION PANEL
// ============================================================

const addPdfKeyTerms = async (doc, terms) => {
    if (!Array.isArray(terms) || !terms.length) return;

    for (const item of terms) {
        if (typeof item === 'string') {
            await addPdfParagraph(doc, item);
            continue;
        }

        if (!isValidObject(item)) continue;

        const term = pdfText(item.term || item.name);
        const definition = pdfText(
            item.definition || item.meaning
        );

        if (!term && !definition) continue;

        ensurePdfSpace(doc, 65);

        const y = doc.y;
        const x = doc.page.margins.left;
        const width = getPdfContentWidth(doc);

        doc
            .save()
            .roundedRect(x, y, width, 48, 5)
            .fill(PDF_COLORS.paleGold)
            .restore();

        doc
            .font('Helvetica-Bold')
            .fontSize(10.5)
            .fillColor(PDF_COLORS.primary)
            .text(term, x + 12, y + 8, {
                width: width - 24,
            });

        doc.y = y + 27;

        if (definition) {
            await addPdfParagraph(doc, definition, {
                fontSize: 10,
            });
        }

        doc.moveDown(0.3);
    }
};

// ============================================================
// WORKED EXAMPLES
// ============================================================

const addPdfWorkedExamples = async (doc, examples) => {
    if (!Array.isArray(examples) || !examples.length) return;

    for (let index = 0; index < examples.length; index++) {
        const example = examples[index];

        if (typeof example === 'string') {
            addPdfHeading(
                doc,
                `Worked Example ${index + 1}`,
                { size: 10.5, compact: true }
            );

            await addPdfParagraph(doc, example);
            continue;
        }

        if (!isValidObject(example)) continue;

        addPdfHeading(
            doc,
            example.title || `Worked Example ${index + 1}`,
            { size: 10.5, compact: true }
        );

        if (example.question) {
            await addPdfParagraph(doc, `Question: ${example.question}`);
        }

        if (example.given) {
            addPdfParagraph(doc, `Given: ${pdfText(example.given)}`);
        }

        if (example.formula) {
            addPdfHeading(doc, 'Formula', {
                size: 9.5,
                compact: true,
            });

            await addPdfParagraph(doc, example.formula);
        }

        if (example.steps) {
            const steps = Array.isArray(example.steps)
                ? example.steps
                : [example.steps];

            for (let step = 0; step < steps.length; step++) {
                await addPdfParagraph(
                    doc,
                    `${step + 1}. ${pdfText(steps[step])}`,
                    { fontSize: 10.5 }
                );
            }
        }

        if (example.solution) {
            addPdfHeading(doc, 'Solution', {
                size: 9.5,
                compact: true,
            });

            await addPdfParagraph(doc, example.solution);
        }

        if (example.answer !== undefined) {
            await addPdfParagraph(
                doc,
                `Final Answer: ${pdfText(example.answer)}`
            );
        }

        if (example.explanation) {
            await addPdfParagraph(doc, example.explanation);
        }
    }
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

    doc
        .save()
        .roundedRect(x, y, contentWidth, panelHeight, 8)
        .fill(PDF_COLORS.light)
        .restore();

    doc
        .save()
        .roundedRect(x, y, contentWidth, 5, 3)
        .fill(PDF_COLORS.primary)
        .restore();

    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(PDF_COLORS.primary)
        .text('LESSON OVERVIEW', x + 14, y + 15, {
            lineBreak: false,
            characterSpacing: 0.5,
        });

    validInformation.forEach(([label, value], index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);

        const itemX =
            x + 14 + column * (columnWidth + columnGap);

        const itemY = y + 40 + row * rowHeight;

        const availableWidth = columnWidth - 15;

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

        doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor(PDF_COLORS.dark)
            .text(pdfText(value), itemX, itemY + 12, {
                width: availableWidth,
                height: 22,
                ellipsis: true,
            });
    });

    doc.y = y + panelHeight + 12;
};

// ============================================================
// PDF TITLE
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

    const panelHeight = Math.max(88, titleHeight + 55);

    ensurePdfSpace(doc, panelHeight + 15);

    const y = doc.y;

    doc
        .save()
        .roundedRect(x, y, contentWidth, panelHeight, 9)
        .fill(PDF_COLORS.primary)
        .restore();

    doc
        .save()
        .roundedRect(x + 18, y + 17, 36, 4, 2)
        .fill(PDF_COLORS.accent)
        .restore();

    doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor(PDF_COLORS.white)
        .text(cleanTitle, x + 20, y + 31, {
            width: contentWidth - 40,
            align: 'center',
            lineGap: 3,
        });

    doc.y = y + panelHeight + 9;

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(PDF_COLORS.muted)
        .text('PREPARED FOR CLASSROOM TEACHING', {
            align: 'center',
            characterSpacing: 0.7,
        });

    doc.moveDown(0.8);
};

// ============================================================
// GENERIC PDF CONTENT SECTION
// ============================================================

const addPdfGenericSection = async (
    doc,
    heading,
    value,
    options = {}
) => {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return;
    }

    addPdfHeading(doc, heading, {
        size: options.size || 11.5,
        compact: options.compact === true,
    });

    if (Array.isArray(value)) {
        if (options.definitions) {
            await addPdfKeyTerms(doc, value);
        } else {
            await addPdfList(doc, value);
        }
    } else if (isValidObject(value)) {
        await addPdfParagraph(doc, pdfText(value));
    } else {
        await addPdfParagraph(doc, value);
    }
};

// ============================================================
// GENERATE ADVANCED LESSON NOTE PDF
// ============================================================

const generateLessonNotePdf = async (note) => {
    if (!note || !isValidObject(note.content)) {
        throw new Error('Invalid lesson note content.');
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
            Creator: 'RGSS Advanced AI Lesson Note Generator',
        },
    });

    const chunks = [];

    const pdfPromise = new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('error', reject);
        doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    doc.on('pageAdded', () => drawPdfHeader(doc));

    drawPdfHeader(doc);

    try {
        // TITLE

        addPdfTitle(
            doc,
            note.title || content.title || 'LESSON NOTE'
        );

        // OVERVIEW

        addLessonInformationPanel(doc, [
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
        ]);

        // SUBTOPICS

        await addPdfGenericSection(
            doc,
            'SUBTOPICS',
            content.subTopics
        );

        // OBJECTIVES

        await addPdfGenericSection(
            doc,
            'LEARNING OBJECTIVES',
            content.learningObjectives
        );

        // LEARNING OUTCOMES

        await addPdfGenericSection(
            doc,
            'EXPECTED LEARNING OUTCOMES',
            content.learningOutcomes
        );

        // MATERIALS

        await addPdfGenericSection(
            doc,
            'INSTRUCTIONAL MATERIALS',
            content.instructionalMaterials
        );

        // KEY TERMS

        await addPdfGenericSection(
            doc,
            'KEY TERMS AND DEFINITIONS',
            content.keyTerms,
            { definitions: true }
        );

        // PREVIOUS KNOWLEDGE

        await addPdfGenericSection(
            doc,
            'PREVIOUS KNOWLEDGE',
            content.previousKnowledge
        );

        // INTRODUCTION

        await addPdfGenericSection(
            doc,
            'INTRODUCTION',
            content.introduction
        );

        // LESSON CONTENT

        if (content.lessonContent.length) {
            addPdfHeading(doc, 'COMPREHENSIVE LESSON CONTENT', {
                size: 14,
            });

            for (
                let index = 0;
                index < content.lessonContent.length;
                index++
            ) {
                const section = content.lessonContent[index];

                addPdfHeading(
                    doc,
                    section.heading ||
                    `Lesson Section ${index + 1}`,
                    {
                        size: 12,
                        compact: true,
                    }
                );

                if (section.explanation) {
                    await addPdfParagraph(
                        doc,
                        section.explanation
                    );
                }

                if (section.keyTerms.length) {
                    addPdfHeading(doc, 'Important Terms', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfKeyTerms(
                        doc,
                        section.keyTerms
                    );
                }

                if (section.formulas.length) {
                    addPdfHeading(doc, 'Formulas and Principles', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfWorkedExamples(
                        doc,
                        section.formulas
                    );
                }

                if (section.examples.length) {
                    addPdfHeading(doc, 'Examples', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfList(
                        doc,
                        section.examples,
                        { fontSize: 10.8 }
                    );
                }

                if (section.workedExamples.length) {
                    addPdfHeading(doc, 'Worked Examples', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfWorkedExamples(
                        doc,
                        section.workedExamples
                    );
                }

                if (section.practicalApplications.length) {
                    addPdfHeading(doc, 'Practical Applications', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfList(
                        doc,
                        section.practicalApplications
                    );
                }

                if (section.diagramDescriptions.length) {
                    addPdfHeading(doc, 'Diagrams and Illustrations', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfList(
                        doc,
                        section.diagramDescriptions
                    );
                }

                if (section.commonMisconceptions.length) {
                    addPdfHeading(doc, 'Common Misconceptions', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfList(
                        doc,
                        section.commonMisconceptions
                    );
                }

                if (section.activities.length) {
                    addPdfHeading(doc, 'Section Activities', {
                        size: 10,
                        compact: true,
                    });

                    await addPdfList(doc, section.activities);
                }
            }
        }

        // GLOBAL FORMULA SHEET

        if (content.formulaSheet.length) {
            addPdfHeading(doc, 'FORMULA SHEET', {
                size: 13,
            });

            await addPdfWorkedExamples(
                doc,
                content.formulaSheet
            );
        }

        // GLOBAL WORKED EXAMPLES

        if (content.workedExamples.length) {
            addPdfHeading(doc, 'ADDITIONAL WORKED EXAMPLES', {
                size: 13,
            });

            await addPdfWorkedExamples(
                doc,
                content.workedExamples
            );
        }

        // APPLICATIONS

        await addPdfGenericSection(
            doc,
            'REAL-LIFE AND PRACTICAL APPLICATIONS',
            content.practicalApplications
        );

        // DIAGRAMS

        await addPdfGenericSection(
            doc,
            'DIAGRAMS AND ILLUSTRATIONS',
            content.diagramDescriptions
        );

        // TEACHING ACTIVITIES

        await addPdfGenericSection(
            doc,
            'TEACHER ACTIVITIES',
            content.teacherActivities
        );

        await addPdfGenericSection(
            doc,
            'STUDENT ACTIVITIES',
            content.studentActivities
        );

        // DIFFERENTIATED LEARNING

        await addPdfGenericSection(
            doc,
            'DIFFERENTIATED LEARNING',
            content.differentiatedLearning
        );

        // MISCONCEPTIONS

        await addPdfGenericSection(
            doc,
            'COMMON STUDENT MISCONCEPTIONS AND CORRECTIONS',
            content.commonMisconceptions
        );

        // EVALUATION

        await addPdfGenericSection(
            doc,
            'EVALUATION QUESTIONS',
            content.evaluationQuestions
        );

        // ANSWERS

        await addPdfGenericSection(
            doc,
            'SUGGESTED ANSWERS AND MARKING GUIDE',
            content.evaluationAnswers
        );

        // SUMMARY

        await addPdfGenericSection(
            doc,
            'COMPREHENSIVE LESSON SUMMARY',
            content.summary
        );

        // CONCLUSION

        await addPdfGenericSection(
            doc,
            'CONCLUSION',
            content.conclusion
        );

        // ASSIGNMENT

        await addPdfGenericSection(
            doc,
            'ASSIGNMENT',
            content.assignment
        );

        // REFERENCES

        await addPdfGenericSection(
            doc,
            'REFERENCES',
            content.references
        );

        // FURTHER READING

        await addPdfGenericSection(
            doc,
            'FURTHER READING',
            content.furtherReading
        );

        addPdfFooter(doc);

        doc.end();

        return await pdfPromise;

    } catch (error) {
        doc.destroy();
        throw error;
    }
};

// ============================================================
// REMOVE PDF BINARY DATA
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
// ADMIN AND TEACHER
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
// CREATOR DATA
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
// ADVANCED AI SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `
You are RGSS Advanced AI Academic Assistant.

You are an expert Nigerian secondary school teacher,
professional curriculum developer, educational researcher,
textbook author, subject specialist and examination educator.

Your task is to produce comprehensive, accurate and
professionally structured educational lesson notes.

EDUCATIONAL STANDARDS:

1. Use clear, professional educational English.
2. Adapt every explanation to the specified class and age group.
3. Follow appropriate Nigerian secondary school curriculum
   expectations and NERDC learning objectives where applicable.
4. Do not claim that a note has been officially approved by NERDC.
5. Never invent official curriculum references.
6. Explain concepts thoroughly instead of providing short definitions.
7. Organize topics from fundamental concepts to advanced concepts
   appropriate to the selected class.
8. Provide sufficient teaching material for classroom delivery.
9. Use Nigerian examples where relevant.
10. Ensure all scientific, mathematical and technical information
    is accurate.
11. Avoid repetitive explanations and unnecessary filler.
12. Maintain a logical progression between sections.

MATHEMATICAL AND LATEX REQUIREMENTS:

For Mathematics, Further Mathematics, Physics, Chemistry,
Basic Science and other subjects involving mathematical notation:

1. Use LaTeX for mathematical expressions.
2. Use \\( ... \\) for inline mathematical expressions.
3. Use \\[ ... \\] for display equations.
4. Use proper mathematical fractions, powers, subscripts,
   superscripts, roots, summations, integrals and symbols.
5. Explain every important symbol and variable.
6. Show complete calculations step by step.
7. Include units where applicable.
8. Explain the formula before applying it.
9. Include the substitution of values.
10. Include the final answer and interpretation.
11. Do not put mathematical expressions inside ordinary code blocks.
12. Ensure LaTeX is syntactically valid.
13. Use \\mathrm{} for ordinary words inside mathematical expressions.
14. Do not replace mathematical expressions with plain-text approximations.

PHYSICS REQUIREMENTS:

Where relevant, include:
- Physical principles and laws.
- SI units.
- Derived units.
- Symbols and dimensions.
- Relevant equations.
- Mathematical derivations.
- Worked numerical problems.
- Practical experiments.
- Observations and conclusions.
- Real-life applications.

CHEMISTRY REQUIREMENTS:

Where relevant, include:
- Chemical symbols.
- Chemical formulae.
- Balanced chemical equations.
- Reaction conditions.
- Physical and chemical properties.
- Laboratory procedures.
- Safety precautions.
- Chemical calculations.
- Relevant observations.

MATHEMATICS REQUIREMENTS:

Where relevant, include:
- Definitions.
- Rules and principles.
- Formulae.
- Step-by-step solutions.
- Multiple worked examples.
- Different approaches to solving problems.
- Common errors.
- Exercises of increasing difficulty.

BIOLOGY REQUIREMENTS:

Where relevant, include:
- Biological structures.
- Functions.
- Classification.
- Processes and mechanisms.
- Relevant labelled diagram descriptions.
- Practical observations.
- Applications.

OTHER SUBJECTS:

Adapt the structure to the subject. Do not force
mathematical content into subjects where it is unnecessary.

ADVANCED CONTENT REQUIREMENTS:

Include the following wherever relevant:

1. Detailed introduction.
2. Previous knowledge.
3. Learning objectives.
4. Expected learning outcomes.
5. Instructional materials.
6. Key terms and definitions.
7. Detailed explanations.
8. Principles and laws.
9. Formulae and derivations.
10. Worked examples.
11. Practical applications.
12. Classroom activities.
13. Diagram descriptions.
14. Common misconceptions.
15. Differentiated learning activities.
16. Evaluation questions.
17. Suggested answers.
18. Marking guide.
19. Comprehensive summary.
20. Assignment.
21. References.
22. Further reading.

WORKED EXAMPLE REQUIREMENTS:

Where appropriate, provide at least three worked examples.

Each worked example should contain:
- Question.
- Given information.
- Relevant formula.
- Explanation of the formula.
- Step-by-step solution.
- Correct units.
- Final answer.
- Interpretation.

REFERENCE REQUIREMENTS:

Only recommend genuine and relevant educational references
when known with reasonable confidence.

Never fabricate:
- Textbook titles.
- Authors.
- Publishers.
- Editions.
- Page numbers.
- URLs.
- Official examination requirements.

When uncertain, recommend a general subject textbook
without inventing bibliographic details.

CONTENT DEPTH:

Produce textbook-style explanations appropriate to the
specified class level.

Do not sacrifice accuracy or age suitability for length.

Use meaningful examples and explanations.

Return ONLY valid JSON.

Do not include Markdown code fences.
`;

// ============================================================
// ADVANCED LESSON NOTE JSON TEMPLATE
// ============================================================

const createLessonTemplate = ({
    subjectName,
    className,
    classLevel,
    termName,
    weekTitle,
    topic,
    duration,
    subTopics,
}) => ({
    title: 'Comprehensive Lesson Title',
    subject: subjectName,
    className,
    classLevel,
    term: termName,
    week: weekTitle,
    topic,
    lessonDuration: duration,

    subTopics,

    learningObjectives: [
        'Detailed measurable learning objective',
    ],

    learningOutcomes: [
        'What students should understand and demonstrate',
    ],

    instructionalMaterials: [],

    previousKnowledge: '',

    introduction: '',

    keyTerms: [
        {
            term: '',
            definition: '',
        },
    ],

    lessonContent: [
        {
            heading: 'Introduction to the Concept',

            explanation: '',

            keyTerms: [
                {
                    term: '',
                    definition: '',
                },
            ],

            formulas: [
                {
                    title: '',
                    formula: '',
                    explanation: '',
                    variables: [],
                    units: [],
                },
            ],

            examples: [],

            workedExamples: [
                {
                    title: '',
                    question: '',
                    given: '',
                    formula: '',
                    steps: [],
                    answer: '',
                    explanation: '',
                },
            ],

            practicalApplications: [],

            diagramDescriptions: [],

            commonMisconceptions: [],

            activities: [],
        },
    ],

    formulaSheet: [],

    workedExamples: [],

    practicalApplications: [],

    diagramDescriptions: [],

    teacherActivities: [],

    studentActivities: [],

    differentiatedLearning: [
        {
            level: 'Additional support',
            activity: '',
        },
        {
            level: 'Standard learning',
            activity: '',
        },
        {
            level: 'Advanced learners',
            activity: '',
        },
    ],

    commonMisconceptions: [],

    evaluationQuestions: [],

    evaluationAnswers: [
        {
            questionNumber: 1,
            answer: '',
            markingGuide: [],
        },
    ],

    summary: '',

    conclusion: '',

    assignment: [],

    references: [],

    furtherReading: [],
});

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
        console.error('[GET TERMS ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve academic terms.'
        );
    }
};

// ============================================================
// 2. GET AVAILABLE E-NOTES WEEKS
// GET /lesson-notes/weeks
// ============================================================

exports.getAvailableWeeks = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
        }

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
                    adminId: context.adminId,
                    isActive: true,
                },
            }),

            prisma.term.findFirst({
                where: {
                    id: termId,
                    adminId: context.adminId,
                },
            }),
        ]);

        if (!schoolClass) {
            return sendError(res, 404, 'Class not found.');
        }

        if (!term) {
            return sendError(res, 404, 'Academic term not found.');
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
                adminId: context.adminId,
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

        return res.json({
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
        console.error('[GET WEEKS ERROR]:', error);

        return sendError(
            res,
            500,
            'Unable to retrieve E-Notes weeks.'
        );
    }
};

// ============================================================
// 3. GENERATE ADVANCED AI LESSON NOTE
// POST /lesson-notes/generate
// ============================================================

exports.generateLessonNote = async (req, res) => {
    try {
        const context = getUserContext(req);

        if (!context) {
            return sendError(res, 403, 'Invalid account.');
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

        if (
            typeof topic !== 'string' ||
            !topic.trim() ||
            topic.trim().length > 300
        ) {
            return sendError(
                res,
                400,
                'Please enter a valid topic not exceeding 300 characters.'
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

        if (
            additionalInstructions &&
            additionalInstructions.length > 3000
        ) {
            return sendError(
                res,
                400,
                'Additional instructions cannot exceed 3000 characters.'
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
            return sendError(res, 404, 'Academic term not found.');
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

        const template = createLessonTemplate({
            subjectName,
            className,
            classLevel,
            termName,
            weekTitle,
            topic: cleanTopic,
            duration,
            subTopics: topicSubTopics,
        });

        const userPrompt = `
GENERATE AN ADVANCED, COMPREHENSIVE TEACHER'S LESSON NOTE.

SCHOOL CLASS: ${className}

CLASS LEVEL: ${classLevel}

SUBJECT: ${subjectName}

ACADEMIC TERM: ${termName}

SCHOOL E-NOTES WEEK: ${weekTitle}

LESSON TOPIC: ${cleanTopic}

LESSON DURATION: ${duration} MINUTES

TEACHER-PROVIDED SUBTOPICS:
${JSON.stringify(topicSubTopics, null, 2)}

ADDITIONAL TEACHER INSTRUCTIONS:
${extraInstructions}

CONTENT EXPECTATIONS:

1. Produce textbook-style explanations suitable for the specified class.
2. Cover all teacher-provided subtopics.
3. Expand the topic into logical lesson sections.
4. Explain all important concepts thoroughly.
5. Include definitions and relevant terminology.
6. Include multiple practical examples.
7. Include at least three worked examples where appropriate.
8. Use LaTeX for mathematical expressions.
9. Include formulas and their explanations where relevant.
10. Include step-by-step calculations where relevant.
11. Include scientific units and symbols where relevant.
12. Include practical applications.
13. Include diagram descriptions that teachers can use to draw or explain diagrams.
14. Include likely student misconceptions and corrections.
15. Include activities suitable for classroom teaching.
16. Include differentiated learning for students requiring additional support and advanced learners.
17. Include at least 10 meaningful evaluation questions where appropriate.
18. Include answers and marking guidance.
19. Include meaningful assignments.
20. Include reliable textbook references where known.
21. Never fabricate references, page numbers or authors.
22. Maintain age and class-level suitability.
23. Avoid unnecessary repetition.
24. Ensure every explanation is educationally useful.

MATHEMATICAL OUTPUT:

Use:
\\( ... \\) for inline equations.

Use:
\\[ ... \\] for display equations.

Example:
\\[F = ma\\]

For a quadratic equation:
\\[x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\]

For chemical reactions:
\\[2H_2 + O_2 \\rightarrow 2H_2O\\]

Return the lesson using this JSON structure:

${JSON.stringify(template, null, 2)}

IMPORTANT:

- Return every field in the template.
- All list fields must be arrays.
- Use objects for structured worked examples.
- Use valid JSON strings.
- Do not return undefined values.
- Do not use Markdown code fences.
- Do not place raw unescaped quotation marks inside JSON strings.
- Mathematical expressions must use valid LaTeX.
- If a section is genuinely irrelevant to the selected subject, return an empty array.
- Do not fill sections with meaningless placeholder content.
- Prioritize educational accuracy over unnecessary length.
`;

        const completion = await groq.chat.completions.create({
            model: GROQ_MODEL,

            messages: [
                {
                    role: 'system',
                    content: SYSTEM_PROMPT,
                },
                {
                    role: 'user',
                    content: userPrompt,
                },
            ],

            temperature: 0.45,

            max_tokens: 16000,

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
                'The AI response did not contain a valid comprehensive lesson note.'
            );
        }

        if (completion.choices?.[0]?.finish_reason === 'length') {
            throw new Error(
                'The AI response reached its output limit and may be incomplete. Please generate the lesson again.'
            );
        }

        normalizeLessonContent(generatedContent);

        // Ensure important lesson information is retained.

        generatedContent.subject =
            generatedContent.subject || subjectName;

        generatedContent.className =
            generatedContent.className || className;

        generatedContent.classLevel =
            generatedContent.classLevel || classLevel;

        generatedContent.term =
            generatedContent.term || termName;

        generatedContent.week =
            generatedContent.week || weekTitle;

        generatedContent.topic =
            generatedContent.topic || cleanTopic;

        generatedContent.lessonDuration =
            generatedContent.lessonDuration || duration;

        if (!generatedContent.subTopics.length) {
            generatedContent.subTopics = topicSubTopics;
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
            '[RGSS ADVANCED AI LESSON NOTE] Draft created:',
            savedNote.id
        );

        return res.status(201).json({
            success: true,

            message:
                'Comprehensive AI lesson note generated successfully. Review the content and save it to generate the mathematical PDF.',

            note: removePdfBinary(savedNote),

            generation: {
                provider: 'groq',
                model: GROQ_MODEL,
                latexSupported: true,
                advancedContent: true,
            },
        });

    } catch (error) {
        console.error(
            '[ADVANCED AI LESSON NOTE GENERATION ERROR]:',
            error
        );

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

            const normalizedContent = normalizeLessonContent({
                ...content,
            });

            updateData.content = normalizedContent;
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
                'Cloudinary is not configured. Check your environment variables.'
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
                'Invalid lesson note content.'
            );
        }

        console.log(
            '[RGSS] Generating advanced mathematical PDF:',
            noteId
        );

        // Generate PDF including LaTeX equations.

        const pdfBuffer = await generateLessonNotePdf(existingNote);

        if (!pdfBuffer || !pdfBuffer.length) {
            throw new Error('Generated PDF is empty.');
        }

        const pdfFilename =
            `${safeFilename(existingNote.title)}-${noteId}-${Date.now()}.pdf`;

        // Upload PDF.

        const uploadResult = await uploadPdfToCloudinary(
            pdfBuffer,
            pdfFilename
        );

        uploadedPdfPublicId = uploadResult.pdfPublicId;

        // Update database.

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

        // Remove previous PDF only after successful update.

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
            '[RGSS] Advanced lesson note saved:',
            noteId
        );

        return res.json({
            success: true,

            message:
                'Advanced lesson note saved successfully. Mathematical expressions have been processed for the PDF.',

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
                'PDF is not available. Save the lesson note to generate it.'
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
