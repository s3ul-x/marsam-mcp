const CODE_ALIASES: Record<string, string> = {
  Space: " ",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/**
 * The character produced by the physical key position, independent of the
 * active keyboard layout. `KeyB` is "b" even when the layout types "ل" there.
 */
export function physicalChar(event: KeyboardEvent): string {
  const code = event.code ?? "";
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code.slice(6).toLowerCase();
  return CODE_ALIASES[code] ?? "";
}

/**
 * Matches a keyboard shortcut against the typed character or the physical key
 * position, so shortcuts keep working on Arabic, Cyrillic, Greek and other
 * non-Latin layouts.
 */
export function matchKey(event: KeyboardEvent, candidates: string[]): boolean {
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const physical = physicalChar(event);
  return candidates.some(
    (candidate) =>
      candidate === key || (physical !== "" && candidate === physical),
  );
}
