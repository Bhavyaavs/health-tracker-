const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { fromPath } = require("pdf2pic");
const { createWorker } = require("tesseract.js");
const PDFDocument = require("pdfkit");
const cors = require("cors");
const db = require("./db");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const upload = multer({ dest: UPLOAD_DIR });
const app = express();
app.use(cors());
app.use(express.json());

function parseMetrics(text) {
  const patterns = {
    glucose: /(?:glucose|sugar)[:\s]*([0-9]+(?:\.[0-9]+)?)/i,
    cholesterol: /cholesterol[:\s]*([0-9]+(?:\.[0-9]+)?)/i,
    hdl: /hdl[:\s]*([0-9]+(?:\.[0-9]+)?)/i,
    ldl: /ldl[:\s]*([0-9]+(?:\.[0-9]+)?)/i,
    bp: /(?:bp|blood pressure)[:\s]*([0-9]{2,3}\/\d{2,3})/i,
    weight: /weight[:\s]*([0-9]+(?:\.[0-9]+)?)/i,
  };
  const metrics = {};
  const lower = text;
  for (const k of Object.keys(patterns)) {
    const m = lower.match(patterns[k]);
    if (m) metrics[k] = { value: m[1] };
  }
  return metrics;
}

function computeDiff(oldMetrics, newMetrics) {
  const diffs = {};
  for (const k of Object.keys(newMetrics)) {
    const newv = newMetrics[k];
    const oldv = oldMetrics ? oldMetrics[k] : undefined;
    try {
      if (!oldv) {
        diffs[k] = { change: "new", from: oldv, to: newv };
      } else {
        const newVal =
          newv && newv.value ? parseFloat(newv.value) : parseFloat(newv);
        const oldVal =
          oldv && oldv.value ? parseFloat(oldv.value) : parseFloat(oldv);
        if (isNaN(newVal) || isNaN(oldVal)) {
          // handle BP or non-numeric
          const newStr = newv && newv.value ? newv.value : newv;
          const oldStr = oldv && oldv.value ? oldv.value : oldv;
          if (
            typeof newStr === "string" &&
            newStr.includes("/") &&
            typeof oldStr === "string" &&
            oldStr.includes("/")
          ) {
            diffs[k] = { change: "bp", from: oldStr, to: newStr };
          } else {
            diffs[k] = { change: "unknown", from: oldv, to: newv };
          }
        } else {
          const delta = newVal - oldVal;
          const state =
            delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
          diffs[k] = { change: state, delta, from: oldVal, to: newVal };
        }
      }
    } catch (e) {
      diffs[k] = { change: "unknown", from: oldv, to: newv };
    }
  }
  return diffs;
}

async function ocrImage(filePath) {
  const worker = createWorker();
  await worker.load();
  await worker.loadLanguage("eng");
  await worker.initialize("eng");
  const {
    data: { text },
  } = await worker.recognize(filePath);
  await worker.terminate();
  return text;
}

async function ocrPdf(filePath) {
  // convert pages to images using pdf2pic
  const converter = fromPath(filePath, {
    density: 150,
    saveFilename: "page",
    savePath: UPLOAD_DIR,
    format: "png",
  });
  const pageCount = 3; // convert first 3 pages to limit work
  const texts = [];
  try {
    const info = await converter(1);
    texts.push(await ocrImage(info.path));
  } catch (e) {
    // fallback: return empty
  }
  return texts.join("\n");
}

app.get("/api/people", (req, res) => {
  db.all("SELECT * FROM person", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/people", (req, res) => {
  const { name, dob } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  db.run(
    "INSERT INTO person (name, dob) VALUES (?, ?)",
    [name, dob || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, dob });
    },
  );
});

app.get("/api/people/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM person WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "not found" });
    db.all(
      "SELECT * FROM report WHERE person_id = ? ORDER BY uploaded_at DESC",
      [id],
      (err2, reports) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ person: row, reports });
      },
    );
  });
});

