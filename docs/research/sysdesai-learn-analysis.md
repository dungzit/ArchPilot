# Research: sysdesai.com /learn and a proposed original ArchPilot learning module

| | |
|---|---|
| **Date** | 2026-09-24 |
| **Method** | 14 single WebFetch requests (well under the 30 cap). WebFetch returns model-summarised text, not raw HTML, so details such as diagrams, exact widgets and login behaviour are only as reliable as those summaries. |
| **Policy** | `docs/pattern-content-policy.md` applies. Nothing here is copied from the site. Structure and facts are described in our own words. The lesson and module titles listed are short factual labels, not content. |

## 1. Summary

- sysdesai.com sells (partly free) a broad "system design" product. `/learn` is one linear course, the "Software Architecture Academy", with 18 modules and 131 lessons (about 29 hours). Each module is a flat list of lessons, and there is no branching into multiple tracks.
- A lesson is a long-form reading page, typically 8-25 minutes. It has headings, an on-page contents list, a comparison table, callouts (interview tip, warning), a practice prompt that links out to a design exercise, a knowledge-check quiz with a 70% pass mark, and comments.
- Assessment is quiz-only (MCQ, true/false, matching). A certificate is issued after every lesson is done and every quiz passed. The rest is community: leaderboard (score, level, streak, follows), feed, discussions and public profiles.
- The learning section is loosely coupled to the tools. Lessons point to a design gallery (48 public designs) and to an AI mock-interview with a whiteboard. Nothing observed suggests a lesson auto-checks a learner's diagram against rules.
- **Opportunity for ArchPilot:** we have a canvas, a deterministic sizing calculator, deterministic validation and a pattern hub. A lesson whose exercise is graded by our own rules (no LLM in v1) is something the reference site does not appear to offer. The obvious risk is copying the curriculum, which the policy forbids. Curriculum topics such as "caching" are generic knowledge, but our lesson text, ordering rationale, diagrams and exercises must be our own.

## 2. Observed structure and UX

### 2.1 Course structure (from `/learn`)

| # | Module (short) | Lessons | Approx. minutes |
|---|---|---|---|
| 1 | Foundations | 7 | 87 |
| 2 | Networking & Communication | 7 | 83 |
| 3 | Data Storage | 8 | 110 |
| 4 | Caching | 7 | 84 |
| 5 | Message Queues & Streaming | 7 | 94 |
| 6 | Architectural Styles | 8 | 107 |
| 7 | Data Management Patterns | 8 | 116 |
| 8 | Decomposition & Integration Patterns | 8 | 90 |
| 9 | Reliability & Resilience Patterns | 9 | 94 |
| 10 | Performance & Scalability Patterns | 9 | 104 |
| 11 | Messaging & Communication Patterns | 6 | 71 |
| 12 | Security & Identity Patterns | 5 | 57 |
| 13 | Deployment & Operations Patterns | 7 | 72 |
| 14 | Distributed Systems | 8 | 109 |
| 15 | Infrastructure & DevOps | 7 | 100 |
| 16 | Security & Auth | 7 | 92 |
| 17 | Real-World Case Studies | 8 | 190 |
| 18 | Interview Strategy | 5 | 67 |

Totals: 131 lessons, about 29 hours. Observations:

- Modules 12 and 16 (both security) and 8, 11 and 6 overlap in scope. The taxonomy looks accumulated rather than designed. We should avoid that.
- The FAQ text mentions "60+ lessons" while the course page shows 131. The site is internally inconsistent, or the FAQ is stale.
- The overview page showed every module as "Not started" for an anonymous visitor. No progress percentages were visible without an account.

### 2.2 Module page (sampled: Foundations, Case Studies, Interview Strategy)

- Numbered lesson list. Each row has a title, a one-line description, a duration, a difficulty label (only "Medium" and "High" were seen; the case-study and interview modules were all "High") and a link. A "Start Module" button sits at the bottom.
- Foundations lessons cover: what system design is, vertical vs horizontal scaling, reliability and availability, CAP and PACELC, consistency models, SLA/SLO/SLI, and back-of-envelope estimation (8-15 min each).
- Case studies are 8 classic "design X" problems (URL shortener, chat, news feed, video streaming, ride-sharing, search, e-commerce, notifications), 20-25 min each, walking from requirements through estimation and diagram to trade-offs.
- Interview Strategy has 5 short lessons on answer frameworks, timing, mistakes and company-specific expectations.
- Difficulty is coarse (two visible levels) and per lesson.

### 2.3 Lesson anatomy (sampled: scalability lesson)

