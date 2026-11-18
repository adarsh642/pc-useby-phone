export type KeyboardMessage =
  | { type: "text"; text: string }
  | { type: "key"; key: "Enter" | "Escape" | "Tab" | "Backspace" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"; modifiers?: ("Ctrl" | "Alt" | "Shift")[] };

const allowedKeys = new Set(["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const allowedModifiers = new Set(["Ctrl", "Alt", "Shift"]);

export function validateKeyboardMessage(message: unknown): message is KeyboardMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  if (candidate.type === "text") {
    return typeof candidate.text === "string" && candidate.text.length > 0 && candidate.text.length <= 2048;
  }
  if (candidate.type !== "key" || typeof candidate.key !== "string" || !allowedKeys.has(candidate.key)) return false;
  if (candidate.modifiers === undefined) return true;
  return Array.isArray(candidate.modifiers)
    && candidate.modifiers.length <= 3
    && new Set(candidate.modifiers).size === candidate.modifiers.length
    && candidate.modifiers.every((modifier) => typeof modifier === "string" && allowedModifiers.has(modifier));
}
