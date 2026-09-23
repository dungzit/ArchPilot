# sysdesai.com Gallery: Analysis and Compliant Ingestion Design

| | |
|---|---|
| Date | 2026-09-24 |
| Scope | Research for the ArchPilot knowledge hub. Governed by `docs/pattern-content-policy.md` (original, human-written summaries with attribution and link-out; no copied text or diagrams). |
| Method | About 24 WebFetch requests, one at a time. No scripted crawling. Note that WebFetch returns an AI-processed summary of each page, so quoted clause wording and counts should be re-verified by a human in a browser before anyone relies on them legally. |

## 1. Summary

- sysdesai.com is a commercial, single-operator SaaS ("AI Software Architect" plus a free gallery, news feed and academy). The gallery is a public catalogue of system-design walkthroughs with a "Real World" tab of about 54 pages x 12 cards (roughly 640 entries; estimated from the pagination count, unverified).
- **Critical finding:** the "Real World" entries are not human-authored analyses of company systems. Per the site's own About/FAQ text, an AI generates them automatically from engineering-blog articles (35+ blogs), plus user-triggered "Design this" generation. So a sysdesai entry is an AI-generated derivative of a company's blog post, and the "company" tag is often just the blog publisher (Dev.to, InfoQ, DZone, Medium, ByteByteGo, The New Stack), not the company whose system is described.
- Consequence: sysdesai is best used as a discovery index (which topic, which blog, which category) and a UX reference. It is a poor "source of truth" for the hub. The authoritative sources are the original company blog posts, and each author must read those.
- robots.txt allows crawling of the gallery and share pages, including for named AI crawlers. The Terms of Service (effective 1 March 2026) contain no explicit anti-scraping clause, but they prohibit overloading the service and bar redistributing AI outputs without attribution, and they grant no licence to reuse gallery content. Legally permitted and wise are different: we recommend against crawling (section 5).
- Recommended: a link-out catalog (metadata plus our own original summary and redrawn diagram plus the original blog link), built from a 30-item author reading list (section 6). No sysdesai text or diagrams are stored.

## 2. Legal and terms findings

### robots.txt (https://www.sysdesai.com/robots.txt)
- Default rule for all agents: everything allowed except `/design/`, `/designs`, `/feed`, `/notifications`, `/settings/`.
- Separate blocks for GPTBot, ChatGPT-User, Google-Extended, PerplexityBot and ClaudeBot: they explicitly allow `/gallery`, `/share/`, `/learn`, `/news/`, `/interview`, `/llms.txt`, `/llms-full.txt` and the same disallows as above.
- No crawl-delay is stated. A sitemap is declared (`/sitemap.xml`; not fetched).
- Reading: the gallery listing and `/share/` entry pages are NOT disallowed for any agent, including AI agents. robots.txt is a crawler-etiquette signal, not a licence.

### Terms of Service (https://www.sysdesai.com/terms; 12 sections; effective 2026-03-01)
- Sections: Acceptance, Service description, Accounts, Acceptable Use (4), AI-Generated Content (5), Community and UGC (6), Intellectual Property (7), Third-Party Services (8), Liability, Availability, Changes, Contact.
- Scraping, crawling, bots, automated access: no dedicated clause (per the summary). Section 4 forbids abusing, overloading or interfering with the infrastructure, and reverse-engineering or extracting source code.
- Reuse: Section 4 bars reselling, redistributing or commercially exploiting AI-generated outputs without attribution.
- IP (section 7): the brand, logo and source code belong to the operator; users keep ownership of their prompts; outputs are provided for the user's use.
- No licence is granted to shared or gallery designs, and there is no mention of third-party blog content or its sources.
- AI/ML training use of site content: not addressed.
- Practical reading: we may read for personal research. Copying gallery text or diagrams into our product, or bulk-republishing, is not licensed and is exactly what our policy already forbids.

### Disclaimer (https://www.sysdesai.com/disclaimer)
- No warranties on accuracy; capacity estimates are approximate and patterns may be outdated.
- Says nothing about affiliation with or trademarks of the depicted companies, nor about source content or reuse.
- Consequence for us: entries can be inaccurate, so they cannot be cited as fact. Numbers must come from the company's original post.

### Privacy (https://www.sysdesai.com/privacy)
- Prompts and chats go to Google Gemini; the site uses Clerk session cookies and Mixpanel analytics; profile info is public. Not relevant to reuse, but relevant if we ever let users sign in there. We do not.

