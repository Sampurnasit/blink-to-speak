// Speech synthesis helpers (Web Speech API)

let voices: SpeechSynthesisVoice[] = [];

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const load = () => {
    voices = window.speechSynthesis.getVoices();
  };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

export function speak(text: string, opts: { rate?: number; volume?: number; lang?: string } = {}) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = opts.rate ?? 1;
    utter.volume = opts.volume ?? 1;
    utter.lang = opts.lang ?? "en-US";
    const preferred = voices.find((v) => v.lang === utter.lang) ?? voices[0];
    if (preferred) utter.voice = preferred;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.error("Speech failed", e);
  }
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function splitTextForSpeech(text: string, maxLength = 1200) {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxLength) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      current = `${word} `;
    } else {
      current += `${word} `;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function speakLongText(text: string, opts: { rate?: number; volume?: number; lang?: string } = {}) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  stopSpeaking();

  const chunks = splitTextForSpeech(text, 1200);
  let index = 0;

  const speakNext = () => {
    if (index >= chunks.length) return;
    const utter = new SpeechSynthesisUtterance(chunks[index]);
    utter.rate = opts.rate ?? 1;
    utter.volume = opts.volume ?? 1;
    utter.lang = opts.lang ?? "en-US";
    const preferred = voices.find((v) => v.lang === utter.lang) ?? voices[0];
    if (preferred) utter.voice = preferred;
    utter.onend = () => {
      index += 1;
      speakNext();
    };
    window.speechSynthesis.speak(utter);
  };

  speakNext();
}
