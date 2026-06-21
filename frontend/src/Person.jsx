import React, { useEffect, useState } from "react";
import axios from "axios";

const API = "http://localhost:5000/api";

export default function Person({ id, goBack, threshold = 10 }) {
  const [person, setPerson] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [significantMap, setSignificantMap] = useState({});
  const [editingDob, setEditingDob] = useState(false);
  const [dobInput, setDobInput] = useState("");
  const [savingDob, setSavingDob] = useState(false);
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [compareResult, setCompareResult] = useState(null);

  useEffect(() => {
    fetchPerson();
  }, [id]);
  function fetchPerson() {
    axios
      .get(`${API}/people/${id}`)
      .then((r) => setPerson(r.data.person))
      .catch((e) => console.error(e));
  }

  useEffect(()=>{
    // when person changes, compute significance map for reports
    if(!person || !person.reports) return;
    const map = {};
    person.reports.forEach(r=>{ map[r.id]=false });
    setSignificantMap(map);
    person.reports.forEach(r=>{
      axios.get(`${API}/report/${r.id}/details`).then(res=>{
        const diffs = res.data.diffs || {};
        let sig = false;
        for(const k in diffs){
          const d = diffs[k];
          if(d.change === 'new' || d.change === 'bp' || d.change === 'unknown'){ sig = true; break }
          if(d.delta !== undefined && d.from !== undefined){
            const from = Number(d.from) || 0;
            const delta = Number(d.delta) || 0;
            const pct = from !== 0 ? Math.abs(delta / from * 100) : Math.abs(delta);
            if(pct >= Number(threshold)) { sig = true; break }
          }
        }
        setSignificantMap(m => ({...m, [r.id]: sig}));
      }).catch(()=>{})
    })
  }, [person, threshold]);

  // keep dobInput synced when person loads
  useEffect(()=>{
    if(person) setDobInput(person.dob || '');
  }, [person]);

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file, file.name);
    setLoading(true);
    try {
      await axios.post(`${API}/people/${id}/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      await fetchPerson();
      alert('Upload complete — report added.');
    } catch (err) {
      console.error(err);
      alert('Upload failed. Check backend and OCR dependencies (Tesseract, Poppler).');
    }
    setLoading(false);
  }

  function pickCompareDefaults(){
    if(!person || !person.reports || person.reports.length<2) return;
    setCompareLeft(String(person.reports[1].id || person.reports[0].id));
    setCompareRight(String(person.reports[0].id));
  }

  function runCompare(){
    if(!compareLeft || !compareRight) { alert('Select two reports to compare'); return }
    if(compareLeft === compareRight){ alert('Select two different reports'); return }
    axios.get(`${API}/compare?left=${compareLeft}&right=${compareRight}`).then(r=>setCompareResult(r.data)).catch(e=>{ console.error(e); alert('Compare failed') });
  }

  // auto-populate compare selectors when reports change
  useEffect(()=>{
    if(!person || !person.reports) return;
    if(person.reports.length >= 2 && (!compareLeft || !compareRight)){
      pickCompareDefaults();
    }
  }, [person]);

  function viewReport(rid) {
    axios
      .get(`${API}/report/${rid}/details`)
      .then((r) => setSelectedReport(r.data))
      .catch((e) => console.error(e));
  }

  function deleteReport(rid) {
    if (!confirm("Delete report?")) return;
    axios.post(`${API}/report/${rid}/delete`).then(() => {
      fetchPerson();
      if (selectedReport && selectedReport.id == rid) setSelectedReport(null);
    });
  }

  if (!person) return <div style={{ padding: 20 }}>Loading...</div>;

  function startEditDob(){ setDobInput(person.dob || ''); setEditingDob(true); }
  function cancelEditDob(){ setDobInput(person.dob || ''); setEditingDob(false); }
  async function saveDob(){
    setSavingDob(true);
    try{
      await axios.put(`${API}/people/${id}`, { dob: dobInput });
      setEditingDob(false);
      fetchPerson();
    }catch(e){
      console.error(e);
      alert('Failed to save DOB. Check backend connection.');
    }
    setSavingDob(false);
  }

  return (
    <div style={{ padding: 20 }}>
      <button onClick={goBack}>← Back</button>
      <h2>{person.name}</h2>
      <p>
        DOB: {editingDob ? (
          <span>
            <input type="date" value={dobInput} onChange={e=>setDobInput(e.target.value)} />
            <button onClick={saveDob} disabled={savingDob} style={{marginLeft:8}}>{savingDob? 'Saving...':'Save'}</button>
            <button onClick={cancelEditDob} style={{marginLeft:8}}>Cancel</button>
          </span>
        ) : (
          <span>
            {person.dob || "—"} <button onClick={startEditDob} style={{marginLeft:8}}>Edit</button>
          </span>
        )}
      </p>

      <h3>Upload Report (PDF or image)</h3>
      <form onSubmit={upload}>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files[0])}
          accept=".pdf,image/*"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Uploading..." : "Upload"}
        </button>
      </form>

      <h4 style={{marginTop:12}}>Compare Reports</h4>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <select value={compareLeft} onChange={e=>setCompareLeft(e.target.value)}>
          <option value="">Select older</option>
          {person.reports && person.reports.map(r=> <option key={r.id} value={r.id}>{r.filename} ({new Date(r.uploaded_at).toLocaleString()})</option>)}
        </select>
        <select value={compareRight} onChange={e=>setCompareRight(e.target.value)}>
          <option value="">Select newer</option>
          {person.reports && person.reports.map(r=> <option key={r.id} value={r.id}>{r.filename} ({new Date(r.uploaded_at).toLocaleString()})</option>)}
        </select>
        <button onClick={pickCompareDefaults}>Auto</button>
        <button onClick={runCompare}>Compare</button>
      </div>

      <h3>Reports</h3>
      <ul>
        {person.reports &&
          person.reports.map((r) => {
            // determine if report has significant change from computed map
            const badge = significantMap[r.id];
            return (
              <li key={r.id} style={{ marginBottom: 6, display:'flex', alignItems:'center', gap:8 }}>
                <div>
                  {r.filename} — {new Date(r.uploaded_at).toLocaleString()}
                  {badge && <span className="pulse-badge" style={{marginLeft:8,display:'inline-block',background:'#fee2e2',color:'#b91c1c',padding:'4px 8px',borderRadius:999,animation:'pulse 1.6s infinite'}}> Significant</span>}
                </div>
                <div style={{marginLeft:'auto'}}>
                    <button onClick={()=>{ setCompareLeft(String(r.id)); }} style={{marginLeft:8}}>Set older</button>
                    <button onClick={()=>{ setCompareRight(String(r.id)); }} style={{marginLeft:8}}>Set newer</button>
                  <button onClick={() => viewReport(r.id)} style={{ marginLeft: 8 }}>
                    View
                  </button>
                  <a style={{ marginLeft: 8 }} href={`http://localhost:5000/api/report/${r.id}/export?format=pdf`}>
                    Export PDF
                  </a>
                  <a style={{ marginLeft: 8 }} href={`http://localhost:5000/api/report/${r.id}/export?format=png`}>
                    Export PNG
                  </a>
                  <button onClick={() => deleteReport(r.id)} style={{ marginLeft: 8, color: "#900" }}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
      </ul>

      {selectedReport && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd" }}>
          <h4>Report Details: {selectedReport.report.filename}</h4>
          <p>Uploaded: {selectedReport.report.uploaded_at}</p>
          <h5>Metrics</h5>
          <ul>
            {selectedReport.report.metrics &&
            Object.keys(selectedReport.report.metrics).length > 0 ? (
              Object.entries(selectedReport.report.metrics).map(([k, v]) => (
                <li key={k}>
                  {k}: {v.value || v} {v.unit || ""}
                </li>
              ))
            ) : (
              <li>No metrics</li>
            )}
          </ul>
          <h5>Diff vs previous</h5>
          {selectedReport.previous ? (
            <ul>
              {Object.entries(selectedReport.diffs).map(([k, d]) => {
                const renderDiff = (diff) => {
                  if (!diff) return null;
                  if (diff.change === "new") {
                    const val = (diff.to && (diff.to.value || diff.to)) || "";
                    return <span style={{ color: "#1e88e5" }}>New → {String(val)}</span>;
                  }
                  if (diff.change === "bp") {
                    return <span style={{ color: "#6a1b9a" }}>{diff.from} → {diff.to}</span>;
                  }
                  if (diff.change === "unknown") {
                    const from = diff.from && (diff.from.value || diff.from);
                    const to = diff.to && (diff.to.value || diff.to);
                    return <span style={{ color: "#555" }}>Changed {String(from)} → {String(to)}</span>;
                  }
                  const delta = Number(diff.delta) || 0;
                  const from = Number(diff.from) || 0;
                  const to = Number(diff.to) || 0;
                  const arrow = delta > 0 ? "▲" : (delta < 0 ? "▼" : "→");
                  const color = delta > 0 ? "#d32f2f" : (delta < 0 ? "#2e7d32" : "#666");
                  const pct = from !== 0 ? `${((delta / from) * 100).toFixed(1)}%` : null;
                  return (
                    <span style={{ color }}>
                      {arrow} {Math.abs(delta).toFixed(2)}{pct ? ` (${pct})` : ""} — {String(from)} → {String(to)}
                    </span>
                  );
                };
                return (
                  <li key={k}>
                    <strong>{k}</strong>: {renderDiff(d)}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No previous report to compare.</p>
          )}
          <h5>Extracted Text</h5>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#f8f8f8",
              padding: 8,
            }}
          >
            {selectedReport.report.extracted_text}
          </pre>
        </div>
      )}

      {compareResult && (
        <div style={{marginTop:16,padding:12,border:'1px solid #ddd',background:'#fffaf2'}}>
          <h4>Compare: {compareResult.left.filename} → {compareResult.right.filename}</h4>
          <ul>
            {Object.entries(compareResult.diffs).map(([k,d])=> (
              <li key={k}><strong>{k}</strong>: {d.change==='new'? (<span style={{color:'#0ea5e9'}}>New → {String(d.to && (d.to.value||d.to))}</span>) : d.change==='bp' ? (<span style={{color:'#6a1b9a'}}>{d.from} → {d.to}</span>) : d.change==='unknown' ? (<span>Changed</span>) : (<span style={{color: d.delta>0? '#b91c1c':'#15803d'}}>{d.delta>0? '▲':'▼'} {Math.abs(d.delta).toFixed(2)} ({d.from} → {d.to})</span>)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
