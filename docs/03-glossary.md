# 03 - Glossary (Plain Language)

## Healthcare & Policy Terms
- Payer: Insurance company or government program that pays medical bills.
- Provider: Doctor, clinic, or hospital delivering care.
- Benefit: Type of coverage in a plan (for example medical or pharmacy).
- Medical benefit drug: Drug billed through medical claims, often given in clinic (for example infusion drugs).
- Pharmacy benefit drug: Drug dispensed through pharmacy channels.
- Formulary: Plan's approved list of drugs.
- Prior authorization (PA): Pre-approval required by payer before a service/drug is paid.
- Step therapy: "Try drug A first, then drug B" rule.
- Quantity limit: Max amount covered per period.
- Exclusion: What is not covered.
- Coverage criteria: Conditions that must be met for approval.
- Effective date: Date when a policy version starts.

## Product & AI Terms
- Ingestion: Pulling documents into the system.
- Parsing: Converting document files into structured text blocks.
- Normalization: Converting many policy writing styles into one standard format.
- Schema: The field structure we store (for example `drug_name`, `coverage_status`).
- RAG (Retrieval-Augmented Generation): AI method that finds relevant source text first, then answers.
- Embedding: Numeric representation of text meaning.
- Vector database: Database optimized for embedding-based meaning search.
- Hybrid retrieval: Combining keyword search and vector search in one query flow.
- Metadata filter: Restricting retrieval by fields like payer, plan, and policy version.
- Citation: Reference showing exactly where an answer came from.
- Hallucination: AI output that sounds correct but is unsupported or wrong.
- Confidence score: Model certainty estimate; not a legal guarantee.

## Voice Terms
- STT (Speech-to-Text): Converts spoken words into text.
- TTS (Text-to-Speech): Converts text response into spoken audio.
- Turn: One user utterance plus one assistant response.
- Escalation: Hand-off to human support when uncertainty/risk is high.

## Engineering Terms
- API: Interface for one system to request data/actions from another.
- Endpoint: A specific API URL path.
- Queue: Background task line for jobs like document processing.
- Idempotent: Running same request multiple times does not create duplicates.
- Diff: Comparison showing what changed between two versions.
- Qdrant: Vector database used to store and search policy text embeddings.
