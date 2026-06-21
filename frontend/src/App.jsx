import React, { useEffect, useState } from "react";
import axios from "axios";
import Person from "./Person";

const API = "http://localhost:5000/api";

export default function App() {
  const [people, setPeople] = useState([]);
  const [name, setName] = useState("");
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
    axios.post(`${API}/people`, { name }).then(() => {
      setName("");
      fetchPeople();
    });
  }

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
        @keyframes pulse { 0% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.08); opacity: 0.85 } 100% { transform: scale(1); opacity: 1 } }
        .pulse-badge { box-shadow: 0 6px 20px rgba(0,0,0,0.06); }
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
            <li key={p.id}>
              {p.name} — <a href={`#/person/${p.id}`}>open</a>
            </li>
          ))}
        </ul>
        <form onSubmit={addPerson}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
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
