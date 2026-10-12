/**
 * Lightweight language detection for review text: English, Filipino, Taglish (mixed),
 * emoji-only or empty. Counts common function words from each language; deterministic.
 */
export type Language = "english" | "filipino" | "taglish" | "emoji_only" | "empty" | "other";

const FILIPINO = new Set(
  ("ang ng mga sa na at ay si ni ko mo ka siya kami tayo sila po opo hindi di wala walang may meron " +
    "yung iyong ito iyan yan dito doon pero kasi talaga lang naman din rin pa ba nga sobra sobrang " +
    "ganda maganda mabango bango salamat maraming dumating agad mabilis bilis sana ulit order " +
    "nyo niyo namin natin kayo ako akin nya niya kahit para pag kapag kaya galing tapos lng nmn " +
    "tlga sya ung pde pwede puwede bago luma mura mahal sulit grabe panget pangit sira basag tagas")
    .split(" "),
);
const ENGLISH = new Set(
  ("the a an is are was were be been it this that these those and or but not no very so good great " +
    "nice love best quality product item fast delivery arrived received smell smells scent works " +
    "will would recommend recommended thank thanks seller price worth again buy bought order my i " +
    "you we they with for of to in on at as just really also too well clean cleans")
    .split(" "),
);
// Words used identically in both (e.g. "order"); do not count them for either side.
const SHARED = new Set(["order", "seller", "item"]);

const EMOJI = /\p{Extended_Pictographic}/u;

export function detectLanguage(text: string | null | undefined): Language {
  const t = (text ?? "").trim();
  if (!t) return "empty";
  const words = t.toLowerCase().match(/[a-zñ']+/g) ?? [];
  if (words.length === 0) return EMOJI.test(t) ? "emoji_only" : "other";
  let fil = 0;
  let eng = 0;
  for (const w of words) {
    if (SHARED.has(w)) continue;
    if (FILIPINO.has(w)) fil++;
    else if (ENGLISH.has(w)) eng++;
  }
  if (fil === 0 && eng === 0) return "other";
  const share = fil / (fil + eng);
  if (share >= 0.8) return "filipino";
  if (share <= 0.2) return "english";
  return "taglish";
}
