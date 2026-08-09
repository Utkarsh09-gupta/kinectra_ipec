import { QdrantClient } from "@qdrant/js-client-rest";
import { logger } from "./logger";

const url = process.env.QDRANT_URL;
const apiKey = process.env.QDRANT_API_KEY;

if (!url) {
  logger.warn("QDRANT_URL is not configured. Vector search queries will fall back to local mocks or default to localhost:6333.");
}

export const qdrant = new QdrantClient({
  url: url || "http://localhost:6333",
  apiKey: apiKey || undefined,
});
