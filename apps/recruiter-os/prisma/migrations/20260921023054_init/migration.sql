-- CreateEnum
CREATE TYPE "AppModeScope" AS ENUM ('DEMO', 'LIVE');

-- CreateEnum
CREATE TYPE "UnknownTimezonePolicy" AS ENUM ('BLOCK', 'REVIEW');

-- CreateEnum
CREATE TYPE "RoutingStrategy" AS ENUM ('ROUND_ROBIN', 'FALLBACK_ONLY');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('RECRUITER', 'MANAGER', 'ORG_ADMIN');

-- CreateEnum
CREATE TYPE "GrantType" AS ENUM ('CASE_CONTENT', 'TEAM_CONVERSATION_CONTENT', 'REASSIGNMENT', 'EXPORT', 'SENSITIVE_SOURCE', 'TEAM_REPORTS', 'BASELINE_ENTRY', 'RETENTION_ADMIN');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW_INQUIRY', 'INTAKE_IN_PROGRESS', 'READY_FOR_RECRUITER', 'CONTACT_ATTEMPTED', 'TWO_WAY_CONVERSATION', 'APPOINTMENT_SCHEDULED', 'AWAITING_APPLICANT', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseClosureReason" AS ENUM ('APPLICANT_REQUESTED_STOP', 'APPLICANT_WITHDREW', 'UNABLE_TO_REACH', 'REFERRED_ELSEWHERE', 'MERGED_DUPLICATE', 'HANDED_OFF_TO_OFFICIAL_SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('PHONE_CALL', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('CALLBACK_CALL', 'INTAKE_SMS', 'APPOINTMENT_REMINDER_SMS', 'RECRUITER_SMS', 'EMAIL_UPDATES');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'REVOKED', 'SUPPRESSED', 'RESUMED');

-- CreateEnum
CREATE TYPE "DefinitionState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "IntakePathway" AS ENUM ('CALLBACK_REQUEST', 'FULL_INTAKE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_SELECT', 'MULTI_SELECT', 'PHONE', 'EMAIL', 'TIMEZONE', 'CONSENT');

