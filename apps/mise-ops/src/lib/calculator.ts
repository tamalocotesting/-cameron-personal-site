/**
 * The operations calculator's arithmetic, in one place so the server-rendered
 * defaults and the client-side updates can never disagree.
 *
 * It models what the current way of working consumes. It models no saving,
 * because MISE OPS has no customer results to derive one from.
 */

/** Roughly two shifts a day. Stated on the page, not hidden in here. */
export const SHIFTS_PER_MONTH = 60;

export interface CalcInput {
  locations: number;
  employees: number;
  newHires: number;
  trainingHours: number;
  managerRate: number;
  questionsPerShift: number;
  minutesPerQuestion: number;
}

export const defaults: CalcInput = {
  locations: 1,
  employees: 22,
  newHires: 3,
  trainingHours: 6,
  managerRate: 28,
  questionsPerShift: 12,
  minutesPerQuestion: 4,
};

export interface CalcResult {
  questionHours: number;
  onboardingHours: number;
  totalHours: number;
  perEmployee: number;
  monthlyCost: number;
  annualCost: number;
}

export function compute(v: CalcInput): CalcResult {
  const questionHours =
    ((v.questionsPerShift * v.minutesPerQuestion) / 60) * SHIFTS_PER_MONTH * v.locations;
  const onboardingHours = v.newHires * v.trainingHours * v.locations;
  const totalHours = questionHours + onboardingHours;
  const staff = Math.max(1, v.employees * v.locations);
  const monthlyCost = totalHours * v.managerRate;

  return {
    questionHours,
    onboardingHours,
    totalHours,
    perEmployee: totalHours / staff,
    monthlyCost,
    annualCost: monthlyCost * 12,
  };
}

export const money = (n: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(n));

export const hours = (n: number): string => {
  const rounded = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${new Intl.NumberFormat('en-US').format(rounded)} h`;
};
