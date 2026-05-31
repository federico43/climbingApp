// Static "knowledge pack" the model needs to emit valid protocols.
//
// This is the cacheable prefix — keep it byte-stable across requests for prompt
// caching to hit. Volatile, per-request content (the coach's description, the
// athlete roster, any base protocol) goes in the user message instead.
//
// Two modes share the same block vocabulary:
//   - "generate": one prompt → one protocol               (PROTOCOL_TOOL)
//   - "assign":   one prompt + roster → one protocol PER athlete (ASSIGN_TOOL)
//
// Phase 1 covers five block types the model can fully specify from text.
// `strength_conditioning` (needs the exercise library) is excluded for now.
// `sequence` is allowed but the model never picks a route — the coach attaches
// it in the app.

export const BLOCK_TYPES = [
  "project_bouldering",
  "constraint_warmup",
  "exploration_session",
  "free_session",
  "sequence",
]

// Must mirror utils/adaptations.ts in the app.
export const ADAPTATIONS = [
  "technique", "strength", "power", "power_endurance",
  "endurance", "conditioning", "mobility", "general", "test",
]

// Boulder grades, easiest → hardest. Must mirror BoulderLevelOptions in the app.
export const GRADES = ["orange", "blue", "green", "yellow", "red", "black"]

// ─── Shared block vocabulary (used by both system prompts) ──────────────────────

const BLOCK_GUIDE = `Only use these five block types:

1. project_bouldering — Work a hard boulder ("project") over several attempts with rest between tries.
   Fields: blockName, description, adaptation, targetAttempts (1–20, typical 4–10), restTime (seconds between attempts, 60–300, typical 120–180).

2. constraint_warmup — Easy climbing with a movement constraint (e.g. silent feet, straight arms) to warm up and reinforce technique.
   Fields: blockName, description, adaptation, level (a boulder grade), targetAttempts (1–10, typical 1–3).

3. exploration_session — Open, free climbing exploration with an optional time cap.
   Fields: blockName, description, adaptation, timeLimit (minutes; use 0 for no timer).

4. free_session — Unstructured session; just a description of what to do.
   Fields: blockName, description, adaptation.

5. sequence — Repeated attempts on a specific set of moves on the spray wall (a "route"), with rest between tries. Used for power and power-endurance work.
   Fields: blockName, description, adaptation, targetAttempts (1–20, typical 4–8), restTime (seconds, 60–300, typical 120–180).
   IMPORTANT: you cannot choose the actual route — the coach attaches it in the app afterward. In the description, briefly describe the intended route (e.g. "a powerful ~6-move overhang sequence"). Do NOT output any route id or holds.

Rules:
- adaptation MUST be one of: ${ADAPTATIONS.join(", ")}. Pick the one that best matches the block's intent.
- level (constraint_warmup only) MUST be one of these grades (easiest→hardest): ${GRADES.join(", ")}.
- blockName: a short, human title (2–4 words).
- description: 1–3 sentences of clear coaching instructions.
- Only include the numeric/level fields that belong to the block's type; omit fields that don't apply.
- Order blocks the way the session should run: warm-ups first, hardest work in the middle, lighter work last.
- Interpret duration/intensity sensibly: more time → more blocks or higher attempt counts; "easy day" → fewer attempts, easier grades.
- If asked for something these block types can't represent (e.g. a strength circuit with named exercises), approximate with the closest block and note the substitution in its description.`

// ─── System prompt (single, unified) ────────────────────────────────────────────

export const UNIFIED_PACK = `You are an assistant that turns a climbing coach's plain-language instruction into structured training protocols for a bouldering app. You MUST call the \`propose_plan\` tool exactly once. Do not write prose outside the tool call.

The user message includes:
- ROSTER: the available athletes as id + name.
- BASE (optional): an existing protocol to start from.

Decide which case you're in:

CASE A — the coach NAMES one or more athletes (people matching the ROSTER):
- Produce one COMPLETE protocol per named athlete in "athletes" (a name + the full ordered list of blocks — never a diff). Apply any per-athlete differences the coach describes ("Mia goes easier", "Charlie and John warm up on blue"). Athletes sharing the same plan still each get their own full copy.
- Set each athleteId to the matching id from the ROSTER. If a named person is NOT in the roster, do NOT invent an id — add that raw name to "unresolved" and skip them.
- Leave "unassigned" empty.

CASE B — the coach does NOT name any athlete:
- Produce a single protocol in "unassigned" (a name + blocks). Leave "athletes" empty.

If a BASE is provided, use it as the starting point (per athlete in case A, or directly in case B) and apply only the requested changes.

${BLOCK_GUIDE}

Give every protocol a short, descriptive name.`

// ─── Tool definition ────────────────────────────────────────────────────────────

const BLOCK_ITEM_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: BLOCK_TYPES, description: "Block type." },
    blockName: { type: "string", description: "Short block title." },
    description: { type: "string", description: "Coaching instructions for the athlete." },
    adaptation: { type: "string", enum: ADAPTATIONS, description: "Target training adaptation." },
    targetAttempts: { type: "integer", description: "Attempts. For project_bouldering, constraint_warmup, and sequence." },
    restTime: { type: "integer", description: "Rest between attempts (seconds). For project_bouldering and sequence." },
    level: { type: "string", enum: GRADES, description: "Boulder grade. Only for constraint_warmup." },
    timeLimit: { type: "integer", description: "Time cap in minutes (0 = no timer). Only for exploration_session." },
  },
  required: ["type", "blockName", "description", "adaptation"],
}

export const PLAN_TOOL = {
  name: "propose_plan",
  description:
    "Return either a single protocol (no athletes named) OR one protocol per named athlete.",
  input_schema: {
    type: "object",
    properties: {
      unassigned: {
        type: "object",
        description: "A single protocol. Use ONLY when the coach named no athletes.",
        properties: {
          name: { type: "string", description: "Short, descriptive protocol name." },
          blocks: { type: "array", description: "Ordered list of training blocks.", items: BLOCK_ITEM_SCHEMA },
        },
        required: ["name", "blocks"],
      },
      athletes: {
        type: "array",
        description: "One entry per athlete the coach named (and matched to the roster).",
        items: {
          type: "object",
          properties: {
            athleteId: { type: "string", description: "Matching athlete id from the ROSTER." },
            athleteName: { type: "string", description: "The matched roster name." },
            protocolName: { type: "string", description: "Short protocol name for this athlete." },
            blocks: { type: "array", description: "This athlete's ordered blocks.", items: BLOCK_ITEM_SCHEMA },
          },
          required: ["athleteId", "athleteName", "protocolName", "blocks"],
        },
      },
      unresolved: {
        type: "array",
        description: "Names the coach mentioned that don't match any roster athlete.",
        items: { type: "string" },
      },
    },
    required: [],
  },
}