- Left sidebar with the course tree, on-page table of contents, previous/next buttons.
- Body: conceptual headings, a comparison table (vertical vs horizontal), at least one architecture diagram (the summary described it vaguely and possibly as a placeholder, so treat as unverified).
- Callouts: an "interview tip" and a "warning" box.
- A practice prompt linking to a design exercise.
- A knowledge check with a 70% minimum score to count as complete.
- Discussion/comments and "ask a question" affordances. No ads and no login wall were observed.

### 2.4 Assessment, progress and gamification

- Quizzes: MCQ, true/false, matching (per the FAQ), embedded in lessons.
- Completion is gated on quiz pass (70%). The certificate needs all 131 lessons plus all quizzes.
- Certificate: shows recipient name, course title, a line about mastery of scalability, distributed systems and architecture, the award date and the site domain. It is shareable. Whether it is independently verifiable was not stated. A `/certificate/preview` page is public.
- Leaderboard: users ranked by a reputation score, with level, expertise label, streak and follow counts, filtered by week, month and all time. Which actions earn points was not disclosed on the page.
- Community: discussions, activity feed, architect directory with public profiles, follows and notifications.

### 2.5 Links to tools and other sections

- Design gallery: 48 public designs, filterable by category (messaging, e-commerce, social, storage/CDN, real-time, search, analytics, API platform, AI/ML, other) and by completed/in-progress status. Entries show creator, view count and interview-practice count. Each has an "Interview" link.
- Interview practice: AI video interviewer with a whiteboard. It reads the sketch, asks follow-ups and scores in 6 categories. It is credit-gated (new users get about 50 free credits, or bring your own API key).
- News feed: aggregates posts from 35+ engineering blogs (Netflix, Uber, Stripe named), refreshed about every six hours. The pattern is aggregation with links out, which is close to our attribution stance.
- AI architect (copilot or autopilot) exports designs as Markdown for coding assistants.
- The Academy, gallery, news, discussions, directory and leaderboard are stated to be free.

### 2.6 Not accessible or not verified

- Whole lesson bodies, quiz question formats and answer feedback UX were not seen beyond the one summarised lesson.
- Whether progress persists without sign-in, how points are earned, certificate verification, exact pricing (`/pricing`) and the terms of use were not read.
- The News, Discussions, Architects, Feed, About, Resources and Terms pages were not fetched (request budget and relevance).
- No login wall was reported on pages read, but WebFetch cannot log in, so any authenticated-only view (progress, quiz submission, mock interview) was not observed.

## 3. Comparison with what we can do

| Aspect | sysdesai.com (observed) | ArchPilot v1 (proposed) |
|---|---|---|
| Scope | 131 lessons, broad, 29 h | 6-8 lessons, narrow, about 2 h, all authored by us |
| Structure | One linear track, 18 modules | Tracks > modules > lessons > checks, but v1 ships one track and 2-3 modules |
| Lesson medium | Reading page plus quiz | Short reading plus a hands-on canvas or sizing exercise |
| Assessment | MCQ, true/false, matching, 70% | Deterministic auto-checks on the learner's own design or numbers, plus a small number of MCQs |
| Grading of designs | AI interviewer (credit-gated) | Rule-based validation and sizing tolerances, no LLM in v1 |
| Progress | Completion via quiz, streaks, leaderboard | Per-user lesson and check state, simple percent and "next lesson"; no public ranking |
| Certificate | Full-course, shareable | Later (see section 5) |
| Community | Public profiles, feed, discussions | Out of scope (internal tool for 2-4 named users) |
| Content sourcing | Own text plus news aggregation | Own text only. Hub patterns are linked and attributed per policy |

Constraints that shape us (from the content policy): original wording, mandatory attribution on any hub pattern we reference, diagrams redrawn as our own `ArchGraph`, and each lesson should carry the same author self-certification as patterns. The audience is 2-4 named users, so gamification and social features add little value in v1.

## 4. Proposed module design

### 4.1 Information architecture

```
Track            e.g. "System Design Fundamentals" (v1 has one)
 └─ Module       a themed group of 2-4 lessons (e.g. "Sizing", "Scaling reads")
     └─ Lesson   10-20 min. Ordered. Has a prerequisite list.
         └─ Check   the unit of assessment inside a lesson. Types:
                    - canvas_rule   (design on the canvas, validated by rules)
                    - sizing        (numeric answer, tolerance band vs our sizing engine)
                    - mcq           (single or multi choice, keyed answer)
                    - reflect       (self-marked checkbox, no grading)
```

