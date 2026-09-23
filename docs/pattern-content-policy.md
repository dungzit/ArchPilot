# SystemsArchitect (ArchPilot) — Content-IP Policy for Pattern Entries

| | |
|---|---|
| **Author** | BA/QA Analyst |
| **Date** | 2026-09-23 |
| **Version** | 0.1 |
| **Status** | Draft — awaiting Product Owner sign-off (gate G0.2) |
| **Related docs** | `docs/requirements/systemsarchitect-requirements.md` (NFR-LEGAL-001/002, REQ-HUB-002/005), `docs/requirements/systemsarchitect-decisions.md` (decision 3), `docs/development/systemsarchitect-build-scope.md` (gate G0.2, task C.1/C.4, `content_hash` invariant) |

## Executive summary

**English.** This is the content-IP policy for ArchPilot's pattern hub, required to unblock gate G0.2 and the content-authoring track. It applies only to this internal tool, used by 2–4 named users, per the Product Owner's decisions: self-certification against a checklist, no second reviewer, no mechanical originality-check tool. It states in plain terms what "original, human-written, attributed" means, gives the 5-item checklist each author fills out per pattern entry (the same 5 boxes the backend's `legal_reviews` row records against a `content_hash`), and documents the takedown process for a non-compliant entry. It ends with a one-line sign-off block for the Product Owner.

**Tiếng Việt.** Đây là chính sách sở hữu trí tuệ (IP) cho nội dung thư viện mẫu kiến trúc của ArchPilot, cần thiết để mở khóa cổng G0.2 và giai đoạn biên soạn nội dung. Chính sách chỉ áp dụng cho công cụ nội bộ này, dùng bởi 2–4 người dùng được nêu tên, theo quyết định của chủ sản phẩm: tác giả tự chứng nhận theo checklist, không có người soát xét thứ hai, không dùng công cụ kiểm tra tính nguyên bản tự động. Tài liệu nêu rõ thế nào là "nguyên bản, do con người viết, có trích dẫn nguồn", đưa ra checklist 5 mục mà mỗi tác giả điền cho từng mẫu kiến trúc (đúng 5 mục mà dòng `legal_reviews` trong backend ghi lại gắn với `content_hash`), và mô tả quy trình gỡ bỏ khi phát hiện vi phạm. Cuối tài liệu là khối ký duyệt một dòng cho chủ sản phẩm.

## Context & objectives

ArchPilot's pattern hub summarizes real-world reference architectures inspired by public engineering blog posts (e.g., Netflix, Uber, Stripe). NFR-LEGAL-001/002 require every entry to be original and attributed, never scraped or reproduced verbatim, with a takedown path if a source company objects. Gate G0.2 requires the Product Owner to sign off on the policy governing this before any pattern content is authored (task C.1, `docs/development/systemsarchitect-build-scope.md`). Scope: internal use only, 2–4 named users, self-certify-only review (decision 3, `systemsarchitect-decisions.md`) — no legal counsel, no independent countersign, no automated originality checker.

## 1. The rule, in plain terms

A pattern entry is **compliant** when:

- **Summarize, don't copy.** Every sentence in the summary and body is written in the author's own words, based on their understanding of the source article — not copied, and not lightly reworded ("find-and-replace") from the source's sentences.
- **Always attribute.** The source company/team name, the original post's title, and a working link to it are always included on the entry. No entry is published without these populated (this is already enforced at the database level — see REQ-HUB-005 schema constraint).
- **No verbatim diagrams.** Diagrams are redrawn by the author as ArchPilot's own `ArchGraph` component/edge model, representing the author's understanding of the architecture — not a screenshot, export, trace, or close visual copy of the source's diagram.
- **Facts and numbers are fine; prose is not.** Citing a factual number from the source (e.g., "handles 5M events/sec") with attribution is allowed — that's a fact, not an expression. Copying the sentence that describes it is not.
- **When in doubt, cite more, copy less.** If unsure whether a phrase is "too close" to the source, rewrite it further or add an inline citation rather than publish as-is.

## 2. Self-certification checklist (per pattern entry, before "published")

The author completes all five items below for each entry before it can be marked `published`. This is the same checklist the admin UI enforces (publish stays disabled until all five are checked) and it is what the backend's `legal_reviews` row records against the entry's `content_hash`.

1. [ ] **Original wording** — I wrote this summary and body in my own words; no sentence is copy-pasted or lightly edited from the source article.
2. [ ] **Attribution complete** — The source company name, source article title, and a working link to the original post are all filled in on this entry.
3. [ ] **Original diagram** — Any diagram on this entry is my own `ArchGraph` redraw of the architecture, not a screenshot, export, or traced copy of the source's diagram.
4. [ ] **Side-by-side check done** — I compared my draft against the source article, paragraph by paragraph, and confirm no paragraph or diagram is substantially similar to the original.
5. [ ] **Author of record** — I understand I am recorded as the author of this entry's `content_hash`, and this entry may be unpublished without further review if it is later found non-compliant.

*Note:* per Product Owner decision 3, there is no second/independent reviewer and no mechanical originality-check tool for this version — the author's own checkmarks are the entire gate. This is an accepted trade-off for a 2–4-user internal tool (see Risks below).

## 3. Non-compliance / takedown process

If a published pattern entry is later found (or reported) to be non-compliant with Section 1:

- **Trigger.** Any of: (a) a source company disputes the entry via the in-app report form (`POST /api/patterns/{slug}/report`), (b) the Product Owner or any team member spots an issue on review, (c) the pre-launch audit (gate G3) flags an entry.
- **Owner.** The Product Owner (or an admin-role user acting on the Product Owner's behalf) actions the takedown. No separate legal function exists for this tool.
- **Action.** The entry is unpublished via the existing one-click admin action (`POST /api/admin/patterns/{id}/unpublish`), which is immediate and requires no code change. The triggering request is logged in `takedown_requests` for the audit trail. Any design a user had already built from that pattern keeps working, but the pattern's attribution is suppressed on those derived designs (existing behavior).
- **Re-publish.** Only after the entry is corrected and re-passes the Section 2 checklist against a new `content_hash`.

## Traceability matrix

| Requirement | Design element | Test case | Status |
|---|---|---|---|
| NFR-LEGAL-001 (original, attributed, no verbatim) | `patterns` table attribution CHECK constraints; `content_hash` invariant (`ArchPilot/backend/app/content_hash.py`) | TC-COMPLY-001 | Pending — QA to author |
| NFR-LEGAL-001 (self-certification) | `legal_reviews` table, admin UI 5-checkbox form (task 5.3) | TC-COMPLY-002 | Pending |
| NFR-LEGAL-002 (takedown path) | `takedown_requests` table, unpublish endpoint (task 5.4) | TC-COMPLY-003 | Pending |
| REQ-HUB-005 (attribution always visible) | `patterns` schema NOT NULL + non-blank CHECK | TC-FUNC-HUB-005 | Pending |
| G0.2 (this policy, signed) | This document | — | **Awaiting PO sign-off** |

## Step-by-step plan

1. **Product Owner reads and signs this document** (Section "Sign-off" below) — *owner: Product Owner; outcome: gate G0.2 cleared, `docs/development/systemsarchitect-build-scope.md` task C.1 marked done.*
2. **Content author(s) use the Section 2 checklist for each of the 12 seed patterns** while authoring (task C.3/C.4) — *owner: Content author; outcome: 12 `legal_reviews` rows, each with all 5 boxes checked and a matching `content_hash`.*
3. **QA references this policy when writing TC-COMPLY-001..003** — *owner: QA; outcome: test cases under `docs/testing/` exercising the publish-gate and takedown flow.*
4. **Pre-launch audit (gate G3)** — Product Owner and QA jointly spot-check all 12 published entries against Section 1 before launch — *owner: PO + QA; outcome: audit sign-off, launch unblocked.*

## Risks & assumptions

- **Risk.** No second reviewer means a single author's judgment is the only compliance check pre-launch. *Accepted trade-off* per Product Owner decision 3, given the 2–4-user internal-only audience. The gate G3 pre-launch audit (PO + QA together) is the one remaining independent look, applied once across all entries rather than per entry.
- **Assumption.** If the audience ever grows beyond the current 2–4 named users, this policy must be revisited (independent countersign and/or an originality-check tool should be reconsidered at that point) — see decisions doc.
- **Open question.** No fixed SLA is set for acting on a takedown trigger in this version; if a firmer turnaround commitment is needed, the Product Owner should specify one in a future revision.

## Next handoff

**Product Owner** — read Sections 1–3 and sign below. Once signed, content authors (task C.2 onward) are unblocked to begin the seed-pattern authoring track.

---

## Sign-off

**Approved by:** ____________________ (name) **Date:** ____________

**Scope of approval:** Approved for **internal-only distribution to the current 2–4 named users** of ArchPilot. This approval must be **revisited if the audience or distribution model changes** (e.g., grows beyond the current named users, or moves toward external/public release).
