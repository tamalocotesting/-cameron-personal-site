/*
  Warnings:

  - You are about to drop the `passkey` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "passkey" DROP CONSTRAINT "passkey_userId_fkey";

-- AlterTable
ALTER TABLE "member" ALTER COLUMN "displayName" SET DEFAULT '';

-- DropTable
DROP TABLE "passkey";