### llms.txt / llms-full.txt
- Describe the product (48+ "community" walkthroughs, academy of 11 modules, news from 35+ blogs, fork, Markdown export "for AI coding agents"). No licensing or citation terms. The 48+ figure conflicts with the ~54 pages of Real World results, so treat all counts as approximate.

### Crawling verdict
- Technically permitted by robots.txt; not expressly forbidden by ToS (verify text manually); but no content licence, a commercial site, AI-generated derivative content, and an explicit infrastructure-abuse clause. We do not crawl. Manual reading of a bounded reading list is enough, and it fits the policy's human-authoring requirement. If bulk metadata is ever wanted, ask the operator (Contact link) in writing first.

## 3. Gallery structure and UX

Observed on https://www.sysdesai.com/gallery (listing pages render server-side; entry pages did not, see section 4).

**Tabs:** Featured, Real World (described as designs inspired by real engineering-blog posts), Community. Query-param URLs work (`?tab=real-world`, `&sort=`, `&category=`).

**Sort:** Newest (default), Oldest, Popular. **Status filter:** All, Completed, In Progress. All observed entries showed "Done".

**Category filter (single-select chips):** All, Messaging, E-commerce, Social Media, Storage & CDN, Real-time, Search & Discovery, Analytics, API Platform, AI & ML, Other. Each entry carries 1-3 category tags, so categories overlap heavily.

**Pagination:** numbered (1 2 3 ... 54), 12 cards per page.

**Card (as reported):** title; company favicon and company name (Real World only); category tag chips; a status marker; view count and an engagement (like/bookmark) count; designer display name (Featured/Community); link to `/share/<7-char id>`.

**Detail page and features (from FAQ, About and llms-full.txt; not directly observed):**
- Step-by-step "explorable" walkthrough with diagrams; an AI chat box available on every step for explanations or alternatives.
- Fork any public design to a private editable copy; bookmark for later; share to X, LinkedIn, Facebook or by link; export as a Markdown spec.
- Interview practice: choose a topic or existing design and a difficulty, hold a voice conversation with an AI interviewer while sketching on a whiteboard, then get scoring in 6 categories and a history of past interviews. Costs credits (50 free on signup).
- Also: an academy (11 modules), news feed (35+ blogs, refreshed every six hours), community discussions, leaderboard.

**Designer guidance for our hub (own words):**
1. Left rail or top bar with a single-select category filter plus a sort dropdown; a tab bar for source type (ours: "Reference architectures" / "My designs").
2. Grid of equal cards, 12 per page or infinite scroll: title, company logo/name, up to 3 tag chips, a one-line original summary, and a maturity/status badge.
3. Card click opens a detail page with a left step list (numbered sections) and a right pane showing the current step's text and the diagram; previous/next buttons and keyboard arrows.
4. "Open in canvas" (our equivalent of fork) copies the pattern's `ArchGraph` into the user's workspace; "Save/bookmark" is a toggle.
5. "Quiz me" (our equivalent of interview mode): hide a section and ask the learner to place components or state trade-offs, then reveal our author's answer. Scoring can be self-marked, so no AI or voice is needed in v1.
6. Always-visible attribution strip: company, original post title, link-out, date read, author of record.
7. Avoid the overlapping "Other" category; use a primary category plus secondary tags.

## 4. Entry-page anatomy

Limitation: all four `/share/<id>` pages fetched (URL Shortener, Distributed Resource Management, Ads Ranking System, plus one more attempt) returned only the site navigation shell, meaning the walkthrough content is rendered client-side and could not be read via WebFetch. The anatomy below is therefore taken from the operator's own description (llms-full.txt, FAQ), not from direct inspection. A human should open two or three entries in a browser to confirm.

Reported sections, in order:
1. Problem analysis: functional and non-functional requirements.
2. Scope definition: feature prioritisation, MVP scope.
3. Capacity estimation: traffic, storage, bandwidth.
4. Architecture design: diagrams (Mermaid) plus technology rationale; also a data model.
5. Data-flow sequences (sequence diagrams).
6. Scalability strategy: bottlenecks, caching, sharding.
7. Summary: decisions, trade-offs, future considerations.
Plus: per-step AI chat, fork, bookmark, share, Markdown export. Whether a source-blog link is shown on the page could not be confirmed, and the listing cards show only a company/publisher name, not the article title. So authors must locate the original article themselves.

Useful for our template: the same seven sections map onto our existing pattern body (requirements, estimation via our sizing calculator, ArchGraph, sequences, scaling, trade-offs).

