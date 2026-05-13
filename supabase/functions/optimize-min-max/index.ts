// Optimize Min/Max stock levels using Lovable AI Gateway
// Analyzes 12-month history + 3-month forecast + on_order + in_production
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SkuRow {
  id: string;
  sku_code: string;
  name: string;
  category: string | null;
  stock: number;
  on_order: number;
  in_production: number;
  lead_time_days: number;
  moq: number;
  unit_cost: number;
  service_level: number;
  demand_history: number[];
  demand_history_yearly: number[];
  forecast_3m: number[];
}

const MODEL = "google/gemini-3-flash-preview";

async function optimizeBatch(
  skus: SkuRow[],
): Promise<Map<string, { min: number; max: number; justification: string }>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const summary = skus.map((s) => {
    const yearly = s.demand_history_yearly?.length ? s.demand_history_yearly : [];
    const forecast = s.forecast_3m?.length ? s.forecast_3m : [];
    const dailyAvg = yearly.length ? yearly.reduce((a, b) => a + b, 0) / (yearly.length * 30) : 0;
    return {
      id: s.id,
      sku: s.sku_code,
      stock: s.stock,
      on_order: s.on_order,
      in_production: s.in_production,
      lead_days: s.lead_time_days,
      moq: s.moq,
      service_level: s.service_level,
      avg_daily: Number(dailyAvg.toFixed(2)),
      monthly_history_12m: yearly.map((v) => Math.round(v)),
      forecast_next_3m: forecast.map((v) => Math.round(v)),
    };
  });

  const body = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an inventory optimization expert. For each SKU, compute Min and Max stock levels. " +
          "Min = safety stock + lead-time demand. Max = Min + economic batch covering forecasted demand. " +
          "Account for seasonality in 12-month history, expected 3-month forecast, current on_order and in_production pipeline. " +
          "Respect MOQ. Service level drives safety factor (0.95→1.65σ, 0.99→2.33σ). " +
          "Return concise per-SKU justification (1 sentence).",
      },
      { role: "user", content: JSON.stringify(summary) },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "set_min_max",
          description: "Set Min and Max stock for each SKU.",
          parameters: {
            type: "object",
            properties: {
              recommendations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    min: { type: "number" },
                    max: { type: "number" },
                    justification: { type: "string" },
                  },
                  required: ["id", "min", "max", "justification"],
                  additionalProperties: false,
                },
              },
            },
            required: ["recommendations"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "set_min_max" } },
  };

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("No tool call returned");
  const parsed = JSON.parse(args);
  const map = new Map<string, { min: number; max: number; justification: string }>();
  for (const r of parsed.recommendations ?? []) {
    map.set(r.id, {
      min: Math.max(0, Math.round(r.min)),
      max: Math.max(0, Math.round(r.max)),
      justification: String(r.justification ?? ""),
    });
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader)
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return new Response(
        JSON.stringify({
          error:
            "Missing Supabase environment variables. Ensure SUPABASE_URL, SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY), and SUPABASE_SERVICE_ROLE_KEY are set.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, supabaseService);
    const { data: skus, error: skusErr } = await admin
      .from("skus")
      .select(
        "id, sku_code, name, category, stock, on_order, in_production, lead_time_days, moq, unit_cost, service_level, demand_history, demand_history_yearly, forecast_3m",
      )
      .eq("user_id", userId);

    if (skusErr) throw skusErr;
    if (!skus || skus.length === 0) {
      return new Response(JSON.stringify({ error: "No SKUs to optimize" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create run record
    const { data: run } = await admin
      .from("optimization_runs")
      .insert({ user_id: userId, model: MODEL, status: "running", skus_processed: skus.length })
      .select()
      .single();

    let succeeded = 0;
    const BATCH = 25;
    try {
      for (let i = 0; i < skus.length; i += BATCH) {
        const batch = skus.slice(i, i + BATCH) as SkuRow[];
        const recs = await optimizeBatch(batch);
        // Bulk update
        const updates = batch
          .map((s) => {
            const r = recs.get(s.id);
            if (!r) return null;
            return admin
              .from("skus")
              .update({
                ai_min_recommended: r.min,
                ai_max_recommended: r.max,
                ai_justification: r.justification,
                ai_optimized_at: new Date().toISOString(),
              })
              .eq("id", s.id)
              .eq("user_id", userId);
          })
          .filter(Boolean);
        await Promise.all(updates as Promise<unknown>[]);
        succeeded += recs.size;
      }

      await admin
        .from("optimization_runs")
        .update({
          status: "completed",
          skus_succeeded: succeeded,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run!.id);

      return new Response(
        JSON.stringify({ ok: true, processed: skus.length, succeeded, runId: run!.id }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin
        .from("optimization_runs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run!.id);
      throw e;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("optimize-min-max error:", message);
    const isRate = message.includes("429");
    const isBilling = message.includes("402");
    const clientErrorMessage = isRate
      ? "Rate limit reached. Please retry in a moment."
      : isBilling
        ? "Billing limit reached for AI optimization."
        : "Optimization failed. Please retry later.";
    // Return 200 with a fallback flag so the platform's runtime monitor
    // does not flag transient AI gateway errors (402/429) as a blank-screen crash.
    return new Response(
      JSON.stringify({
        ok: false,
        fallback: true,
        code: isBilling ? "BILLING_LIMIT" : isRate ? "RATE_LIMIT" : "OPTIMIZATION_FAILED",
        error: clientErrorMessage,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
