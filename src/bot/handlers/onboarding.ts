import type { Api } from "grammy";
import { runClaude } from "../../claude/runner";
import { savePersona, DEFAULT_PERSONA, type Persona } from "../../persona";

interface OnboardingAnswers {
  language: string;
  name: string;
  personality: string;
  extra?: string;
}

type OnboardingStep = "language" | "name" | "personality" | "extra" | "generating" | "done";

interface OnboardingState {
  step: OnboardingStep;
  answers: Partial<OnboardingAnswers>;
}

const QUESTIONS: Record<string, string> = {
  language: "Hi! Let's set me up. What language should I speak?\n\n(e.g. English, Russian, Spanish — or just type your preference)",
  name: "What should my name be? (default: Kuzma)",
  personality: "Describe my personality in a few words.\n\n(e.g. \"casual and witty\", \"formal and precise\", \"friendly with dry humor\")",
  extra: "Anything else I should know about how to behave?\n\n(or type \"skip\" to finish)",
};

export function buildPersonaPrompt(answers: { language: string; name: string; personality: string; extra?: string }): string {
  let prompt = `Generate a persona config for a Telegram AI assistant bot.

Bot name: ${answers.name}
Language: ${answers.language}
Personality: ${answers.personality}`;

  if (answers.extra && answers.extra.toLowerCase() !== "skip") {
    prompt += `\nAdditional instructions: ${answers.extra}`;
  }

  prompt += `

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "name": "${answers.name}",
  "language": "${answers.language}",
  "systemPrompt": "A 2-3 sentence system prompt describing the bot's personality and behavior style",
  "replies": {
    "startup": "A greeting message when the bot starts (sent to the owner)",
    "shutdown": "A goodbye message when the bot shuts down",
    "error": "A message when something goes wrong",
    "newSession": "A message when the user starts a fresh conversation",
    "stopped": "A message when the user stops an active Claude run",
    "alreadyStopped": "A message when the user tries to stop but nothing is running",
    "voiceError": "A message when voice transcription fails",
    "photoError": "A message when photo processing fails",
    "documentError": "A message when document processing fails"
  }
}

All replies must match the personality described above and be in ${answers.language}. Keep replies short (1-2 sentences max). Make them feel natural, not robotic.`;

  return prompt;
}

export function createOnboarding(
  api: Api,
  chatId: number,
  personaPath: string,
  workspacePath: string,
  onComplete: (persona: Persona) => void,
) {
  const state: OnboardingState = { step: "language", answers: {} };

  async function sendQuestion(step: OnboardingStep): Promise<void> {
    const question = QUESTIONS[step];
    if (question) await api.sendMessage(chatId, question);
  }

  async function handleMessage(text: string): Promise<boolean> {
    if (state.step === "done") return false;

    switch (state.step) {
      case "language":
        state.answers.language = text;
        state.step = "name";
        await sendQuestion("name");
        return true;

      case "name":
        state.answers.name = text || "Kuzma";
        state.step = "personality";
        await sendQuestion("personality");
        return true;

      case "personality":
        state.answers.personality = text;
        state.step = "extra";
        await sendQuestion("extra");
        return true;

      case "extra":
        if (text.toLowerCase() !== "skip") state.answers.extra = text;
        state.step = "generating";
        await generate();
        return true;

      default:
        return true; // absorb messages during generation
    }
  }

  async function generate(): Promise<void> {
    await api.sendMessage(chatId, "Got it! Generating personality...");

    const prompt = buildPersonaPrompt(state.answers as OnboardingAnswers);
    let jsonText = "";

    try {
      for await (const event of runClaude({
        prompt,
        workspacePath,
      })) {
        if (event.type === "text") jsonText += event.content;
      }

      // Clean up potential markdown fences
      jsonText = jsonText.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();

      const generated = JSON.parse(jsonText);
      const persona: Persona = {
        ...DEFAULT_PERSONA,
        ...generated,
        replies: { ...DEFAULT_PERSONA.replies, ...generated.replies },
      };

      savePersona(personaPath, persona);
      state.step = "done";

      await api.sendMessage(chatId, persona.replies.startup);
      onComplete(persona);
    } catch (err) {
      console.error("Persona generation failed:", err);
      console.error("Raw output:", jsonText);

      // Fallback: save defaults with user's answers
      const fallback: Persona = {
        ...DEFAULT_PERSONA,
        name: state.answers.name || "Kuzma",
        language: state.answers.language || "en",
      };
      savePersona(personaPath, fallback);
      state.step = "done";

      await api.sendMessage(chatId, `Hmm, generation hiccuped. I've set up defaults — you can re-run onboarding later by deleting data/persona.json.\n\n${fallback.replies.startup}`);
      onComplete(fallback);
    }
  }

  // Start the flow
  sendQuestion("language");

  return { handleMessage, isComplete: () => state.step === "done" };
}
