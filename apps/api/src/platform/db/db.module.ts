import { Global, Module } from '@nestjs/common';
import { db, type Database } from '@parkease/db';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{ provide: DB, useValue: db }],
  exports: [DB],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DbModule {}

export type { Database };
