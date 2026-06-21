# Health Reports Tracker

Simple Flask web app to upload health reports (PDF/image), extract metrics via OCR, and track changes over time.

Features:

- Add people
- Upload PDF or image reports per person
- Basic OCR extraction (pytesseract + pdf2image)
- Parse common metrics (glucose, cholesterol, HDL, LDL, triglycerides, weight, BP)
- Show diffs vs previous report

Quick start:

1. Create a virtualenv and install dependencies:

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

2. Notes: `pdf2image` requires `poppler` installed on your system for PDF conversion. `pytesseract` requires Tesseract OCR installed and on PATH.

3. Run the app:

```bash
python app.py
```

Open http://127.0.0.1:5000 in your browser.

Preview (static)
--------------

A quick local preview page is included to try the UI without running the frontend build tools.

- Open `report_preview.html` in your browser:

	- File: c:\Users\Guesty\Desktop\health reports tracker\report_preview.html
	- The preview lets you add people, simulate uploads, view diffs and download exports.
	- If the backend is running at `http://localhost:5000`, the preview will attempt a real upload and PDF export; otherwise it falls back to client-side generation.

Node backend (optional)
-----------------------

If you prefer the Node/Express backend instead of the Python version, there is a backend scaffold in `backend/`.

Start backend:

```bash
cd "c:\Users\Guesty\Desktop\health reports tracker\backend"
npm install
node server.js
```

Frontend (optional)
-------------------

There is a minimal React frontend scaffold in `frontend/` (Vite). To run:

```bash
cd "c:\Users\Guesty\Desktop\health reports tracker\frontend"
npm install
npm run dev
```

Prerequisites
-------------
- For OCR and PDF->image conversion you may need to install system packages:
	- Tesseract (for OCR). Add to PATH.
	- Poppler (`pdftoppm`) for PDF page conversion.

If you need help installing those on Windows, tell me your environment and I'll provide commands.