## 5. Proposed catalog schema and compliant workflow

### 5.1 Principle
Store a pointer, not the content. A hub entry has four layers: (a) minimal factual metadata about the sysdesai listing, used only as a reading pointer; (b) our authors' original summary and body; (c) our own ArchGraph redraw; (d) the company's original blog link as the primary citation.

### 5.2 Catalog schema (reference index, one row per candidate)

| Field | Type | Notes |
|---|---|---|
| `candidate_id` | uuid | internal |
| `working_title` | text | our own title, not copied from sysdesai unless generic |
| `topic_category` | enum | mapped to ArchPilot categories (see mapping below) |
| `secondary_tags` | text[] | our own tags |
| `discovery_ref.site` | text | constant `sysdesai.com` |
| `discovery_ref.url` | url | the `/share/<id>` link, link-out only |
| `discovery_ref.listed_company_tag` | text | as tagged; may be a publisher, not the company |
| `discovery_ref.listed_categories` | text[] | facts about the listing |
| `discovery_ref.accessed_on` | date | |
| `source.company` | text | the real company, verified by the author |
| `source.article_title` | text | original post title (author-verified) |
| `source.url` | url | original post link (required before publish) |
| `source.published_on` | date | |
| `source.publisher_type` | enum | `company_blog`, `third_party_media`, `personal_blog` |
| `status` | enum | `candidate`, `source_confirmed`, `drafting`, `self_certified`, `published`, `unpublished` |
| `author_id` | fk | author of record |

The published pattern keeps the existing `patterns` fields (summary, body, ArchGraph, attribution columns, `content_hash`, `legal_reviews`). Add: `discovery_ref` (nullable JSON, an optional "found via" credit) and `source.*` mapped to the existing attribution constraints (company, article title, link all NOT NULL and non-blank).

Category mapping (proposed): Messaging -> messaging/notifications; Social Media -> feeds/social; Storage & CDN -> storage/edge; Search & Discovery -> search/recommendation; Analytics and Real-time -> data/streaming; API Platform -> platform/gateway/security; AI & ML -> ML systems; E-commerce -> payments/commerce. Drop "Other".

