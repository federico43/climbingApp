// Static "knowledge pack" the model needs to emit a valid protocol.
//
// This is the cacheable prefix — it must stay byte-stable across requests for
// prompt caching to hit. Keep volatile, per-request content (the coach's
// description) OUT of this file; it goes in the user message instead.
//
// Phase 1 covers four block types that the model can fully specify from a text
// description. `sequence` (needs a real spray-wall route) and
// `strength_conditioning` (needs the exercise library) are intentionally
// excluded — those come in a later phase.

export const BLOCK_TYPES = [
  "project_bouldering",
  "constraint_warmup",
  "exploration_session",
  "free_session",
]

// Must mirror utils/adaptations.ts in the app.
export const ADAPTATIONS = [
  "technique",
  "strength",
  "power",
  "power_endurance",
  "endurance",
  "conditioning",
  "mobility",
  "general",
  "test",
]

// Boulder grades, easiest → hardest. Must mirror BoulderLevelOptions in the app.
export const GRADES = ["orange", "blue", "green", "yellow", "red", "black"]

// ─── System prompt (the knowledge pack) ────────────────────────────────────────

export const KNOWLEDGE_PACK = `You are an assistant that turns a climbing coach's plain-language session description into a structured training protocol for a bouldering app.

A protocol is an ordered list of "blocks". You MUST call the \`propose_protocol\` tool exactly once with the full protocol. Do not write any prose outside the tool call.

Only use these four block types:

1. project_bouldering — Work a hard boulder ("project") over several attempts with rest between tries.
   Fields: blockName, description, adaptation, targetAttempts (1–20, typical 4–10), restTime (seconds between attempts, 60–300, typical 120–180).

2. constraint_warmup — Easy climbing with a movement constraint (e.g. silent feet, straight arms) to warm up and reinforce technique.
   Fields: blockName, description, adaptation, level (a boulder grade), targetAttempts (1–10, typical 1–3).

3. exploration_session — Open, free climbing exploration with an optional time cap.
   Fields: blockName, description, adaptation, timeLimit (minutes; use 0 for no timer).

4. free_session — Unstructured session; just a description of what to do.
   Fields: blockName, description, adaptation.

Rules:
- adaptation MUST be one of: ${ADAPTATIONS.join(", ")}. Pick the one that best matches the block's training intent.
- level (constraint_warmup only) MUST be one of these grades (easiest→hardest): ${GRADES.join(", ")}.
- blockName: a short, human title (2–4 words), e.g. "Silent-feet warmup", "Project session".
- description: 1–3 sentences of clear coaching instructions for the athlete.
- Only include the numeric/level fields that belong to the block's type. Omit fields that don't apply.
- Order blocks the way the session should run: warm-ups first, hardest work in the middle, lighter work last.
- Interpret session duration and intensity sensibly: more time → more blocks or higher attempt counts; "easy day" → fewer attempts, easier grades.
- If the request asks for something these four block types cannot represent (e.g. a spray-wall sequence, a strength circuit with specific exercises), approximate it with the closest available block and note the substitution in that block's description.
- Give the protocol a short, descriptive name.`

// ─── Tool definition ────────────────────────────────────────────────────────────

export const PROTOCOL_TOOL = {
  name: "propose_protocol",
  description:
    "Return the structured training protocol assembled from the coach's description.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short, descriptive protocol name.",
      },
      blocks: {
        type: "array",
        description: "Ordered list of training blocks.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: BLOCK_TYPES,
              description: "Block type.",
            },
            blockName: { type: "string", description: "Short block title." },
            description: {
              type: "string",
              description: "Coaching instructions for the athlete.",
            },
            adaptation: {
              type: "string",
              enum: ADAPTATIONS,
              description: "Target training adaptation.",
            },
            targetAttempts: {
              type: "integer",
              description:
                "Number of attempts. Only for project_bouldering and constraint_warmup.",
            },
            restTime: {
              type: "integer",
              description:
                "Rest between attempts in seconds. Only for project_bouldering.",
            },
            level: {
              type: "string",
              enum: GRADES,
              description: "Boulder grade. Only for constraint_warmup.",
            },
            timeLimit: {
              type: "integer",
              description:
                "Time cap in minutes (0 = no timer). Only for exploration_session.",
            },
          },
          required: ["type", "blockName", "description", "adaptation"],
        },
      },
    },
    required: ["name", "blocks"],
  },
}
