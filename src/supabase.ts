import { createClient } from "@supabase/supabase-js";

// Use build-time env vars when present (e.g. GitHub Actions secrets / local .env),
// otherwise fall back to the project's public anon credentials. Anon keys are
// public by design (they ship inside every client build and are protected by
// Row Level Security), so embedding them here guarantees the app always has a
// backend and never boots to a blank screen.
const FALLBACK_SUPABASE_URL = "https://rfaikvgsulpbpsyfccku.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmYWlrdmdzdWxwYnBzeWZjY2t1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzIyMzgsImV4cCI6MjA5MDA0ODIzOH0.j1a0wbljVvILvuD3DVWom_0cRJS0mrlKpbc95TkFm5U";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
