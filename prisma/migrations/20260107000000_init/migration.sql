-- CreateEnum
CREATE TYPE "CreditTxType" AS ENUM ('FREE', 'EARN_CONTRACT', 'SHARE_DAILY', 'SPEND_GENERATE');

-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "fid" INTEGER NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "pfpUrl" TEXT,
  "primaryWallet" TEXT,
  "credits" INTEGER NOT NULL DEFAULT 0,
  "freeGranted" BOOLEAN NOT NULL DEFAULT false,
  "lastShareAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTx" (
  "id" TEXT NOT NULL,
  "fid" INTEGER NOT NULL,
  "type" "CreditTxType" NOT NULL,
  "delta" INTEGER NOT NULL,
  "txHash" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CreditTx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawPost" (
  "id" TEXT NOT NULL,
  "tweetId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "handle" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "url" TEXT,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "reposts" INTEGER NOT NULL DEFAULT 0,
  "replies" INTEGER NOT NULL DEFAULT 0,
  "views" INTEGER NOT NULL DEFAULT 0,
  "isReply" BOOLEAN NOT NULL DEFAULT false,
  "isRetweet" BOOLEAN NOT NULL DEFAULT false,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RawPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPost" (
  "id" TEXT NOT NULL,
  "rawPostId" TEXT NOT NULL,
  "fid" INTEGER NOT NULL,
  "stylePreset" TEXT NOT NULL,
  "length" TEXT NOT NULL,
  "variantIdx" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "confidence" TEXT NOT NULL,
  "angle" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GeneratedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSub" (
  "id" TEXT NOT NULL,
  "fid" INTEGER NOT NULL,
  "appFid" INTEGER NOT NULL,
  "token" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationSub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_fid_key" ON "User"("fid");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTx_txHash_key" ON "CreditTx"("txHash");

-- CreateIndex
CREATE INDEX "CreditTx_fid_createdAt_idx" ON "CreditTx"("fid", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawPost_tweetId_key" ON "RawPost"("tweetId");

-- CreateIndex
CREATE INDEX "RawPost_timestamp_idx" ON "RawPost"("timestamp");

-- CreateIndex
CREATE INDEX "RawPost_handle_idx" ON "RawPost"("handle");

-- CreateIndex
CREATE INDEX "GeneratedPost_fid_createdAt_idx" ON "GeneratedPost"("fid", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedPost_rawPostId_createdAt_idx" ON "GeneratedPost"("rawPostId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "unique_gen_v1" ON "GeneratedPost"("rawPostId", "fid", "stylePreset", "length", "variantIdx", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSub_fid_appFid_key" ON "NotificationSub"("fid", "appFid");

-- CreateIndex
CREATE INDEX "NotificationSub_enabled_idx" ON "NotificationSub"("enabled");

-- AddForeignKey
ALTER TABLE "CreditTx" ADD CONSTRAINT "CreditTx_fid_fkey" FOREIGN KEY ("fid") REFERENCES "User"("fid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPost" ADD CONSTRAINT "GeneratedPost_fid_fkey" FOREIGN KEY ("fid") REFERENCES "User"("fid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPost" ADD CONSTRAINT "GeneratedPost_rawPostId_fkey" FOREIGN KEY ("rawPostId") REFERENCES "RawPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSub" ADD CONSTRAINT "NotificationSub_fid_fkey" FOREIGN KEY ("fid") REFERENCES "User"("fid") ON DELETE CASCADE ON UPDATE CASCADE;
