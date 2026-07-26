# Lexicon v2 implementation roadmap

## Mission

Turn the normalized 194-book corpus into an evidence-aware, adaptive English-learning system while preserving TypeWords' existing dictionaries, practice modes, local data, synchronization, and legacy FSRS progress.

The project is not complete when files exist under `public/`. It is complete only when a learner can select an ordered learning stage, study stable language entities and skill-specific cards, inspect provenance and quality, record personal errors, and receive a reproducible adaptive queue without corrupting old progress.

## Non-negotiable invariants

1. Every normalized entity must remain traceable to every original book membership, source index, original ID, original headword, and evidence variant.
2. Ten books copying the same payload remain one evidence variant, not ten independent linguistic votes.
3. The immutable raw layer is never silently corrected. Corrections are versioned overlays with reasons and target identities.
4. `US` and `us`, numbered homographs, multiword expressions, inflected forms, constructions, sentences, and data artifacts must not be collapsed merely because their lowercase strings match.
5. Legacy TypeWords dictionaries remain usable throughout migration.
6. Old word-string FSRS progress may initialize only the corresponding spelling card. It must not imply mastery of pronunciation, senses, constructions, collocations, or production.
7. Unverified AI-generated content is a candidate, never verified evidence.
8. Large source lineage and evidence data are loaded on demand and must not inflate the initial browser bundle.
9. Every generated runtime artifact must be reproducible and validated from committed source files.

## State model

```text
RawBookEntry (immutable)
        |
        v
BookMembership ---> EvidenceVariant
        |                  |
        v                  v
LexicalUnit ------> Validation / Correction overlays
        |
        v
Verified lexical content (sense, syntax, pragmatics, collocation)
        |
        v
PracticeCard (stable cardId, one skill target)
        |
        v
LearnerCardState + PersonalErrorEvent + FSRS
```

## Delivery phases

### Phase 0 — Corpus normalization and ordering

Status: completed in the committed data package.

Delivered:

- 194 source books and 277,529 original memberships.
- Stable normalized lexical-unit identities.
- Case-sensitive entity splitting.
- Evidence-variant deduplication.
- S0–S6 learning stages and Q0 quarantine.
- Source-family de-inflation.
- Quality and validation queues.
- Legacy safe projections.

Exit criteria:

- Every source relation is queryable.
- Quarantined artifacts cannot enter the default learning queue.
- Learning depth is tiered instead of treating all 31,951 entities equally.

### Phase 1 — Runtime foundation

Status: active in `agent/lexicon-runtime-foundation`.

Scope:

- Typed lexicon metadata in `Word` without breaking legacy dictionaries.
- Reproducible runtime builder.
- Validation gate and CI.
- Versioned correction overlay.
- Compact stage JSON.
- Lazy source shards.
- S0–S6 browser and one-click import.
- Per-unit source and quality detail page.

Exit criteria:

- `pnpm lexicon:check` passes on a clean checkout.
- Nuxt builds after runtime generation.
- Stage text projections exactly match canonical independent units.
- No control-character artifact leaks into a learning list.
- An imported word retains `lexicalUnitId` and `lexiconMeta`.
- A learner can inspect concrete source books without loading the entire source index.

### Phase 2 — Stable practice-card identity and FSRS migration

Status: next.

Scope:

- Replace word-string-only scheduling with stable `PracticeCard.cardId`.
- Introduce a versioned card-state store.
- Deterministically migrate legacy cards.
- Keep spelling-card compatibility fallbacks during transition.
- Key wrong counts, ratings, exclusions, known state, and persistence by card ID where appropriate.
- Preserve dictionary progress and current sessions across schema upgrades.

Required migration rule:

```text
legacy fsrsData[normalizedWord]
    -> lexicalUnitId#spelling#normalizedWord
```

No legacy state is copied automatically to:

- recognition;
- listening;
- pronunciation;
- sense discrimination;
- construction;
- collocation;
- Chinese-to-English production;
- error correction.

Exit criteria:

- Existing users keep their spelling schedule.
- Case-sensitive entities cannot share a card accidentally.
- The same normalized entity appearing in multiple books shares one skill card rather than relearning from zero.
- Old caches and synced states upgrade without data loss.

### Phase 3 — Adaptive stage queue

Status: planned after Phase 2.

Scope:

- Build queues from `learning_sequence`, prerequisite relations, known entities, due cards, personal error history, and selected domain targets.
- Separate active and receptive mastery policies.
- Prevent S4–S6 from consuming the same review budget as S0–S3.
- Promote receptive items to active only through evidence from use or explicit learner choice.
- Support cross-book progress without duplicating cards.

Queue priority inputs:

1. overdue FSRS cards;
2. prerequisite closure;
3. active stage order;
4. personal repeated errors;
5. current reading/project vocabulary;
6. domain goal boosts;
7. source breadth and quality;
8. cognitive load and session budget.

