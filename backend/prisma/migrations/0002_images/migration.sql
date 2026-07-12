-- CreateTable
CREATE TABLE IF NOT EXISTS "Image" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Image_userId_idx" ON "Image"("userId");
