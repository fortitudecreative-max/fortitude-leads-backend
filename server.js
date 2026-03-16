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
    console.log("[RB2B] Received payload:", JSON.stringify(p).substring(0, 500));
    // RB2B sends fields with capitalized names and spaces
    const name = ((p["First Name"] || "") + " " + (p["Last Name"] || "")).trim() || null;
    const company = p["Company Name"] || null;
    const title = p["Title"] || null;
    const linkedin_url = p["LinkedIn URL"] || null;
    const page_url = p["Page URL"] || p["Current Page URL"] || null;
    const email = p["Business Email"] || p["Email"] || null;

    const { error } = await supabase.from("leads").insert({ source: "rb2b", name, company, title, linkedin_url, page_url, email, raw_payload: p });
    if (error) throw error;

    await sendTelegram("RB2B - New Visitor\n" + (name || "Unknown") + (company ? "\n" + company : "") + (title ? "\n" + title : "") + (email ? "\n" + email : "") + (linkedin_url ? "\n" + linkedin_url : "") + (page_url ? "\nPage: " + page_url : ""));
    res.json({ success: true });
  } catch (e) {
    console.error("RB2B error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/snitcher-webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("[Snitcher] Received payload:", JSON.stringify(body).substring(0, 500));
    // Snitcher sends { event, subjects: [...] } — process each subject
    const subjects = body?.subjects || (body?.company ? [body] : [body]);
    const results = [];
    for (const s of subjects) {
      const c = s?.company || {};
      const name = ((s?.first_name || "") + " " + (s?.last_name || "")).trim() || null;
      const company = c?.name || s?.name || null;
      const domain = c?.domain || s?.domain || null;
      const industry = c?.industry || null;
      const employees = c?.employee_range || c?.employees || null;
      const country = c?.location || s?.location || null;
      const linkedin_url = s?.linkedin_url || c?.profiles?.linkedin?.url || null;
      const email = s?.email || null;
      const title = s?.title || null;
      const landing_page = s?.session?.landing_page || s?.landing_page || null;
      const pages_viewed = s?.session?.pages_viewed || s?.pages_viewed || null;
      const traffic_source = s?.session?.source || s?.traffic_source || null;

      const { error } = await supabase.from("leads").insert({
        source: "snitcher", name, company, domain, title, linkedin_url, email,
        industry, employees, country, pages_viewed,
        landing_page, traffic_source, raw_payload: s
      });
      if (error) throw error;

      await sendTelegram("Snitcher - " + (name ? "Contact: " + name : "Company: " + (company || "Unknown")) + (company && name ? "\n" + company : "") + (domain ? " (" + domain + ")" : "") + (title ? "\n" + title : "") + (email ? "\n" + email : "") + (industry ? "\n" + industry : "") + (employees ? " - " + employees : "") + (country ? "\n" + country : "") + (landing_page ? "\nPage: " + landing_page : ""));
      results.push({ success: true });
    }
    res.json({ success: true, processed: results.length });
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
