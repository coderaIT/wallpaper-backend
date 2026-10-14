import { Prisma } from '../../generated/prisma/client';

type LockClient = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

/** Locks wallpaper rows in id order so category assignment and exclusive deletion cannot interleave. */
export async function lockWallpaperRows(tx: Prisma.TransactionClient | LockClient, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  await tx.$queryRaw`SELECT id FROM wallpapers WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
}
