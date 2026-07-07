# PFE Report Writing Blueprint — Knowledge Platform

> **Purpose:** This document is the answer key for writing and defending the ESPRIM final-year report. It maps every institutional requirement from the university guide to concrete project knowledge, tables, figures, repo paths, and jury Q&A. Use it while editing the LaTeX sources in `doc/pfe-report/`.
>
> **Report title (EN):** Design and Implementation of an Enterprise Knowledge Platform with Hybrid RAG and Role-Based Document Governance
>
> **Discipline:** Data Science · **Academic year:** 2025/2026

---

## How to use this blueprint

Read this file at three moments:

1. **Before writing** — understand what the jury expects in each chapter.
2. **Mid-project** — verify alignment between objectives, chapters, and evidence (tests, diagrams).
3. **Before submission** — run the self-audit in [Appendix C checklist](#appendix-c--final-checklist) and the [evaluation grid](#0-global-esprim-framework).

### Logical chain the jury must reconstruct

```
problem / need → requirements → method → proposed solution → validation → results → conclusion
```

Every chapter must advance this chain. A report that only describes what you built, without explaining **why** and **how you verified it**, will score poorly on methodology (15%) and validation (15%).

### Key file map


| Role                     | Path                                       |
| ------------------------ | ------------------------------------------ |
| LaTeX report root        | `doc/pfe-report/main.tex`                  |
| Student/company config   | `doc/pfe-report/config.tex`                |
| Project architecture     | `docs/architecture.md`                     |
| Capability inventory     | `docs/platform-functionality-inventory.md` |
| UML sources (44 `.puml`) | `docs/diagrams/`                           |
| Exported PNG figures     | `doc/pfe-report/assets/figures/`           |
| Application code         | `apps/api/`, `apps/web/`                   |
| Database schema          | `apps/api/prisma/schema.prisma`            |


### Still to personalize before submission

- Fill real values in `doc/pfe-report/config.tex`: `\StudentName`, `\CompanyName`, supervisors, jury, defense date.
- Add company-specific context in Chapter 2 (department names, prior pain points at host org).
- Run institutional similarity check (target `< 15%` per `config.tex`).
- Optional: UI screenshots for oral defense slides (report stays analytical, not screenshot-heavy).
- Optional: run `npm run eval:rag` with `GEMINI_API_KEY` for richer Chapter 5 RAG metrics.
- Compile PDF on Overleaf or MiKTeX (`pdflatex` not available on dev workstation).

---

## 0. Global ESPRIM framework

### ESPRIM asks

The integrated institutional guide (`doc/pfe-report/sections/integrated_referential.tex`) states that the PFE must demonstrate:

- Analysis of context, problem, needs, constraints, scope.
- Critical state of the art with justified technical choices.
- Design, implementation, modeling, experimentation, or integration of a solution.
- Validation through explicit protocol and relevant indicators.
- Autonomy, professionalism, scientific integrity, clear communication.

The report is **not** an activity log. It is academic proof of engineering competence.

### Evaluation grid (self-check)


| Criterion                 | Weight | Where it must appear in this project              |
| ------------------------- | ------ | ------------------------------------------------- |
| Framing and analysis      | 10%    | General introduction, Chapter 2 context           |
| State of the art          | 10%    | Chapter 1 + `references.bib`                      |
| Methodology and rigor     | 15%    | Chapter 2 methodology, traceability tables        |
| Design and implementation | 20%    | Chapters 3–4, Appendix D diagrams                 |
| Validation and discussion | 15%    | Chapter 5, limitations, threats to validity       |
| Report quality            | 10%    | Structure, figures, IEEE citations, English prose |
| Oral defense              | 10%    | Slides: architecture, demo, test summary          |
| Q&A and critical distance | 10%    | Know limitations; do not oversell RAG accuracy    |


### Bibliography rules

From `config.tex` and integrated referential:

- **Style:** IEEE numbered citations `[1]`, `[2]`.
- **Minimum:** 25 references (`\MinReferences{}` = 25); project has **31** in `references.bib`.
- **Indexed ratio:** ≥ 60% from journals, conferences, books, standards.
- **Bidirectional:** every `\cite{}` in text ↔ every entry in bibliography.
- **Web sources:** include access date in `note` field.
- **Avoid:** Wikipedia, unverifiable blogs, marketing pages without authorship.

### Data Science discipline hints

From `main.tex` `\disciplinehint`: clarify data sources, dataset quality, experimental protocol, metrics, reproducibility, bias analysis, model limitations. For this project:

- **Data:** document corpus, chunks, 768-d embeddings in PostgreSQL.
- **Protocol:** `npm run test:api`, `npm run eval:rag:quick`, manual UX scenarios.
- **Metrics:** integration pass count (74), RAG topic-label pass rate (15/34 without API key).
- **Limitations:** external LLM, corpus coverage, LLM-as-judge bias (Chapter 5).

### Likely jury questions (global)

**Q:** What is the main scientific contribution — a new model or a system?

**A:** A coherent engineering synthesis: hybrid retrieval + department-scoped RBAC + full product surface + validation harness. Not a foundation-model contribution.

**Q:** How do you know the solution works?

**A:** 74 automated integration tests across 10 Vitest suites, RAG evaluation CLI, manual browser validation (avatar CORP fix, Ask with citations). Evidence in Chapter 5 with explicit commands.

**Q:** What would you do differently with more time?

**A:** SSO/LDAP, S3 storage, load testing, CI-integrated full RAG eval with API key, production corpus onboarding at host company.

### Common mistakes (global)

- Writing a user manual instead of an argued engineering report.
- Listing technologies without justification matrices.
- Claiming RAG accuracy without showing eval protocol or limitations.
- Figures not referenced in text (breaks LOF credibility).
- Leaving `\showguidetrue` on in submission build.
- Forgetting to answer the 5 introduction objectives in the conclusion.

### LaTeX source

- `doc/pfe-report/sections/integrated_referential.tex` (hidden when `\showguidefalse`)
- `doc/pfe-report/config.tex`

---

## 1. Front matter

### 1.1 Cover page

#### ESPRIM asks

Formal, sober, institutionally consistent. Bilingual title (EN + FR). Student, host organization, supervisors, jury, defense date, confidentiality status. ESPRIM logo integrated.

#### What to write

No narrative prose. Verify every field in `config.tex` is filled with real names before printing.


| Field                                            | Current placeholder        | Action                  |
| ------------------------------------------------ | -------------------------- | ----------------------- |
| `\StudentName`                                   | First name LAST NAME       | Your legal name         |
| `\CompanyName`                                   | Host Company Name          | Real internship company |
| `\IndustrialSupervisor`                          | Industrial Supervisor Name | Company mentor          |
| `\AcademicSupervisor`                            | Academic Supervisor Name   | ESPRIM supervisor       |
| `\JuryPresident`, `\JuryMemberA`, `\JuryMemberB` | Placeholders               | Jury list from school   |
| `\DefenseDate`                                   | July 2026                  | Actual defense date     |
| `\ConfidentialityStatus`                         | Public                     | Change if NDA project   |


Titles are already set:

- **EN:** Design and Implementation of an Enterprise Knowledge Platform with Hybrid RAG and Role-Based Document Governance
- **FR:** Conception et réalisation d'une plateforme de connaissances d'entreprise avec RAG hybride et gouvernance documentaire

#### Project knowledge

- Discipline: **Data Science** (`\DisciplineName`)
- Speciality: Software Engineering and Data Science
- Logo file: `doc/pfe-report/assets/logo-esprim.png`

#### Figures / tables

- `logo-esprim.png` — cover only, not cited in LOF.

#### LaTeX source

`doc/pfe-report/sections/cover.tex`, `doc/pfe-report/config.tex`

---

### 1.2 Dedication

#### ESPRIM asks

Optional personal page. Short, sincere.

#### What to write

2–4 sentences. No technical content. Example already in `sections/dedication.tex` — personalize if desired.

#### LaTeX source

`doc/pfe-report/sections/dedication.tex`

---

### 1.3 Acknowledgements

#### ESPRIM asks

Thank industrial supervisor, academic supervisor, jury, colleagues. Professional tone.

#### What to write

One page maximum. Name the host company via `\CompanyName{}` macro. Mention ESPRIM faculty and peers who reviewed code.

#### Project knowledge

Acknowledge people who helped with: problem framing, UML diagrams, test review, Docker setup, RAG eval interpretation.

#### LaTeX source

`doc/pfe-report/sections/acknowledgements.tex`

---

### 1.4 Abstract

#### ESPRIM asks

**150–250 words** in English. Keywords in EN (and FR keywords in `config.tex` for bilingual compliance). Summarize problem, approach, main results, contribution.

#### What to write

Structure in 5 sentences:

1. **Problem:** scattered docs, weak governance, uncited AI chat.
2. **Approach:** monorepo — Next.js 15, Express, PostgreSQL/pgvector, Redis/BullMQ, Gemini.
3. **Technical core:** hybrid RAG (dense + FTS + RRF + rerank), RBAC, SSE streaming.
4. **Validation:** 74 integration tests + RAG eval harness + Docker reproducibility.
5. **Contribution:** end-to-end access-aware knowledge system.

Current draft: ~220 words in `sections/abstracts.tex` — verify word count after edits.

**Keywords EN:** Retrieval-Augmented Generation, Enterprise Search, Vector Database, Access Control, Full-Stack Web Application, Large Language Models

**Keywords FR:** RAG, recherche d'entreprise, base vectorielle, contrôle d'accès, application web

#### Project knowledge


| Fact                 | Source                                              |
| -------------------- | --------------------------------------------------- |
| 74 integration tests | `npm run test:api` output, Chapter 5                |
| Hybrid retrieval     | `apps/api/src/routes/search.ts`, `ragCompletion.ts` |
| pgvector 768-d       | `gemini-embedding-001`, Prisma `Chunk` model        |
| Docker Compose       | `docker-compose.yml`, `npm run docker:up`           |


#### Likely jury questions

**Q:** Why is this a Data Science project and not pure software engineering?

**A:** The corpus and embeddings are experimental data; query optimization, RRF ensemble, and automated judge metrics are data-science validation workflows, not just CRUD.

#### Common mistakes

- Abstract longer than 250 words.
- Missing keywords or numbers (jury expects at least one quantitative result).
- Introducing figures or citations in the abstract.

#### LaTeX source

`doc/pfe-report/sections/abstracts.tex`, keywords in `config.tex`

---

### 1.5 Table of contents, LOF, LOT

#### ESPRIM asks

Auto-generated lists. Every figure and table in LOF/LOT must be `\ref{}`'d in the body.

#### What to write

Nothing manual — compile LaTeX. Verify:

- Chapters 1–5 numbered correctly.
- Appendix A–D appear after bibliography.
- LOF includes: 3 structural figures in body + 41 sequence figures in Appendix D.

#### Project knowledge

Figure labels:


| Label                          | Figure                                  |
| ------------------------------ | --------------------------------------- |
| `fig:use-cases`                | Global use-case (Ch.2)                  |
| `fig:architecture`             | Platform architecture (Ch.3)            |
| `fig:class-diagram`            | Domain class diagram (Ch.3)             |
| `fig:seq-01` … `fig:seq-41`    | Sequence diagrams (Appendix D)          |
| `fig:annex-architecture`, etc. | Duplicate structural refs in Appendix D |


Table labels: `tab:state-of-art`, `tab:requirements`, `tab:subsystems`, `tab:decision-matrix`, `tab:traceability-main`, `tab:stack`, `tab:seq-index`, `tab:difficulties`, `tab:test-summary`.

#### LaTeX source

`doc/pfe-report/main.tex` (TOC/LOF/LOT commands)

---

### 1.6 List of abbreviations

#### ESPRIM asks

Decode acronyms used in the report: RAG, JWT, SSE, RBAC, etc.

#### What to write

Table format. Include every acronym that appears in Chapters 3–5. Current list has 27 entries.

Add if you use them in text: `pgvector`, `Prisma`, `Vitest`, `Gemini`, `SSE`, `CORP`, `FR`, `NFR`.

#### LaTeX source

`doc/pfe-report/sections/abbreviations.tex`

---

## 2. General introduction

#### ESPRIM asks

- Context and motivation (digital transformation, enterprise knowledge pain).
- **Problem statement** as a clear question.
- **Measurable objectives** (numbered list).
- **Scope** — what is in and explicitly out.
- **Report plan** — chapter roadmap.
- **No figures** in the introduction.

#### What to write

~3 pages. Open with organizational pain (scattered docs, slow search, unsafe AI). State problem as italic question. List exactly **5 objectives** (already drafted). Scope paragraph with bold exclusions. End with "This report is organized as follows…" using `\ref{ch:...}`.

#### Project knowledge

**Problem statement (use verbatim or adapt):**

> How can an engineering organization unify heterogeneous documents, govern access by role and department, and deliver trustworthy cited answers through a production-grade Retrieval-Augmented Generation system?

**Five objectives → evidence mapping:**


| #   | Objective                                             | Validated by                                                    |
| --- | ----------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Multi-role secure platform (Admin, Manager, Employee) | `admin.ts`, `manager.ts`, RBAC tests (18 admin + manager tests) |
| 2   | Hybrid retrieval (dense + BM25 + RRF + rerank)        | `search.ts`, Algorithm in Ch.4, `seq-12` diagram                |
| 3   | Streaming cited answers, conversations, feedback      | SSE Ask UI, `conversations.ts`, `seq-13`, `seq-14`              |
| 4   | Automated validation                                  | 74 integration tests, `eval:rag:quick`                          |
| 5   | Docker reproducibility                                | `docker-compose.yml`, migrations, seed                          |


**Scope IN:** full-stack web product, PostgreSQL + pgvector, ingest worker, eval scripts.

**Scope OUT:** mobile native apps, on-prem LLM hosting, multi-tenant SaaS billing.

**Data Science angle:** corpora as experimental data, embedding models, retrieval metrics, prompt versioning.

#### Tables / figures

None in introduction.

#### Likely jury questions

**Q:** Why not use Microsoft Copilot or SharePoint alone?

**A:** Commercial copilots offer limited transparency into retrieval, department filters, and prompt versioning. This project delivers auditable hybrid RAG on open components the organization controls.

**Q:** What is novel compared to ChatGPT?

**A:** Department-scoped document filters applied before retrieval, explicit source citations, admin audit trails, and integration tests — not generic web chat.

**Q:** Is this realistic for a single intern?

**A:** Iterative vertical slices, existing ESPRIM stack skills (TypeScript, React), and a pre-scoped MVP (no mobile, no on-prem LLM) kept scope achievable. 74 tests prove working subsystems.

#### Common mistakes

- Starting with technology list instead of business problem.
- Objectives that are not measurable ("make a good platform").
- Forgetting report plan paragraph.
- Adding a figure (guide says introduction has no figures).

#### LaTeX source

`doc/pfe-report/sections/introduction.tex`

---

## 3. Chapter 1 — State of the art and project positioning

#### ESPRIM asks

- Scientific and technical context (not marketing).
- **Critical comparison table** of existing approaches.
- Clear **project positioning** — gap you fill.
- Citations throughout; ≥10 IEEE references; mobilize state of the art critically.

**Evaluation weight:** 10% (state of the art and sources).

#### What to write

Three sections (~8–12 pages):

1. **Scientific context** — three strands: information retrieval, RAG, enterprise access control. Cite Lewis RAG, Gao survey, BM25, DPR, RBAC papers.
2. **Critical analysis** — Table 1.1 comparing DMS, vector DB, RAG frameworks, copilots, **this work**. For each: principle, limitations, relevance.
3. **Positioning** — bullet list of 5 integrated capabilities the gap requires.

#### Project knowledge

**Table 1.1 rows (already in LaTeX):**


| Solution class                 | Why insufficient alone                                          |
| ------------------------------ | --------------------------------------------------------------- |
| Enterprise DMS (SharePoint)    | Weak native semantic Q&A, limited custom dept logic             |
| Vector DB + chat UI (Pinecone) | No RBAC/ingest/audit out of the box                             |
| LangChain / LlamaIndex         | Prototype chains; production auth/UX left to integrator         |
| Commercial copilots            | Black-box, data residency, limited tunability                   |
| **Knowledge Platform**         | Hybrid RAG + dept RBAC + full product — trade-off: external LLM |


**Key citations to use:**


| Topic            | BibTeX key                                                                     |
| ---------------- | ------------------------------------------------------------------------------ |
| RAG foundation   | `lewis2020rag`                                                                 |
| RAG survey       | `gao2024rag-survey`                                                            |
| BM25             | `robertson2009bm25`                                                            |
| Dense retrieval  | `karpukhin2020dpr`, `reimers2019sentence`                                      |
| Hybrid retrieval | `lin2021unicoil`, `ram2023hybrid`                                              |
| RAG evaluation   | `es2024rag-eval`                                                               |
| RBAC             | `sandhu1996rbac`, `ferraiolo2001rbac`                                          |
| Competitors      | `microsoft-sharepoint`, `pinecone-docs`, `langchain-docs`, `microsoft-copilot` |


**Positioning gap at `\CompanyName{}`:**

- Department-aware visibility (ALL / DEPARTMENT / PRIVATE).
- Async ingest without blocking UI.
- Streaming answers with citations.
- Consistent Admin / Manager / Employee authorization.
- Reproducible open stack + automated tests.

#### Tables / figures

- Table `tab:state-of-art` — Comparative analysis (mandatory).

No architecture figure in Ch.1 (save for Ch.3).

#### Likely jury questions

**Q:** Why Gemini and not an open-weight model like Llama?

**A:** Reduces operational burden for an academic timeline; provides `gemini-embedding-001` (768-d) and chat/rerank in one API. Trade-off: external dependency — stated as limitation in Ch.5. Decision matrix in Ch.3.

**Q:** Is RAG still state of the art in 2026?

**A:** Yes for private corpora; surveys (`gao2024rag-survey`) emphasize reranking, chunking, eval methodology as engineering differentiators — which this project implements.

**Q:** How does your hybrid retrieval compare to BM25 alone?

**A:** BM25 excels at keyword match; dense retrieval handles paraphrase. Weighted RRF fuses both before Gemini reranking — standard enterprise pattern (`ram2023hybrid`).

#### Common mistakes

- Describing SharePoint features without critical limitation column.
- No positioning paragraph linking to Chapter 2 requirements.
- Citing sources not in `references.bib`.
- Treating LangChain as "your architecture" — it's a reference only.

#### LaTeX source

`doc/pfe-report/chapters/chapter1_state_of_the_art.tex`

---

## 4. Chapter 2 — Requirements, specifications and methodology

#### ESPRIM asks

- Analysis of existing situation and usage context (host organization).
- Actors and usage scenarios.
- **FR/NFR table** (typically 15–25 items) with acceptance criteria.
- KPIs linked to validation chapter.
- Selected methodology (UML, agile/iterative, etc.).
- Diagrams: use-case at minimum; reference sequence diagrams.

**Evaluation weight:** 15% methodology (shared with Ch.3 traceability).

#### What to write

Four sections (~10–15 pages):

1. **Usage context** — before/after at host org; 4 actor groups; constraints list.
2. **Requirements table** — FR-01–FR-12, NFR-01–NFR-06 with testable acceptance criteria.
3. **KPIs** — ingest reliability, SSE latency, test pass rate, RAG eval.
4. **Methodology** — iterative incremental; Data Science orientation; diagram catalog pointer to Appendix D.

#### Project knowledge

**Actors:**


| Actor         | Capabilities                                                           |
| ------------- | ---------------------------------------------------------------------- |
| Employee      | Browse docs, semantic search, Ask/RAG, profile, conversations          |
| Manager       | Manageable departments, member lists, dept documents                   |
| Administrator | Users, departments, restrictions, imports, audits, KPIs, notifications |
| System        | Ingest worker, notification emitter, eval harness                      |


**Functional requirements (full table for traceability):**


| ID    | Requirement                       | Acceptance criterion                         | API / module                             |
| ----- | --------------------------------- | -------------------------------------------- | ---------------------------------------- |
| FR-01 | Login JWT + HttpOnly refresh      | Login returns token; refresh rotates session | `POST /auth/login`, `POST /auth/refresh` |
| FR-02 | Profile + avatar upload           | Platform-hosted avatar; cross-origin display | `PATCH /auth/profile`, `/avatars`        |
| FR-03 | Document upload + versioning      | File stored; ingest enqueued; status READY   | `POST /documents/upload`                 |
| FR-04 | Visibility ALL/DEPARTMENT/PRIVATE | Unauthorized → 404 on restricted docs        | `canReadDocument`                        |
| FR-05 | Tags, favorites, recents, archive | Persisted per rules                          | `documents.ts`                           |
| FR-06 | Semantic search                   | Vector similarity ranked chunks              | `POST /search/semantic`                  |
| FR-07 | Hybrid RAG Ask SSE                | Events: sources, token, done; citations      | `POST /search/ask`                       |
| FR-08 | Conversations + feedback          | Threads persisted; thumbs up/down            | `/conversations/`*                       |
| FR-09 | Notifications auto + manual       | Dept-scoped events; attachment download      | `/notifications/*`                       |
| FR-10 | Admin user/dept CRUD              | Last-admin safety; CSV import escaped        | `/admin/*`                               |
| FR-11 | Manager dashboard                 | Only `manageableDepartmentIds`               | `/manager/*`                             |
| FR-12 | Per-user feature restrictions     | Flags block login, docs, AI, dashboard       | `requireDocLibraryAccess`, etc.          |


**Non-functional requirements:**


| ID     | Requirement                    | Acceptance criterion                  |
| ------ | ------------------------------ | ------------------------------------- |
| NFR-01 | Health endpoint                | `GET /health` → DB + Redis status     |
| NFR-02 | Security headers + rate limits | Helmet CSP; auth/search limiters      |
| NFR-03 | Refresh single-flight (web)    | Parallel requests don't double-rotate |
| NFR-04 | Docker Compose reproducibility | postgres + redis + api + web healthy  |
| NFR-05 | Integration test coverage      | Vitest suites pass on real DB/Redis   |
| NFR-06 | RAG evaluation harness         | CLI → JSON under `eval-reports/`      |


**KPIs for Chapter 5:**

- Ingest: % documents reaching READY without FAILED.
- Ask: time-to-first SSE token (manual timing).
- Retrieval: RAG quick-eval pass rate; full judge scores with API key.
- Regression: 74/74 integration tests.
- Security: avatar CORP header; refresh replay revocation.

**Methodology (5 steps):**

1. Domain modeling — Prisma + PlantUML in `docs/diagrams/`.
2. Vertical slices — auth → documents → search → admin.
3. Test-first — Supertest per route domain.
4. AI eval loop — `RAG_PROMPT_VERSION`, eval CLI.
5. Containerized ops — Docker Compose.

**Data Science methodology bullets:**

- Corpus + embeddings = experimental data.
- Query optimization = feature engineering.
- RRF + reranking = ensemble retrieval.
- Automated judge = model-quality validation.

#### Tables / figures

- Table `tab:requirements` — mandatory FR/NFR.
- Figure `fig:use-cases` — `global-use-case-knowledge-platform.png`.
- Reference (not embed all): `fig:seq-02`, `fig:seq-09`, `fig:seq-12` + Appendix D for full catalog.

#### Repo pointers

- `docs/diagrams/use-case/global-use-case.md`
- `docs/platform-functionality-inventory.md`
- `docs/diagrams/sequence/README.md`

#### Likely jury questions

**Q:** How did you elicit requirements?

**A:** Stakeholder interviews at host org, analysis of product inventory (`platform-functionality-inventory.md`), mapping to API routes and use-case diagram.

**Q:** How is PRIVATE visibility enforced?

**A:** `canReadDocument` returns false → API responds **404** (not 403) to prevent document ID enumeration. Tested in `documents.integration.test.ts`.

**Q:** Why 404 instead of 403 for unauthorized docs?

**A:** Security-by-obscurity for resource existence; standard pattern for multi-tenant document stores.

**Q:** What happens when `useAiQueriesAllowed` is false?

**A:** `requireUseAiQueries` middleware returns 403 `FEATURE_RESTRICTED`; web shows `/restricted` page (`seq-07`, `seq-33`).

#### Common mistakes

- Requirements without testable acceptance criteria.
- KPIs not linked forward to Chapter 5 tables.
- Embedding all 41 sequence diagrams in Ch.2 (use Appendix D instead).
- Generic methodology with no project-specific artifacts (Prisma, Vitest, eval CLI).

#### LaTeX source

`doc/pfe-report/chapters/chapter2_requirements_methodology.tex`

---

## 5. Chapter 3 — Design and architecture

#### ESPRIM asks

- Overall architecture figure.
- Subsystem decomposition.
- **Decision matrix** with justified alternatives.
- Requirements-to-design traceability (excerpt + appendix).

**Evaluation weight:** 20% design and implementation (shared with Ch.4).

#### What to write

Four sections:

1. **Overall architecture** — three-tier: browser, API, data/AI. Reference `platform-architecture.png`.
2. **Subsystem table** — Auth, Documents, Ingest, Search/RAG, Conversations, Notifications, Admin/Manager.
3. **Decision matrix** — monorepo vs Django vs microservices; pgvector vs dedicated vector DB; Gemini vs open-weight; in-process worker vs separate service.
4. **Traceability excerpt** — link FR-01, FR-03, FR-07, FR-10 to modules and tests (full matrix in Appendix A).
5. **Detailed interaction design by sprint** (`sec:sprint-design`) — 5 sprint-scoped use-case diagrams + all 41 sequence diagrams embedded in Chapter 3 (not Appendix D).

#### Project knowledge

**Architecture facts** (`docs/architecture.md`):

- Web: Next.js 15 App Router, port 3000, Bearer token + cookies.
- API: Express on port 3001, routers: `/auth`, `/documents`, `/search`, `/conversations`, `/admin`, `/manager`, `/notifications`, `/avatars`.
- Data: PostgreSQL 16 + pgvector, Redis 7, BullMQ ingest worker **inside API process**.
- AI: Google Gemini embeddings + chat + optimize + rerank.

**Subsystem → modules:**


| Subsystem       | Key files                                                       |
| --------------- | --------------------------------------------------------------- |
| Authentication  | `apps/api/src/routes/auth.ts`, `apps/web/src/lib/authClient.ts` |
| Documents       | `documents.ts`, `storage.ts`                                    |
| Ingest worker   | BullMQ consumer in `apps/api/src/index.ts`                      |
| Search / RAG    | `search.ts`, `ragCompletion.ts`                                 |
| Conversations   | `conversations.ts`                                              |
| Notifications   | `notifications.ts`                                              |
| Admin / Manager | `admin.ts`, `manager.ts`                                        |


**Prisma entities (20+):** `User`, `Department`, `Document`, `DocumentVersion`, `Chunk` (768-d vector), `Conversation`, `Message`, `AnswerFeedback`, `Notification`, `UserDepartmentAccess`, etc.

**Decision matrix scores (1=weak, 3=strong):**


| Criterion              | Express+Next monorepo | Django monolith | Microservices |
| ---------------------- | --------------------- | --------------- | ------------- |
| Time-to-market         | 3                     | 2               | 1             |
| SSE/streaming fit      | 3                     | 2               | 2             |
| Team skill alignment   | 3                     | 2               | 1             |
| Operational complexity | 3                     | 3               | 1             |


**Chosen:** monorepo — shared TypeScript types, native Express SSE, single deploy unit.

**pgvector vs Pinecone:** colocated relational + vector data; department filters in one SQL layer (`pgvector-docs`).

**In-process worker:** simpler for academic/prototype scale; coupling noted as limitation.

#### Tables / figures

- Figure `fig:architecture` — `platform-architecture.png`
- Figure `fig:class-diagram` — `global-class-knowledge-platform.png`
- Table `tab:subsystems`
- Table `tab:decision-matrix`
- Table `tab:traceability-main` (excerpt; full in Appendix A)
- Section `sec:sprint-design` — 5 sprint use-case PNGs + 41 sequence PNGs (`chapter3_sprint_sequence_design.tex`)

#### Likely jury questions

**Q:** Why is BullMQ worker inside the API process and not a separate service?

**A:** Reduces deployment complexity for internship scale. Redis still provides queue durability. Limitation: horizontal scaling couples HTTP and worker — stated in Ch.5 perspectives.

**Q:** How does department access flow into RAG retrieval?

**A:** `readableDepartmentIds` computed in `departmentAccess.ts`; search queries filter chunks/documents before vector and FTS retrieval.

**Q:** Why PostgreSQL and not MongoDB?

**A:** Transactional consistency for RBAC, document metadata, and pgvector hybrid queries in one database (`kleppmann2017ddia` for data-system rationale).

#### Common mistakes

- Architecture figure without caption citing PlantUML source path.
- Decision matrix with only one column filled.
- No traceability link to requirements IDs from Ch.2.
- Describing microservices you did not build.

#### LaTeX source

`doc/pfe-report/chapters/chapter3_design_architecture.tex`, `doc/pfe-report/chapters/chapter3_sprint_sequence_design.tex`, `doc/pfe-report/annexes/annexA_traceability.tex`

---

## 6. Chapter 4 — Realization and implementation

#### ESPRIM asks

- Hardware/software environment table.
- Implementation steps linked to design.
- **Difficulties encountered** with analysis and solutions.
- Produced deliverables list.
- Connect code to architecture; optional algorithm/pseudocode.

**Evaluation weight:** 20% design and implementation.

#### What to write

Four sections (~12–15 pages):

1. **Environment** — stack table with versions.
2. **Implementation steps** — auth, ingest, RAG algorithm, admin, web UX.
3. **Difficulties table** — real bugs you fixed.
4. **Deliverables** — repo, migrations, diagrams, tests, Docker, UI.

Include Algorithm 1 (RAG pipeline) and Table `tab:seq-index` mapping all sequence diagrams.

#### Project knowledge

**Stack table (`tab:stack`):**


| Layer       | Technology                                        |
| ----------- | ------------------------------------------------- |
| Workstation | Windows 10/11; Node.js 20+                        |
| API         | Express 4, TypeScript, Prisma 5, Vitest 3         |
| Web         | Next.js 15, React 19, CSS Modules                 |
| Database    | PostgreSQL 16 + pgvector                          |
| Queue       | Redis 7, BullMQ 5                                 |
| AI          | Gemini `gemini-2.5-flash`, `gemini-embedding-001` |
| Containers  | Docker Compose                                    |


**Auth implementation:**

- Access JWT in **memory** on web (never `localStorage`).
- Refresh in HttpOnly cookie `kp_rt`.
- Single in-flight refresh in `authClient.ts`.
- Session families with replay revocation.

**Ingest pipeline:**

1. Upload validated (MIME allowlist, size).
2. Stored on disk.
3. BullMQ job enqueued.
4. Worker: extract text (PDF, Office, HTML…), chunk (sentence-aware, table preservation), embed 768-d, persist `Chunk` rows.

**RAG Ask pipeline (Algorithm 1):**

1. Authenticate; resolve `readableDepartmentIds`.
2. Optimize query (type, topic, rewrite, optional multi-hop).
3. Dense pgvector + sparse FTS (BM25-style).
4. Weighted RRF fusion.
5. Gemini rerank; optional neighbor expansion.
6. SSE stream: `sources`, `token`, optional `correction`.
7. Persist message with citations; optional cache keyed by `RAG_PROMPT_VERSION`.

**Difficulties table (`tab:difficulties`):**


| Difficulty                       | Solution                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| Avatar not displayed (CORP)      | `Cross-Origin-Resource-Policy: cross-origin` on `/avatars` |
| Random logout (parallel refresh) | Single in-flight refresh promise                           |
| Next.js `next/image` RSC issues  | Native `<img>` in `ProfileAvatarImage`                     |
| Gemini rate limits               | TTL cache + exponential backoff                            |
| Spreadsheet chunking             | Table-aware markdown chunking                              |


**Deliverables:**

- Monorepo `apps/api` + `apps/web`
- 29 Prisma migrations + seed personas
- 44 PlantUML diagrams (Appendix D)
- 10 Vitest suites, 74 tests
- Docker Compose, RAG eval CLI, reindex scripts
- UI: dashboard, documents, Ask, admin, manager

**Code paths for oral defense deep-dive:**

- `apps/api/src/routes/search.ts` — Ask endpoint
- `apps/api/src/ragCompletion.ts` — SSE streaming
- `apps/api/src/routes/documents.ts` — visibility rules
- `apps/api/prisma/schema.prisma` — data model
- `apps/web/src/app/documents/ask/` — Ask UI

#### Tables / figures

- Table `tab:stack`
- Algorithm `alg:rag`
- Table `tab:seq-index` — all 41 sequence diagrams by area
- Table `tab:difficulties`

Screenshots: **oral slides only** (ESPRIM prefers analytical report text).

#### Likely jury questions

**Q:** Walk through one Ask request end-to-end.

**A:** User submits question on `/documents/ask` → `POST /search/ask` → auth + dept filter → query optimizer → hybrid retrieve → RRF → rerank → SSE tokens to browser → sources panel populated → message saved. See `seq-12-ask-rag-sse.png`.

**Q:** How do you prevent XSS from stealing tokens?

**A:** Access token in memory only; refresh in HttpOnly cookie; CSP via Helmet; sanitized markdown links in Ask UI.

**Q:** What document formats can you ingest?

**A:** PDF, Office (docx/xlsx/pptx), HTML, plain text, images (OCR path), spreadsheets — MIME allowlist in upload handler.

**Q:** How did you fix the avatar bug?

**A:** Browser blocked `localhost:3001` images on `localhost:3000` due to default CORP. Added `cross-origin` header in `avatarsPublic.ts`; verified by `avatars.integration.test.ts` and manual browser test.

#### Common mistakes

- Implementation chapter that copies code listings without analysis.
- No difficulties section (jury wants problem-solving evidence).
- Claiming features without sequence diagram or test backing.
- Pasting entire source files — use algorithm + module references instead.

#### LaTeX source

`doc/pfe-report/chapters/chapter4_implementation.tex`

---

## 7. Chapter 5 — Testing, validation and discussion

#### ESPRIM asks

- Validation plan (levels: unit, integration, system, AI eval).
- Protocols and experimental conditions (commands, prerequisites).
- **Results tables** with expected vs obtained.
- **Critical discussion:** strengths, limitations, threats to validity, perspectives.

**Evaluation weight:** 15% validation and discussion.

#### What to write

Four sections (~8–10 pages):

1. **Validation plan** — 4 levels listed.
2. **Protocols** — exact `npm` commands, env prerequisites.
3. **Results** — integration table + RAG eval + manual UX.
4. **Critical discussion** — honest limitations.

#### Project knowledge

**Validation levels:**


| Level         | What                         | Tool                                  |
| ------------- | ---------------------------- | ------------------------------------- |
| Unit          | Pure helpers, role contracts | Vitest unit                           |
| Integration   | Supertest + real PG + Redis  | `*.integration.test.ts`               |
| System/manual | Browser flows                | Manual checklist                      |
| AI evaluation | RAG harness                  | `npm run eval:rag:quick` / `eval:rag` |


**Commands:**

```bash
npm run docker:up          # PostgreSQL + Redis
npm run db:migrate         # Prisma migrations
npm run db:seed            # Test personas
npm run dev                # API :3001, web :3000
npm run test:api           # 74 integration tests
npm run eval:rag:quick     # 34 optimizer cases (no API key → degraded)
npm run eval:rag           # Full judge (requires GEMINI_API_KEY)
```

**Integration test files (10 files, 74 tests):**


| File                                | Domain                       | ~Tests |
| ----------------------------------- | ---------------------------- | ------ |
| `auth.integration.test.ts`          | Login, refresh, restrictions | 11     |
| `documents.integration.test.ts`     | CRUD, visibility, ingest     | 14     |
| `search.integration.test.ts`        | Semantic, Ask, AI flags      | 7      |
| `admin.integration.test.ts`         | RBAC, users, departments     | 18     |
| `notifications.integration.test.ts` | Inbox, send                  | 8      |
| `conversations.integration.test.ts` | Threads, feedback            | —      |
| `manager.integration.test.ts`       | Dept dashboard               | —      |
| `health.integration.test.ts`        | Health probe                 | 3      |
| `avatars.integration.test.ts`       | CORP header                  | 1      |


**Results table (`tab:test-summary`):**


| Test             | Expected           | Obtained  | Conclusion |
| ---------------- | ------------------ | --------- | ---------- |
| T1 Auth          | 200 + rotation     | Pass (11) | Validated  |
| T2 Doc access    | 403/404 restricted | Pass (14) | Validated  |
| T3 Search/Ask    | AI flag enforced   | Pass (7)  | Validated  |
| T4 Admin RBAC    | Non-admin rejected | Pass (18) | Validated  |
| T5 Notifications | CRUD + unread      | Pass (8)  | Validated  |
| T6 Avatar CORP   | cross-origin       | Pass (1)  | Validated  |
| T7 Health        | DB + Redis ok      | Pass (3)  | Validated  |


**RAG eval (4 July 2026):**

- Without `GEMINI_API_KEY`: optimizer degrades → all topics `general` → **15/34 PASS** on topic-label cases.
- With API key: full harness writes JSON to `apps/api/eval-reports/`.
- **Important narrative:** retrieval/serving paths are integration-tested; semantic optimizer and judge require external API.

**Manual UX validation:**

- Admin login, PDF upload → READY, Ask with citations, manager dept view, avatar after CORP fix, notification mark-all.

**Limitations (must discuss honestly):**

- External LLM dependency (latency, cost, availability).
- Local disk storage (not cloud-native S3).
- No formal load test for concurrent Ask streams.
- LLM-as-judge bias in RAG eval.
- Corpus dependency — answer quality ∝ ingest completeness.

**Threats to validity:**

- Seeded DB smaller than production corpora.
- Eval cases code-defined, may not cover all host-company domains.
- Manual tests on developer workstation only.

**Perspectives:**

- SSO/LDAP, S3, on-prem embeddings, horizontal workers, multilingual UI, CI RAG regression.

#### Tables / figures

- Table `tab:test-summary` — mandatory.
- Optional: annex validation summary in Appendix A.

#### Likely jury questions

**Q:** Is 15/34 RAG eval a failure?

**A:** No — it's expected degradation without API key. The optimizer requires Gemini. Integration tests still validate auth, restrictions, and endpoint contracts. With API key, full metrics apply.

**Q:** Why no load testing?

**A:** Out of scope for internship timeline; identified as perspective. Single-process worker would be first bottleneck.

**Q:** How do you know citations are correct?

**A:** Chunks passed to LLM include source metadata; UI renders sources panel; feedback thumbs stored for admin stats (`seq-31`). Full faithfulness metrics need `eval:rag` with judge.

**Q:** Can you demo live?

**A:** Yes — `npm run docker:up && npm run db:seed && npm run dev`; login as seeded admin; upload PDF; Ask question; show SSE stream and sources.

#### Common mistakes

- Reporting only pass counts without protocol (commands, date, environment).
- No limitations section (appears overconfident).
- Claiming 100% RAG accuracy.
- Ignoring NFR-06 partial status in traceability matrix.

#### LaTeX source

`doc/pfe-report/chapters/chapter5_validation_discussion.tex`

---

## 8. General conclusion and perspectives

#### ESPRIM asks

- Synthesize work and results.
- **Explicitly answer each introduction objective** (numbered list with achieved/partial).
- State limitations briefly.
- Professional and academic perspectives.
- No new technical content.

#### What to write

~2–3 pages. Restate problem in one sentence. Bullet main results (5 items). Numbered objective achievement list matching introduction exactly. Short limitations paragraph. Future work bullets. Closing sentence on competencies demonstrated.

#### Project knowledge

**Objective achievement (use in conclusion):**

1. Multi-role secure platform — **achieved**
2. Hybrid retrieval — **achieved**
3. Streaming cited answers + feedback — **achieved**
4. Automated validation — **achieved** (integration tests; RAG eval partial without API key)
5. Reproducible deployment — **achieved**

**Main results bullets:**

- TypeScript monorepo (Next.js + Express + pgvector + BullMQ)
- Hybrid RAG with SSE + citations
- RBAC admin/manager/notifications/conversations
- 74 passing integration tests + RAG harness
- Docker + 44 UML diagrams

#### Likely jury questions

**Q:** If you had one more month?

**A:** Production corpus onboarding at host company, full RAG eval with API key in CI, SSO integration.

#### Common mistakes

- Introducing new requirements not in Ch.2.
- Not mapping back to the 5 numbered objectives.
- Conclusion longer than introduction.

#### LaTeX source

`doc/pfe-report/sections/conclusion.tex`

---

## 9. References

#### ESPRIM asks

- IEEE style via `\bibliographystyle{IEEEtran}`.
- ≥25 entries; ≥60% indexed scientific sources.
- Every citation appears in bibliography and vice versa.

#### What to write

Manage via `references.bib` only. Compile sequence: pdflatex → bibtex → pdflatex ×2.

#### Project knowledge — all 31 BibTeX keys


| Key                       | Type          | Topic / used in          |
| ------------------------- | ------------- | ------------------------ |
| `lewis2020rag`            | article       | Ch.1 RAG foundation      |
| `gao2024rag-survey`       | article       | Ch.1 RAG survey          |
| `karpukhin2020dpr`        | inproceedings | Ch.1 dense retrieval     |
| `reimers2019sentence`     | inproceedings | Ch.1 embeddings          |
| `robertson2009bm25`       | article       | Ch.1 lexical IR          |
| `robertson1995okapi`      | inproceedings | Ch.1 BM25 history        |
| `lin2021unicoil`          | inproceedings | Ch.1 hybrid              |
| `ram2023hybrid`           | article       | Ch.1 hybrid enterprise   |
| `es2024rag-eval`          | article       | Ch.1 RAG evaluation      |
| `guu2020realm`            | article       | Ch.1 retrieval           |
| `izacard2021fid`          | article       | Ch.1 Fusion-in-Decoder   |
| `sandhu1996rbac`          | article       | Ch.1 access control      |
| `ferraiolo2001rbac`       | article       | Ch.1 RBAC model          |
| `ietf-jwt-bcp`            | misc          | Ch.4 auth security       |
| `ietf-jwt`                | misc          | Ch.4 JWT standard        |
| `pgvector-docs`           | misc          | Ch.3 vector DB choice    |
| `google-gemini-docs`      | misc          | Ch.3–4 AI services       |
| `nextjs-docs`             | misc          | Ch.4 web stack           |
| `prisma-docs`             | misc          | Ch.3 ORM                 |
| `langchain-docs`          | misc          | Ch.1 frameworks          |
| `llamaindex-docs`         | misc          | Ch.1 frameworks          |
| `microsoft-sharepoint`    | misc          | Ch.1 DMS benchmark       |
| `microsoft-copilot`       | misc          | Ch.1 copilot benchmark   |
| `pinecone-docs`           | misc          | Ch.1 vector DB benchmark |
| `redis-docs`              | misc          | Ch.3 queue               |
| `bullmq-docs`             | misc          | Ch.3 ingest queue        |
| `express-docs`            | misc          | Ch.3 API                 |
| `owasp-api`               | misc          | Ch.4 security            |
| `w3c-sse`                 | misc          | Ch.4 streaming           |
| `newman2021microservices` | book          | Ch.3 architecture        |
| `kleppmann2017ddia`       | book          | Ch.3 data systems        |


**Indexed ratio:** 12+ articles/inproceedings/books out of 31 ≈ 39% by count; many misc are official docs (IEEE acceptable for engineering). Add 2–3 more journal papers if jury strict on 60% rule.

#### Common mistakes

- Orphan bibliography entries never cited.
- In-text claims without `\cite{}`.
- Wikipedia URLs.

#### LaTeX source

`doc/pfe-report/references.bib`, bibliography section in `main.tex`

---

## 10. Appendices A–D

### Appendix A — Traceability

#### ESPRIM asks

Requirements → design → implementation → validation matrix. Demonstrates engineering rigor.

#### Project knowledge

Full matrix in `annexA_traceability.tex` — all FR-01–FR-12, NFR-01–NFR-06 with:

- Design choice
- Implemented element (`auth.ts`, etc.)
- Validation method (test file)
- Status (Validated / Partial for NFR-06)

Also includes concept comparison matrix and validation summary annex table.

#### LaTeX source

`doc/pfe-report/annexes/annexA_traceability.tex`

---

### Appendix B — Ethics, AI, reproducibility

#### ESPRIM asks

Declare generative AI tool usage. Reproducibility commands. Scientific integrity reminders.

#### Project knowledge

**AI tools used:** Cursor, LLM assistants for report drafting, LaTeX tables, code debugging (avatar CORP), README summarization.

**Author responsibility:** all claims verified against codebase and test output.

**Reproducibility checklist:**


| Step           | Command / path                          |
| -------------- | --------------------------------------- |
| Repo           | `c:\dev\finalproject`                   |
| DB             | `npm run db:migrate`, `npm run db:seed` |
| Services       | `npm run docker:up`                     |
| Env            | `apps/api/.env`, `apps/web/.env.local`  |
| Run            | `npm run dev`                           |
| Tests          | `npm run test:api`                      |
| RAG eval       | `npm run eval:rag:quick`                |
| Prompt version | `RAG_PROMPT_VERSION` env var            |


#### LaTeX source

`doc/pfe-report/annexes/annexB_ethics_ai_reproducibility.tex`

---

### Appendix C — Final checklist

#### ESPRIM asks

Pre-submission self-audit: structure, scientific quality, form, files to submit.

#### Checklist for this project

**Structure:**

- Front matter complete
- Introduction with 5 objectives + report plan
- Logical chain across chapters
- Conclusion answers objectives
- `config.tex` personalized (warnitem)

**Scientific:**

- Comparison tables Ch.1, Ch.3
- 74 integration tests documented
- Limitations discussed
- 31 references in IEEE style

**Form:**

- Figures numbered and referenced
- `\showguidefalse` for submission
- Similarity check `< 15%`
- AI declaration in Appendix B

**Files to submit:**

- Final PDF (`main.pdf`)
- LaTeX source (`doc/pfe-report/`)
- Similarity report
- Oral defense slides
- Optional: repository link

#### LaTeX source

`doc/pfe-report/annexes/annexC_final_checklist.tex`

---

### Appendix D — Complete system diagrams

#### ESPRIM asks

Full UML catalog for traceability and oral defense. All sequence flows documented.

#### Project knowledge

44 PlantUML diagrams exported to `doc/pfe-report/assets/figures/`. Grouped in `annexD_system_diagrams.tex`:

- Structural (3)
- Authentication (10)
- Document library (9)
- Search/RAG/conversations (6)
- Notifications (3)
- Manager (1)
- Administration (9)
- Operations (1)

Chapters 2–4 reference subsets; appendix is authoritative complete catalog.

#### LaTeX source

`doc/pfe-report/annexes/annexD_system_diagrams.tex`, `annexD_diagram_macros.tex`

---

## 11. Oral defense supplement

### 10-minute narrative arc


| Minute | Content                    | Slide asset                                                           |
| ------ | -------------------------- | --------------------------------------------------------------------- |
| 0–1    | Problem + objectives       | Text only                                                             |
| 1–3    | Architecture + use cases   | `platform-architecture.png`, `global-use-case-knowledge-platform.png` |
| 3–5    | RAG pipeline demo          | `seq-12-ask-rag-sse.png` + live demo                                  |
| 5–7    | Security + RBAC            | `seq-01-login.png`, restrictions table                                |
| 7–8    | Validation results         | Table: 74 tests, RAG eval                                             |
| 8–9    | Difficulties + limitations | CORP fix, API key dependency                                          |
| 9–10   | Conclusion + perspectives  | Objective checklist                                                   |


### Recommended live demo script

1. `npm run dev` (pre-started)
2. Login as seeded admin (`admin@example.com` / seed password from README)
3. Upload a PDF → show READY status
4. Open Ask → submit question → show SSE stream + sources panel
5. Open admin users list → show department access
6. Profile → show avatar (post-CORP fix)

### Top 15 cross-chapter jury questions


| #   | Question                            | Short answer                                                                 |
| --- | ----------------------------------- | ---------------------------------------------------------------------------- |
| 1   | What problem does this solve?       | Fragmented enterprise knowledge; uncited AI; weak dept governance            |
| 2   | What is your contribution?          | Integrated hybrid RAG product with RBAC + tests + eval harness               |
| 3   | Why RAG not fine-tuning?            | Private corpus changes often; RAG cites sources; no GPU training budget      |
| 4   | How does hybrid retrieval work?     | Dense pgvector + FTS → weighted RRF → Gemini rerank                          |
| 5   | How is access enforced in RAG?      | `readableDepartmentIds` filter before retrieval                              |
| 6   | Why Gemini?                         | API simplicity, 768-d embeddings, internship timeline                        |
| 7   | JWT security model?                 | Access in memory; HttpOnly refresh; rotation + family revocation             |
| 8   | Why 404 for private docs?           | Prevent enumeration attacks                                                  |
| 9   | What is BullMQ for?                 | Async ingest — extract, chunk, embed without blocking upload                 |
| 10  | How many tests?                     | 74 integration tests, 10 files, all pass                                     |
| 11  | RAG accuracy?                       | 15/34 topic labels without API key; full judge with key; limitations in Ch.5 |
| 12  | Hardest bug?                        | Avatar CORP cross-origin — fixed with response header                        |
| 13  | Why monorepo?                       | Shared types, faster iteration, single deploy                                |
| 14  | Scalability limits?                 | In-process worker; local disk; no load test — future work                    |
| 15  | Did you use AI to write the report? | Yes — declared in Appendix B; verified all claims against code               |


---

## 12. PNG asset catalog

All exported figures for the LaTeX report live under `doc/pfe-report/assets/figures/`. PlantUML sources are under `docs/diagrams/`. Render command:

```bash
java -jar scripts/plantuml.jar docs/diagrams/**/*.puml
# copies or outputs to doc/pfe-report/assets/figures/
```

### Logo (1 file)


| Filename          | Purpose                          | Used in                   | Source                                                          |
| ----------------- | -------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `logo-esprim.png` | ESPRIM school logo on cover page | `sections/cover.tex` only | `doc/pfe-report/assets/logo-esprim.png` (bundled with template) |


---

### Structural diagrams (3 files)


| Filename                                 | Purpose                                                                                                                                                 | Used in                                                               | PlantUML source                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `platform-architecture.png`              | Overall three-tier architecture: Next.js web, Express API routers, PostgreSQL/pgvector, Redis/BullMQ worker, Gemini AI, local disk storage              | Chapter 3 (`fig:architecture`), Appendix D (`fig:annex-architecture`) | `docs/diagrams/architecture/platform-architecture.puml` |
| `global-use-case-knowledge-platform.png` | UML use-case diagram: Employee, Manager, Administrator actors and all major platform use cases (documents, search, Ask, admin, notifications)           | Chapter 2 (`fig:use-cases`), Appendix D (`fig:annex-use-case`)        | `docs/diagrams/use-case/global-use-case-diagram.puml`   |
| `global-class-knowledge-platform.png`    | Domain class diagram: Prisma entities (User, Department, Document, DocumentVersion, Chunk, Conversation, Message, Notification, etc.) and relationships | Chapter 3 (`fig:class-diagram`), Appendix D (`fig:annex-class`)       | `docs/diagrams/class/global-class-diagram.puml`         |


---

### Sequence diagrams — Authentication and account (10 files)


| Filename                          | Purpose                                                                                                      | API / flow                                                | Used in                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| `seq-01-login.png`                | User login: validation, bcrypt, lockout, `issueSessionTokens`, HttpOnly `kp_rt` cookie, JSON access token    | `POST /auth/login`                                        | Appendix D (`fig:seq-01`); referenced Ch.2 |
| `seq-02-refresh-token.png`        | Access token refresh: cookie read, session rotation, replay/family revocation, `authVersion` check           | `POST /auth/refresh`                                      | Appendix D (`fig:seq-02`); referenced Ch.2 |
| `seq-03-logout.png`               | User logout: revoke refresh session, clear cookie                                                            | `POST /auth/logout`                                       | Appendix D (`fig:seq-03`)                  |
| `seq-04-password-reset.png`       | Forgot password + reset password flow with token email                                                       | `POST /auth/forgot-password`, `POST /auth/reset-password` | Appendix D (`fig:seq-04`)                  |
| `seq-05-change-password.png`      | Change password: revoke all sessions, issue new tokens, `authVersion` bump                                   | `POST /auth/change-password`                              | Appendix D (`fig:seq-05`)                  |
| `seq-06-profile-update.png`       | Profile update: name, email, phone, avatar URL rules; optional email change triggers token rotation          | `PATCH /auth/profile`                                     | Appendix D (`fig:seq-06`)                  |
| `seq-07-feature-restriction.png`  | Feature restriction middleware: `requireDocLibraryAccess` / `requireUseAiQueries` → 403 `FEATURE_RESTRICTED` | Middleware gates                                          | Appendix D (`fig:seq-07`); Ch.4 security   |
| `seq-23-get-auth-me.png`          | Current user session payload: JWT verify, user + departments returned                                        | `GET /auth/me`                                            | Appendix D (`fig:seq-23`)                  |
| `seq-32-register-info-static.png` | Next.js register page: static "no self-registration" informational page                                      | `GET /register` (web)                                     | Appendix D (`fig:seq-32`)                  |
| `seq-33-restricted-page-ux.png`   | Restricted feature explanation page when user lacks permission; complements API 403 in seq-07                | `/restricted` (web)                                       | Appendix D (`fig:seq-33`)                  |


---

### Sequence diagrams — Document library and ingest (9 files)


| Filename                             | Purpose                                                                                                                       | API / flow                                    | Used in                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| `seq-08-document-upload.png`         | Document upload: MIME validation, disk storage, Prisma transaction, `enqueueDocumentIngest`, optional `notifyDocumentCreated` | `POST /documents/upload`                      | Appendix D (`fig:seq-08`); Ch.4 ingest     |
| `seq-09-document-ingest-worker.png`  | BullMQ worker `processIngest`: text extraction, chunking, embedding, persist Chunk rows with vectors                          | BullMQ consumer                               | Appendix D (`fig:seq-09`); referenced Ch.2 |
| `seq-10-document-read-download.png`  | Document file download: `canReadDocument` check, stream file bytes                                                            | `GET /documents/:id/versions/:versionId/file` | Appendix D (`fig:seq-10`)                  |
| `seq-24-documents-list.png`          | Document list: auth, doc-library gate, `listDocuments` with dept scope and total count                                        | `GET /documents`                              | Appendix D (`fig:seq-24`)                  |
| `seq-25-document-detail.png`         | Document detail JSON with access check and version metadata                                                                   | `GET /documents/:id`                          | Appendix D (`fig:seq-25`)                  |
| `seq-26-favorites-recents.png`       | Favorite add/remove and recent view tracking with audit side effects                                                          | `POST/DELETE` favorite, `POST` recent         | Appendix D (`fig:seq-26`)                  |
| `seq-27-patch-document-metadata.png` | Document metadata update: tags, visibility, archive; manage permission required                                               | `PATCH /documents/:id`                        | Appendix D (`fig:seq-27`)                  |
| `seq-28-document-new-version.png`    | New document version: upload file, create version row, enqueue ingest                                                         | `POST /documents/:id/versions`                | Appendix D (`fig:seq-28`)                  |
| `seq-29-document-reprocess.png`      | Reprocess document version: reset chunks, re-enqueue ingest job                                                               | `POST .../versions/:versionId/reprocess`      | Appendix D (`fig:seq-29`)                  |


---

### Sequence diagrams — Search, RAG, and conversations (6 files)


| Filename                                   | Purpose                                                                                                                           | API / flow                              | Used in                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `seq-11-semantic-search.png`               | Semantic vector search: embed query, `vectorSearch` with dept filters, return ranked chunks                                       | `POST /search/semantic`                 | Appendix D (`fig:seq-11`)                             |
| `seq-12-ask-rag-sse.png`                   | **Core RAG flow:** query optimize → hybrid retrieval → RRF → rerank → SSE stream (`sources`, `token`, `done`) → optional critique | `POST /search/ask`                      | Appendix D (`fig:seq-12`); **oral defense key slide** |
| `seq-13-conversation-and-messages.png`     | Conversation create/list and message append (representative thread flow)                                                          | `/conversations/`*                      | Appendix D (`fig:seq-13`)                             |
| `seq-14-answer-feedback.png`               | Thumbs up/down and optional comment on assistant message                                                                          | `POST .../messages/:messageId/feedback` | Appendix D (`fig:seq-14`)                             |
| `seq-30-conversations-crud-supplement.png` | Conversation list, get by id, patch title, delete — supplements seq-13                                                            | `/conversations` CRUD                   | Appendix D (`fig:seq-30`)                             |
| `seq-31-admin-feedback-stats.png`          | Admin aggregate statistics on answer feedback                                                                                     | `GET /conversations/feedback/stats`     | Appendix D (`fig:seq-31`)                             |


---

### Sequence diagrams — Notifications (3 files)


| Filename                              | Purpose                                                                                                         | API / flow                 | Used in                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------- |
| `seq-15-notification-automatic.png`   | Automatic notification on document creation: `notifyDocumentCreated` → `createNotification` → recipient fan-out | Internal after upload      | Appendix D (`fig:seq-15`) |
| `seq-16-notification-manual-send.png` | Manual admin announcement: multipart form, target selection, attachment, fan-out                                | `POST /notifications/send` | Appendix D (`fig:seq-16`) |
| `seq-17-notification-inbox.png`       | Notification inbox: paginated list, unread count, mark read, attachment download                                | `/notifications` read APIs | Appendix D (`fig:seq-17`) |


---

### Sequence diagrams — Manager dashboard (1 file)


| Filename                       | Purpose                                                                                  | API / flow                                            | Used in                   |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------- |
| `seq-18-manager-dashboard.png` | Manager department overview: list manageable departments, department detail with members | `GET /manager/departments`, `GET /manager/department` | Appendix D (`fig:seq-18`) |


---

### Sequence diagrams — Administration (9 files)


| Filename                                    | Purpose                                                              | API / flow                                   | Used in                   |
| ------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------- |
| `seq-19-admin-user-create.png`              | Admin creates user with role, departments, initial password          | `POST /admin/users`                          | Appendix D (`fig:seq-19`) |
| `seq-20-admin-department-merge.png`         | Admin merges two departments: reassign users, documents, access rows | `POST /admin/departments/merge`              | Appendix D (`fig:seq-20`) |
| `seq-21-admin-department-access-bulk.png`   | Bulk replace user department access records                          | `PUT /admin/users/:userId/department-access` | Appendix D (`fig:seq-21`) |
| `seq-34-admin-department-create.png`        | Admin creates new department in hierarchy                            | `POST /admin/departments`                    | Appendix D (`fig:seq-34`) |
| `seq-35-dept-access-single-post-delete.png` | Grant or revoke single `UserDepartmentAccess` row for a user         | `POST/DELETE` dept access                    | Appendix D (`fig:seq-35`) |
| `seq-36-admin-stats.png`                    | Admin KPI statistics and time-series aggregates                      | `GET /admin/stats`                           | Appendix D (`fig:seq-36`) |
| `seq-37-admin-activity-export.png`          | Admin activity log listing and CSV export stream                     | `GET /admin/activity`                        | Appendix D (`fig:seq-37`) |
| `seq-38-admin-document-audit.png`           | Document audit trail view and export                                 | `GET /admin/document-audit`                  | Appendix D (`fig:seq-38`) |
| `seq-39-admin-documents-csv-export.png`     | Export full document list as CSV (formula-injection escaped)         | `GET /documents/export`                      | Appendix D (`fig:seq-39`) |
| `seq-40-admin-bulk-delete-documents.png`    | Bulk delete documents: transactional DB delete + storage cleanup     | `POST /documents/bulk-delete`                | Appendix D (`fig:seq-40`) |
| `seq-41-admin-user-patch-lock.png`          | Admin patch user fields and lock/unlock account                      | `PATCH /admin/users/:id`, `POST .../lock`    | Appendix D (`fig:seq-41`) |


---

### Sequence diagrams — Operations and health (1 file)


| Filename                  | Purpose                                                  | API / flow    | Used in                                |
| ------------------------- | -------------------------------------------------------- | ------------- | -------------------------------------- |
| `seq-22-health-check.png` | API health probe: database and Redis connectivity status | `GET /health` | Appendix D (`fig:seq-22`); Ch.5 NFR-01 |


---

### Asset summary


| Category      | Count  | PNG path                                                                                                                                   |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Logo          | 1      | `doc/pfe-report/assets/logo-esprim.png`                                                                                                    |
| Structural    | 3      | `doc/pfe-report/assets/figures/platform-architecture.png`, `global-use-case-knowledge-platform.png`, `global-class-knowledge-platform.png` |
| Sprint UC     | 5      | `doc/pfe-report/assets/figures/sprint-{1..5}-use-case-knowledge-platform.png`                                                              |
| Sequence      | 41     | `doc/pfe-report/assets/figures/seq-01-login.png` … `seq-41-admin-user-patch-lock.png`                                                      |
| **Total PNG** | **49** |                                                                                                                                            |


### Chapter-to-figure quick reference


| Report chapter       | Embed in body                                                      | Reference appendix only                     |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| General introduction | —                                                                  | —                                           |
| Chapter 1            | —                                                                  | —                                           |
| Chapter 2            | `global-use-case-knowledge-platform.png` (§2.1.3 after actors)     | —                                           |
| Chapter 3            | `platform-architecture.png`, `global-class-knowledge-platform.png`, 5 sprint UC + 41 sequence diagrams | —                                           |
| Chapter 4            | — (sprint-aligned implementation + `tab:seq-index`)                | —                                           |
| Chapter 5            | `tab:kpi-results` (KPI → measured outcome)                        | —                                           |
| Appendix D           | 3 structural figures (defense copy) + `tab:annex-seq-index`        | Sequence figures canonical in Ch.3          |


---

## Appendix: Requirements-to-chapter cross-index

Quick lookup: where each requirement is introduced, designed, implemented, and validated.


| Req    | Ch.2 specify | Ch.3 design      | Ch.4 implement             | Ch.5 validate           | Diagram              |
| ------ | ------------ | ---------------- | -------------------------- | ----------------------- | -------------------- |
| FR-01  | ✓            | auth subsystem   | `auth.ts`, `authClient.ts` | auth tests (11)         | seq-01, seq-02       |
| FR-02  | ✓            | avatar route     | `avatarsPublic.ts`         | avatars test (1)        | seq-06               |
| FR-03  | ✓            | ingest queue     | BullMQ worker              | documents tests (14)    | seq-08, seq-09       |
| FR-04  | ✓            | visibility model | `canReadDocument`          | documents tests         | seq-25               |
| FR-05  | ✓            | metadata         | `documents.ts`             | documents tests         | seq-26, seq-27       |
| FR-06  | ✓            | pgvector         | `search.ts`                | search tests            | seq-11               |
| FR-07  | ✓            | hybrid RAG       | `ragCompletion.ts`         | search tests + manual   | seq-12               |
| FR-08  | ✓            | conversations    | `conversations.ts`         | conversations tests     | seq-13, seq-14       |
| FR-09  | ✓            | notifications    | `notifications.ts`         | notifications tests (8) | seq-15–17            |
| FR-10  | ✓            | admin RBAC       | `admin.ts`                 | admin tests (18)        | seq-19–21, seq-34–41 |
| FR-11  | ✓            | manager scope    | `manager.ts`               | manager tests           | seq-18               |
| FR-12  | ✓            | restrictions     | middleware                 | auth + search tests     | seq-07, seq-33       |
| NFR-01 | ✓            | health route     | `httpApp.ts`               | health tests (3)        | seq-22               |
| NFR-02 | ✓            | Helmet, limiters | `httpApp.ts`               | integration + review    | —                    |
| NFR-03 | ✓            | single-flight    | `authClient.ts`            | auth tests              | seq-02               |
| NFR-04 | ✓            | Docker           | `docker-compose.yml`       | manual deploy           | —                    |
| NFR-05 | ✓            | Vitest           | `*.integration.test.ts`    | 74 pass                 | —                    |
| NFR-06 | ✓            | eval CLI         | `ragEvaluation.ts`         | eval:rag:quick          | —                    |


---

*Document version: aligned with Knowledge Platform repository state, July 2026. LaTeX sources: `doc/pfe-report/`.*