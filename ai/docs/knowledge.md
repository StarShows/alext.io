# Portfolio knowledge and recruiting quality

`knowledge/portfolio.json` is the versioned source of answer evidence. It contains 14 small public facts covering full-stack delivery, React/Node/Python/cloud, healthcare integrations, reliability tooling, AI/MCP approach, public projects and contact. Sources were checked against the current public site and an authorized October resume; private resume content, internal employer systems, medical/personal information and unsupported outcome metrics were not copied into the repository.

`owner-published` means Alex's own professional description, not independent employer verification. `code-inspected` identifies a statement actually supported by public repository code. The assistant must not conflate an explanation, a demonstration, a public commercial website and an independently verified production accomplishment.

## Updating facts

Edit the curated JSON on a reviewed branch. Each fact needs a stable ID, bounded text, search tags, a public source label/link and provenance. Do not ingest arbitrary webpages at runtime. Keep claims specific enough that their source can actually support them. Update the review date and source revision, run validation/retrieval tests, and run the real-model evaluation after substantive changes. No model retraining or vector database is required.

Resume variants disagree on summary durations, and no single approved current download was established. Accordingly `resume` and `booking` are null, the widget does not advertise either, and exact years/certifications/metrics are not fabricated. Before adding a download, verify its bytes, date, authorization, accessibility, URL and consistency with the knowledge base. Before adding scheduling, verify the actual booking mechanism and never report a booking without confirmation from that system.

## Retrieval

A small BM25-style index scores fact text and tags with a limited synonym dictionary. Contextual follow-ups may use the previous question. The system retrieves at most six facts and reduces context if needed. A vector store is not justified for this collection. Evaluate recall and false matches before adding embeddings; any embeddings would also run locally.

The model selects fact IDs for evidence blocks. The server checks those IDs against the retrieved subset and inserts the exact approved text and citations. Invented IDs, generated factual wording and unapproved URLs fail validation. The semantic scope classifier runs before generation and rejects unrelated requests even when they contain engineering keywords.

## Answer review

For recruiter questions, check concrete experience, relevant source links and honest gaps. For managers, check technically correct tradeoffs and debugging reasoning. For leadership, check a bounded use case, measurable baseline, feasibility, permissions, human review and operational ownership.

Suggested first-90-day work is conditional: understand workflows and constraints, identify one valuable use case, validate with a small pilot, measure results, then harden only what proves useful. It is not a guaranteed delivery schedule or a claim of prior work.

`knowledge/evaluation.json` has 56 cases spanning recruiting, projects, technical approaches, follow-ups, unrelated requests, adversarial instructions, invented achievements, confidential information and contact. `scripts/evaluate.mjs` evaluates the actual local model and writes deterministic assertions plus full synthetic evaluation responses. These are test prompts, not visitor logs. Human reviewers still need to score correctness, relevance, honest uncertainty and useful citations. An LLM judge alone is not sufficient.

Suggested release gate: all deterministic evidence/link/security assertions pass, no fabricated personal achievement in the reviewed sample, all high-risk refusal cases pass, and at least 90% of allowed questions receive useful relevant answers. These are proposed acceptance targets, not measured results.