Exit criteria:

- Daily work is finite and explainable.
- A word is not repeated simply because it appears in many books.
- Prerequisites precede dependent multiword expressions and constructions.
- Queue decisions expose their reasons.

### Phase 4 — Verified lexical-content model

Status: planned.

Scope:

- Independent lexeme and sense identities.
- Pronunciation variants and labels.
- Forms and morphology.
- Definitions and Chinese glosses per sense.
- Semantic mechanisms and intent maps.
- Valency, complement frames, alternations, and required prepositions.
- Collocations and constructions.
- Register, dialect, politeness, offensiveness, and datedness.
- Contrast rules and Chinese-learner error guidance.
- Source references, review status, confidence, conflicts, and rollback.

Content states:

```text
raw -> candidate -> supported -> reviewed -> verified
                         \-> rejected
```

Exit criteria:

- Every displayed deep claim has a source or is visibly labeled as inference/candidate.
- One word may have multiple separately trainable senses.
- Chinese translations are attached to senses rather than flattened into one list.
- Conflicting sources remain inspectable.

### Phase 5 — Skill-specific practice cards

Status: planned after the content model can support them.

Card skills:

- recognition;
- listening;
- spelling;
- pronunciation;
- sense discrimination;
- construction;
- collocation;
- Chinese-to-English production;
- error correction.

Design rule:

The answer screen reveals only the minimum mechanism needed for the failed task. Full etymology, source history, relation graphs, and all senses remain progressively disclosed.

Exit criteria:

- A learner can be strong at recognition but weak at production without the system collapsing those states.
- Errors generate targeted follow-up cards rather than merely repeating the spelling.
- Each card has a stable identity across dictionaries and content revisions.

### Phase 6 — Personal error and extraction model

Status: planned.

Scope:

- Store error events, not just aggregate wrong counts.
- Classify spelling, listening, pronunciation, sense, syntax, collocation, register, and translation-anchor errors.
- Preserve the learner's attempted answer and context.
- Generate concise decision rules and contrast cards.
- Decay resolved error patterns without erasing history.
- Capture vocabulary from articles and projects with context and source.

Exit criteria:

- The system can explain why an item is being reviewed.
- Repeated personal failure outranks generic corpus priority.
- One corrected success does not erase a persistent error pattern prematurely.

### Phase 7 — Evidence enrichment pipeline

Status: planned; must remain source-governed.

Scope:

- Import independent dictionaries and corpora under their licenses.
- Cluster copied sources before confidence calculation.
- Validate examples for grammaticality, naturalness, sense alignment, and provenance.
- Detect source conflicts and stale labels.
- Maintain incremental change sets and content hashes.
- Prioritize S0, then S1–S3, then encountered receptive vocabulary.

Exit criteria:

- No generated claim is promoted without review policy.
- Reprocessing one lexical unit does not rebuild all 31,951 entities.
- Source and model versions are recorded.

### Phase 8 — Performance and storage hardening

Status: planned.

Scope:

- Keep raw SQLite/JSONL out of the initial static payload.
- Evaluate IndexedDB or a worker-backed SQLite reader for advanced queries.
- Cache source shards and invalidate them by manifest hash.
- Measure stage import latency, memory, bundle size, and mobile behavior.
- Stream or paginate large imports.
- Make server sync preserve lexicon metadata instead of stripping it.

Exit criteria:

- S0 import and browsing work on mobile-class hardware.
- Initial page load is not proportional to corpus size.
- Offline and online stores serialize the same schema safely.

### Phase 9 — Upstream synchronization and release hardening

Status: planned.

Scope:

- Track the upstream TypeWords branch separately from product-specific lexicon changes.
- Keep integration seams narrow and documented.
- Add migrations for every persisted-schema change.
- Add release notes, rollback instructions, and data backup checks.
- Test web, VS Code web, and any supported packaged variants.

Exit criteria:

- Upstream merges do not require manually reapplying the lexicon architecture.
- A failed migration can restore the previous snapshot.
- CI covers corpus integrity, type/build integration, and migration fixtures.

## Current execution order

1. Merge Phase 1 only after CI proves reproducibility and Nuxt compatibility.
2. Start Phase 2 on a separate branch with migration fixtures before changing live scheduling keys.
3. Complete Phase 3 before mass-generating new card types.
4. Build verified deep content incrementally in the order actually learned: S0 -> S1 -> S2/S3 -> encountered S4/S5.
5. Never block real learning on finishing all lexical content globally.

## Explicitly deferred work

The following are not silently treated as completed:

- authoritative verification of all senses;
- authoritative etymology cleanup for all entities;
- natural-example validation for every old example;
- pronunciation scoring;
- universal word-family merging;
- automatic active mastery of all S0–S3 words;
- full synchronization support for new metadata;
- production deployment and release.
