import { z } from "zod";

const OutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        roomTypeId: z.string().uuid(),
        stayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        suggestedRate: z.number().finite().positive(),
        demandLevel: z.enum(["low", "medium", "high"]),
        rationale: z.string().min(5).max(280),
      }),
    )
    .min(1)
    .max(200),
});

function rulesFallback(roomTypes, demandRows) {
  const roomMap = new Map(roomTypes.map((r) => [r.id, r]));
  return demandRows.map((d) => {
    const room = roomMap.get(d.room_type_id);
    const occupancy = d.rooms_available
      ? Number(d.rooms_booked) / Number(d.rooms_available)
      : 1;
    const pickup = Number(d.pickup_7d);
    const event = Number(d.local_event_score);
    const adjustment = Math.max(
      -0.12,
      Math.min(0.3, (occupancy - 0.45) * 0.45 + pickup * 0.012 + event * 0.12),
    );
    const suggestedRate =
      Math.round(
        Math.max(
          Number(room.min_rate),
          Math.min(
            Number(room.max_rate),
            Number(room.base_rate) * (1 + adjustment),
          ),
        ) / 50,
      ) * 50;
    return {
      roomTypeId: room.id,
      stayDate: d.stay_date.toISOString
        ? d.stay_date.toISOString().slice(0, 10)
        : String(d.stay_date).slice(0, 10),
      suggestedRate,
      demandLevel:
        occupancy >= 0.75 || event >= 0.7
          ? "high"
          : occupancy >= 0.45
            ? "medium"
            : "low",
      rationale: `Rule-based estimate: ${Math.round(occupancy * 100)}% booked, ${pickup} rooms of 7-day pickup, event score ${event.toFixed(2)}. Review against local market conditions.`,
    };
  });
}

export async function generateSuggestions(roomTypes, demandRows) {
  const fallback = () => ({
    provider: "rules_fallback",
    suggestions: rulesFallback(roomTypes, demandRows),
  });
  const baseUrl = process.env.OLLAMA_BASE_URL;
  if (!baseUrl || !demandRows.length) return fallback();

  // Only aggregate commercial signals leave this service. No guest/student identifiers or PII exist in this payload.
  const safePayload = {
    roomTypes: roomTypes.map((r) => ({
      id: r.id,
      name: r.name,
      baseRate: Number(r.base_rate),
      minRate: Number(r.min_rate),
      maxRate: Number(r.max_rate),
    })),
    demand: demandRows.map((d) => ({
      roomTypeId: d.room_type_id,
      stayDate: d.stay_date.toISOString
        ? d.stay_date.toISOString().slice(0, 10)
        : String(d.stay_date).slice(0, 10),
      available: Number(d.rooms_available),
      booked: Number(d.rooms_booked),
      pickup7d: Number(d.pickup_7d),
      eventScore: Number(d.local_event_score),
    })),
  };
  const prompt = `You are a cautious hotel revenue analyst. Return ONLY JSON: {"suggestions":[{"roomTypeId":"UUID","stayDate":"YYYY-MM-DD","suggestedRate":number,"demandLevel":"low|medium|high","rationale":"short explanation"}]}. Use only supplied room IDs and dates. Suggested rates must stay within each room type minRate/maxRate. Consider occupancy, 7-day pickup and event score. Do not invent external facts. Payload: ${JSON.stringify(safePayload)}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.AI_TIMEOUT_MS || 8000),
  );
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 2500 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ollama_http_${response.status}`);
    const body = await response.json();
    const parsed = OutputSchema.parse(JSON.parse(body.response));
    const allowedRooms = new Map(roomTypes.map((r) => [r.id, r]));
    const allowedDates = new Set(
      demandRows.map((d) =>
        d.stay_date.toISOString
          ? d.stay_date.toISOString().slice(0, 10)
          : String(d.stay_date).slice(0, 10),
      ),
    );
    const seen = new Set();
    const validated = parsed.suggestions.filter((s) => {
      const room = allowedRooms.get(s.roomTypeId);
      const key = `${s.roomTypeId}:${s.stayDate}`;
      if (!room || !allowedDates.has(s.stayDate) || seen.has(key)) return false;
      seen.add(key);
      s.suggestedRate =
        Math.round(
          Math.max(
            Number(room.min_rate),
            Math.min(Number(room.max_rate), s.suggestedRate),
          ) / 50,
        ) * 50;
      s.rationale = s.rationale.replace(
        /https?:\/\/\S+/g,
        "[external link removed]",
      );
      return true;
    });
    if (!validated.length) throw new Error("empty_validated_result");
    return { provider: "ollama_local", suggestions: validated };
  } catch (err) {
    console.warn(
      "AI provider unavailable or invalid; using rules fallback:",
      err.name === "AbortError" ? "timeout" : err.message,
    );
    return fallback();
  } finally {
    clearTimeout(timeout);
  }
}
