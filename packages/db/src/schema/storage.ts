import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId, timestamps } from '../columns/common.js';

import { users } from './identity.js';

/**
 * One row per upload signature the API issued (S-50): the id Cloudinary will store it under, who
 * asked, and the folder it was signed into. An attach endpoint accepts an upload id only if it is
 * here and belongs to the caller.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: primaryId(),
    publicId: text('public_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folder: text('folder').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uploads_public_id_key').on(t.publicId),
    index('uploads_user_id_idx').on(t.userId),
    check(
      'uploads_folder_check',
      sql`${t.folder} IN ('spaces', 'documents', 'avatars', 'reviews', 'proofs')`,
    ),
    check(
      'uploads_public_id_in_folder_check',
      sql`${t.publicId} LIKE 'parkease/' || ${t.folder} || '/%'`,
    ),
  ],
);
