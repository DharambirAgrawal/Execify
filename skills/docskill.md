---
name: docx
description: "Use this skill whenever the user wants to create a Word document (.docx). Covers resumes, assignments, reports, proposals, letters, meeting notes, and any professional document."
---

# DOCX Generation Skill

## Your Job

Generate a JSON object with this exact shape:

```json
{
  "file_name": "test.js",
  "language": "javascript",
  "dependencies": ["docx"],
  "run_command": "node test.js",
  "output_file": "workspace/<descriptive-name>.docx",
  "notes": [],
  "code": "<full runnable JavaScript as a single string>"
}
```

Rules:
- Output **valid JSON only**. No markdown fences. No explanation outside the JSON.
- `file_name` is always `test.js`.
- `run_command` is always `node test.js`.
- `code` must be complete, runnable, and write the docx to `path.join(__dirname, 'workspace', '<name>.docx')`.
- Code must create the `workspace` directory if it does not exist.

---

## Locked Design System

**You must use this design system exactly. Do not invent margins, fonts, sizes, or helper patterns.**

### Constants (copy these verbatim)

```javascript
const PAGE_MARGIN = 480;
const CONTENT_W   = 12240 - PAGE_MARGIN * 2; // 11280
const F           = "Calibri";
const S           = 18; // 9pt body
```

### Required Imports

Always import exactly these — add more only if you use them:

```javascript
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat, BorderStyle,
  ExternalHyperlink, TabStopType, Header, Footer,
  PageNumber, WidthType, ShadingType, Table,
  TableRow, TableCell, HeadingLevel, PageBreak
} = require('docx');
const fs   = require('fs');
const path = require('path');
```

### Required Helper Functions (copy these verbatim, do not rewrite them)

**Name / title block:**
```javascript
const namePara = (text) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 20 },
  children: [new TextRun({ text, font: F, size: 26, bold: true })]
});
```

**Contact line (supports plain text and hyperlinks):**
```javascript
const contactPara = (items) => {
  const ch = [];
  items.forEach((p, i) => {
    if (i > 0) ch.push(new TextRun({ text: "  |  ", font: F, size: S, color: "555555" }));
    if (p.url) {
      ch.push(new ExternalHyperlink({
        link: p.url,
        children: [new TextRun({ text: p.text, font: F, size: S, color: "1155CC", underline: {} })]
      }));
    } else {
      ch.push(new TextRun({ text: p.text, font: F, size: S }));
    }
  });
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 50 }, children: ch });
};
```

**Section heading (ALL CAPS, bottom border — never use HeadingLevel for sections):**
```javascript
const sec = (label) => new Paragraph({
  spacing: { before: 88, after: 26 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: "1A1A1A", space: 1 } },
  children: [new TextRun({ text: label.toUpperCase(), font: F, size: 19, bold: true })]
});
```

**Entry header — role or project title left, date right-aligned:**
```javascript
const entryHead = (title, right) => new Paragraph({
  spacing: { before: 70, after: 0 },
  tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
  children: [
    new TextRun({ text: title, font: F, size: S + 1, bold: true }),
    new TextRun({ text: "\t" + right, font: F, size: S, italics: true, color: "444444" }),
  ]
});
```

**Sub-header — company or subtitle left, location right-aligned:**
```javascript
const subHead = (left, right) => new Paragraph({
  spacing: { before: 0, after: 22 },
  tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
  children: [
    new TextRun({ text: left, font: F, size: S, italics: true, color: "444444" }),
    new TextRun({ text: "\t" + right, font: F, size: S, italics: true, color: "444444" }),
  ]
});
```

**Bullet point:**
```javascript
const b = (text) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { before: 0, after: 22 },
  children: [new TextRun({ text, font: F, size: S })]
});
```

**Skill row (bold label + plain value):**
```javascript
const skillRow = (label, value) => new Paragraph({
  spacing: { before: 0, after: 20 },
  children: [
    new TextRun({ text: label + ": ", font: F, size: S, bold: true }),
    new TextRun({ text: value, font: F, size: S }),
  ]
});
```

**Plain body paragraph:**
```javascript
const body = (text) => new Paragraph({
  spacing: { before: 24, after: 50 },
  children: [new TextRun({ text, font: F, size: S })]
});
```

---

## Document Skeleton (always follow this structure)

```javascript
const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: "\u2022",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 320, hanging: 220 } } }
      }]
    }]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN }
      }
    },
    // Optional: include headers/footers only if the document needs them
    headers: {
      default: new Header({ children: [ /* header paragraphs */ ] })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: "Page ", font: F, size: S }),
            new TextRun({ children: [PageNumber.CURRENT], font: F, size: S }),
          ]
        })]
      })
    },
    children: [
      // all content here using the helper functions above
    ]
  }]
});

const workspaceDir = path.join(__dirname, 'workspace');
if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir);

Packer.toBuffer(doc).then(buf => {
  const outPath = path.join(workspaceDir, 'output.docx');
  fs.writeFileSync(outPath, buf);
  console.log('Done:', outPath);
});
```

---

## Critical Rules — Breaking These Causes Crashes or Wrong Output

