import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { UploadFolder } from '@parkease/contracts/shared';
import type { Transaction } from '@parkease/db';
import { uploads } from '@parkease/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module.js';

/**
 * An upload id the caller did not get a signature for: made up, someone else's, or signed into a
 * different folder. One answer for all three, so the response never says whether an id exists.
 */
export class UploadNotRecognisedError extends HttpException {
  constructor() {
    super(
      {
        error: 'UPLOAD_NOT_RECOGNISED',
        message: "That photo didn't upload from this account. Take it again and retry.",
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * The record of every upload signature issued (S-50), and the check every attach endpoint makes
 * against it. `uploadIdIn` in the contracts proves an id is well-formed and in the right folder;
 * only this proves the caller is the one who was given it.
 */
@Injectable()
export class UploadRegistry {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(userId: string, folder: UploadFolder, publicId: string): Promise<void> {
    await this.db.insert(uploads).values({ userId, folder, publicId });
  }

  /**
   * Throws `UploadNotRecognisedError` unless every id was signed for `userId` into `folder`.
   * `alreadyAttached` are ids the caller's record already holds (a space's current photos, a
   * profile's current document): re-sending them is not a new attach, and some predate this
   * registry, so they are not checked again.
   */
  async assertOwned(
    userId: string,
    folder: UploadFolder,
    publicIds: readonly string[],
    options: { readonly alreadyAttached?: Iterable<string>; readonly tx?: Transaction } = {},
  ): Promise<void> {
    const known = new Set(options.alreadyAttached ?? []);
    const fresh = [...new Set(publicIds)].filter((id) => !known.has(id));
    if (fresh.length === 0) return;

    const rows = await (options.tx ?? this.db)
      .select({ publicId: uploads.publicId })
      .from(uploads)
      .where(
        and(
          inArray(uploads.publicId, fresh),
          eq(uploads.userId, userId),
          eq(uploads.folder, folder),
        ),
      );
    if (rows.length !== fresh.length) throw new UploadNotRecognisedError();
  }
}
