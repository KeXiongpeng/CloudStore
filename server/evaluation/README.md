# RAG Evaluation

## Frozen corpus

`corpus/` contains eight immutable Markdown fixtures. Upload all eight once to the dedicated Workspace A. Do not edit corpus files after the baseline upload.

Expected Workspace A titles:

1. 01-hnsw.md
2. 02-pgvector.md
3. 03-cosine-distance.md
4. 04-embedding.md
5. 05-upload-index.md
6. 06-markdown-chunking.md
7. 07-sse-chat.md
8. 08-stategraph-rag.md

Workspace B must be an active workspace with zero knowledge-base documents.

## Commands

```powershell
cd server
npm run rag:evaluate -- `
  --label rag-baseline `
  --workspace-a <WORKSPACE_A_ID> `
  --workspace-b <WORKSPACE_B_ID> `
  --case-delay-ms 1000 `
  --backend-tests "122 passed" `
  --frontend-tests "28 passed"
```

The runner preflight fails unless Workspace A has exactly and only those eight documents, all indexed with content hashes matching the frozen corpus, and Workspace B has zero documents. Editing a corpus file after upload therefore fails future preflight until you deliberately create and label a new eval version.

Reports are written to `evaluation/reports/` as JSON and Markdown. Never put API keys in reports or CLI arguments.
