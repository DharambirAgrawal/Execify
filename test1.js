const { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, BorderStyle, ExternalHyperlink, TabStopType, Header, Footer, PageNumber, WidthType, ShadingType, Table, TableRow, TableCell, HeadingLevel, PageBreak } = require('docx');
const fs = require('fs');
const path = require('path');

const PAGE_MARGIN = 480;
const CONTENT_W = 12240 - PAGE_MARGIN * 2;
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

const sec = (label) => new Paragraph({
  spacing: { before: 200, after: 50 },
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

const body = (text) => new Paragraph({
  spacing: { before: 24, after: 50 },
  children: [new TextRun({ text, font: F, size: S })]
});

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
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Research Proposal: AI Hallucination Mitigation", font: F, size: 20, bold: true })]
        })]
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
      namePara("Addressing AI Hallucination: Mechanisms, Detection, and Mitigation"),
      contactPara([
        { text: "Department of Computer Science" },
        { text: "Research Proposal" },
        { text: "Academic Year 2023-2024" }
      ]),

      sec("1. Executive Summary"),
      body("This research proposal outlines a comprehensive study into the phenomenon of 'hallucination' in Large Language Models (LLMs). As AI systems are increasingly integrated into critical decision-making processes, the tendency for these models to generate factually incorrect or nonsensical information poses significant risks. This project aims to categorize hallucination types, develop robust detection benchmarks, and evaluate the efficacy of Retrieval-Augmented Generation (RAG) and fine-tuning as mitigation strategies."),

      sec("2. Problem Statement"),
      body("Despite the transformative capabilities of Transformer-based architectures, LLMs remain prone to generating 'hallucinations'—outputs that are syntactically correct but semantically false or ungrounded in the provided context. This issue undermines trust in AI applications within legal, medical, and technical domains."),
      b("Lack of standardized metrics for measuring hallucination frequency across different model architectures."),
      b("The 'black box' nature of neural networks making it difficult to trace the origin of false assertions."),
      b("Inefficiency of current manual fact-checking processes for high-volume AI outputs."),

      sec("3. Research Objectives"),
      b("To develop a taxonomy of AI hallucinations, distinguishing between intrinsic (logical) and extrinsic (factual) errors."),
      b("To create an automated evaluation framework using cross-model verification techniques."),
      b("To measure the impact of temperature settings and decoding strategies on truthfulness."),
      b("To propose a hybrid RAG-based architecture that reduces hallucination rates by at least 40% in domain-specific tasks."),

      sec("4. Proposed Methodology"),
      body("The research will follow a quantitative experimental design, utilizing the following phases:"),
      skillRow("Data Collection", "Utilizing TruthfulQA and HaluEval datasets alongside custom-generated adversarial prompts."),
      skillRow("Model Selection", "Comparative analysis of GPT-4, Llama-3, and Mistral-7B models."),
      skillRow("Evaluation", "Implementation of NLI (Natural Language Inference) and Knowledge Graph verification."),

      sec("5. Project Timeline"),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [3000, 2000, 6280],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 3000, type: WidthType.DXA },
                shading: { fill: "E6E6E6", type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: "Phase", font: F, size: S, bold: true })] })]
              }),
              new TableCell({
                width: { size: 2000, type: WidthType.DXA },
                shading: { fill: "E6E6E6", type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: "Duration", font: F, size: S, bold: true })] })]
              }),
              new TableCell({
                width: { size: 6280, type: WidthType.DXA },
                shading: { fill: "E6E6E6", type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: "Key Deliverables", font: F, size: S, bold: true })] })]
              })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Literature Review", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Weeks 1-3", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Comprehensive bibliography and taxonomy report.", font: F, size: S })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Environment Setup", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Weeks 4-5", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "GPU cluster config and API integration.", font: F, size: S })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Experimentation", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Weeks 6-12", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Raw data from RAG vs. Fine-tuning tests.", font: F, size: S })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Analysis & Writing", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Weeks 13-16", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Final thesis and conference paper draft.", font: F, size: S })] })] })
            ]
          })
        ]
      }),

      sec("6. Required Resources"),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [4000, 7280],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 4000, type: WidthType.DXA },
                shading: { fill: "E6E6E6", type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: "Resource Type", font: F, size: S, bold: true })] })]
              }),
              new TableCell({
                width: { size: 7280, type: WidthType.DXA },
                shading: { fill: "E6E6E6", type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: "Description", font: F, size: S, bold: true })] })]
              })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Compute Power", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Access to 4x NVIDIA A100 GPUs for model inference and fine-tuning.", font: F, size: S })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "API Credits", font: F, size: S })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "$500 budget for OpenAI and Anthropic API benchmarking.", font: F, size: S })] })] })
            ]
          })
        ]
      }),

      sec("7. Expected Impact"),
      body("The findings of this research will contribute to the development of safer AI systems. By providing a clear framework for detecting and mitigating hallucinations, this work will assist developers in creating more reliable LLM applications for high-stakes environments, ultimately reducing the spread of AI-generated misinformation.")
    ]
  }]
});

const workspaceDir = path.join(__dirname, 'workspace');
if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir);

Packer.toBuffer(doc).then(buf => {
  const outPath = path.join(workspaceDir, 'AI_Hallucination_Research_Proposal.docx');
  fs.writeFileSync(outPath, buf);
  console.log('Done:', outPath);
});
