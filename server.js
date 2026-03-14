const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();
const app = express();
const PORT = process.env.PORT || 3001;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || origin.endsWith(".vercel.app") || origin === "https://leads.fortitudecreative.com" || origin === "http://localhost:3000") {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : req.query.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid or expired session" });
  req.user = user;
  next();
};

app.get("/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

app.post("/api/rb2b-webhook", async (req, res) => {
  try {
    const p = req.body;
    const name = ((p.first_name || "") + " " + (p.last_name || "")).trim() || null;
    const { error } = await supabase.from("leads").insert({
      source: "rb2b", name,
      company: p.company_name || p.employer || null,
      title: p.job_title || p.title || null,
      linkedin_url: p.linkedin_url || p.profile_url || null,
      page_url: p.page_url || p.current_url || null,
      raw_payload: p
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/snitcher-webhook", async (req, res) => {
  try {
    const v = req.body?.visitor || req.body;
    const c = v?.company || v;
    const s = v?.session || {};
    const { error } = await supabase.from("leads").insert({
      source: "snitcher",
      company: c?.name || null, domain: c?.domain || null,
      industry: c?.industry || null, employees: c?.employees || null,
      country: c?.country || null, pages_viewed: s?.pages_viewed || null,
      duration_seconds: s?.duration || null, traffic_source: s?.source || null,
      landing_page: s?.landing_page || null, raw_payload: req.body
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const { source, limit = 100, offset = 0 } = req.query;
    let q = supabase.from("leads").select("*").order("created_at", { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (source && source !== "all") q = q.eq("source", source);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ leads: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log("Fortitude Leads backend on port " + PORT));