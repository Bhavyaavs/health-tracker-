import React, { useEffect, useState } from "react";
import axios from "axios";
import Person from "./Person";

const API = "http://localhost:5000/api";

export default function App() {
  const [people, setPeople] = useState([]);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDob, setEditDob] = useState("");
  const [threshold, setThreshold] = useState(() => {
    const v = localStorage.getItem('significantThreshold');
    return v ? Number(v) : 10;
  });
  const [route, setRoute] = useState(window.location.hash || "");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    fetchPeople();
  }, []);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function fetchPeople() {
    axios
      .get(`${API}/people`)
      .then((r) => setPeople(r.data))
      .catch((e) => console.error(e));
  }
  function addPerson(e) {
    e.preventDefault();
    if (!name) return;
    axios
      .post(`${API}/people`, { name, dob })
      .then(() => {
        setName("");
        setDob("");
        fetchPeople();
      })
      .catch((err) => {
        console.error('Add person failed', err);
        alert('Failed to add person — check backend is running and see console for details.');
      });
  }

  function startEdit(p){ setEditingId(p.id); setEditName(p.name||''); setEditDob(p.dob||''); }
  function cancelEdit(){ setEditingId(null); setEditName(''); setEditDob(''); }
  function saveEdit(){ if(!editingId) return; axios.put(`${API}/people/${editingId}`, { name: editName, dob: editDob }).then(()=>{ fetchPeople(); cancelEdit(); }).catch(e=>console.error(e)); }
  function deletePerson(id){ if(!confirm('Delete person and all reports?')) return; axios.delete(`${API}/people/${id}`).then(()=>fetchPeople()).catch(e=>console.error(e)); }

  // simple router: #/person/:id
  if (route.startsWith("#/person/")) {
    const id = route.split("/")[2];
    return (
      <Person
        id={id}
        goBack={() => {
          window.location.hash = "";
          fetchPeople();
        }}
        threshold={threshold}
      />
    );
  }

  return (
    <div style={{ padding: 20, fontFamily: "Segoe UI,Arial" }}>
      <style>{`
        :root{--bg:#f6efe6;--card:#fffaf2;--muted:#6b5b4a;--accent:#c59b70}
        body{background:var(--bg)}
        .card { background: var(--card); border-radius:10px; padding:12px; box-shadow:0 6px 18px rgba(16,24,40,0.04)}
        h1,h2,h3{color:var(--muted)}
        a { color: var(--accent) }
        @keyframes pulse { 0% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.04); opacity: 0.85 } 100% { transform: scale(1); opacity: 1 } }
        .pulse-badge { box-shadow: 0 6px 20px rgba(0,0,0,0.04); background: #fff3eb; }
      `}</style>
      <h1>Health Tracker (React)</h1>
      <div style={{float:'right'}}>
        <button onClick={()=>setShowSettings(s=>!s)} style={{marginRight:8}} className="secondary">Settings</button>
      </div>
      {showSettings && (
        <div style={{border:'1px solid #ddd',padding:12,marginBottom:12,borderRadius:8}}>
          <label>Significant change threshold (%): </label>
          <input type="number" value={threshold} onChange={e=>{ const v=Number(e.target.value||0); setThreshold(v); localStorage.setItem('significantThreshold', String(v)); }} style={{width:80,marginLeft:8}} />
          <div className="muted" style={{marginTop:6}}>Changes larger than this percent are highlighted on reports.</div>
        </div>
      )}
      <section style={{ marginBottom: 20 }}>
        <h3>People</h3>
        <ul>
          {people.map((p) => (
            <li key={p.id} style={{marginBottom:8}}>
              {editingId===p.id ? (
                <span>
                  <input value={editName} onChange={e=>setEditName(e.target.value)} />
                  <input type="date" value={editDob||''} onChange={e=>setEditDob(e.target.value)} style={{marginLeft:8}} />
                  <button onClick={saveEdit} style={{marginLeft:8}}>Save</button>
                  <button onClick={cancelEdit} style={{marginLeft:8}}>Cancel</button>
                </span>
              ) : (
                <span>
                  <strong>{p.name}</strong> — <a href={`#/person/${p.id}`}>open</a>
                  <button onClick={()=>startEdit(p)} style={{marginLeft:8}}>Edit</button>
                  <button onClick={()=>deletePerson(p.id)} style={{marginLeft:8,color:'#900'}}>Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addPerson} style={{display:'flex',gap:8,alignItems:'center'}}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input type="date" value={dob} onChange={e=>setDob(e.target.value)} style={{width:160}} />
          <button>Add</button>
        </form>
      </section>
      <section>
        <p>
          Open a person by clicking <em>open</em> next to their name.
        </p>
      </section>
    </div>
  );
}
