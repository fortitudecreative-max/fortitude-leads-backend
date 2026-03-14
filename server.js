const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// Config - values loaded from Railway env vars
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SECRET_KEY env vars required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

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

async function sendTelegram(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage", {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg
    });
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

app.get("/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

app.post("/api/rb2b-webhook", async (req, res) => {
  try {
    const p = req.body;
    const name = ((p.first_name || "") + " " + (p.last_name || "")).trim() || null;
    const company = p.company_name || p.employer || null;
    const title = p.job_title || p.title || null;
    const linkedin_url = p.linkedin_url || p.profile_url || null;
    const page_url = p.page_url || p.current_url || null;

    const { error } = await supabase.from("leads").insert({ source: "rb2b", name, company, title, linkedin_url, page_url, raw_payload: p });
    if (error) throw error;

    await sendTelegram("RB2B - New Visitor\n" + (name || "Unknown") + "\n" + (company || "") + (title ? "\n" + title : "") + (linkedin_url ? "\n" + linkedin_url : "") + (page_url ? "\n" + page_url : ""));
    res.json({ success: true });
  } catch (e) {
    console.error("RB2B error:", e.message);
    res.status(500).json({ error: e.message });
  }
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

    await sendTelegram("Snitcher - New Company\n" + (c?.name || "Unknown") + (c?.domain ? " (" + c.domain + ")" : "") + (c?.industry ? "\n" + c.industry : "") + (c?.employees ? " - " + c.employees : "") + (c?.country ? "\n" + c.country : "") + (s?.pages_viewed ? "\n" + s.pages_viewed + " pages" : "") + (s?.duration ? " - " + Math.round(s.duration / 60) + " min" : "") + (s?.source ? " via " + s.source : "") + (s?.landing_page ? "\n" + s.landing_page : ""));
    res.json({ success: true });
  } catch (e) {
    console.error("Snitcher error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const { source, limit = 100, offset = 0 } = req.query;
    let q = supabase.from("leads").select("*").order("created_at", { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (source && source !== "all") q = q.eq("source", source);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ leads: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("Fortitude Leads backend on port " + PORT));