-- CreateEnum
CREATE TYPE "IntakeSessionStatus" AS ENUM ('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'HANDED_OFF', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageAuthorKind" AS ENUM ('APPLICANT', 'RECRUITER', 'APPROVED_AUTOMATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageState" AS ENUM ('RECEIVED', 'DRAFT', 'APPROVED', 'SCHEDULED', 'QUEUED', 'SUBMITTING', 'PROVIDER_ACCEPTED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELED', 'BLOCKED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND_MANUAL', 'FORWARDED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'BUSY', 'FAILED', 'VOICEMAIL', 'CANCELED', 'FORWARD_UNANSWERED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CALLBACK', 'FOLLOW_UP', 'REVIEW_BRIEF', 'REVIEW_SENSITIVE', 'REVIEW_HUMAN_REQUEST', 'LINKING_REVIEW', 'APPOINTMENT_PREP', 'RECONCILE_SEND', 'OTHER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'SNOOZED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskCompletionOutcome" AS ENUM ('SPOKE_WITH_APPLICANT', 'LEFT_VOICEMAIL', 'NO_ANSWER', 'SENT_MESSAGE', 'APPOINTMENT_SET', 'RESOLVED', 'NOT_NEEDED', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentState" AS ENUM ('PROPOSED', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentOutcome" AS ENUM ('ATTENDED', 'NO_SHOW', 'CANCELED_BY_APPLICANT', 'CANCELED_BY_RECRUITER', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "AppointmentMedium" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO');

-- CreateEnum
CREATE TYPE "ReviewFlagKind" AS ENUM ('HUMAN_REQUESTED', 'SENSITIVE_QUESTION', 'LINKING_REVIEW', 'BRIEF_REVIEW', 'SEND_RECONCILIATION', 'DUPLICATE_SUSPECTED', 'MERGE_PERMISSION_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewFlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "BriefState" AS ENUM ('GENERATED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "BriefItemKind" AS ENUM ('INTENT', 'FACT', 'CLARIFICATION', 'SUGGESTION', 'NEXT_ACTION', 'REVIEW_REASON');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('MESSAGE', 'INTAKE_ANSWER', 'NOTE_REVISION', 'CALL_EVENT');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('ACKNOWLEDGMENT', 'INTAKE_INVITATION', 'APPOINTMENT_REMINDER', 'RECRUITER_MANUAL');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('SMS', 'VOICE', 'AI_BRIEF', 'OUTBOUND_WEBHOOK', 'EMAIL');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISABLED', 'DEMO', 'CONFIGURED_UNVERIFIED', 'HEALTHY', 'ERROR');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "HandoffState" AS ENUM ('DRAFT', 'APPROVED', 'EXPORTED', 'TRANSPORT_ACCEPTED', 'TRANSPORT_FAILED', 'EXTERNALLY_CONFIRMED');

-- CreateEnum
CREATE TYPE "MetricEventKind" AS ENUM ('INQUIRY_OPENED', 'ACK_PROVIDER_ACCEPTED', 'ACK_DELIVERED', 'HUMAN_OUTREACH_ATTEMPTED', 'TWO_WAY_HUMAN_CONTACT', 'APPOINTMENT_SCHEDULED', 'APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELED', 'APPOINTMENT_NO_SHOW', 'TASK_COMPLETED_ON_TIME', 'TASK_COMPLETED_LATE', 'BRIEF_REVIEWED', 'BRIEF_CORRECTED', 'CASE_CLOSED', 'CASE_REOPENED');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('SECURITY', 'OPERATIONAL');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "role" TEXT,
    "twoFactorEnabled" BOOLEAN DEFAULT false,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "impersonatedBy" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataScope" "AppModeScope" NOT NULL DEFAULT 'DEMO',

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "quietHoursStartMinute" INTEGER NOT NULL DEFAULT 1260,
    "quietHoursEndMinute" INTEGER NOT NULL DEFAULT 480,
    "unknownTimezonePolicy" "UnknownTimezonePolicy" NOT NULL DEFAULT 'BLOCK',
    "routingStrategy" "RoutingStrategy" NOT NULL DEFAULT 'ROUND_ROBIN',
    "fallbackOwnerMemberId" TEXT,
    "seatLimit" INTEGER NOT NULL DEFAULT 5,
    "intakeApprovalRecordedAt" TIMESTAMP(3),
    "intakeApprovalRecordedBy" TEXT,
    "intakeApprovalNote" TEXT,
    "minimumIntakeAge" INTEGER,
    "youthPolicyNote" TEXT,
    "citizenshipQuestionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiPreparationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiProvider" TEXT NOT NULL DEFAULT 'local-rules',
    "aiApprovedCategories" TEXT[] DEFAULT ARRAY['intake_answers', 'applicant_messages', 'recruiter_messages', 'call_outcomes']::TEXT[],
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_metadata" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "implementationFeeCents" INTEGER,
    "monthlyFeeCents" INTEGER,
    "licensedSeats" INTEGER,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffRole" "StaffRole" NOT NULL DEFAULT 'RECRUITER',
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,
    "staffRole" "StaffRole" NOT NULL DEFAULT 'RECRUITER',
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "managerMemberId" TEXT,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_grant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectMemberId" TEXT NOT NULL,
    "grant" "GrantType" NOT NULL,
    "applicantId" TEXT,
    "teamId" TEXT,
    "grantedByMemberId" TEXT,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "applicantId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "preferredName" TEXT,
    "generalLocation" TEXT,
    "timezone" TEXT,
    "timezoneConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW_INQUIRY',
    "closureReason" "CaseClosureReason",
    "closureNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "ownerMemberId" TEXT,
    "teamId" TEXT,
    "automationPaused" BOOLEAN NOT NULL DEFAULT false,
    "automationPausedReason" TEXT,
    "mergedIntoApplicantId" TEXT,
    "mergedAt" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "legalHoldReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_point" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_permission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "contactValue" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressedAt" TIMESTAMP(3),
    "suppressionSource" TEXT,
    "lastEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "contactValue" TEXT NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "disclosureKey" TEXT NOT NULL,
    "disclosureVersion" INTEGER NOT NULL,
    "disclosureText" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_episode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "originKind" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAcceptedAt" TIMESTAMP(3),
    "acknowledgedDeliveredAt" TIMESTAMP(3),
    "firstHumanOutreachAt" TIMESTAMP(3),
    "firstTwoWayHumanAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_definition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_version" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "DefinitionState" NOT NULL DEFAULT 'DRAFT',
    "greeting" TEXT NOT NULL,
    "completionText" TEXT NOT NULL,
    "handoffText" TEXT NOT NULL,
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_question" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "intakeVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "pathway" "IntakePathway" NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consentPurpose" "ConsentPurpose",
    "disclosureKey" TEXT,
    "disclosureText" TEXT,
    "sensitiveCategory" TEXT,

    CONSTRAINT "intake_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_session" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT,
    "intakeVersionId" TEXT NOT NULL,
    "pathway" "IntakePathway" NOT NULL,
    "status" "IntakeSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "resumeTokenHash" TEXT,
    "resumeExpiresAt" TIMESTAMP(3),
    "resumeRevokedAt" TIMESTAMP(3),
    "resumeVerificationHash" TEXT,
    "resumeVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "currentQuestionKey" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "handedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intake_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_answer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "intakeSessionId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "questionPrompt" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "valueText" TEXT NOT NULL,
    "valueOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "intake_answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "contactValue" TEXT NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "authorKind" "MessageAuthorKind" NOT NULL,
    "authorMemberId" TEXT,
    "channel" "ContactChannel" NOT NULL,
    "fromValue" TEXT NOT NULL,
    "toValue" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "state" "MessageState" NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiBriefId" TEXT,
    "approvedBodyHash" TEXT,
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "templateVersionId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerName" TEXT,
    "idempotencyKey" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "failureCode" TEXT,
    "failureDetail" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_delivery_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "normalizedState" "MessageState" NOT NULL,
    "stateRank" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "providerEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_delivery_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "fromValue" TEXT NOT NULL,
    "toValue" TEXT NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "humanConnected" BOOLEAN NOT NULL DEFAULT false,
    "durationSeconds" INTEGER,
    "providerCallSid" TEXT,
    "providerParentCallSid" TEXT,
    "providerLeg" TEXT,
    "providerName" TEXT,
    "recordedByMemberId" TEXT,
    "note" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT true,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_revision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceRef" TEXT,
    "ownerMemberId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "originalDueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "snoozeCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedByMemberId" TEXT,
    "completionOutcome" "TaskCompletionOutcome",
    "completionNote" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_snooze" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromDueAt" TIMESTAMP(3) NOT NULL,
    "toDueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "byMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_snooze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_window" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "availability_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "recruiterMemberId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "medium" "AppointmentMedium" NOT NULL DEFAULT 'IN_PERSON',
    "locationDetail" TEXT,
    "purpose" TEXT NOT NULL,
    "state" "AppointmentState" NOT NULL DEFAULT 'PROPOSED',
    "outcome" "AppointmentOutcome",
    "outcomeNote" TEXT,
    "outcomeRecordedByMemberId" TEXT,
    "outcomeRecordedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "supersedesAppointmentId" TEXT,
    "supersededByAppointmentId" TEXT,
    "confirmTokenHash" TEXT,
    "confirmExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "canceledAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_flag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "kind" "ReviewFlagKind" NOT NULL,
    "status" "ReviewFlagStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "sourceRef" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByMemberId" TEXT,
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "modelId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "inputSnapshotHash" TEXT NOT NULL,
    "inputEventCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,
    "state" "BriefState" NOT NULL DEFAULT 'GENERATED',
    "staleAt" TIMESTAMP(3),
    "reviewedByMemberId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "failureReason" TEXT,
    "draftMessageBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "kind" "BriefItemKind" NOT NULL,
    "order" INTEGER NOT NULL,
    "generatedText" TEXT NOT NULL,
    "recruiterText" TEXT,
    "recruiterMemberId" TEXT,
    "recruiterEditedAt" TIMESTAMP(3),
    "interpretation" BOOLEAN NOT NULL DEFAULT false,
    "unknown" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "brief_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_source_ref" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "briefItemId" TEXT NOT NULL,
    "sourceKind" "SourceKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevision" INTEGER,
    "quotedExcerpt" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brief_source_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_review" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "note" TEXT,
    "correctedItemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brief_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "automatable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_version" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "DefinitionState" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "placeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "secretRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISABLED',
    "statusDetail" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "integration_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "providerEventKey" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'received',
    "outcomeDetail" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deadLetteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_export" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "packageVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "HandoffState" NOT NULL DEFAULT 'DRAFT',
    "preparedByMemberId" TEXT NOT NULL,
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "transport" TEXT,
    "transportDetail" TEXT,
    "externalReferenceId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handoff_export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT,
    "inquiryEpisodeId" TEXT,
    "teamId" TEXT,
    "memberId" TEXT,
    "kind" "MetricEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "numericValue" INTEGER,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_observation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "measurementKind" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "meanMinutes" DOUBLE PRECISION NOT NULL,
    "methodology" TEXT NOT NULL,
    "recordedByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baseline_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "applicantId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantAId" TEXT NOT NULL,
    "applicantBId" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "signalDetail" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'open',
    "resolvedByMemberId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "closedCaseRetentionDays" INTEGER,
    "webhookPayloadRetentionDays" INTEGER,
    "briefRetentionDays" INTEGER,
    "auditMetadataRetentionDays" INTEGER,
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requestedByMemberId" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "retention_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_clock" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "frozenAt" TIMESTAMP(3),
    "offsetSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_clock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor"("userId");

-- CreateIndex
CREATE INDEX "passkey_userId_idx" ON "passkey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organizationId_key" ON "organization_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_metadata_organizationId_key" ON "commercial_metadata"("organizationId");

-- CreateIndex
CREATE INDEX "member_organizationId_staffRole_idx" ON "member"("organizationId", "staffRole");

-- CreateIndex
CREATE INDEX "member_organizationId_active_idx" ON "member"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_userId_key" ON "member"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_id_key" ON "member"("organizationId", "id");

-- CreateIndex
CREATE INDEX "invitation_organizationId_status_idx" ON "invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "team_organizationId_name_key" ON "team"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "team_organizationId_id_key" ON "team"("organizationId", "id");

-- CreateIndex
CREATE INDEX "team_member_organizationId_memberId_idx" ON "team_member"("organizationId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "team_member_organizationId_teamId_memberId_key" ON "team_member"("organizationId", "teamId", "memberId");

-- CreateIndex
CREATE INDEX "permission_grant_organizationId_subjectMemberId_grant_idx" ON "permission_grant"("organizationId", "subjectMemberId", "grant");

-- CreateIndex
CREATE INDEX "permission_grant_organizationId_applicantId_idx" ON "permission_grant"("organizationId", "applicantId");

-- CreateIndex
CREATE INDEX "coverage_organizationId_toMemberId_expiresAt_idx" ON "coverage"("organizationId", "toMemberId", "expiresAt");

-- CreateIndex
CREATE INDEX "coverage_organizationId_fromMemberId_idx" ON "coverage"("organizationId", "fromMemberId");

-- CreateIndex
CREATE INDEX "absence_organizationId_memberId_startsAt_idx" ON "absence"("organizationId", "memberId", "startsAt");

-- CreateIndex
CREATE INDEX "applicant_organizationId_status_idx" ON "applicant"("organizationId", "status");

-- CreateIndex
CREATE INDEX "applicant_organizationId_ownerMemberId_status_idx" ON "applicant"("organizationId", "ownerMemberId", "status");

-- CreateIndex
CREATE INDEX "applicant_organizationId_teamId_idx" ON "applicant"("organizationId", "teamId");

-- CreateIndex
CREATE INDEX "applicant_organizationId_updatedAt_idx" ON "applicant"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_organizationId_reference_key" ON "applicant"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_organizationId_id_key" ON "applicant"("organizationId", "id");

-- CreateIndex
CREATE INDEX "contact_point_organizationId_channel_value_idx" ON "contact_point"("organizationId", "channel", "value");

-- CreateIndex
CREATE UNIQUE INDEX "contact_point_organizationId_applicantId_channel_value_key" ON "contact_point"("organizationId", "applicantId", "channel", "value");

-- CreateIndex
CREATE INDEX "channel_permission_organizationId_contactValue_channel_idx" ON "channel_permission"("organizationId", "contactValue", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "channel_permission_organizationId_applicantId_channel_purpo_key" ON "channel_permission"("organizationId", "applicantId", "channel", "purpose", "contactValue");

-- CreateIndex
CREATE INDEX "consent_event_organizationId_applicantId_occurredAt_idx" ON "consent_event"("organizationId", "applicantId", "occurredAt");

-- CreateIndex
CREATE INDEX "inquiry_episode_organizationId_applicantId_openedAt_idx" ON "inquiry_episode"("organizationId", "applicantId", "openedAt");

-- CreateIndex
CREATE INDEX "inquiry_episode_organizationId_openedAt_idx" ON "inquiry_episode"("organizationId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "intake_definition_organizationId_key_key" ON "intake_definition"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "intake_definition_organizationId_id_key" ON "intake_definition"("organizationId", "id");

-- CreateIndex
CREATE INDEX "intake_version_organizationId_state_idx" ON "intake_version"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "intake_version_organizationId_definitionId_version_key" ON "intake_version"("organizationId", "definitionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "intake_version_organizationId_id_key" ON "intake_version"("organizationId", "id");

-- CreateIndex
CREATE INDEX "intake_question_organizationId_intakeVersionId_order_idx" ON "intake_question"("organizationId", "intakeVersionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "intake_question_organizationId_intakeVersionId_key_key" ON "intake_question"("organizationId", "intakeVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "intake_question_organizationId_id_key" ON "intake_question"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_session_resumeTokenHash_key" ON "intake_session"("resumeTokenHash");

-- CreateIndex
CREATE INDEX "intake_session_organizationId_status_idx" ON "intake_session"("organizationId", "status");

-- CreateIndex
CREATE INDEX "intake_session_organizationId_applicantId_idx" ON "intake_session"("organizationId", "applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "intake_session_organizationId_id_key" ON "intake_session"("organizationId", "id");

-- CreateIndex
CREATE INDEX "intake_answer_organizationId_intakeSessionId_idx" ON "intake_answer"("organizationId", "intakeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "intake_answer_organizationId_intakeSessionId_questionKey_re_key" ON "intake_answer"("organizationId", "intakeSessionId", "questionKey", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "intake_answer_organizationId_id_key" ON "intake_answer"("organizationId", "id");

-- CreateIndex
CREATE INDEX "conversation_organizationId_lastEventAt_idx" ON "conversation"("organizationId", "lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_organizationId_applicantId_channel_contactValu_key" ON "conversation"("organizationId", "applicantId", "channel", "contactValue");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_organizationId_id_key" ON "conversation"("organizationId", "id");

-- CreateIndex
CREATE INDEX "message_organizationId_applicantId_occurredAt_idx" ON "message"("organizationId", "applicantId", "occurredAt");

-- CreateIndex
CREATE INDEX "message_organizationId_state_scheduledFor_idx" ON "message"("organizationId", "state", "scheduledFor");

-- CreateIndex
CREATE INDEX "message_organizationId_providerMessageId_idx" ON "message"("organizationId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "message_organizationId_id_key" ON "message"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_organizationId_idempotencyKey_key" ON "message"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "message_delivery_event_organizationId_messageId_occurredAt_idx" ON "message_delivery_event"("organizationId", "messageId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_delivery_event_organizationId_messageId_providerSta_key" ON "message_delivery_event"("organizationId", "messageId", "providerStatus", "occurredAt");

-- CreateIndex
CREATE INDEX "call_event_organizationId_applicantId_occurredAt_idx" ON "call_event"("organizationId", "applicantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "call_event_organizationId_id_key" ON "call_event"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "call_event_organizationId_providerCallSid_providerLeg_key" ON "call_event"("organizationId", "providerCallSid", "providerLeg");

-- CreateIndex
CREATE INDEX "note_organizationId_applicantId_createdAt_idx" ON "note"("organizationId", "applicantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "note_organizationId_id_key" ON "note"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "note_revision_organizationId_noteId_revision_key" ON "note_revision"("organizationId", "noteId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "note_revision_organizationId_id_key" ON "note_revision"("organizationId", "id");

-- CreateIndex
CREATE INDEX "task_organizationId_ownerMemberId_status_dueAt_idx" ON "task"("organizationId", "ownerMemberId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "task_organizationId_status_dueAt_idx" ON "task"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "task_organizationId_applicantId_status_idx" ON "task"("organizationId", "applicantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "task_organizationId_id_key" ON "task"("organizationId", "id");

-- CreateIndex
CREATE INDEX "task_snooze_organizationId_taskId_idx" ON "task_snooze"("organizationId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "availability_window_organizationId_memberId_weekday_startMi_key" ON "availability_window"("organizationId", "memberId", "weekday", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_confirmTokenHash_key" ON "appointment"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "appointment_organizationId_recruiterMemberId_startsAt_idx" ON "appointment"("organizationId", "recruiterMemberId", "startsAt");

-- CreateIndex
CREATE INDEX "appointment_organizationId_applicantId_startsAt_idx" ON "appointment"("organizationId", "applicantId", "startsAt");

-- CreateIndex
CREATE INDEX "appointment_organizationId_state_startsAt_idx" ON "appointment"("organizationId", "state", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_organizationId_id_key" ON "appointment"("organizationId", "id");

-- CreateIndex
CREATE INDEX "appointment_reminder_organizationId_appointmentId_status_idx" ON "appointment_reminder"("organizationId", "appointmentId", "status");

-- CreateIndex
CREATE INDEX "review_flag_organizationId_status_kind_idx" ON "review_flag"("organizationId", "status", "kind");

-- CreateIndex
CREATE INDEX "review_flag_organizationId_applicantId_status_idx" ON "review_flag"("organizationId", "applicantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_flag_organizationId_id_key" ON "review_flag"("organizationId", "id");

-- CreateIndex
CREATE INDEX "brief_organizationId_applicantId_generatedAt_idx" ON "brief"("organizationId", "applicantId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "brief_organizationId_applicantId_revision_key" ON "brief"("organizationId", "applicantId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "brief_organizationId_id_key" ON "brief"("organizationId", "id");

-- CreateIndex
CREATE INDEX "brief_item_organizationId_briefId_order_idx" ON "brief_item"("organizationId", "briefId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "brief_item_organizationId_id_key" ON "brief_item"("organizationId", "id");

-- CreateIndex
CREATE INDEX "brief_source_ref_organizationId_briefItemId_idx" ON "brief_source_ref"("organizationId", "briefItemId");

-- CreateIndex
CREATE INDEX "brief_source_ref_organizationId_sourceKind_sourceId_idx" ON "brief_source_ref"("organizationId", "sourceKind", "sourceId");

-- CreateIndex
CREATE INDEX "brief_review_organizationId_briefId_createdAt_idx" ON "brief_review"("organizationId", "briefId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_organizationId_key_key" ON "message_template"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_organizationId_id_key" ON "message_template"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "template_version_organizationId_templateId_version_key" ON "template_version"("organizationId", "templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "template_version_organizationId_id_key" ON "template_version"("organizationId", "id");

-- CreateIndex
CREATE INDEX "integration_config_organizationId_kind_idx" ON "integration_config"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "integration_config_organizationId_kind_provider_key" ON "integration_config"("organizationId", "kind", "provider");

-- CreateIndex
CREATE INDEX "webhook_receipt_organizationId_receivedAt_idx" ON "webhook_receipt"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_receipt_provider_providerEventKey_key" ON "webhook_receipt"("provider", "providerEventKey");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_record_idempotencyKey_key" ON "outbox_record"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outbox_record_status_availableAt_idx" ON "outbox_record"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_record_organizationId_status_idx" ON "outbox_record"("organizationId", "status");

-- CreateIndex
CREATE INDEX "handoff_export_organizationId_applicantId_createdAt_idx" ON "handoff_export"("organizationId", "applicantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "handoff_export_organizationId_id_key" ON "handoff_export"("organizationId", "id");

-- CreateIndex
CREATE INDEX "metric_event_organizationId_kind_occurredAt_idx" ON "metric_event"("organizationId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "metric_event_organizationId_inquiryEpisodeId_idx" ON "metric_event"("organizationId", "inquiryEpisodeId");

-- CreateIndex
CREATE INDEX "baseline_observation_organizationId_taskType_measurementKin_idx" ON "baseline_observation"("organizationId", "taskType", "measurementKind");

-- CreateIndex
CREATE INDEX "audit_event_organizationId_occurredAt_idx" ON "audit_event"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_event_organizationId_applicantId_occurredAt_idx" ON "audit_event"("organizationId", "applicantId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_event_organizationId_category_action_idx" ON "audit_event"("organizationId", "category", "action");

-- CreateIndex
CREATE INDEX "duplicate_candidate_organizationId_resolution_idx" ON "duplicate_candidate"("organizationId", "resolution");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_candidate_organizationId_applicantAId_applicantBI_key" ON "duplicate_candidate"("organizationId", "applicantAId", "applicantBId", "signal");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_organizationId_name_key" ON "retention_policy"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_organizationId_id_key" ON "retention_policy"("organizationId", "id");

-- CreateIndex
CREATE INDEX "retention_run_organizationId_policyId_startedAt_idx" ON "retention_run"("organizationId", "policyId", "startedAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_metadata" ADD CONSTRAINT "commercial_metadata_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_organizationId_managerMemberId_fkey" FOREIGN KEY ("organizationId", "managerMemberId") REFERENCES "member"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "team"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_organizationId_subjectMemberId_fkey" FOREIGN KEY ("organizationId", "subjectMemberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_organizationId_grantedByMemberId_fkey" FOREIGN KEY ("organizationId", "grantedByMemberId") REFERENCES "member"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage" ADD CONSTRAINT "coverage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage" ADD CONSTRAINT "coverage_organizationId_fromMemberId_fkey" FOREIGN KEY ("organizationId", "fromMemberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage" ADD CONSTRAINT "coverage_organizationId_toMemberId_fkey" FOREIGN KEY ("organizationId", "toMemberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence" ADD CONSTRAINT "absence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence" ADD CONSTRAINT "absence_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant" ADD CONSTRAINT "applicant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant" ADD CONSTRAINT "applicant_organizationId_ownerMemberId_fkey" FOREIGN KEY ("organizationId", "ownerMemberId") REFERENCES "member"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant" ADD CONSTRAINT "applicant_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "team"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_point" ADD CONSTRAINT "contact_point_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_point" ADD CONSTRAINT "contact_point_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_permission" ADD CONSTRAINT "channel_permission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_permission" ADD CONSTRAINT "channel_permission_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_episode" ADD CONSTRAINT "inquiry_episode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_episode" ADD CONSTRAINT "inquiry_episode_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_definition" ADD CONSTRAINT "intake_definition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_version" ADD CONSTRAINT "intake_version_organizationId_definitionId_fkey" FOREIGN KEY ("organizationId", "definitionId") REFERENCES "intake_definition"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_question" ADD CONSTRAINT "intake_question_organizationId_intakeVersionId_fkey" FOREIGN KEY ("organizationId", "intakeVersionId") REFERENCES "intake_version"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_session" ADD CONSTRAINT "intake_session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_session" ADD CONSTRAINT "intake_session_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_session" ADD CONSTRAINT "intake_session_organizationId_intakeVersionId_fkey" FOREIGN KEY ("organizationId", "intakeVersionId") REFERENCES "intake_version"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_answer" ADD CONSTRAINT "intake_answer_organizationId_intakeSessionId_fkey" FOREIGN KEY ("organizationId", "intakeSessionId") REFERENCES "intake_session"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_organizationId_conversationId_fkey" FOREIGN KEY ("organizationId", "conversationId") REFERENCES "conversation"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_delivery_event" ADD CONSTRAINT "message_delivery_event_organizationId_messageId_fkey" FOREIGN KEY ("organizationId", "messageId") REFERENCES "message"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_event" ADD CONSTRAINT "call_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_event" ADD CONSTRAINT "call_event_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_revision" ADD CONSTRAINT "note_revision_organizationId_noteId_fkey" FOREIGN KEY ("organizationId", "noteId") REFERENCES "note"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_organizationId_ownerMemberId_fkey" FOREIGN KEY ("organizationId", "ownerMemberId") REFERENCES "member"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_snooze" ADD CONSTRAINT "task_snooze_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "task"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_window" ADD CONSTRAINT "availability_window_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_window" ADD CONSTRAINT "availability_window_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organizationId_recruiterMemberId_fkey" FOREIGN KEY ("organizationId", "recruiterMemberId") REFERENCES "member"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reminder" ADD CONSTRAINT "appointment_reminder_organizationId_appointmentId_fkey" FOREIGN KEY ("organizationId", "appointmentId") REFERENCES "appointment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_flag" ADD CONSTRAINT "review_flag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_flag" ADD CONSTRAINT "review_flag_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief" ADD CONSTRAINT "brief_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief" ADD CONSTRAINT "brief_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_item" ADD CONSTRAINT "brief_item_organizationId_briefId_fkey" FOREIGN KEY ("organizationId", "briefId") REFERENCES "brief"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_source_ref" ADD CONSTRAINT "brief_source_ref_organizationId_briefItemId_fkey" FOREIGN KEY ("organizationId", "briefItemId") REFERENCES "brief_item"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_review" ADD CONSTRAINT "brief_review_organizationId_briefId_fkey" FOREIGN KEY ("organizationId", "briefId") REFERENCES "brief"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "message_template"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_config" ADD CONSTRAINT "integration_config_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_receipt" ADD CONSTRAINT "webhook_receipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_record" ADD CONSTRAINT "outbox_record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_export" ADD CONSTRAINT "handoff_export_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_export" ADD CONSTRAINT "handoff_export_organizationId_applicantId_fkey" FOREIGN KEY ("organizationId", "applicantId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_event" ADD CONSTRAINT "metric_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_observation" ADD CONSTRAINT "baseline_observation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_organizationId_applicantAId_fkey" FOREIGN KEY ("organizationId", "applicantAId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_organizationId_applicantBId_fkey" FOREIGN KEY ("organizationId", "applicantBId") REFERENCES "applicant"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy" ADD CONSTRAINT "retention_policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_run" ADD CONSTRAINT "retention_run_organizationId_policyId_fkey" FOREIGN KEY ("organizationId", "policyId") REFERENCES "retention_policy"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
