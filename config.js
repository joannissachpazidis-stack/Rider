// Optional: Supabase-Zugang fest eintragen, dann ist die Cloud auf jedem Gerät
// automatisch eingerichtet (man muss sich nur noch anmelden).
// Der "anon"-Schlüssel ist öffentlich gedacht – geschützt wird über Login + Row Level Security.
window.CLOUD_CONFIG = {
  url: '', // z. B. 'https://abcdefgh.supabase.co'
  key: '', // "anon public" / "publishable" Key aus Supabase → Project Settings → API
};
