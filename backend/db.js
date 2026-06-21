const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.join(__dirname, "health.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dob TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    uploaded_at TEXT,
    extracted_text TEXT,
    metrics_json TEXT,
    FOREIGN KEY(person_id) REFERENCES person(id)
  )`);
});

module.exports = db;
