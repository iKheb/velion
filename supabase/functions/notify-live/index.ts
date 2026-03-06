// Supabase Edge Function (starter)
// deno run --allow-net --allow-env index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json().catch(() => ({}));
  return new Response(JSON.stringify({ ok: true, received: body }), {
    headers: { "Content-Type": "application/json" },
  });
});

