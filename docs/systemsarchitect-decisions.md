# SystemsArchitect — Product Owner Decision Checklist

| | |
|---|---|
| **Author** | BA/QA Analyst |
| **Date** | 2026-09-23 |
| **Version** | 0.1 |
| **Status** | Blocking decisions 1–4 answered by Product Owner on 2026-09-23; see inline "**DECIDED**" notes |
| **Related docs** | `docs/requirements/systemsarchitect-requirements.md` (v0.1, original 9 open questions), `docs/architecture/systemsarchitect-prototype-design.md` (v0.1), `docs/architecture/reviews/review-systemsarchitect-prototype.md` |

## Executive summary

**English.** The architecture proposal and its red-team review turned most of
the original 9 open questions into concrete proposals, but five still need a
Product Owner decision — four of them block `senior-developer-1` starting
work, because they change scope, schedule, or the day-1 legal/auth setup.
Five more previously-open items are now effectively answered by the design;
they just need a one-line confirmation. Four new decisions surfaced during
the review (mostly co-pilot scope and deployment) can wait until mid-build.

**Tiếng Việt.** Đề xuất kiến trúc và bản rà soát phản biện đã biến phần lớn 9
câu hỏi mở ban đầu thành đề xuất cụ thể, nhưng vẫn còn 5 quyết định cần chủ
sản phẩm chốt — 4 trong số đó chặn `senior-developer-1` bắt đầu công việc vì
ảnh hưởng đến phạm vi, lịch trình, hoặc thiết lập pháp lý/đăng nhập ngày đầu.
5 mục còn lại trong danh sách câu hỏi mở cũ nay đã được thiết kế trả lời gần
như đầy đủ, chỉ cần xác nhận một dòng. 4 quyết định mới phát sinh từ bản rà
soát (chủ yếu về phạm vi trợ lý AI và nơi triển khai) có thể chờ đến giữa quá
trình xây dựng.

## Decision list

### BLOCKING — must be answered before `senior-developer-1` starts

1. **Scope/schedule package.** Pick one: **(A)** 18 seed patterns, 12-week
   timeline, full scope as proposed; **(B)** 12 seed patterns, 9-week
   timeline, with co-pilot LLM re-rank deferred and CSV export cut (red-team
   recommendation, saves ~9 pd); **(C)** other number/timeline.
   *Why it matters:* sets the content-track start date, team commitment, and
   which content authors must be booked. Both architects flag this as the
   single biggest lever.
   **DECIDED: (B)** — 12 patterns, 9-week timeline, co-pilot LLM re-rank
   deferred to Phase 2, CSV export cut.

2. **Audience & distribution.** **(A)** Internal-only, org SSO, ~50–200 users
   (assumed default) or **(B)** plan for eventual external/public release.
   *Why it matters:* B raises legal risk sharply and forces (3) toward
   requiring counsel, not a checklist.
   **DECIDED: (A), internal-only — but scale is 2–4 users**, materially
   smaller than the ~50–200 assumed. This also drove decision 4 below away
   from Entra ID/SSO.

3. **Legal review process + reviewer assignment.** **(A)** Self-certify
   against the 5-item checklist, countersigned by a second person, no
   in-house counsel (assumed default) or **(B)** require legal counsel
   review. Also confirm: who is the **second, independent reviewer** for
   per-entry approval (G1) vs. the pre-launch audit (G3), so BA/QA isn't
   doing both.
   *Why it matters:* blocks gate G0.2 (content-IP policy sign-off), which
   blocks the content track and Phase 3.
   **DECIDED: (A)**, self-certify + checklist, no in-house counsel.
   **Reviewer sub-item DECIDED: no second/independent reviewer in this
   version** — author self-certifies alone. *Note: this waters down
   NFR-LEGAL-002 as designed by the red-team (which assumed an independent
   countersign); accepted as a reasonable trade-off given internal-only
   distribution to 2–4 known users. Revisit if audience ever grows or
   distribution changes (see decision 2).*

4. **Auth model** (superseding the original "Entra ID setup timeline"
   question — moot given decision 2's 2–4-user scale). Pick one: **(A)**
   simple local auth (username/password or shared access token, no SSO
   integration); **(B)** Entra ID SSO anyway; **(C)** no auth, trusted
   network/VPN only.
   *Why it matters:* OIDC/SSO setup was rated "blocks all auth" and Phase-0,
   day-1 work; at 2–4 users it's disproportionate effort.
   **DECIDED: (A)** — simple local auth. Drop Entra ID/OIDC integration from
   Phase 0 entirely; this also removes the IT-dependency risk the original
   question 4 was tracking.

### DEFERRABLE — all now answered (2026-09-23)

5. **Co-pilot scope.** **RESOLVED via decision 1**: LLM pattern-suggest
   deferred to Phase 2 (gate on >40 patterns); sizing review ships as
   deterministic rules only, no LLM.
6. **LLM provider.** **MOOT** — no LLM skill ships in this version's scope
   (see 5); revisit if/when Phase 2 LLM re-rank is picked back up.
7. **Deployment target.** **DECIDED: on-prem Docker host** — single
   container on an existing internal server, no new cloud account/spend.
8. **MVP success metric.** **DECIDED: qualitative team adoption** — the 2–4
   users actually use it for real designs/sizing and give positive
   feedback; no numeric target set for this version.
9. **Mechanical originality-check tool.** **DECIDED: skip for this
   version** — consistent with dropping the second-reviewer requirement
   (decision 3); self-certify checklist only, no extra tooling.

### RESOLVED — confirm only, no re-discussion needed

- **Sizing data source:** published rules-of-thumb/blog benchmarks, each
  tagged with a confidence level and user-overridable. (Review adds: every
  benchmark must carry a source citation before launch.)
- **Auth model:** ~~Entra ID SSO required~~ — **superseded, see decision 4
  above**: simple local auth, no anonymous access to the hub.
- **Accessibility bar:** WCAG 2.1 AA, best-effort (keyboard nav + ARIA in
  scope; full formal audit is not).
- **Diagram notation:** simple custom node/edge model, C4-compatible in
  spirit, not full C4.
- **Sharing:** read-only share link ships in MVP, but scoped to
  org-SSO-authenticated users only, with a 30-day expiry — not an anonymous
  bearer link.

## Next handoff

All nine decisions (1–9) are answered as of 2026-09-23 — nothing remains
open. `senior-developer-1` is fully unblocked to begin build scoping.

**Net effect of this round vs. the architects' original design:** smaller
audience (2–4 users, not 50–200) simplified auth to local login (Entra
ID/SSO dropped) and removed the independent-reviewer countersign + the
originality-check tool from the legal gate. This is a reasonable trade-off
for a small internal tool, but it means NFR-LEGAL-002 now relies on a single
author's self-certification with no second check — worth re-tightening if
distribution ever widens beyond the current 2–4 known users.
