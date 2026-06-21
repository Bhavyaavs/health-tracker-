import os
import re
import json
from datetime import datetime
import io
from flask import Flask, render_template, request, redirect, url_for, flash, send_from_directory, send_file
from werkzeug.utils import secure_filename
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc
from PIL import Image
import pytesseract
from pdf2image import convert_from_path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///health.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.secret_key = 'dev-secret'

db = SQLAlchemy(app)


class Person(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, nullable=False)
    dob = db.Column(db.String)
    reports = db.relationship('Report', backref='person', cascade='all, delete-orphan')


class Report(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    person_id = db.Column(db.Integer, db.ForeignKey('person.id'), nullable=False)
    filename = db.Column(db.String, nullable=False)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
    extracted_text = db.Column(db.Text)
    metrics_json = db.Column(db.Text)  # JSON string

    def metrics(self):
        if self.metrics_json:
            return json.loads(self.metrics_json)
        return {}


def extract_text_from_image(path):
    img = Image.open(path)
    text = pytesseract.image_to_string(img)
    return text


def extract_text_from_pdf(path):
    # convert PDF pages to images and OCR them
    images = convert_from_path(path, dpi=200)
    texts = []
    for img in images:
        texts.append(pytesseract.image_to_string(img))
    return "\n".join(texts)


METRIC_PATTERNS = {
    'glucose': r'(?:glucose|sugar)[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|mmol/l|mmol/L|%)?',
    'hba1c': r'hba1c[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(%?)',
    'cholesterol': r'cholesterol[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|mmol/l|mmol/L)?',
    'hdl': r'hdl[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|mmol/l)?',
    'ldl': r'ldl[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|mmol/l)?',
    'triglycerides': r'triglycerid(?:es)?[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|mmol/l)?',
    'creatinine': r'creatinine[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|umol/l)?',
    'bun': r'(?:urea|bun)[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|mmol/l)?',
    'uric_acid': r'uric acid[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(mg/dl|umol/l)?',
    'hemoglobin': r'hemoglobin[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(g/dl)?',
    'wbc': r'wbc[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(x10\^?3/ul|10\^3/ul)?',
    'rbc': r'rbc[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(x10\^?6/ul|10\^6/ul)?',
    'platelets': r'platelet(?:s)?[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(x10\^?3/ul|10\^3/ul)?',
    'weight': r'weight[:\s]*([0-9]+(?:\.[0-9]+)?)\s*(kg|lb|lbs)?',
    'bp': r'(?:bp|blood pressure)[:\s]*([0-9]{2,3}/[0-9]{2,3})',
}


def parse_metrics(text):
    text_lower = text.lower()
    metrics = {}
    for key, pattern in METRIC_PATTERNS.items():
        m = re.search(pattern, text_lower, re.IGNORECASE)
        if m:
            # Many patterns capture value and optional unit
            try:
                if m.lastindex and m.lastindex >= 2:
                    val = m.group(1)
                    unit = m.group(2) if m.group(2) else None
                    metrics[key] = {'value': val, 'unit': unit}
                else:
                    metrics[key] = {'value': m.group(1), 'unit': None}
            except Exception:
                metrics[key] = {'value': m.group(1), 'unit': None}
    return metrics


def compute_diff(old_metrics, new_metrics):
    diffs = {}
    for k, newv in new_metrics.items():
        oldv = old_metrics.get(k)
        try:
            # newv and oldv are dicts like {'value': '123', 'unit': 'mg/dl'}
            if oldv is None:
                diffs[k] = {'change': 'new', 'from': oldv, 'to': newv}
            else:
                new_val = newv.get('value') if isinstance(newv, dict) else newv
                old_val = oldv.get('value') if isinstance(oldv, dict) else oldv
                # handle BP separately
                if isinstance(new_val, str) and '/' in new_val and isinstance(old_val, str) and '/' in old_val:
                    diffs[k] = {'change': 'bp', 'from': old_val, 'to': new_val}
                else:
                    nv = float(new_val)
                    ov = float(old_val)
                    delta = nv - ov
                    state = 'increased' if delta > 0 else ('decreased' if delta < 0 else 'unchanged')
                    diffs[k] = {'change': state, 'delta': delta, 'from': float(ov), 'to': float(nv)}
        except Exception:
            diffs[k] = {'change': 'unknown', 'from': oldv, 'to': newv}
    return diffs


@app.route('/report/<int:report_id>/export')
def export_report(report_id):
    fmt = request.args.get('format', 'pdf').lower()
    r = Report.query.get_or_404(report_id)
    prev = Report.query.filter(Report.person_id == r.person_id, Report.id != r.id).order_by(desc(Report.uploaded_at)).first()
    prev_metrics = prev.metrics() if prev else {}
    diffs = compute_diff(prev_metrics, r.metrics())

    # build a simple textual summary
    lines = []
    lines.append(f"Report: {r.filename}")
    lines.append(f"Person: {r.person.name}")
    lines.append(f"Uploaded: {r.uploaded_at.strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    lines.append("Extracted metrics:")
    for k, v in r.metrics().items():
        if isinstance(v, dict):
            val = v.get('value')
            unit = v.get('unit') or ''
            lines.append(f" - {k}: {val} {unit}".strip())
        else:
            lines.append(f" - {k}: {v}")
    lines.append("")
    lines.append("Diff vs previous:")
    if prev:
        for k, d in diffs.items():
            if d.get('change') == 'new':
                lines.append(f" - {k}: new -> {d.get('to')}")
            elif d.get('change') == 'bp':
                lines.append(f" - {k}: {d.get('from')} -> {d.get('to')}")
            elif d.get('change') == 'unknown':
                lines.append(f" - {k}: changed from {d.get('from')} to {d.get('to')}")
            else:
                lines.append(f" - {k}: {d.get('change')} by {d.get('delta'):.2f} ({d.get('from')} -> {d.get('to')})")
    else:
        lines.append(' No previous report')

    text = "\n".join(lines)

    if fmt in ('png', 'image'):
        # Render text to an image
        from PIL import ImageDraw, ImageFont
        font = None
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None
        padding = 10
        # estimate image size
        max_width = max([len(line) for line in lines]) * 7
        line_height = 14
        img_h = line_height * (len(lines) + 1) + padding * 2
        img_w = max(300, max_width + padding * 2)
        img = Image.new('RGB', (img_w, img_h), color='white')
        draw = ImageDraw.Draw(img)
        y = padding
        for line in lines:
            draw.text((padding, y), line, fill='black', font=font)
            y += line_height
        bio = io.BytesIO()
        img.save(bio, format='PNG')
        bio.seek(0)
        return send_file(bio, mimetype='image/png', as_attachment=True, download_name=f"report_{r.id}.png")

    # default: PDF
    bio = io.BytesIO()
    p = canvas.Canvas(bio, pagesize=letter)
    width, height = letter
    x = 40
    y = height - 40
    p.setFont('Helvetica-Bold', 14)
    p.drawString(x, y, f"Health Report: {r.filename}")
    y -= 24
    p.setFont('Helvetica', 10)
    for line in lines[1:]:
        if y < 60:
            p.showPage()
            y = height - 40
            p.setFont('Helvetica', 10)
        p.drawString(x, y, line)
        y -= 14
    p.showPage()
    p.save()
    bio.seek(0)
    return send_file(bio, mimetype='application/pdf', as_attachment=True, download_name=f"report_{r.id}.pdf")


@app.before_first_request
def create_tables():
    db.create_all()


@app.route('/')
def index():
    people = Person.query.all()
    return render_template('index.html', people=people)


@app.route('/person/add', methods=['POST'])
def add_person():
    name = request.form.get('name')
    dob = request.form.get('dob')
    if not name:
        flash('Name required', 'error')
        return redirect(url_for('index'))
    p = Person(name=name, dob=dob)
    db.session.add(p)
    db.session.commit()
    return redirect(url_for('person_detail', person_id=p.id))


@app.route('/person/<int:person_id>')
def person_detail(person_id):
    p = Person.query.get_or_404(person_id)
    reports = Report.query.filter_by(person_id=person_id).order_by(desc(Report.uploaded_at)).all()
    return render_template('person.html', person=p, reports=reports)


@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/person/<int:person_id>/upload', methods=['POST'])
def upload_report(person_id):
    p = Person.query.get_or_404(person_id)
    if 'file' not in request.files:
        flash('No file part', 'error')
        return redirect(url_for('person_detail', person_id=person_id))
    f = request.files['file']
    if f.filename == '':
        flash('No selected file', 'error')
        return redirect(url_for('person_detail', person_id=person_id))
    filename = secure_filename(f.filename)
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    f.save(save_path)

    # extract text
    text = ''
    if filename.lower().endswith('.pdf'):
        try:
            text = extract_text_from_pdf(save_path)
        except Exception:
            flash('PDF parsing may require poppler; text extraction failed.', 'warning')
            text = ''
    else:
        try:
            text = extract_text_from_image(save_path)
        except Exception:
            text = ''

    metrics = parse_metrics(text)

    report = Report(person_id=person_id, filename=filename, extracted_text=text, metrics_json=json.dumps(metrics))
    db.session.add(report)
    db.session.commit()
    flash('Report uploaded', 'success')
    return redirect(url_for('report_detail', report_id=report.id))


@app.route('/report/<int:report_id>')
def report_detail(report_id):
    r = Report.query.get_or_404(report_id)
    prev = Report.query.filter(Report.person_id == r.person_id, Report.id != r.id).order_by(desc(Report.uploaded_at)).first()
    prev_metrics = prev.metrics() if prev else {}
    diffs = compute_diff(prev_metrics, r.metrics())
    return render_template('report.html', report=r, diffs=diffs, prev=prev)


@app.route('/person/<int:person_id>/edit', methods=['POST'])
def edit_person(person_id):
    p = Person.query.get_or_404(person_id)
    name = request.form.get('name')
    dob = request.form.get('dob')
    if name:
        p.name = name
    p.dob = dob
    db.session.commit()
    flash('Person updated', 'success')
    return redirect(url_for('person_detail', person_id=person_id))


@app.route('/person/<int:person_id>/delete', methods=['POST'])
def delete_person(person_id):
    p = Person.query.get_or_404(person_id)
    db.session.delete(p)
    db.session.commit()
    flash('Person deleted', 'success')
    return redirect(url_for('index'))


@app.route('/report/<int:report_id>/delete', methods=['POST'])
def delete_report(report_id):
    r = Report.query.get_or_404(report_id)
    # delete file
    try:
        path = os.path.join(app.config['UPLOAD_FOLDER'], r.filename)
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
    pid = r.person_id
    db.session.delete(r)
    db.session.commit()
    flash('Report deleted', 'success')
    return redirect(url_for('person_detail', person_id=pid))


if __name__ == '__main__':
    app.run(debug=True)
