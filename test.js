const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  LevelFormat, BorderStyle, ExternalHyperlink, TabStopType
} = require('docx');
const fs = require('fs');
const path = require('path');

const PAGE_MARGIN = 480;
const CONTENT_W   = 12240 - PAGE_MARGIN * 2;
const F = "Calibri";
const S = 18;

const namePara = (text) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 20 },
  children: [new TextRun({ text, font: F, size: 26, bold: true })]
});

const contactPara = (items) => {
  const ch = [];
  items.forEach((p, i) => {
    if (i > 0) ch.push(new TextRun({ text: "  |  ", font: F, size: S, color: "555555" }));
    if (p.url) ch.push(new ExternalHyperlink({ link: p.url, children: [new TextRun({ text: p.text, font: F, size: S, color: "1155CC", underline: {} })] }));
    else ch.push(new TextRun({ text: p.text, font: F, size: S }));
  });
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 50 }, children: ch });
};

const sec = (label) => new Paragraph({
  spacing: { before: 88, after: 26 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: "1A1A1A", space: 1 } },
  children: [new TextRun({ text: label.toUpperCase(), font: F, size: 19, bold: true })]
});

const entryHead = (title, right) => new Paragraph({
  spacing: { before: 70, after: 0 },
  tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
  children: [
    new TextRun({ text: title, font: F, size: S + 1, bold: true }),
    new TextRun({ text: "\t" + right, font: F, size: S, italics: true, color: "444444" }),
  ]
});

const subHead = (left, right) => new Paragraph({
  spacing: { before: 0, after: 22 },
  tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
  children: [
    new TextRun({ text: left, font: F, size: S, italics: true, color: "444444" }),
    new TextRun({ text: "\t" + right, font: F, size: S, italics: true, color: "444444" }),
  ]
});

const b = (text) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { before: 0, after: 22 },
  children: [new TextRun({ text, font: F, size: S })]
});

const skillRow = (label, value) => new Paragraph({
  spacing: { before: 0, after: 20 },
  children: [
    new TextRun({ text: label + ": ", font: F, size: S, bold: true }),
    new TextRun({ text: value, font: F, size: S }),
  ]
});