Rules: lessons reference hub patterns by slug (link plus attribution shown by the hub), never by embedding source prose. A lesson may name several prerequisites. A lesson is "complete" when all required checks pass.

### 4.2 Lesson format (about 15 minutes)

1. **Goal**: 2-3 measurable outcomes ("you can size X", "you can place a cache so that Y").
2. **Concept**: 300-500 words of our own text, one redrawn `ArchGraph` diagram.
3. **Worked example**: a small scenario solved step by step, with the numbers shown via the sizing calculator (deep link that preloads the workload).
4. **Try it**: the exercise, one of:
   - **Design this on the canvas**: a button opens the canvas with a starter graph (or blank) and a task card pinned. "Check my design" runs deterministic rules.
   - **Size this workload**: a form of inputs (users, read/write ratio, payload) prefilled into the sizing tool. The learner enters their derived figures and we compare them with the tool's output within a tolerance.
5. **Checks**: 2-4 items (see 4.1) with immediate feedback. Each failing rule returns a canned hint written by us (no generated text).
6. **Go deeper**: links to hub patterns (attributed by the hub) and external sources.
7. **Summary and next**: 3 bullet takeaways and a link to the next lesson.

### 4.3 Auto-check mechanics (deterministic)

- **Canvas rules** are declarative predicates over the `ArchGraph`, each with an id, a human-readable hint and a severity. Examples: `has_node(type=cache) AND edge(app -> cache)`; `no_edge(client -> database)` ("clients must not talk to the DB directly"); `replicas(db) >= 2`; `every stateless service is behind a load balancer`; `every async edge passes through a queue`. Reuse the existing validation engine wherever a rule already exists, and add lesson-only rules as data (JSON), not code, so authors can add them without a release.
- **Sizing checks** compare the learner's answer with the sizing engine's output using a per-check relative tolerance (for example 10-25%) and accept alternative unit forms. The engine stays the single source of truth, so lesson answers cannot drift from the tool.
- **MCQs** hold a keyed answer and a written explanation per option.
- Checks are idempotent and can be retried without limit. Store the best result and attempt count only.
- A check result is always explained by the rule's own hint. There is no scoring by an LLM in v1.

### 4.4 Progress model

- Per user, per lesson: `not_started -> in_progress -> completed`. A lesson completes when all required checks are passed.
- Per check: best status (`pass`, `fail`, `unattempted`), attempt count, last-attempt timestamp.
- Module and track progress are derived (completed required lessons over total), not stored.
- A lesson is unlocked when its prerequisites are complete. In v1, prerequisites are advisory (warn, do not block) because the audience is tiny and trusted.
- The learner's canvas attempt is saved as a normal ArchPilot design tagged with `lesson_id`, so they can resume and see it in their designs list. Content versioning: progress stores the `content_hash` of the lesson completed, so we can tell users when a lesson has since changed.
- Lightweight nudges only: "next lesson", percent bar, "last worked on". No streaks or leaderboard in v1.

### 4.5 Authoring and compliance

- Lessons are Markdown plus a front-matter block and are stored as data (same seed-and-import approach as patterns, idempotent, `draft -> published`).
- Reuse the pattern policy checklist, adapted for lessons: original wording; attribution for every external source and every hub pattern link; original `ArchGraph` diagram; side-by-side check; author of record with `content_hash`. Original quizzes and exercises must not be re-worded versions of the reference site's questions.
- We may reuse generic topic names (caching, CAP) since those are common knowledge, but not the reference site's module ordering, lesson blurbs, exercise wording or quiz questions. Our ordering should follow our own rationale: skills that the canvas and sizing tool exercise first.

## 5. v1 curriculum outline

One track, "Design fundamentals with ArchPilot", three modules. Hub pattern slugs are placeholders. Map each to a real seed-pattern slug at authoring time (I did not confirm the 12 seed slugs) and only link patterns that are published and attributed.

