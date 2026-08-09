-- Track consecutive INVALID_IMAGE evaluate_submission failures per
-- submission, so the judging sweep can auto-disqualify after a fixed
-- attempt count instead of a time-based window.
ALTER TABLE "Submission" ADD COLUMN "invalidImageAttempts" INTEGER NOT NULL DEFAULT 0;
