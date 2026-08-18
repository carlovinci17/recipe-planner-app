-- Module 12 / Lesson 12.1 — activate semantic search on recipes.embedding.
-- Run after backfilling embeddings (scripts/backfill-embeddings.ts --apply).
-- HNSW + cosine: good recall, fast, no training step (unlike ivfflat).
create index if not exists recipes_embedding_hnsw on recipes using hnsw (embedding vector_cosine_ops);
