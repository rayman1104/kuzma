export interface Persona {
  name: string;
  language: string;
  systemPrompt: string;
  replies: {
    startup: string;
    shutdown: string;
    error: string;
    newSession: string;
    stopped: string;
    alreadyStopped: string;
    voiceError: string;
    photoError: string;
    documentError: string;
  };
}

export const DEFAULT_PERSONA: Persona = {
  name: "Kuzma",
  language: "en",
  systemPrompt: "",
  replies: {
    startup: "Hey. I'm up and running.",
    shutdown: "Signing off. Ping me when you need me.",
    error: "Something broke. Try again?",
    newSession: "Clean slate. What's up?",
    stopped: "Stopped.",
    alreadyStopped: "I'm not doing anything right now.",
    voiceError: "Couldn't make that out. Try again?",
    photoError: "Couldn't process that image. Send it again?",
    documentError: "Couldn't open that file. Try again?",
  },
};

export function loadPersona(path: string): Persona | null {
  try {
    const text = require("fs").readFileSync(path, "utf-8");
    const data = JSON.parse(text);
    return { ...DEFAULT_PERSONA, ...data, replies: { ...DEFAULT_PERSONA.replies, ...data.replies } };
  } catch {
    return null;
  }
}

export function savePersona(path: string, persona: Persona): void {
  require("fs").writeFileSync(path, JSON.stringify(persona, null, 2));
}
