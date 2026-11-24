# Backup model comparison, 2026-11-24

Asked for in roster item #17. The user's words: "compare them, with a very small coding task. speed and quality both to be judged".

Task: write `parseDuration(s)` in JavaScript (for example '1h30m' becomes 5400 seconds, and bad input gives null). Each answer was checked by 16 hidden tests in a sandbox. A second check asked each model to call a `read_file` tool. The models were called directly over HTTP (`bench.js`), not through Claude Code. Each run had a 2000-token cap and the lowest temperature allowed.

| Backend | Model | Thinking | Median time | Tokens/s | Tests passed | Tool call |
|---|---|---|---|---|---|---|
| glm | glm-5.3:cloud | on | 8.5 s (cap hit) | ~236 | 0/16 (no code) | ok |
| glm | glm-5.3:cloud | off (`thinking: disabled`) | 1.4 s | ~143 | 16/16 | ok |
| box | qwen3.8-27b-heretic-int4-int8 | on | 24.8 s (cap hit; also no code at 8000 tokens) | ~80 | 0/16 (no code) | ok |
| box | same | off (`chat_template_kwargs.enable_thinking=false` only) | 2.6 s | ~77 | 14/16 | ok |
| strata | inkling-2-mini-sq-15 | none | 4.1 s | ~57 | 16/16 | ok |

The box failed '1h 5m 10s' (its pattern allows no spaces between parts) and '0s' (it rejects a total of zero).

The code each model wrote is in `glm.js`, `box.js` and `strata.js`. `bench.js` reads the box key from the environment at run time and contains no key.

Caveat: this was one tiny task. It measures speed and basic correctness, not how well a model handles long multi-step agent work.