### 5.3 What we must NOT store or display
- sysdesai prose, step text, capacity tables, chat outputs, exports, or any AI-generated wording from it (including "lightly reworded" copies).
- sysdesai diagrams, Mermaid source, screenshots, thumbnails, or traced copies.
- Bulk mirrors of the listing (titles plus counts plus designer names), view or like counts, designer names (they are user or AI personas with no need for us to hold them).
- Company logos or favicons scraped from sysdesai (use only text names, or logos under the company's own brand rules).
- Anything from `/design/`, `/designs`, private or forked user designs.
- Copies of the company's blog text or figures either (policy section 1).
- Credentials, cookies or API keys for sysdesai; we do not create an account there.

### 5.4 Editorial workflow (fits the existing 5-item self-certify checklist)
1. **Triage.** Product Owner or lead picks a candidate from the reading list (section 6). Status `candidate`.
2. **Locate the primary source.** The author opens the sysdesai entry only as a pointer, finds the original company article (search the company's engineering blog), and records `source.*`. If no primary article can be found, or the source is a low-quality third-party summary, drop the candidate: without a verified source, checklist item 2 (attribution) cannot be met. Status `source_confirmed`.
3. **Read the original, not sysdesai.** Author reads the company article, closes it, and writes the summary and body from understanding (sections mirror our template: requirements, estimation, components, flows, scaling, trade-offs). Numbers are taken from the original article with attribution, never from sysdesai (its estimates are its own AI's approximations).
4. **Redraw.** Author builds the ArchGraph from their understanding of the article, not from the sysdesai diagram.
5. **Self-certify** with the existing five boxes: original wording, attribution complete (company, article title, link), original diagram, side-by-side check (against the company article; also against the sysdesai entry if it was opened), author of record. `content_hash` recorded; publish enabled.
6. **Optional credit.** A "discovered via sysdesai.com" line with the link, in a footer; not required and not a substitute for the primary citation.
7. **Takedown** unchanged (`/api/patterns/{slug}/report`, unpublish, `takedown_requests`). Add sysdesai to the report-contact list if they ever ask.
8. Extra check to add to the side-by-side item: authors who consulted sysdesai must state so in the note field; anything that seems close to sysdesai wording is rewritten.

Reading-list refresh: manual, at most quarterly, by a human browsing the Real World tab. No scheduled fetchers.

## 6. Seed reading list (30 candidates for authors)

Prefix every URL with `https://www.sysdesai.com`. Company is the tag as listed; entries tagged to a media publisher (Dev.to, InfoQ, DZone, Medium, ByteByteGo, The New Stack) or "AWS" are lower priority because the true company or article is unclear; an author must locate the primary source first. All showed status "Done". I did not open the entry pages (client-rendered), so relevance is judged from the card titles only.

| # | Working title (as listed) | Company (as tagged) | Category tags | sysdesai path | Priority note |
|---|---|---|---|---|---|
| 1 | Real-Time Privacy-Preserving Messaging | Meta | Messaging, AI & ML, Analytics | /share/qGxLQc- | High: named company |
| 2 | Oblivious HTTP Platform | Cloudflare | API Platform, Messaging, Real-time | /share/RmPYcMD | High |
| 3 | Real-time Notification System | Dev.to | Messaging, API Platform | /share/wMpjWsg | Medium: find primary source |
| 4 | Notification System (Featured tab) | community | Messaging, API Platform | /share/QOCCw38 | Medium: classic topic, no company; write from general knowledge instead |
| 5 | Messaging App (Featured tab) | community | Messaging, Real-time | /share/SiQy7W5 | Medium: classic topic; same note |
| 6 | Photo and Video Upload System | Instagram | Social Media, Storage & CDN | /share/XnPtNiE | High |
| 7 | Short-Form Video Feed with Friend Bubbles | Meta | Social Media, AI & ML | /share/9cClsoh | High |
| 8 | Recommendation Feed Re-ranking | Pinterest | Social Media, AI & ML | /share/9lx76cl | High |
| 9 | Globally Distributed Graph Data Platform | Netflix | Analytics, Social Media, Storage & CDN | /share/SzMsICW | High |
| 10 | Decentralized Social Media Platform | AT Protocol | Social Media, API Platform, Real-time | /share/H6h3r4x | High: open spec |
| 11 | Real-time Content Prevalence Measurement | Pinterest | Social Media, AI & ML, Analytics | /share/k3QvKf9 | Medium |
| 12 | Authentication Platform | Airbnb | API Platform, Social Media, E-commerce | /share/CCbwUbn | Medium: also tagged Airbnb Engineering |
| 13 | Exabyte-Scale Immutable Blob Storage | Dropbox Tech | Storage & CDN | /share/SnkOgCt | High |
| 14 | Global CDN Infrastructure | Meta Engineering | Storage & CDN | /share/GVLjpUt | High |
| 15 | Distributed Caching System for CDN | Cloudflare | Storage & CDN, API Platform | /share/dbSuEtA | High |
| 16 | CDN Caching System | Cloudflare Blog | Storage & CDN, AI & ML, API Platform | /share/LcoYb9P | Medium: may overlap #15 |
| 17 | Image Delivery System | InfoQ | Storage & CDN, API Platform | /share/UjjjMik | Medium: find primary source |
| 18 | Distributed Code Search Engine | GitHub Engineering | Search & Discovery | /share/vz4w0ei | High |
| 19 | LLM-Native Recommendation Ranking | Netflix Tech Blog | AI & ML, Search & Discovery | /share/OQu72NY | High |
| 20 | Distributed Embedding Retrieval Platform | Pinterest Engineering | AI & ML, Search & Discovery | /share/AERipPA | High |
| 21 | Community Search | Meta Engineering | Search & Discovery | /share/Cw6T6F_ | Medium |
| 22 | Content Ingestion and Deduplication | Pinterest Engineering | Storage & CDN, Search & Discovery | /share/PGSi5sI | Medium |
| 23 | Real-time Experimentation Platform | Datadog Blog | Analytics, Real-time | /share/u91ux0e | High |
| 24 | Observability Pipeline | Datadog | Analytics, E-commerce | /share/-lyDPxn | Medium |
| 25 | Ads Ranking System | Pinterest Engineering | AI & ML, API Platform | /share/SnfzCVd | High |
| 26 | AI Agent Harness | Airbnb Engineering | AI & ML | /share/Z8nwfRn | Medium |
| 27 | LLM Inference Service | Dropbox | AI & ML, Real-time | /share/derwzET | Medium |
| 28 | Access Control System for Serverless Platform | Cloudflare | API Platform, Storage & CDN | /share/e2IfKgT | Medium |
| 29 | Distributed Resource Management | Meta Engineering | Analytics, AI & ML, Storage & CDN | /share/GNVcNZQ | Medium |
| 30 | Ride Sharing Platform | High Scalability | Real-time, API Platform, Other | /share/uvv0DIC | Medium: media source; a Featured-tab "Ride Sharing" (/share/zW-YGkY) is community, not sourced |

Coverage: Messaging 5, Social 7, Storage/CDN 5, Search 5, Analytics/Real-time 2 (plus #1, #29), API platform 3, AI/ML 4, E-commerce/payments 0 (the E-commerce listings observed were mostly Dev.to/AWS/ByteByteGo/InfoQ tags such as /share/rlqDuvS Payment Processing System and /share/VJhCJP5 Agentic Commerce Platform (Cloudflare); add one of those if payments must be covered).

Other Featured-tab titles noted as topic ideas only (community-designed, no company source): URL Shortener /share/ExMwREO; Recommendation Engine /share/L17PE13; Vector Database and Semantic Search /share/dmMa721; Web Crawler and Search Engine /share/2OaL7Jv; Real-Time Stock Trading /share/ek7Diyj; Reddit-like Platform /share/RCnK5z0; Real-time Fraud Detection /share/KBPqGim; Real-time Analytics Dashboard /share/CpyojDt; AI Agent Orchestration /share/ujBnPfu. Since these have no primary company article, they cannot satisfy our attribution rule and would need a different sourcing basis (public textbooks or documentation).

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| sysdesai entries are AI-generated derivatives, may be wrong or hallucinated | Wrong content in the hub | Use only as pointers; numbers and design claims from the primary article |
| "Company" tag is often a media publisher, and titles are generic | Misattribution | Author verifies the true company and article before `source_confirmed` |
| Attribution to sysdesai instead of the primary source would fail our own policy | Non-compliant entries | `source.url` required and points to the original |
| Terms give no reuse licence; text and diagrams are the operator's or the AI outputs' | Infringement or ToS breach if copied | Storage prohibitions in 5.3; authors' original wording |
| Automated fetching, though allowed by robots.txt, could breach the infrastructure-abuse clause or annoy the operator | Blocking, complaint | Manual reading only; no scheduled fetchers |
| Terms text and counts came through a summarising tool; ToS may change (there is a "Changes to Terms" section) | Stale or misread legal position | A human re-reads the Terms in a browser and records the date before starting the authoring track; recheck quarterly |
| Entry pages could not be inspected (client-rendered) | Anatomy in section 4 is second-hand | Human confirms with 2-3 entries in a browser |
| Single self-certifying author; a close paraphrase of an AI summary might slip through | Policy risk already accepted by the Product Owner | Note in the checklist whether sysdesai was consulted; G3 audit spot-checks such entries first |
| Site may disappear or change URLs (short opaque IDs) | Dead discovery links | The discovery link is optional; the primary source link is authoritative |
| Audience growth beyond 2-4 users | The approval scope in the policy lapses | Revisit policy (already noted there) |

## 8. URLs read

- https://www.sysdesai.com/robots.txt
- https://www.sysdesai.com/gallery
- https://www.sysdesai.com/gallery?tab=real-world
- https://www.sysdesai.com/gallery?tab=real-world&page=2 (returned page 1 of 54; page param apparently ignored)
- https://www.sysdesai.com/gallery?tab=real-world&sort=popular
- https://www.sysdesai.com/gallery?tab=real-world&sort=oldest
- https://www.sysdesai.com/gallery?tab=real-world&category=Messaging
- https://www.sysdesai.com/gallery?tab=real-world&category=Social%20Media
- https://www.sysdesai.com/gallery?tab=real-world&category=E-commerce
- https://www.sysdesai.com/gallery?tab=real-world&category=Search%20%26%20Discovery
- https://www.sysdesai.com/gallery?tab=real-world&category=Storage%20%26%20CDN&sort=popular
- https://www.sysdesai.com/gallery?tab=real-world&category=Real-time&sort=popular
- https://www.sysdesai.com/terms (twice)
- https://www.sysdesai.com/disclaimer
- https://www.sysdesai.com/privacy
- https://www.sysdesai.com/llms.txt
- https://www.sysdesai.com/llms-full.txt
- https://www.sysdesai.com/faq
- https://www.sysdesai.com/about
- https://www.sysdesai.com/interview
- https://www.sysdesai.com/share/GNVcNZQ, /share/SnfzCVd, /share/ExMwREO (shell only)

Local: `docs/pattern-content-policy.md`.
