import { PRICING } from '@/lib/pricing';

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

const p = PRICING;

export const DRIVER_FAQ: readonly FaqItem[] = [
  {
    question: 'Can I park a two-wheeler?',
    answer:
      'Yes. Owners list car and two-wheeler slots separately, each with its own price, so you only see spaces that fit what you drive.',
  },
  {
    question: 'What do I actually pay?',
    answer: `The owner’s hourly price, plus ${String(p.gstPercent)}% GST on the ParkEase fee. Two hours at ₹${String(p.example.hourly)} comes to ₹${p.example.driverTotal.toFixed(2)}. There is no platform fee for drivers, and every line is shown before you pay.`,
  },
  {
    question: 'Why does the price go up at some times?',
    answer:
      'When most spaces in an area are taken, a busy-hour charge can be added on top of the owner’s price. You see it on the map and in the breakdown before you book, and the price you book at is the price you pay.',
  },
  {
    question: 'What if I need to cancel?',
    answer: `Cancel before your start time and you get everything back except a ₹${String(p.refunds.processingFee)} processing fee. Cancel within the first ${String(p.refunds.graceMinutes)} minutes and you get ${String(p.refunds.gracePercent)}% back. After that there is no refund, because the slot was held for you.`,
  },
  {
    question: 'What if the owner cancels on me?',
    answer: `You get a full refund at any hour, plus ₹${String(p.refunds.ownerCancelGoodwill)} from ParkEase. It never comes out of anyone else’s money.`,
  },
  {
    question: 'How do I know a space is any good?',
    answer:
      'Every space has photos, a star rating and reviews. Only drivers who finished a booking there can leave a review.',
  },
];

export const OWNER_FAQ: readonly FaqItem[] = [
  {
    question: 'What can I list?',
    answer:
      'Any space a car or two-wheeler can park in that you have the right to rent out: a house driveway, spare bays in your apartment building, a shop forecourt after hours, or a private lot.',
  },
  {
    question: 'How much does ParkEase keep?',
    answer: `${String(p.commissionPercent)}% of your base price, once, and nothing else. Listing is free. The first ${String(p.waiverSlots)} owners pay no commission for their first ${String(p.waiverMonths)} months.`,
  },
  {
    question: 'When do I get paid?',
    answer: `Every Monday, to the bank account you connected through Razorpay, once your balance is at least ₹${String(p.minimumPayout)}.`,
  },
  {
    question: 'Do busy-hour charges change what I earn?',
    answer:
      'No. Busy-hour charges are added on top for the driver. You always earn your own price, less the commission.',
  },
  {
    question: 'What if I have to cancel a booking?',
    answer: `The driver gets a full refund and ₹${String(p.refunds.ownerCancelGoodwill)} from ParkEase. None of it is taken from your earnings.`,
  },
];

export const ALL_FAQ: readonly FaqItem[] = [...DRIVER_FAQ, ...OWNER_FAQ];