| # | Lesson (working title) | Module | Learning goals | Prerequisite | Linked hub patterns (map at authoring) | Canvas or sizing exercise | Auto-check |
|---|---|---|---|---|---|---|---|
| 1 | Reading a workload | A. Sizing | Turn users and behaviour into requests per second, storage and bandwidth; know read/write ratio and peak factor | none | none (tool tutorial) | Size a small photo-sharing workload in the sizing tool | `sizing`: QPS, daily storage within 15% of engine |
| 2 | Latency and availability targets | A. Sizing | Read SLO/SLA-style targets; convert "nines" to downtime; know why single points of failure hurt | 1 | none | Given availability goal, compute allowed downtime and pick how many replicas | `sizing` (downtime), `mcq` (which component is a SPOF) |
| 3 | Your first three-tier design | B. Building blocks | Client, load balancer, stateless app, database; what each does and where traffic flows | 1 | a basic web-tier pattern | Build the design on a blank canvas for the sized workload | `canvas_rule`: LB before app, app before DB, no client-to-DB edge |
| 4 | Scaling reads with a cache | B. Building blocks | Where to place a cache, cache-aside idea, what it costs (staleness, invalidation) | 3 | a caching pattern | Add a cache to the lesson 3 design so that read load on the DB falls below a stated ceiling | `canvas_rule`: cache on read path; `sizing`: residual DB QPS given hit ratio |
| 5 | Async work with a queue | B. Building blocks | Decoupling slow work, backpressure, retries and idempotency at a conceptual level | 3 | a queue/worker pattern | Move email or thumbnail generation off the request path | `canvas_rule`: async edge goes through a queue with a worker; no sync call from client to worker |
| 6 | Removing single points of failure | C. Reliability and trade-offs | Replication, failover, redundant tiers, what fails together | 2, 3 | a high-availability pattern | Harden the design so no single node failure takes the service down | `canvas_rule`: no SPOF (existing validation), replicas >= 2 on stateful nodes |
| 7 | Trade-offs and consistency, in plain terms | C. Reliability and trade-offs | Explain when stale data is acceptable; CAP intuition without jargon overload | 4, 6 | hub patterns that illustrate the trade-off | Choose per data type (profile, payment, feed) a consistency stance and justify | `mcq` with keyed answers and explanations; `reflect` |
| 8 | Capstone: design and size a service end to end | C. Reliability and trade-offs | Combine sizing, design, cache, queue and HA under a written brief | 1-7 | 1-2 patterns of the learner's choice | Brief for a URL-style or notification-style service, learner picks components, sizes them and validates | Bundle of `sizing` plus `canvas_rule` checks; pass when required set is green |

Estimated authoring effort: about 1-1.5 days per lesson including diagram, checks and self-certification. Suggested first cut is lessons 1, 3, 4 to prove the pipeline, then the rest.

## 6. v1 versus later

| Feature | v1 | Later |
|---|---|---|
| Single track, 8 lessons, canvas and sizing exercises | Yes | More tracks (data, messaging, security) |
| Deterministic auto-checks on canvas and sizing | Yes | Richer rule library, partial credit |
| MCQ checks | Yes (few, keyed) | Matching, ordering, question banks |
| Progress state and resume | Yes | Streaks, time spent analytics |
| Advisory prerequisites | Yes | Enforced unlocking if the audience grows |
| Lesson-to-hub links with attribution | Yes | "Compare my design to this pattern" hand-off (REQ-HUB-008) from a lesson |
| Author self-certification and content_hash | Yes | Independent review if audience grows |
| Case-study module | No | Yes, once the pattern hub is larger |
| Certificate | No | Simple "course complete" page, then a verifiable one if there is an external audience |
| Community, leaderboard, comments | No (2-4 users) | Only if audience and policy change |
| AI-graded mock interview or feedback | No (no LLM in v1) | Considered after v1, with cost and privacy review |
| News/digest feed | No | Possible link-out aggregation, only titles and links with attribution |

## 7. Data schema sketch

Illustrative SQL, in the same style as the `patterns` table. Column names are proposals. Content (lesson text, checks) lives in versioned content files or JSON columns loaded by the seed script.