const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 320, hanging: 220 } } } }]
    }]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN }
      }
    },
    children: [

      // HEADER — added phone number
      namePara("Jake Resume"),
      contactPara([
        { text: "Jackson, CA" },
        { text: "(XXX) XXX-XXXX" },
        { text: "jake@gmail.com", url: "mailto:jake@gmail.com" },
        { text: "linkedin.com/in/jakeresume", url: "https://linkedin.com/in/jakeresume" },
        { text: "github.com/jakeresume", url: "https://github.com/jakeresume" },
      ]),

      // SUMMARY
      sec("Summary"),
      new Paragraph({
        spacing: { before: 24, after: 50 },
        children: [new TextRun({
          text: "Software Engineering Intern | 3.88 GPA | Sophomore at Jackson State University. 2 internships delivering full-stack React.js/Node.js platforms and Python AI pipelines. Experienced with REST APIs, CI/CD, Docker, AWS, and Agile development. Seeking Summer 2026 SWE or full-stack internship.",
          font: F, size: S
        })]
      }),

      // EDUCATION
      sec("Education"),
      entryHead("Jackson State University", "Expected May 2028"),
      new Paragraph({
        spacing: { before: 4, after: 0 },
        children: [new TextRun({ text: "B.S. Computer Science", font: F, size: S, italics: true, color: "444444" })]
      }),
      new Paragraph({
        spacing: { before: 4, after: 20 },
        children: [new TextRun({ text: "GPA: 3.88 / 4.0   |   Jackson, CA", font: F, size: S, italics: true, color: "444444" })]
      }),
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({ text: "Coursework: ", font: F, size: S, bold: true }),
          new TextRun({ text: "Data Structures and Algorithms, Operating Systems, Computer Networks, Parallel Processing", font: F, size: S }),
        ]
      }),
      new Paragraph({
        spacing: { before: 8, after: 0 },
        children: [
          new TextRun({ text: "Honors: ", font: F, size: S, bold: true }),
          new TextRun({ text: "Full-Ride Scholarship, Dean's Commendation, President's List, Earl Lester Cole Honors College", font: F, size: S }),
        ]
      }),

      // SKILLS
      sec("Technical Skills"),
      skillRow("Languages",      "Python, C++, Java, JavaScript, TypeScript, HTML, CSS, SQL"),
      skillRow("Frameworks",     "React.js, Node.js, Express.js, Next.js, TensorFlow, PyTorch, NumPy, Pandas"),
      skillRow("Cloud / DevOps", "AWS (EC2, S3, Lambda), GCP, Docker, CI/CD, GitHub Actions, Git, Linux"),
      skillRow("Databases",      "PostgreSQL, MongoDB, MySQL, Redis, ChromaDB"),
      skillRow("AI / ML",        "LLMs, RAG, NLP, Agentic AI, Speech-to-Text, Transformer Models, Vector Embeddings"),
      skillRow("Testing",        "Jest, Pytest, Unit Testing, Integration Testing, Regression Testing"),

      // EXPERIENCE
      sec("Experience"),

      entryHead("Software Engineering Intern", "Aug 2025 – Dec 2025"),
      subHead("Jackson State University — Research Computing", "Jackson, CA"),
      // FIX: "built" → "engineered", "enabling" → removed/replaced, strong action verbs throughout
      b("Engineered a modular offline AI pipeline processing 100+ audio files daily, cutting transcription time by 35% and achieving sub-1s end-to-end latency."),
      b("Architected 4 independently testable services using object-oriented design, eliminating single points of failure and supporting parallel development across the pipeline."),
      b("Presented live demo to department stakeholders; pipeline adopted into research workflow, saving 10+ researchers hours of manual transcription weekly."),

      entryHead("Software Engineering Intern", "Oct 2024 – Present"),
      subHead("Jackson State University — College of Business", "Jackson, CA"),
      // FIX: "built" → "developed", "collaborating" → "working", removed "reducing" duplicate
      b("Developed and maintained full-stack React.js/Node.js features across 3 university platforms serving 1,000+ students, working in Agile sprints with CI/CD deployment via GitHub Actions."),
      b("Diagnosed and resolved production issues across multiple platforms, cutting reported defects by 25% and improving uptime for active users."),
      b("Refactored legacy pages into reusable React.js components, eliminating duplication across 3+ platforms and decreasing future development time by ~40%."),

      // PROJECTS
      sec("Projects"),

      // FIX: "built" → varied verbs, "enabling" removed, "collaborate/collaborating" replaced
      entryHead("VoxCore MCP Server Suite  |  Python, Docker, WebSocket, ChromaDB", "Feb 2026"),
      b("Eliminated $200+/mo in cloud costs by engineering 6 containerized AI microservices (STT, TTS, Memory, Persona, Agent, Interrupt), each independently deployable with sub-100ms inter-service latency."),
      b("Architected for scalability and modularity; services communicate over WebSocket with zero hard dependencies, supporting plug-and-play integration across AI workflows."),

      entryHead("Agentic AI Assistant  |  Python, LLMs, REST APIs, PostgreSQL", "Jan 2026"),
      b("Developed a persistent automation agent achieving autonomous multi-step task execution via REST integrations (email, web search, tasks) and voice interaction with no re-prompting required."),
      b("Implemented semantic vector memory with per-user isolation and sub-100ms barge-in classifier, supporting natural real-time interruption during responses."),

      entryHead("DWIPS — Wearable Obstacle Detection  |  C++, LiDAR, Embedded Systems", "Nov 2025"),
      b("Placed 3rd of 25+ teams: engineered real-time LiDAR obstacle detection in C++ with sub-100ms haptic feedback for visually impaired pedestrian navigation."),
      // FIX: "fault-tolerant sensor layer" bullet — now action-verb led
      b("Implemented noise-filtering algorithms in a fault-tolerant sensor layer, maintaining 92%+ detection accuracy under adverse conditions across all test scenarios."),

      entryHead("Semantic File Share  |  Python, Sockets, AES Encryption", "Sep 2025"),
      // FIX: "reduced" overused — swap to "cut"
      b("Cut average query time from 8s to under 2s with AI semantic search, improving retrieval precision 40% over keyword search for a system supporting 100+ concurrent users."),
      b("Secured transfers with AES encryption, enforced RBAC access control, and logged 10,000+ file events in real time for full auditability."),

      // LEADERSHIP — FIX: "participate" (weak) replaced, added initiative/scope signals
      sec("Leadership and Involvement"),
      entryHead("AI Club  —  Active Contributor", "Aug 2025 – Present"),
      b("Lead technical sessions on LLMs and agentic AI for club members; spearhead hands-on ML projects and mentor peers on applied AI problem-solving."),
      entryHead("National Society of Black Engineers (NSBE)", "Aug 2024 – Present"),
      b("Engage in professional development workshops and connect with industry engineers to advance technical skills and support peers in the CS program."),

    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  const outputPath = path.join(__dirname, 'workspace', 'resume_v9.docx');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buf);
  console.log(`Done: ${outputPath}`);
});

