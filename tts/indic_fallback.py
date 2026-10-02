"""Best-effort Roman (Latin) -> Devanagari conversion.

Used ONLY for tokens that miss the harrrshall/hinglish-tts canonical whitelists
(and would otherwise have gone to IndicXlit, which fails to build on this
machine — fairseq won't compile under Python 3.11 + pyproject pip isolation).

The conversational pipeline rarely exercises this: the LLM is instructed to
reply to Hindi/Hinglish callers in Devanagari, so pure-Devanagari text flows
straight through lib_normalize.to_unified_devanagari() without hitting the
fallback at all. This handles the residual Roman loanwords.
"""

from __future__ import annotations

# Words to hit before generic phonetic scanning. Clinic-domain + Hinglish staples.
WORDS: dict[str, str] = {
    "aap": "आप", "appointment": "अपॉइंटमेंट", "available": "अवेलेबल",
    "booking": "बुकिंग", "book": "बुक", "clinic": "क्लिनिक", "dental": "डेंटल",
    "doctor": "डॉक्टर", "ji": "जी", "ka": "का", "kab": "कब", "kal": "कल",
    "kar": "कर", "kya": "क्या", "slot": "स्लॉट", "sir": "सर", "thik": "ठीक",
    "theek": "ठीक", "nahi": "नहीं", "na": "ना", "toh": "तो", "to": "तो",
    "hai": "है", "hain": "हैं", "ho": "हो", "aapka": "आपका", "aapki": "आपकी",
    "name": "नेम", "number": "नंबर", "time": "टाइम", "today": "टुडे",
    "date": "डेट", "will": "विल", "please": "प्लीज़", "thank": "थैंक",
    "thanks": "थैंक्स", "bye": "बाय", "ok": "ओके", "okay": "ओके",
    "sakt": "सकत", "sakta": "सकता", "sakti": "सकती", "sakte": "सकते",
    "chahiye": "चाहिए", "bana": "बना", "bani": "बनी", "de": "दे", "do": "दो",
    "rahe": "रहे", "rahi": "रही", "raha": "रहा", "main": "मैं", "hum": "हम",
    "mein": "में", "mei": "में", "se": "से", "ko": "को", "ke": "के", "ki": "की",
    "aur": "और", "par": "पर", "pe": "पे", "bhi": "भी", "bahut": "बहुत",
    "hua": "हुआ", "hue": "हुए", "hogi": "होगी", "hoga": "होगा",
    "sunday": "रविवार", "monday": "सोमवार", "tuesday": "मंगलवार",
    "wednesday": "बुधवार", "thursday": "गुरुवार", "friday": "शुक्रवार",
    "saturday": "शनिवार",
}

# Roman consonant spellings in priority (longest-match-first) order.
_CONS = [
    ("ksh", "क्ष"), ("chh", "छ"), ("gh", "घ"), ("kh", "ख"), ("ch", "च"),
    ("jh", "झ"), ("dh", "ध"), ("th", "थ"), ("ph", "फ"), ("sh", "श"),
    ("bh", "भ"), ("gn", "ज्ञ"), ("gy", "ज्ञ"), ("tr", "त्र"), ("sh", "श"),
    ("b", "ब"), ("g", "ग"), ("h", "ह"), ("j", "ज"), ("k", "क"), ("l", "ल"),
    ("m", "म"), ("n", "न"), ("p", "प"), ("r", "र"), ("s", "स"), ("t", "त"),
    ("v", "व"), ("w", "व"), ("y", "य"), ("d", "द"), ("f", "फ"), ("z", "ज़"),
]

# Vowel sounds: (spelling, standalone form, matra-after-consonant, is-"a"-like)
_VOWELS = [
    ("kha", None, None),  # never reached; reserved
    ("aa", "आ", "ा", False), ("ee", "ई", "ी", False), ("oo", "ऊ", "ू", False),
    ("ai", "ऐ", "ै", False), ("au", "औ", "ौ", False), ("ou", "औ", "ौ", False),
    ("kh", None, None, False),  # guard: "kh" must not be seen as vowel "i"
    ("iu", None, None, False),
    ("i", "इ", "ि", False), ("u", "उ", "ु", False), ("e", "ए", "े", False),
    ("o", "ओ", "ो", False), ("a", "अ", None, True),
]
_VOWEL_SPELLINGS = [v[0] for v in _VOWELS if v[1] is not None]


def _word_to_devanagari(w: str) -> str:
    low = w.lower()
    if low in WORDS:
        return WORDS[low]
    out: list[str] = []
    cons: str | None = None          # consonant letter held for a vowel decision
    i = 0
    while i < len(low):
        vow = next((v for v in _VOWEL_SPELLINGS if low.startswith(v, i)), None)
        if vow:
            standalone, matra, is_plain_a = next(
                (v[1], v[2], v[3]) for v in _VOWELS if v[0] == vow
            )
            if cons is None:
                out.append(standalone)
            elif is_plain_a:
                out.append(cons)     # inherent short 'a' — no matra written
                cons = None
            else:
                out.append(cons + matra)
                cons = None
            i += len(vow)
            continue
        if cons is not None:
            out.append(cons)         # consonant with implicit/internal 'a'
            cons = None
        con = next((rec for s, rec in _CONS if low.startswith(s, i)), None)
        if con is None:
            out.append(low[i])
            i += 1
            continue
        cons = con
        i += len(next(s for s, _ in _CONS if low.startswith(s, i)))
    if cons is not None:
        out.append(cons)             # final consonant — Hindi drops final 'a'
    text = "".join(out)
    # Trailing nasal after a vowel sound -> anusvara (hain -> हैं)
    if len(low) >= 3 and low[-1] in "mn" and low[-2] in "aeiou":
        text = text[:-1] + "ं"
    return text


def to_devanagari(text: str) -> str:
    """Convert ASCII Roman tokens in `text` to Devanagari, pass Devanagari
    through unchanged. Keeps punctuation and space structure."""
    import re
    out: list[str] = []
    for m in re.finditer(r"([A-Za-z]+|\s+|[ऀ-ॿ]+|.)", text):
        tok = m.group(0)
        if not tok:
            continue
        if tok.isspace():
            out.append(tok)
        elif "\u0900" <= tok[0] <= "\u097F":
            out.append(tok)                      # already Devanagari
        elif tok[0].isascii() and tok[0].isalpha():
            out.append(_word_to_devanagari(tok))
        else:
            out.append(tok)
    return "".join(out)