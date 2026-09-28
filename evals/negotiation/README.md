# Negotiation intelligence evaluation

This suite evaluates the production extraction boundary, deterministic term
validation, and historical state resolver without changing product behavior.
It contains 20 human-authored synthetic CRE negotiations ordered from direct
single-term proposals to adversarial multi-round amendments.

Run the full live-model suite:

    npm run eval:negotiation

The command reads GEMINI_API_KEY from the environment, .env.local, or .env;
writes a machine-readable report to artifacts/negotiation-eval.json; and
prints a human-readable summary. Useful options:

    npm run eval:negotiation -- --fixture n19-prompt-injection
    npm run eval:negotiation -- --concurrency 2 --output /tmp/report.json
    npm run eval:negotiation -- --fail-under-f1 0.90
    npm run eval:negotiation -- --json-stdout > report.json

## Metrics

- **Extraction precision/recall/F1:** one-to-one canonical assertion detection,
  including repeated terms in stepped schedules and contradictory drafts.
- **Numeric accuracy:** matched numbers must be within the human-declared
  tolerance and use the expected normalized unit.
- **Normalized-value accuracy:** exact, case-insensitive canonical rendering
  against the human-authored normalized value (reported separately from
  extraction so harmless wording differences are visible).
- **Evidence validity:** every raw model quote must be a non-empty exact
  substring of its document. This is measured before deterministic validation.
- **Evidence support:** a matched assertion's quote must overlap its
  human-selected support span.
- **Assertion status:** status on each matched extraction.
- **Current state:** tenant position, landlord position, agreed-term pointer,
  and contradiction flag must all match for each expected final term.
- **Final status / agreement:** exact resolver status and separate binary
  agreement classification.
- **False positives:** unmatched validated terms plus unexpected non-empty
  final states.

Expected terms and final states live in fixtures.ts, separate from scoring. The
matcher uses canonical type for detection and only uses value, status, and
evidence to choose the best pairing among duplicate types. It contains no
fixture IDs, document phrases, or special-case corrections.
