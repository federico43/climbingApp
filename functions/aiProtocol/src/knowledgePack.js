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

1. project_bouldering — Work hard boulders of one grade against the clock, resting between tries; the app counts attempts and why they fell.
   Fields: blockName, description, adaptation, grade (a boulder grade; omit to let the athlete pick), timeLimit (minutes, 5–90, typical 15–30), restTime (seconds between attempts, 60–300, typical 120–180).

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
- Produce one or more GROUPS in "groups". A group is a set of athletes who receive the SAME protocol, together with that protocol (a name + the full ordered list of blocks — never a diff).
- Put athletes who share the same plan in ONE group (list all their ids together). Put athletes whose plans differ in SEPARATE groups. ALWAYS use groups when athletes are named — even if everyone gets the identical workout (then it's a single group containing all of them).
- Apply any per-athlete differences the coach describes ("Mia goes easier" → her own group; "Charlie and John warm up on blue" → if that's their only difference from others, they form a group).
- Set athleteIds to matching ids from the ROSTER. If a named person is NOT in the roster, do NOT invent an id — add that raw name to "unresolved".
- Leave "unassigned" empty.

CASE B — the coach does NOT name any athlete:
- Produce a single protocol in "unassigned" (a name + blocks). Leave "athletes" empty.

If a BASE is provided, use it as the starting point (per athlete in case A, or directly in case B) and apply only the requested changes.

${BLOCK_GUIDE}

Reusing saved blocks:
- The user message may include a LIBRARY of the coach's saved blocks (id, type, name, description). If a saved block fits what you need, PREFER reusing it: emit a block whose "libraryId" is that saved block's id and whose "type" matches it. The saved block's description and content are kept automatically, so you may omit those — but you SHOULD set numeric fields (targetAttempts, restTime, level, timeLimit) when the coach asks for a different amount, to OVERRIDE the saved block's value (e.g. "use my silent-feet warmup but 3 attempts"). You may reuse saved blocks of ANY type — including strength_conditioning blocks, which you cannot otherwise create.
- Only create a brand-new block (one of the five types above, no libraryId) when nothing in the LIBRARY fits.
- Never invent a libraryId — only use ids that appear in the LIBRARY.

Give every protocol a short, descriptive name.`

// ─── Tool definition ────────────────────────────────────────────────────────────

const BLOCK_ITEM_SCHEMA = {
  type: "object",
  properties: {
    libraryId: { type: "string", description: "If reusing a saved LIBRARY block, its id. When set, the other fields are optional." },
    type: { type: "string", description: "Block type. Use one of the five generatable types, or — when reusing via libraryId — the saved block's type." },
    blockName: { type: "string", description: "Short block title." },
    description: { type: "string", description: "Coaching instructions for the athlete." },
    adaptation: { type: "string", enum: ADAPTATIONS, description: "Target training adaptation." },
    targetAttempts: { type: "integer", description: "Attempts. For constraint_warmup and sequence." },
    restTime: { type: "integer", description: "Rest between attempts (seconds). For project_bouldering and sequence." },
    level: { type: "string", enum: GRADES, description: "Boulder grade. Only for constraint_warmup." },
    grade: { type: "string", enum: GRADES, description: "Boulder grade worked. Only for project_bouldering (omit to let the athlete pick)." },
    timeLimit: { type: "integer", description: "Time cap in minutes. For project_bouldering (5–90, required) and exploration_session (0 = no timer)." },
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
      groups: {
        type: "array",
        description: "One entry per GROUP of athletes who receive the same protocol.",
        items: {
          type: "object",
          properties: {
            athleteIds: {
              type: "array",
              description: "Matching ids from the ROSTER for every athlete in this group.",
              items: { type: "string" },
            },
            athleteNames: {
              type: "array",
              description: "The matched roster names for this group.",
              items: { type: "string" },
            },
            protocolName: { type: "string", description: "Short protocol name for this group." },
            blocks: { type: "array", description: "The group's ordered blocks.", items: BLOCK_ITEM_SCHEMA },
          },
          required: ["athleteIds", "protocolName", "blocks"],
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
