import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const fmt = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
const dateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function App() {
  const [token, setToken] = useState(
    localStorage.getItem("staywise_token") || "",
  );
  const [email, setEmail] = useState("revenue@demo.staywise.local");
  const [password, setPassword] = useState("DemoPass!234");
  const [loginError, setLoginError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(dateStr(new Date()));
  const [endDate, setEndDate] = useState(
    dateStr(new Date(Date.now() + 7 * 86400000)),
  );
  const [job, setJob] = useState(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState([]);

  async function request(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP_${res.status}`);
    return body;
  }
  async function login(e) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Login failed");
      localStorage.setItem("staywise_token", body.token);
      setToken(body.token);
    } catch (err) {
      setLoginError(
        err.message === "INVALID_CREDENTIALS"
          ? "Email or password is incorrect."
          : err.message,
      );
    }
  }
  function logout() {
    localStorage.removeItem("staywise_token");
    setToken("");
    setDashboard(null);
    setJob(null);
    setHistory([]);
  }
  useEffect(() => {
    if (!token) return;
    let live = true;
    setLoading(true);
    request("/api/dashboard")
      .then((d) => {
        if (live) setDashboard(d);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          if (e.message.includes("TOKEN")) logout();
        }
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [token]);
  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const next = await request(`/api/rate-suggestions/${job.id}`);
        if (cancelled) return;
        setJob(next);
        if (["completed", "failed"].includes(next.status)) {
          setHistory((h) => [next, ...h.filter((x) => x.id !== next.id)]);
          return;
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      timer = setTimeout(poll, 1300);
    };
    timer = setTimeout(poll, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  async function generate(e) {
    e.preventDefault();
    setError("");
    setCreating(true);
    setJob(null);
    try {
      const j = await request("/api/rate-suggestions", {
        method: "POST",
        body: JSON.stringify({ startDate, endDate }),
      });
      setJob({ id: j.jobId, status: j.status, created_at: j.createdAt });
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }
  const suggestions = job?.result?.suggestions || [];
  const summary = useMemo(() => {
    if (!suggestions.length) return null;
    const avg =
      suggestions.reduce((a, s) => a + Number(s.suggestedRate), 0) /
      suggestions.length;
    const high = suggestions.filter((s) => s.demandLevel === "high").length;
    return { avg, high, count: suggestions.length };
  }, [suggestions]);
  if (!token)
    return (
      <main className="login-wrap">
        <section className="login-card">
          <div className="brand-mark">S</div>
          <p className="eyebrow">STAYWISE REVENUE INTELLIGENCE</p>
          <h1>
            Smarter rates.
            <br />
            <span>Better decisions.</span>
          </h1>
          <p className="muted">
            Sign in to generate demand-aware room-rate recommendations for your
            property.
          </p>
          <form onSubmit={login} className="stack">
            <label>
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
              />
            </label>
            <label>
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
              />
            </label>
            {loginError && <p className="error">{loginError}</p>}
            <button className="primary" type="submit">
              Sign in <span>→</span>
            </button>
          </form>
          <p className="demo-note">
            Demo environment · no guest personal data is used by the AI
          </p>
        </section>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark small">S</div>
          <span>staywise</span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <div className="nav-item active">
          <span>◈</span> Revenue overview
        </div>
        <div className="nav-item">
          <span>▦</span> Reservations
        </div>
        <div className="nav-item">
          <span>⌂</span> Room inventory
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">RM</div>
          <div className="user-info">
            <b>Revenue Manager</b>
            <small>Demo Hospitality Group</small>
          </div>
          <button className="logout" onClick={logout} title="Sign out">
            ↗
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="crumb">
              Reservations & Sales <span>/</span> Rate intelligence
            </div>
            <h2>Revenue overview</h2>
          </div>
          <div className="top-right">
            <span className="live-dot"></span> Demo property{" "}
            <span className="profile">RM</span>
          </div>
        </header>
        {error && (
          <div className="alert" role="alert">
            {error.replaceAll("_", " ")}{" "}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {loading ? (
          <div className="skeleton">Loading your property data…</div>
        ) : (
          dashboard && (
            <>
              <section className="welcome">
                <div>
                  <p className="eyebrow">
                    YOUR PROPERTY · {dashboard.property.currency}
                  </p>
                  <h1>{dashboard.property.name}</h1>
                  <p className="muted">
                    Demand signals, pricing opportunities, and AI-assisted
                    decisions in one place.
                  </p>
                </div>
                <div className="welcome-badge">
                  <span>✦</span> AI-assisted pricing
                </div>
              </section>
              <section className="metrics">
                <div className="metric">
                  <div className="metric-label">Room categories</div>
                  <div className="metric-value">
                    {dashboard.roomTypes.length}
                  </div>
                  <div className="metric-foot">
                    <span className="positive">●</span> Active inventory
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Demand dates tracked</div>
                  <div className="metric-value">
                    {
                      new Set(
                        dashboard.demand.map((d) => d.stay_date.slice(0, 10)),
                      ).size
                    }
                  </div>
                  <div className="metric-foot">Next 14 days</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Average base rate</div>
                  <div className="metric-value">
                    {fmt(
                      dashboard.roomTypes.reduce(
                        (a, r) => a + Number(r.base_rate),
                        0,
                      ) / (dashboard.roomTypes.length || 1),
                    )}
                  </div>
                  <div className="metric-foot">Across room categories</div>
                </div>
              </section>
              <section className="content-grid">
                <div className="panel generator">
                  <div className="panel-head">
                    <div>
                      <div className="icon-tile">✦</div>
                      <h3>Demand-based rate suggestions</h3>
                      <p className="muted">
                        Analyze occupancy, booking pickup, and local event
                        signals.
                      </p>
                    </div>
                    <span className="pill">AI BETA</span>
                  </div>
                  <form onSubmit={generate} className="date-form">
                    <label>
                      Stay date from
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Stay date to
                      <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        max={dateStr(new Date(Date.now() + 90 * 86400000))}
                        onChange={(e) => setEndDate(e.target.value)}
                        required
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={
                        creating ||
                        (!!job && ["queued", "processing"].includes(job.status))
                      }
                    >
                      {creating ? "Queuing…" : "Generate suggestions"}{" "}
                      <span>✦</span>
                    </button>
                  </form>
                  <div className="privacy-line">
                    <span>▣</span> Guest names, emails, and phone numbers are
                    never sent to the AI model.
                  </div>
                  {job && (
                    <div className="job-state" aria-live="polite">
                      <div className={`status-icon ${job.status}`}>
                        {["queued", "processing"].includes(job.status) ? (
                          <span className="spinner" />
                        ) : job.status === "completed" ? (
                          "✓"
                        ) : (
                          "!"
                        )}
                      </div>
                      <div className="job-copy">
                        <b>
                          {job.status === "queued"
                            ? "Queued for analysis"
                            : job.status === "processing"
                              ? "Analyzing demand signals"
                              : job.status === "completed"
                                ? "Recommendations ready"
                                : "Could not complete analysis"}
                        </b>
                        <small>
                          {job.status === "queued"
                            ? "Waiting for an available worker…"
                            : job.status === "processing"
                              ? "Evaluating booking pace and rate boundaries. This usually takes a few seconds."
                              : job.status === "completed"
                                ? `Generated ${suggestions.length} rate recommendations.`
                                : "Please try again. No live rates were changed."}
                        </small>
                      </div>
                      {["queued", "processing"].includes(job.status) && (
                        <span className="processing-label">IN PROGRESS</span>
                      )}
                    </div>
                  )}
                  {job?.status === "completed" && (
                    <>
                      <div className="result-summary">
                        <div>
                          <small>Recommended average</small>
                          <strong>{fmt(summary?.avg)}</strong>
                        </div>
                        <div>
                          <small>High-demand dates</small>
                          <strong>{summary?.high || 0}</strong>
                        </div>
                        <div>
                          <small>Recommendations</small>
                          <strong>{summary?.count || 0}</strong>
                        </div>
                      </div>
                      <div className="provider-note">
                        Method:{" "}
                        <b>
                          {job.provider === "ollama_local"
                            ? "Local Ollama model"
                            : "Rules-based fallback"}
                        </b>{" "}
                        · Review recommendations before applying.
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Stay date</th>
                              <th>Room type</th>
                              <th>Base rate</th>
                              <th>Suggested</th>
                              <th>Demand</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suggestions.map((s, i) => {
                              const room = dashboard.roomTypes.find(
                                (r) => r.id === s.roomTypeId,
                              );
                              return (
                                <tr key={`${s.roomTypeId}-${s.stayDate}-${i}`}>
                                  <td>
                                    {new Date(
                                      `${s.stayDate}T12:00:00`,
                                    ).toLocaleDateString("en-IN", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </td>
                                  <td>
                                    {s.roomTypeName || room?.name || "Room"}
                                  </td>
                                  <td>{fmt(room?.base_rate)}</td>
                                  <td className="rate">
                                    {fmt(s.suggestedRate)}
                                  </td>
                                  <td>
                                    <span className={`demand ${s.demandLevel}`}>
                                      {s.demandLevel}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="rationale-list">
                        <h4>Why these rates?</h4>
                        {suggestions.slice(0, 3).map((s, i) => (
                          <p key={i}>
                            <b>
                              {s.stayDate} · {s.roomTypeName}
                            </b>{" "}
                            — {s.rationale}
                          </p>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="panel signals">
                  <div className="section-title">
                    <div>
                      <h3>Demand signals</h3>
                      <p className="muted">
                        Recent forecast inputs by room type
                      </p>
                    </div>
                    <span className="signal-icon">⌁</span>
                  </div>
                  <div className="legend">
                    <span>
                      <i className="dot high"></i> High
                    </span>
                    <span>
                      <i className="dot medium"></i> Medium
                    </span>
                    <span>
                      <i className="dot low"></i> Low
                    </span>
                  </div>
                  {dashboard.roomTypes.map((room) => {
                    const rows = dashboard.demand
                      .filter((d) => d.room_type_id === room.id)
                      .slice(0, 7);
                    return (
                      <div className="room-signal" key={room.id}>
                        <div className="room-head">
                          <b>{room.name}</b>
                          <span>
                            {fmt(room.base_rate)} <small>/ night</small>
                          </span>
                        </div>
                        <div className="bars">
                          {rows.map((d, i) => {
                            const occ = Math.round(
                              (Number(d.rooms_booked) /
                                Math.max(1, Number(d.rooms_available))) *
                                100,
                            );
                            const level =
                              occ >= 75 ? "high" : occ >= 45 ? "medium" : "low";
                            return (
                              <div
                                className="bar-col"
                                key={i}
                                title={`${d.stay_date}: ${occ}% booked`}
                              >
                                <div className="bar-track">
                                  <div
                                    className={`bar ${level}`}
                                    style={{ height: `${Math.max(5, occ)}%` }}
                                  />
                                </div>
                                <small>
                                  {new Date(
                                    `${d.stay_date.slice(0, 10)}T12:00:00`,
                                  ).toLocaleDateString("en-IN", {
                                    weekday: "short",
                                  })}
                                </small>
                              </div>
                            );
                          })}
                        </div>
                        <div className="room-limits">
                          <span>Min {fmt(room.min_rate)}</span>
                          <span>Max {fmt(room.max_rate)}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="signal-foot">
                    <span>ⓘ</span> Suggestions are bounded by configured minimum
                    and maximum rates.
                  </div>
                </div>
              </section>
              <footer>
                StayWise Revenue Intelligence <span>·</span> Recommendations
                support decisions; they do not automatically change live prices.
              </footer>
            </>
          )
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
