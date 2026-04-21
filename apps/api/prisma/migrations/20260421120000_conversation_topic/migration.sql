-- Add optional topic column to Conversation. Populated by /search/ask via the
-- queryOptimizer so feedbackMemory can boost/penalise past mistakes by topic.
ALTER TABLE "Conversation" ADD COLUMN "topic" TEXT;
