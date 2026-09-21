import { ConsentPurpose, IntakePathway, QuestionType } from '@prisma/client';

/**
 * The published question set the demo organizations start with.
 *
 * Deliberate choices visible here:
 *   * The greeting says this is an automated intake assistant, that a
 *     recruiter will read the answers, and that a human callback can be asked
 *     for without finishing anything.
 *   * The CALLBACK pathway asks for the minimum that makes a callback
 *     possible: a way to reach you, when you are free, and permission to CALL.
 *     Consent to SMS is a separate, optional question and is never a condition
 *     of asking for a phone call.
 *   * Almost everything on the fuller pathway is optional and offers
 *     "Not sure" / "Prefer to discuss with a recruiter".
 *   * There is no citizenship question. Enabling one requires the
 *     organization's own setting AND a new approved version.
 *   * Nothing asks for an SSN, an exact date of birth, a government
 *     identifier, a document, or a medical or legal history.
 */
export const GREETING = [
  'Hi — this is an automated intake assistant for this recruiting office, not a recruiter.',
  '',
  'I can take down a few details so a recruiter has them before they talk to you. A recruiter reads',
  'everything you write here, and they make every decision.',
  '',
  'You can ask for a person at any point, and you can ask for a callback without answering any of the',
  'questions. Nothing you type is used to decide anything about you.',
].join('\n');

export const COMPLETION_TEXT = [
  'Thanks — that is everything I needed.',
  '',
  'What happens next: a recruiter in this office picks this up, reads what you shared, and contacts you',
  'on the channel you chose. If you gave us a time window, they will aim for it.',
].join('\n');

export const HANDOFF_TEXT = [
  'Thanks for telling us. That is something to go over with a recruiter rather than here, so I have',
  'stopped the questions and passed it to the recruiter for this area.',
  '',
  'They will pick it up from here. You do not need to add anything else right now.',
].join('\n');

type SeedQuestion = {
  key: string;
  order: number;
  pathway: IntakePathway;
  type: QuestionType;
  prompt: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  consentPurpose?: ConsentPurpose;
  disclosureKey?: string;
  disclosureText?: string;
};

export const QUESTIONS: SeedQuestion[] = [
  // --- Callback pathway: the minimum that makes a callback possible --------
  {
    key: 'full_name',
    order: 0,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.SHORT_TEXT,
    prompt: 'What name should the recruiter ask for?',
    required: true,
    helpText: 'First name is fine.',
  },
  {
    key: 'phone',
    order: 1,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.PHONE,
    prompt: 'What number should they call?',
    required: true,
  },
  {
    key: 'contact_preference',
    order: 2,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'How would you rather be contacted?',
    required: true,
    options: ['A phone call', 'A text first, then a call', 'Either is fine'],
  },
  {
    key: 'availability',
    order: 3,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.SHORT_TEXT,
    prompt: 'When are you usually free to talk?',
    required: true,
    helpText: 'For example: weekday evenings after 6, or Saturday mornings.',
  },
  {
    key: 'timezone',
    order: 4,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'Which time zone are you in?',
    required: true,
    options: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'Not sure',
    ],
  },
  {
    key: 'callback_call_consent',
    order: 5,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.CONSENT,
    prompt: 'Is it alright for a recruiter to call you on that number?',
    required: true,
    consentPurpose: ConsentPurpose.CALLBACK_CALL,
    disclosureKey: 'callback_call',
    disclosureText:
      'We will call you at the number you gave us so a recruiter can talk with you. Asking for a call does not sign you up for text messages.',
  },
  {
    key: 'callback_sms_consent',
    order: 6,
    pathway: IntakePathway.CALLBACK_REQUEST,
    type: QuestionType.CONSENT,
    // Optional, and separate. Saying no here does not affect the callback.
    prompt: 'Separately — would you like text messages as well? This is optional.',
    required: false,
    consentPurpose: ConsentPurpose.RECRUITER_SMS,
    disclosureKey: 'recruiter_sms',
    disclosureText:
      'You can choose to exchange text messages with a recruiter. Message and data rates may apply. Reply STOP at any time to stop texts, or HELP for help. Saying no here does not affect your callback.',
  },

  // --- Fuller intake ------------------------------------------------------
  {
    key: 'full_name',
    order: 0,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SHORT_TEXT,
    prompt: 'What name should the recruiter ask for?',
    required: true,
  },
  {
    key: 'phone',
    order: 1,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.PHONE,
    prompt: 'What is the best phone number for you?',
    required: true,
  },
  {
    key: 'email',
    order: 2,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.EMAIL,
    prompt: 'An email address, if you use one.',
    required: false,
  },
  {
    key: 'general_location',
    order: 3,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SHORT_TEXT,
    prompt: 'Which town or area are you in?',
    helpText: 'Town or area is enough — we do not need a street address.',
    required: false,
  },
  {
    key: 'timezone',
    order: 4,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'Which time zone are you in?',
    required: false,
    options: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'Not sure',
    ],
  },
  {
    key: 'contact_preference',
    order: 5,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'How would you rather be contacted?',
    required: true,
    options: ['A phone call', 'A text first, then a call', 'Email', 'Either is fine'],
  },
  {
    key: 'availability',
    order: 6,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SHORT_TEXT,
    prompt: 'When are you usually free to talk?',
    required: false,
  },
  {
    key: 'interest_area',
    order: 7,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.MULTI_SELECT,
    prompt: 'Is there anything in particular you are interested in?',
    required: false,
    options: [
      'Mechanical or technical work',
      'Medical or healthcare',
      'Computers, cyber or intelligence',
      'Aviation',
      'Logistics or supply',
      'Law enforcement or security',
      'Not sure yet',
      'Prefer to discuss with a recruiter',
    ],
  },
  {
    key: 'timeline',
    order: 8,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'Roughly what timeframe do you have in mind?',
    required: false,
    options: [
      'As soon as possible',
      'Within 3 months',
      'Within 6 to 12 months',
      'More than a year out',
      'Not sure',
      'Prefer to discuss with a recruiter',
    ],
  },
  {
    key: 'education_status',
    order: 9,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'Where are you with school right now?',
    required: false,
    options: [
      'Still in high school',
      'Finished high school or equivalent',
      'Some college',
      'College degree',
      'Prefer to discuss with a recruiter',
    ],
  },
  {
    key: 'asvab_status',
    order: 10,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.SINGLE_SELECT,
    prompt: 'Have you taken the ASVAB?',
    required: false,
    options: ['Yes', 'No', 'Not sure', 'Prefer to discuss with a recruiter'],
  },
  {
    key: 'anything_else',
    order: 11,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.LONG_TEXT,
    prompt: 'Anything else you want the recruiter to know before they call?',
    required: false,
    helpText: 'Optional. If it is a medical, legal or eligibility question, a recruiter will handle it directly.',
  },
  {
    key: 'intake_sms_consent',
    order: 12,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.CONSENT,
    prompt: 'May we text you a link if you need to come back to this?',
    required: false,
    consentPurpose: ConsentPurpose.INTAKE_SMS,
    disclosureKey: 'intake_sms',
    disclosureText:
      'You can choose to get a text with a link to finish these questions. Message and data rates may apply. Reply STOP at any time to stop texts. This is optional — you can ask for a phone call instead.',
  },
  {
    key: 'recruiter_sms_consent',
    order: 13,
    pathway: IntakePathway.FULL_INTAKE,
    type: QuestionType.CONSENT,
    prompt: 'May a recruiter text you directly?',
    required: false,
    consentPurpose: ConsentPurpose.RECRUITER_SMS,
    disclosureKey: 'recruiter_sms',
    disclosureText:
      'You can choose to exchange text messages with a recruiter. Message and data rates may apply. Reply STOP at any time to stop texts, or HELP for help.',
  },
];

