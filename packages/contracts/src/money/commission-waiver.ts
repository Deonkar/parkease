/**
 * "Commission-free for the first 50 owners for 3 months" (prd §15 Risk 1, task 16c, ADR-032).
 * The database holds the same 50 in `commission_waivers_slot_check`; this is the number the code
 * and the tests read.
 */
export const COMMISSION_WAIVER_SLOTS = 50;
export const COMMISSION_WAIVER_MONTHS = 3;