### Headers and Footers
- `headers.default` MUST be `new Header({ children: [...] })` — NEVER `new Paragraph`
- `footers.default` MUST be `new Footer({ children: [...] })` — NEVER `new Paragraph`
- `Header` and `Footer` MUST be imported from `docx`
- Never place `new Header(...)` or `new Footer(...)` inside section `children`

### Page Numbers
```javascript
// CORRECT
new TextRun({ children: [PageNumber.CURRENT] })
new TextRun({ children: [PageNumber.TOTAL_PAGES] })

// WRONG — crashes
new TextRun({ text: PageNumber.CURRENT })
PageNumber.CURRENT  // never as bare array element
```

### Tab Stops
```javascript
// CORRECT — always use the enum
tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }]

// WRONG — silently produces wrong layout
tabStops: [{ type: 'right', position: CONTENT_W }]
```

### Section Headings
```javascript
// CORRECT — use sec() helper
sec("Experience")

// WRONG — never use HeadingLevel for section titles in this design system
new Paragraph({ heading: HeadingLevel.HEADING_1, children: [...] })
```

### Bullets
```javascript
// CORRECT — always reference the numbering config
b("My bullet text")
// which expands to:
new Paragraph({ numbering: { reference: "bullets", level: 0 }, ... })

// WRONG — never fake bullets with unicode inline
new Paragraph({ children: [new TextRun("• My bullet")] })
new Paragraph({ children: [new TextRun("\u2022 My bullet")] })
```

### Tables
```javascript
// CORRECT — always DXA, dual widths, CLEAR shading
new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [3000, 8280], // must sum to CONTENT_W
  rows: [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 3000, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          shading: { fill: "F2F2F2", type: ShadingType.CLEAR },
          children: [new Paragraph({ children: [new TextRun({ text: "Cell", font: F, size: S })] })]
        }),
        new TableCell({
          width: { size: 8280, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: "Cell", font: F, size: S })] })]
        })
      ]
    })
  ]
})

// WRONG
new TableCell({ shading: { type: ShadingType.SOLID } }) // black background
width: { size: 50, type: WidthType.PERCENTAGE }         // breaks in Google Docs
```

### Newlines
```javascript
// WRONG — \n inside TextRun does nothing in docx
new TextRun({ text: "Line 1\nLine 2" })

// CORRECT — use separate Paragraph elements
new Paragraph({ children: [new TextRun({ text: "Line 1", font: F, size: S })] }),
new Paragraph({ children: [new TextRun({ text: "Line 2", font: F, size: S })] }),
```

### Page Breaks
```javascript
// CORRECT — must be inside a Paragraph
new Paragraph({ children: [new PageBreak()] })

// WRONG — standalone PageBreak creates invalid XML
new PageBreak()
```

---

## Document Type Patterns

### Resume

Use this section order: name + contact → summary → education → skills → experience → projects → leadership/other

```javascript
// Name and contact at top (no header/footer for resumes)
namePara("Full Name"),
contactPara([
  { text: "City, State" },
  { text: "(555) 555-5555" },
  { text: "email@example.com", url: "mailto:email@example.com" },
  { text: "linkedin.com/in/handle", url: "https://linkedin.com/in/handle" },
  { text: "github.com/handle", url: "https://github.com/handle" },
]),

sec("Summary"),
body("One paragraph. Role | GPA if student | key skills | what you are seeking."),

sec("Education"),
entryHead("University Name", "Expected Month Year"),
subHead("Degree, Major", "City, State"),
// then coursework and honors as plain paragraphs using body() or skillRow()

sec("Technical Skills"),
skillRow("Languages", "Python, JavaScript, TypeScript, ..."),
skillRow("Frameworks", "React, Node.js, ..."),

sec("Experience"),
entryHead("Job Title", "Month Year – Month Year"),
subHead("Company Name", "City, State"),
b("Strong action verb + what you did + measurable result."),
b("..."),

sec("Projects"),
entryHead("Project Name  |  Tech Stack", "Month Year"),
b("What you built and the impact."),

sec("Leadership"),
entryHead("Role or Club", "Date range"),
b("What you contributed."),
```

### Report / Assignment

Use header with title and author, footer with page number, no name/contact block.

```javascript
headers: {
  default: new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Document Title", font: F, size: 20, bold: true })]
      })
    ]
  })
},
footers: {
  default: new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: "Page ", font: F, size: S }),
        new TextRun({ children: [PageNumber.CURRENT], font: F, size: S }),
      ]
    })]
  })
},
children: [
  sec("Introduction"),
  body("Your intro paragraph text..."),

  sec("Section Two"),
  body("Content..."),
  b("A supporting bullet point."),
]
```

### Proposal / Business Document

Add a cover paragraph before the first section, use `entryHead` for item/cost rows if needed, use tables for structured comparisons.

---

## What to Fill In

The model's job is **content only**. Call the helper functions with real text. Do not:
- Change margins, font, or size constants
- Replace `sec()` with `HeadingLevel`
- Replace `b()` with inline unicode bullets
- Replace `TabStopType.RIGHT` with the string `'right'`
- Change `ShadingType.CLEAR` to `ShadingType.SOLID`
- Add extra wrapper functions that duplicate what the helpers already do

The design is decided. Fill in the content.