/**
 * The three automatable templates. None of them promises a response time, a
 * job, a waiver, a benefit or an eligibility outcome.
 */
export const TEMPLATES = [
  {
    key: 'acknowledgment',
    kind: 'ACKNOWLEDGMENT' as const,
    name: 'Inquiry acknowledgment',
    automatable: true,
    body:
      'Hi {{first_name}} — this is an automated message from the recruiting office confirming we have your ' +
      'details. A recruiter will read them and get in touch. Reply STOP to stop texts.',
    placeholders: [],
  },
  {
    key: 'intake_invitation',
    kind: 'INTAKE_INVITATION' as const,
    name: 'Intake invitation with a secure link',
    automatable: true,
    body:
      'Hi {{first_name}} — here is your private link to finish the questions for the recruiting office: ' +
      '{{link}} It works for 72 hours. Reply STOP to stop texts.',
    placeholders: ['link'],
  },
  {
    key: 'appointment_reminder',
    kind: 'APPOINTMENT_REMINDER' as const,
    name: 'Appointment reminder',
    automatable: true,
    body:
      'Hi {{first_name}} — a reminder of your appointment with the recruiting office on {{when}}. ' +
      'Reply STOP to stop texts.',
    placeholders: ['when'],
  },
  {
    key: 'missed_call_reply',
    kind: 'MISSED_CALL_REPLY' as const,
    name: 'Reply to a call nobody answered',
    automatable: true,
    // Says what it is, why it arrived, what it is offering and how to stop —
    // in that order, because that is the order a person reads a text from a
    // number they do not recognise.
    body:
      'You just called the recruiting office and we could not pick up — sorry about that. ' +
      'A recruiter will call you back. If it is easier, I can take a few details by text now so they ' +
      'have them before they ring. This is an automated assistant, not the recruiter. ' +
      'Reply GO to answer a few questions, CALL if you would rather just wait for the call, ' +
      'or STOP to stop texts.',
    placeholders: [],
  },
  {
    key: 'intake_sms_prompt',
    kind: 'INTAKE_SMS_PROMPT' as const,
    name: 'One scripted intake question, by text',
    automatable: true,
    // A single placeholder on purpose: the words come from the published,
    // immutable intake version. The template keeps these messages on the same
    // approval, allowlist and idempotency path as every other automated send.
    body: '{{text}}',
    placeholders: ['text'],
  },
  {
    key: 'recruiter_followup',
    kind: 'RECRUITER_MANUAL' as const,
    name: 'Recruiter follow-up (approval required)',
    automatable: false,
    body: 'Hi {{first_name}}, this is {{recruiter}} from the recruiting office. {{message}}',
    placeholders: ['recruiter', 'message'],
  },
];