// update person (name, dob)
app.put('/api/people/:id', (req, res) => {
  const id = req.params.id;
  const { name, dob } = req.body;
  db.get('SELECT * FROM person WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'not found' });
    const newName = name !== undefined ? name : row.name;
    const newDob = dob !== undefined ? dob : row.dob;
    db.run('UPDATE person SET name = ?, dob = ? WHERE id = ?', [newName, newDob, id], function(err2){
      if (err2) return res.status(500).json({ error: err2.message });
      db.get('SELECT * FROM person WHERE id = ?', [id], (err3, updated) => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ person: updated });
      });
    });
  });
});

app.post("/api/people/:id/upload", upload.single("file"), async (req, res) => {
  const personId = req.params.id;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file required" });
  const ext = path.extname(file.originalname).toLowerCase();
  let text = "";
  try {
    if (ext === ".pdf") text = await ocrPdf(file.path);
    else text = await ocrImage(file.path);
  } catch (e) {
    console.error("OCR error", e);
  }
  const metrics = parseMetrics(text);
  const uploadedAt = new Date().toISOString();
  db.run(
    "INSERT INTO report (person_id, filename, uploaded_at, extracted_text, metrics_json) VALUES (?, ?, ?, ?, ?)",
    [personId, file.filename, uploadedAt, text, JSON.stringify(metrics)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        person_id: personId,
        filename: file.filename,
        uploaded_at: uploadedAt,
        metrics,
      });
    },
  );
});

app.get("/api/report/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM report WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "not found" });
    row.metrics = row.metrics_json ? JSON.parse(row.metrics_json) : {};
    res.json(row);
  });
});

app.get("/api/report/:id/details", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM report WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "not found" });
    row.metrics = row.metrics_json ? JSON.parse(row.metrics_json) : {};
    // find previous report for same person
    db.get(
      "SELECT * FROM report WHERE person_id = ? AND id != ? ORDER BY uploaded_at DESC LIMIT 1",
      [row.person_id, id],
      (err2, prev) => {
        if (err2) return res.status(500).json({ error: err2.message });
        prev = prev || null;
        const prevMetrics =
          prev && prev.metrics_json ? JSON.parse(prev.metrics_json) : {};
        const diffs = computeDiff(prevMetrics, row.metrics);
        res.json({ report: row, previous: prev, diffs });
      },
    );
  });
});

app.post("/api/report/:id/delete", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM report WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "not found" });
    const filePath = path.join(UPLOAD_DIR, row.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
    db.run("DELETE FROM report WHERE id = ?", [id], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ ok: true });
    });
  });
});

app.get("/api/report/:id/export", (req, res) => {
  const id = req.params.id;
  const fmt = (req.query.format || "pdf").toLowerCase();
  db.get(
    "SELECT r.*, p.name as person_name FROM report r JOIN person p ON p.id = r.person_id WHERE r.id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "not found" });
      const metrics = row.metrics_json ? JSON.parse(row.metrics_json) : {};
      const lines = [];
      lines.push(`Report: ${row.filename}`);
      lines.push(`Person: ${row.person_name}`);
      lines.push(`Uploaded: ${row.uploaded_at}`);
      lines.push("");
      lines.push("Extracted metrics:");
      if (!metrics || Object.keys(metrics).length === 0) {
        lines.push(" (no structured metrics parsed)");
      }
      for (const k of Object.keys(metrics || {})) {
        const v = metrics[k];
        lines.push(` - ${k}: ${v.value || v}`);
      }
      // Always include the raw extracted text as a fallback so exported PDFs are not blank
      if (row.extracted_text) {
        lines.push("");
        lines.push("Extracted text:");
        const textLines = String(row.extracted_text).split(/\r?\n/).slice(0, 500);
        for (const l of textLines) lines.push(l);
      }
      // PDF
      if (fmt === "pdf") {
        const doc = new PDFDocument();
        res.setHeader(
          "Content-disposition",
          `attachment; filename=report_${id}.pdf`,
        );
        res.setHeader("Content-type", "application/pdf");
        doc.pipe(res);
        doc.fontSize(14).text(`Health Report: ${row.filename}`);
        doc.moveDown();
        doc.fontSize(10);
        lines.slice(1).forEach((l) => doc.text(l));
        doc.end();
        return;
      }
      res.json({ lines });
    },
  );
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