```sql
-- content (authored, versioned)
CREATE TABLE tracks (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  summary TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
);
CREATE TABLE modules (
  id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id),
  slug TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL,
  UNIQUE(track_id, slug)
);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES modules(id),
  slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('intro','core','advanced')),
  est_minutes INTEGER NOT NULL,
  body_md TEXT NOT NULL,                 -- our own text
  diagram_arch_graph_json TEXT,          -- our own ArchGraph redraw
  starter_graph_json TEXT,               -- canvas starting point, nullable
  sizing_preset_json TEXT,               -- workload preloaded into the sizing tool, nullable
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unpublished')),
  content_hash TEXT NOT NULL
);
CREATE TABLE lesson_prereqs (
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  requires_lesson_id TEXT NOT NULL REFERENCES lessons(id),
  PRIMARY KEY (lesson_id, requires_lesson_id)
);
CREATE TABLE lesson_pattern_links (       -- links only; attribution is shown by the hub
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  pattern_slug TEXT NOT NULL,
  PRIMARY KEY (lesson_id, pattern_slug)
);
CREATE TABLE lesson_sources (              -- external references, attribution mandatory
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id),
  org TEXT NOT NULL CHECK (length(trim(org)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  url TEXT NOT NULL CHECK (length(trim(url)) > 0)
);
CREATE TABLE checks (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id),
  position INTEGER NOT NULL, required INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK (kind IN ('canvas_rule','sizing','mcq','reflect')),
  prompt_md TEXT NOT NULL,
  spec_json TEXT NOT NULL,   -- rule ids+params | {metric, expected_from_engine, tolerance} | {options, key}
  hint_md TEXT NOT NULL
);
CREATE TABLE lesson_reviews (              -- same 5-box self-certification as legal_reviews
  lesson_id TEXT NOT NULL REFERENCES lessons(id), content_hash TEXT NOT NULL,
  original_wording INTEGER NOT NULL, attribution_complete INTEGER NOT NULL,
  original_diagram INTEGER NOT NULL, side_by_side_done INTEGER NOT NULL,
  author_of_record INTEGER NOT NULL, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL,
  PRIMARY KEY (lesson_id, content_hash)
);

-- user state
CREATE TABLE lesson_progress (
  user_id TEXT NOT NULL, lesson_id TEXT NOT NULL REFERENCES lessons(id),
  status TEXT NOT NULL CHECK (status IN ('not_started','in_progress','completed')),
  completed_content_hash TEXT, design_id TEXT,        -- learner's canvas attempt
  started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE check_attempts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, check_id TEXT NOT NULL REFERENCES checks(id),
  passed INTEGER NOT NULL, detail_json TEXT,            -- failed rule ids, or answer + expected band
  created_at TEXT NOT NULL
);
CREATE VIEW check_best AS
  SELECT user_id, check_id, MAX(passed) AS passed, COUNT(*) AS attempts, MAX(created_at) AS last_at
  FROM check_attempts GROUP BY user_id, check_id;
```

Suggested API surface: `GET /api/learn/tracks`, `GET /api/learn/lessons/{slug}`, `POST /api/learn/checks/{id}/attempt` (server-side evaluation so answers are never shipped to the client), `GET /api/learn/progress`.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Lesson text, quiz questions or module ordering drifting toward the reference site's | IP breach, policy violation | Do not read the site while writing; write from our own outline (section 5); author checklist plus side-by-side check; questions written fresh; G3-style audit for lessons |
| Commercial third-party site's terms of use not reviewed | Unknown restrictions on reuse or analysis | We used only public pages, paraphrased facts, and copied no prose. Someone should read `/terms` before this document is shared outside the team |
| Summaries from WebFetch may be inaccurate or incomplete | Wrong conclusions about the reference product | Treated details as unverified where noted; nothing in our design depends on a specific claim about their UX |
| Auto-checks too strict or too lenient, rejecting valid alternative designs | Learner frustration, trust loss | Rules stated as required properties, not exact topologies; per-check tolerance; hints explain the reason; always allow retry |
| Rule and sizing drift when the validation or sizing engine changes | Lesson answers silently wrong | Lesson checks reference engine output, not stored constants; regression tests run every lesson's reference solution |
| Scope creep toward a 131-lesson course | Never ships | v1 capped at 8 lessons and 3 modules; case studies deferred |
| No independent reviewer for lesson content (matches current policy) | Errors or IP slip through | Accepted for 2-4 users; revisit if audience grows |
| Progress data keyed to changing content | Confusing completion status | `content_hash` recorded on completion; show "updated since you completed" |
| Attribution gaps when a lesson links to a hub pattern that is later unpublished | Broken links | Pattern links resolved at read time; hide links to unpublished patterns |

## 9. URLs read

1. https://www.sysdesai.com/learn (fetched twice: overview, then module table)
2. https://www.sysdesai.com/learn/foundations (fetched twice: structure, then lesson hrefs)
3. https://www.sysdesai.com/learn/foundations/scalability
4. https://www.sysdesai.com/gallery
5. https://www.sysdesai.com/faq
6. https://www.sysdesai.com/learn/case-studies
7. https://www.sysdesai.com/leaderboard
8. https://www.sysdesai.com/certificate/preview
9. https://www.sysdesai.com/interview
10. https://www.sysdesai.com/learn/interview-strategy

Local: `docs/pattern-content-policy.md`. Not read: `/news`, `/discussions`, `/architects`, `/feed`, `/pricing`, `/terms`, other module and lesson pages, any authenticated view.
