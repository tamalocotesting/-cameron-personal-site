import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Info,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Quote,
  Send,
  ShieldAlert,
  User,
} from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  EmptyState,
  Notice,
  SectionTitle,
  type BadgeTone,
} from '@/components/ui';
import { addMinutes, formatInZone, localInputValue, relativeLabel, zoneAbbreviation } from '@/lib/time';
import { maskContact } from '@/lib/redact';
import type { CaseFileData } from '@/server/services/case-view';
import {
  AddNoteDialog,
  AppointmentOutcomeDialog,
  ApproveMessageForm,
  BriefReviewForm,
  CancelAppointmentDialog,
  CancelMessageDialog,
  CancelTaskDialog,
  CompleteTaskDialog,
  CreateTaskDialog,
  DraftMessageDialog,
  EditBriefItemDialog,
  EditCaseDialog,
  EditDraftDialog,
  IntakeLinkForm,
  LogCallDialog,
  MergeDialog,
  ReassignDialog,
  RecordConsentDialog,
  RegenerateBriefForm,
  RescheduleAppointmentDialog,
  ResolveFlagDialog,
  ScheduleAppointmentDialog,
  SendMessageDialog,
  SnoozeTaskDialog,
  StatusDialog,
} from './forms';

/**
 * The case file.
 *
 * Shared, unchanged, between the Today split view and the standalone applicant
 * page — so there is one implementation of "what a recruiter sees about a
 * person", not two that drift.
 *
 * Layout rule: everything that decides what to do next lives ABOVE the
 * transcript. The brief answers the four questions, the header carries
 * identity, owner, status and the next action, and the full conversation is a
 * tab you open when you need it.
 */

export type CaseView = 'overview' | 'conversation' | 'intake' | 'notes' | 'tasks' | 'activity';

const VIEWS: Array<{ key: CaseView; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'conversation', label: 'Conversation' },
  { key: 'intake', label: 'Intake' },
  { key: 'notes', label: 'Notes' },
  { key: 'tasks', label: 'Tasks & appointments' },
  { key: 'activity', label: 'Activity' },
];

const STATUS_TONE: Record<string, BadgeTone> = {
  NEW_INQUIRY: 'accent',
  INTAKE_IN_PROGRESS: 'pending',
  READY_FOR_RECRUITER: 'ready',
  CONTACT_ATTEMPTED: 'pending',
  TWO_WAY_CONVERSATION: 'ready',
  APPOINTMENT_SCHEDULED: 'ready',
  AWAITING_APPLICANT: 'pending',
  CLOSED: 'neutral',
};

const MESSAGE_STATE_TONE: Record<string, BadgeTone> = {
  RECEIVED: 'accent',
  DRAFT: 'neutral',
  APPROVED: 'ready',
  SCHEDULED: 'pending',
  QUEUED: 'pending',
  SUBMITTING: 'pending',
  PROVIDER_ACCEPTED: 'pending',
  SENT: 'pending',
  DELIVERED: 'ready',
  FAILED: 'review',
  CANCELED: 'neutral',
  BLOCKED: 'review',
  OUTCOME_UNKNOWN: 'review',
};

const MESSAGE_STATE_LABEL: Record<string, string> = {
  RECEIVED: 'Received',
  DRAFT: 'Draft — not sent',
  APPROVED: 'Approved — not sent',
  SCHEDULED: 'Scheduled — not sent',
  QUEUED: 'Queued — not sent',
  SUBMITTING: 'Submitting',
  PROVIDER_ACCEPTED: 'Carrier accepted (not delivery)',
  SENT: 'Sent to the carrier',
  DELIVERED: 'Delivered',
  FAILED: 'Failed — not delivered',
  CANCELED: 'Canceled',
  BLOCKED: 'Blocked',
  OUTCOME_UNKNOWN: 'Outcome unknown — do not resend',
};

function fmt(date: Date | null | undefined, timezone: string) {
  if (!date) return '—';
  return `${formatInZone(date, timezone)} ${zoneAbbreviation(date, timezone)}`;
}

export function CaseFile({
  data,
  view,
  timezone,
  basePath,
  nowInstant,
}: {
  data: CaseFileData;
  view: CaseView;
  timezone: string;
  /** Where the tab links point, so Today and the detail page both deep-link. */
  basePath: string;
  nowInstant: Date;
}) {
  const { applicant, access } = data;
  const caseTz = applicant.timezone ?? timezone;

  const contactOptions = data.contactPoints.map((cp) => ({
    value: cp.value,
    label: `${cp.channel === 'EMAIL' ? 'Email' : 'Phone'} · ${cp.value}${cp.isPrimary ? ' (primary)' : ''}`,
  }));
  const phoneOptions = contactOptions.filter((o) => o.label.startsWith('Phone'));

  return (
    <div className="space-y-3">
      <CaseHeader data={data} timezone={caseTz} nowInstant={nowInstant} />

      {applicant.automationPaused ? (
        <Notice tone="review" icon={<ShieldAlert size={14} />} title="Automated conversation is paused">
          {applicant.automationPausedReason ?? 'A recruiter needs to look at this case.'} Automated
          messages will not go out until the open review is resolved.
        </Notice>
      ) : null}

      {data.openFlags.length ? (
        <Card>
          <CardHeader
            title="Needs a person"
            description="Attention items on this conversation. Never a judgement about the applicant."
          />
          <CardBody className="space-y-2">
            {data.openFlags.map((flag) => (
              <div
                key={flag.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-review/25 bg-review-soft px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-review">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {flag.kind.replace(/_/g, ' ').toLowerCase()}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink">
                    {flag.restricted && !access.sensitive
                      ? 'This item is restricted. Reading the detail needs a sensitive-source grant.'
                      : flag.detail}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    Raised {relativeLabel(flag.raisedAt, nowInstant)} · {fmt(flag.raisedAt, caseTz)}
                  </p>
                </div>
                {access.act ? (
                  <ResolveFlagDialog applicantId={applicant.id} flagId={flag.id} kind={flag.kind} />
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {access.content ? (
        <BriefPanel data={data} timezone={caseTz} nowInstant={nowInstant} />
      ) : (
        <Notice tone="neutral" icon={<Lock size={14} />} title="Conversation content is not shown">
          You can see this case in team reporting. Reading its conversation, intake answers, notes and
          brief needs a case-content grant. Basis for your current access: {access.basis}.
        </Notice>
      )}

      {/* Tabs are links, so every view is deep-linkable and back/forward work. */}
      <div className="overflow-x-auto">
        <div role="tablist" aria-label="Case sections" className="flex gap-1 border-b border-line">
          {VIEWS.map((item) => {
            const active = item.key === view;
            return (
              <Link
                key={item.key}
                role="tab"
                aria-selected={active}
                href={`${basePath}${basePath.includes('?') ? '&' : '?'}view=${item.key}`}
                scroll={false}
                className={
                  active
                    ? 'touch-target -mb-px border-b-2 border-accent px-3 py-2 text-[13px] font-semibold text-accent'
                    : 'touch-target -mb-px border-b-2 border-transparent px-3 py-2 text-[13px] text-ink-faint hover:text-ink'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {view === 'overview' ? (
        <OverviewPanel
          data={data}
          timezone={caseTz}
          nowInstant={nowInstant}
          contactOptions={contactOptions}
          phoneOptions={phoneOptions}
        />
      ) : null}
      {view === 'conversation' ? (
        <ConversationPanel data={data} timezone={caseTz} contactOptions={contactOptions} />
      ) : null}
      {view === 'intake' ? <IntakePanel data={data} timezone={caseTz} /> : null}
      {view === 'notes' ? <NotesPanel data={data} timezone={caseTz} /> : null}
      {view === 'tasks' ? (
        <TasksPanel data={data} timezone={caseTz} nowInstant={nowInstant} />
      ) : null}
      {view === 'activity' ? <ActivityPanel data={data} timezone={caseTz} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function CaseHeader({
  data,
  timezone,
  nowInstant,
}: {
  data: CaseFileData;
  timezone: string;
  nowInstant: Date;
}) {
  const { applicant, access, owner, nextTask } = data;
  const grantedPermissions = data.permissions.filter((p) => p.granted && !p.suppressed);
  const suppressed = data.permissions.filter((p) => p.suppressed);

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[18px] font-semibold text-ink">{applicant.displayName}</h1>
              <Badge tone={STATUS_TONE[applicant.status] ?? 'neutral'}>
                {applicant.status.replace(/_/g, ' ').toLowerCase()}
              </Badge>
              {applicant.mergedIntoApplicantId ? <Badge tone="neutral">merged</Badge> : null}
              {applicant.legalHold ? (
                <Badge tone="pending" icon={<Lock size={12} />}>
                  legal hold
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 font-mono text-[12px] text-ink-faint">{applicant.reference}</p>
          </div>

          {access.act ? (
            <div className="flex flex-wrap items-center gap-2">
              <EditCaseDialog
                applicantId={applicant.id}
                version={applicant.version}
                displayName={applicant.displayName}
                preferredName={applicant.preferredName}
                generalLocation={applicant.generalLocation}
                timezone={applicant.timezone}
                timezoneConfirmed={applicant.timezoneConfirmed}
              />
              <StatusDialog
                applicantId={applicant.id}
                currentStatus={applicant.status}
                version={applicant.version}
              />
              {access.reassign ? (
                <ReassignDialog
                  applicantId={applicant.id}
                  members={data.members}
                  currentOwnerId={applicant.ownerMemberId}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <DefinitionList
          items={[
            {
              label: 'Owner',
              value: owner ? (
                <span className="flex items-center gap-1.5">
                  <User size={13} aria-hidden="true" className="text-ink-faint" />
                  {owner.displayName}
                  {!owner.active ? <Badge tone="review">deactivated</Badge> : null}
                </span>
              ) : (
                <Badge tone="review" icon={<AlertTriangle size={12} />}>
                  no owner
                </Badge>
              ),
            },
            {
              label: 'Next action',
              value: nextTask ? (
                <span>
                  {nextTask.title}{' '}
                  <span
                    className={
                      nextTask.originalDueAt < nowInstant ? 'font-semibold text-review' : 'text-ink-faint'
                    }
                  >
                    ({relativeLabel(nextTask.dueAt, nowInstant)}, {fmt(nextTask.dueAt, timezone)})
                  </span>
                </span>
              ) : (
                <Badge tone="pending" icon={<CircleDashed size={12} />}>
                  none — needs a next step
                </Badge>
              ),
            },
            {
              label: 'Contact',
              value: (
                <span className="flex flex-wrap gap-1.5">
                  {data.contactPoints.length ? (
                    data.contactPoints.map((cp) => (
                      <Badge key={cp.id} tone="neutral" icon={cp.channel === 'EMAIL' ? <Mail size={12} /> : <Phone size={12} />}>
                        {/* Full values live here and in the case file only; list
                            views show masked forms. */}
                        {cp.value}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-ink-faint">none recorded</span>
                  )}
                </span>
              ),
            },
            {
              label: 'Channel permission',
              value: (
                <span className="flex flex-wrap gap-1.5">
                  {grantedPermissions.length ? (
                    grantedPermissions.map((p) => (
                      <Badge key={p.id} tone="ready" icon={<BadgeCheck size={12} />}>
                        {p.purpose.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    ))
                  ) : (
                    <Badge tone="pending">none recorded</Badge>
                  )}
                  {suppressed.map((p) => (
                    <Badge key={p.id} tone="review" icon={<ShieldAlert size={12} />}>
                      opted out of {p.channel.toLowerCase()}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              label: 'General location',
              value: applicant.generalLocation ?? <span className="text-ink-faint">not given</span>,
            },
            {
              label: 'Timezone',
              value: applicant.timezone ? (
                <span>
                  {applicant.timezone}{' '}
                  {applicant.timezoneConfirmed ? (
                    <Badge tone="ready">confirmed</Badge>
                  ) : (
                    <Badge tone="pending">unconfirmed</Badge>
                  )}
                </span>
              ) : (
                <Badge tone="pending">unknown — conservative contact window applies</Badge>
              ),
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

function BriefPanel({
  data,
  timezone,
  nowInstant,
}: {
  data: CaseFileData;
  timezone: string;
  nowInstant: Date;
}) {
  const brief = data.brief;
  const applicantId = data.applicant.id;

  if (!brief) {
    return (
      <Card>
        <CardHeader
          title="Recruiter brief"
          description="AI prepares. Recruiter decides."
          actions={data.access.act ? <RegenerateBriefForm applicantId={applicantId} /> : null}
        />
        <CardBody>
          <EmptyState
            icon={<FileText size={20} />}
            title="No brief has been prepared yet"
            description="Briefs are prepared in the background. You can work the case without one — nothing here depends on it."
          />
        </CardBody>
      </Card>
    );
  }

  if (brief.state === 'FAILED') {
    return (
      <Card>
        <CardHeader
          title="Recruiter brief"
          actions={data.access.act ? <RegenerateBriefForm applicantId={applicantId} /> : null}
        />
        <CardBody>
          <Notice tone="pending" icon={<AlertTriangle size={14} />} title="Preparation is unavailable">
            {brief.failureReason ?? 'The provider could not be reached.'} Nothing was invented in its
            place, and the rest of the case file works normally.
          </Notice>
        </CardBody>
      </Card>
    );
  }

  const byKind = (kind: string) => brief.items.filter((i) => i.kind === kind && !i.dismissed);
  const intent = byKind('INTENT')[0];
  const facts = byKind('FACT');
  const clarifications = byKind('CLARIFICATION');
  const nextAction = byKind('NEXT_ACTION')[0];
  const reviewReasons = byKind('REVIEW_REASON');

  return (
    <Card>
      <CardHeader
        title="Recruiter brief"
        description={`Prepared by ${brief.providerName}${brief.modelId ? ` (${brief.modelId})` : ''} · prompt ${brief.promptVersion} · revision ${brief.revision} · ${fmt(brief.generatedAt, timezone)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {brief.providerName === 'local-rules' ? (
              <Badge tone="neutral" icon={<Bot size={12} />}>
                rules-based demo preparation
              </Badge>
            ) : null}
            {brief.staleAt ? (
              <Badge tone="pending" icon={<Clock size={12} />}>
                stale — new activity since this was prepared
              </Badge>
            ) : null}
            {brief.state === 'APPROVED' ? (
              <Badge tone="ready" icon={<CheckCircle2 size={12} />}>
                reviewed by a recruiter
              </Badge>
            ) : brief.state === 'REJECTED' ? (
              <Badge tone="review">rejected</Badge>
            ) : (
              <Badge tone="pending" icon={<Info size={12} />}>
                not reviewed yet
              </Badge>
            )}
          </div>
        }
      />
      <CardBody className="space-y-4">
        <Notice tone="neutral" icon={<Info size={14} />}>
          Source links prove where a line came from. They do not prove it is right — check anything you
          are going to act on. Lines marked <em>suggestion</em> are interpretation, not fact.
        </Notice>

        <section className="space-y-1">
          <SectionTitle>What does this person want?</SectionTitle>
          <BriefLine item={intent} applicantId={applicantId} canEdit={data.access.act} />
        </section>

        <section className="space-y-1">
          <SectionTitle>What have they already told us?</SectionTitle>
          {facts.length ? (
            <ul className="space-y-1.5">
              {facts.map((item) => (
                <li key={item.id}>
                  <BriefLine item={item} applicantId={applicantId} canEdit={data.access.act} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-faint">
              Nothing is recorded with a verifiable source yet.
            </p>
          )}
        </section>

        <section className="space-y-1">
          <SectionTitle>What needs clarification?</SectionTitle>
          {clarifications.length ? (
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink">
              {clarifications.map((item) => (
                <li key={item.id}>
                  {item.recruiterText ?? item.generatedText}
                  {item.unknown ? (
                    <Badge tone="neutral" className="ml-1.5">
                      unknown
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-faint">Nothing flagged.</p>
          )}
        </section>

        <section className="space-y-1">
          <SectionTitle>What should the recruiter do next?</SectionTitle>
          <BriefLine item={nextAction} applicantId={applicantId} canEdit={data.access.act} />
          {reviewReasons.length ? (
            <ul className="mt-1.5 space-y-1">
              {reviewReasons.map((item) => (
                <li key={item.id} className="flex items-start gap-1.5 text-[13px] text-review">
                  <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {item.recruiterText ?? item.generatedText}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {data.access.act ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <BriefReviewForm applicantId={applicantId} briefId={brief.id} action="approve" label="Approve brief" />
            <BriefReviewForm applicantId={applicantId} briefId={brief.id} action="reject" label="Reject" />
            <RegenerateBriefForm applicantId={applicantId} />
            {brief.draftMessageBody ? (
              <DraftMessageDialog
                applicantId={applicantId}
                briefId={brief.id}
                suggestedBody={brief.draftMessageBody}
                contactOptions={data.contactPoints.map((cp) => ({
                  value: cp.value,
                  label: `${cp.channel === 'EMAIL' ? 'Email' : 'Phone'} · ${cp.value}`,
                }))}
              />
            ) : null}
          </div>
        ) : null}

        <p className="text-[12px] text-ink-faint">
          Loaded {relativeLabel(data.loadedAt, nowInstant)}.
        </p>
      </CardBody>
    </Card>
  );
}

function BriefLine({
  item,
  applicantId,
  canEdit,
}: {
  item: CaseFileData['brief'] extends null ? never : NonNullable<CaseFileData['brief']>['items'][number] | undefined;
  applicantId: string;
  canEdit: boolean;
}) {
  if (!item) return <p className="text-[13px] text-ink-faint">Not available.</p>;
  const corrected = item.recruiterText !== null;
  return (
    <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
      <p className="text-[13.5px] text-ink">
        {item.recruiterText ?? item.generatedText}
        {item.interpretation ? (
          <Badge tone="neutral" className="ml-1.5">
            suggestion
          </Badge>
        ) : null}
        {corrected ? (
          <Badge tone="ready" className="ml-1.5">
            recruiter corrected
          </Badge>
        ) : null}
      </p>

      {corrected ? (
        <p className="mt-1 text-[12px] text-ink-faint">
          Originally prepared as: “{item.generatedText}”
        </p>
      ) : null}

      {item.sources.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {item.sources.map((source) => (
            <li key={source.id}>
              {/* Clicking a citation opens the exact supporting source, and
                  that read is authorized in its own right. */}
              <Link
                href={`/applicants/${applicantId}/source/${source.id}`}
                className="inline-flex items-center gap-1 rounded border border-accent/25 bg-accent-soft px-1.5 py-0.5 text-[12px] text-accent"
              >
                <Quote size={11} aria-hidden="true" />
                {source.sourceKind.replace('_', ' ').toLowerCase()}
                {source.sourceRevision ? ` r${source.sourceRevision}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-1.5">
          <EditBriefItemDialog
            applicantId={applicantId}
            briefItemId={item.id}
            currentText={item.recruiterText ?? item.generatedText}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewPanel({
  data,
  timezone,
  nowInstant,
  contactOptions,
  phoneOptions,
}: {
  data: CaseFileData;
  timezone: string;
  nowInstant: Date;
  contactOptions: Array<{ value: string; label: string }>;
  phoneOptions: Array<{ value: string; label: string }>;
}) {
  const { applicant, access } = data;
  const lastMessage = data.messages[data.messages.length - 1];
  const upcoming = data.appointments.find((a) => ['PROPOSED', 'SCHEDULED', 'CONFIRMED'].includes(a.state));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Act on this case"
          description="Every control here either works or tells you exactly what is blocking it."
        />
        <CardBody className="flex flex-wrap gap-2">
          {access.act ? (
            <>
              <DraftMessageDialog applicantId={applicant.id} contactOptions={contactOptions} />
              <LogCallDialog applicantId={applicant.id} phoneOptions={phoneOptions} />
              <CreateTaskDialog
                applicantId={applicant.id}
                now={localInputValue(addMinutes(nowInstant, 60), timezone)}
              />
              <ScheduleAppointmentDialog
                applicantId={applicant.id}
                timezone={timezone}
                members={data.members}
                defaultRecruiterId={applicant.ownerMemberId ?? undefined}
                defaultLocal={localInputValue(addMinutes(nowInstant, 24 * 60), timezone)}
              />
              <AddNoteDialog applicantId={applicant.id} />
              <RecordConsentDialog applicantId={applicant.id} contactOptions={contactOptions} />
              <IntakeLinkForm applicantId={applicant.id} />
            </>
          ) : (
            <Notice tone="neutral" icon={<Lock size={14} />}>
              You can read this case but not act on it. Acting needs ownership, coverage, or a
              case-content grant.
            </Notice>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Where things stand" />
        <CardBody>
          <DefinitionList
            items={[
              {
                label: 'Inquiry opened',
                value: data.episode ? fmt(data.episode.openedAt, timezone) : '—',
              },
              {
                label: 'Acknowledgment',
                value: data.episode?.acknowledgedDeliveredAt
                  ? `delivered ${fmt(data.episode.acknowledgedDeliveredAt, timezone)}`
                  : data.episode?.acknowledgedAcceptedAt
                    ? `carrier accepted ${fmt(data.episode.acknowledgedAcceptedAt, timezone)} (delivery not confirmed)`
                    : 'none',
              },
              {
                label: 'First human outreach',
                value: data.episode?.firstHumanOutreachAt
                  ? fmt(data.episode.firstHumanOutreachAt, timezone)
                  : 'not yet',
              },
              {
                label: 'Two-way human contact',
                value: data.episode?.firstTwoWayHumanAt
                  ? fmt(data.episode.firstTwoWayHumanAt, timezone)
                  : 'not yet',
              },
              {
                label: 'Last message',
                value: lastMessage
                  ? `${lastMessage.direction === 'INBOUND' ? 'from the applicant' : 'from us'} · ${fmt(lastMessage.occurredAt, timezone)}`
                  : 'none',
              },
              {
                label: 'Next appointment',
                value: upcoming
                  ? `${fmt(upcoming.startsAt, upcoming.timezone)} · ${upcoming.state.toLowerCase()}`
                  : 'none scheduled',
              },
            ]}
          />
        </CardBody>
      </Card>

      {data.duplicates.length ? (
        <Card className="lg:col-span-2">
          <CardHeader
            title="Possible duplicate"
            description="Flagged for a person to decide. Nothing has been merged and no content is shared between the cases."
          />
          <CardBody className="space-y-2">
            {data.duplicates.map((candidate) => {
              const other =
                candidate.applicantAId === applicant.id ? candidate.applicantB : candidate.applicantA;
              return (
                <p key={candidate.id} className="text-[13px] text-ink">
                  <Link href={`/applicants/${other.id}`} className="text-accent underline underline-offset-2">
                    {other.reference} · {other.displayName}
                  </Link>{' '}
                  — {candidate.signalDetail}
                </p>
              );
            })}
            {access.reassign ? (
              <MergeDialog
                survivingApplicantId={applicant.id}
                candidates={data.duplicates.map((candidate) => {
                  const other =
                    candidate.applicantAId === applicant.id ? candidate.applicantB : candidate.applicantA;
                  return {
                    id: other.id,
                    candidateId: candidate.id,
                    label: `${other.reference} · ${other.displayName}`,
                    signalDetail: candidate.signalDetail,
                  };
                })}
              />
            ) : (
              <Notice tone="neutral">Merging needs reassignment authority.</Notice>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

function ConversationPanel({
  data,
  timezone,
  contactOptions,
}: {
  data: CaseFileData;
  timezone: string;
  contactOptions: Array<{ value: string; label: string }>;
}) {
  const { applicant, access } = data;
  return (
    <Card>
      <CardHeader
        title="Conversation"
        description="Authorship, approval and transport are separate facts, and each message says which it is."
        actions={
          access.act ? <DraftMessageDialog applicantId={applicant.id} contactOptions={contactOptions} /> : null
        }
      />
      <CardBody className="space-y-2">
        {data.messages.length === 0 && data.calls.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={20} />}
            title="No messages or calls yet"
            description="When the applicant writes in, or you send something, it appears here with its full transport history."
          />
        ) : null}

        <ul className="space-y-2">
          {data.messages.map((message) => {
            const inbound = message.direction === 'INBOUND';
            return (
              <li
                key={message.id}
                className={
                  inbound
                    ? 'rounded-md border border-line bg-surface-muted px-3 py-2'
                    : 'rounded-md border border-accent/20 bg-accent-soft/40 px-3 py-2'
                }
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={inbound ? 'accent' : 'neutral'} icon={inbound ? <MessageSquare size={12} /> : <Send size={12} />}>
                    {message.authorKind === 'APPLICANT'
                      ? 'Applicant'
                      : message.authorKind === 'RECRUITER'
                        ? 'Recruiter'
                        : message.authorKind === 'APPROVED_AUTOMATION'
                          ? 'Approved automation'
                          : 'System'}
                  </Badge>
                  <Badge tone={MESSAGE_STATE_TONE[message.state] ?? 'neutral'}>
                    {MESSAGE_STATE_LABEL[message.state] ?? message.state}
                  </Badge>
                  {message.simulated ? (
                    <Badge tone="pending" icon={<Bot size={12} />}>
                      simulated
                    </Badge>
                  ) : null}
                  {message.aiGenerated ? <Badge tone="neutral">AI-drafted</Badge> : null}
                  <span className="ml-auto text-[12px] text-ink-faint">{fmt(message.occurredAt, timezone)}</span>
                </div>

                <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] text-ink">{message.body}</p>

                {message.blockedReason ? (
                  <p className="mt-1 text-[12.5px] font-medium text-review">Blocked: {message.blockedReason}</p>
                ) : null}
                {message.failureDetail ? (
                  <p className="mt-1 text-[12.5px] text-review">
                    {message.failureCode ? `${message.failureCode}: ` : ''}
                    {message.failureDetail}
                  </p>
                ) : null}
                {message.approvedAt ? (
                  <p className="mt-1 text-[12px] text-ink-faint">
                    Approved {fmt(message.approvedAt, timezone)}
                  </p>
                ) : null}

                {message.deliveryEvents.length ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[12px] text-ink-faint">
                      Carrier events ({message.deliveryEvents.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-[12px] text-ink-faint">
                      {message.deliveryEvents.map((event) => (
                        <li key={event.id}>
                          {fmt(event.occurredAt, timezone)} · {event.providerStatus} → {event.normalizedState}
                          {event.errorCode ? ` (${event.errorCode})` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {access.act ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {message.state === 'DRAFT' ? (
                      <>
                        <EditDraftDialog
                          applicantId={applicant.id}
                          messageId={message.id}
                          version={message.version}
                          body={message.body}
                          wasApproved={false}
                        />
                        <ApproveMessageForm
                          applicantId={applicant.id}
                          messageId={message.id}
                          version={message.version}
                        />
                      </>
                    ) : null}
                    {message.state === 'APPROVED' ? (
                      <>
                        <SendMessageDialog applicantId={applicant.id} messageId={message.id} />
                        <EditDraftDialog
                          applicantId={applicant.id}
                          messageId={message.id}
                          version={message.version}
                          body={message.body}
                          wasApproved
                        />
                      </>
                    ) : null}
                    {['SCHEDULED', 'QUEUED'].includes(message.state) ? (
                      <CancelMessageDialog applicantId={applicant.id} messageId={message.id} />
                    ) : null}
                    {message.state === 'BLOCKED' ? (
                      <EditDraftDialog
                        applicantId={applicant.id}
                        messageId={message.id}
                        version={message.version}
                        body={message.body}
                        wasApproved={false}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {data.calls.length ? (
          <div className="border-t border-line pt-3">
            <SectionTitle>Calls</SectionTitle>
            <ul className="mt-1.5 space-y-1.5">
              {data.calls.map((call) => (
                <li key={call.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Badge
                    tone={call.humanConnected ? 'ready' : 'pending'}
                    icon={<Phone size={12} />}
                  >
                    {call.outcome.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  <span className="text-ink">
                    {call.direction.replace(/_/g, ' ').toLowerCase()} · {maskContact(call.toValue)}
                  </span>
                  {call.simulated ? <Badge tone="pending">simulated</Badge> : null}
                  <span className="text-ink-faint">{fmt(call.occurredAt, timezone)}</span>
                  {call.note ? <span className="text-ink-faint">— {call.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Intake / Notes / Tasks / Activity
// ---------------------------------------------------------------------------

function IntakePanel({ data, timezone }: { data: CaseFileData; timezone: string }) {
  return (
    <Card>
      <CardHeader
        title="Intake"
        description="Answers are immutable revisions, recorded against the exact published question version the applicant saw."
      />
      <CardBody className="space-y-4">
        {data.intakeSessions.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title="No intake session"
            description="Issue a secure intake link from the Overview tab to invite the applicant to answer a few questions."
          />
        ) : null}
        {data.intakeSessions.map((session) => (
          <div key={session.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={session.status === 'COMPLETED' ? 'ready' : session.status === 'HANDED_OFF' ? 'review' : 'pending'}>
                {session.status.replace(/_/g, ' ').toLowerCase()}
              </Badge>
              <Badge tone="neutral">
                {session.pathway === 'CALLBACK_REQUEST' ? 'callback request' : 'full intake'}
              </Badge>
              <Badge tone="neutral">question set v{session.intakeVersion.version}</Badge>
              <span className="text-[12px] text-ink-faint">
                started {fmt(session.createdAt, timezone)}
                {session.completedAt ? ` · completed ${fmt(session.completedAt, timezone)}` : ''}
              </span>
            </div>
            {session.answers.length ? (
              <dl className="divide-y divide-line rounded-md border border-line">
                {session.answers.map((answer) => (
                  <div key={answer.id} className="px-3 py-2">
                    <dt className="text-[12.5px] text-ink-faint">{answer.questionPrompt}</dt>
                    <dd className="mt-0.5 text-[13.5px] text-ink">
                      {answer.skipped ? (
                        <span className="text-ink-faint">skipped</span>
                      ) : answer.sensitive && !data.access.sensitive ? (
                        <Badge tone="pending" icon={<Lock size={12} />}>
                          restricted — needs a sensitive-source grant
                        </Badge>
                      ) : (
                        answer.valueText || <span className="text-ink-faint">blank</span>
                      )}
                      {answer.revision > 1 ? (
                        <Badge tone="neutral" className="ml-1.5">
                          revision {answer.revision}
                        </Badge>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-ink-faint">No answers recorded yet.</p>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function NotesPanel({ data, timezone }: { data: CaseFileData; timezone: string }) {
  return (
    <Card>
      <CardHeader
        title="Staff notes"
        description="Private to authorized staff. Excluded from external AI preparation by default."
        actions={data.access.act ? <AddNoteDialog applicantId={data.applicant.id} /> : null}
      />
      <CardBody className="space-y-2">
        {data.notes.length === 0 ? (
          <EmptyState icon={<FileText size={20} />} title="No notes" description="Add one from the button above." />
        ) : null}
        {data.notes.map((note) => {
          const latest = note.revisions[0];
          const restricted = note.sensitive && !data.access.sensitive;
          return (
            <div key={note.id} className="rounded-md border border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {note.sensitive ? (
                  <Badge tone="pending" icon={<Lock size={12} />}>
                    sensitive
                  </Badge>
                ) : null}
                <span className="text-[12px] text-ink-faint">
                  {fmt(note.createdAt, timezone)}
                  {note.revisions.length > 1 ? ` · ${note.revisions.length} revisions` : ''}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-ink">
                {restricted ? 'Restricted. Reading this needs a sensitive-source grant.' : (latest?.body ?? '')}
              </p>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function TasksPanel({
  data,
  timezone,
  nowInstant,
}: {
  data: CaseFileData;
  timezone: string;
  nowInstant: Date;
}) {
  const { applicant, access } = data;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Follow-ups"
          description="Completing one needs an outcome. Moving one keeps the date originally promised."
          actions={
            access.act ? (
              <CreateTaskDialog
                applicantId={applicant.id}
                now={localInputValue(addMinutes(nowInstant, 60), timezone)}
              />
            ) : null
          }
        />
        <CardBody className="space-y-2">
          {data.tasks.length === 0 ? (
            <EmptyState icon={<Clock size={20} />} title="No follow-ups" description="Add one to keep this case accountable." />
          ) : null}
          {data.tasks.map((task) => {
            const overdue = task.status !== 'COMPLETED' && task.status !== 'CANCELED' && task.originalDueAt < nowInstant;
            return (
              <div key={task.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink">{task.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-faint">{task.reason}</p>
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      Due {fmt(task.dueAt, timezone)}
                      {task.dueAt.getTime() !== task.originalDueAt.getTime()
                        ? ` · originally promised ${fmt(task.originalDueAt, timezone)}`
                        : ''}
                      {task.snoozeCount ? ` · moved ${task.snoozeCount}×` : ''} · owner {task.owner.displayName}
                    </p>
                    {task.completionOutcome ? (
                      <p className="mt-0.5 text-[12px] text-ready">
                        Completed {fmt(task.completedAt, timezone)} — {task.completionOutcome.replace(/_/g, ' ').toLowerCase()}
                        {task.completionNote ? `: ${task.completionNote}` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        task.status === 'COMPLETED'
                          ? 'ready'
                          : task.status === 'CANCELED'
                            ? 'neutral'
                            : overdue
                              ? 'review'
                              : 'pending'
                      }
                      icon={overdue ? <AlertTriangle size={12} /> : undefined}
                    >
                      {overdue && task.status !== 'COMPLETED' ? 'overdue' : task.status.toLowerCase()}
                    </Badge>
                    {access.act && (task.status === 'OPEN' || task.status === 'SNOOZED') ? (
                      <>
                        <CompleteTaskDialog
                          applicantId={applicant.id}
                          taskId={task.id}
                          version={task.version}
                          title={task.title}
                        />
                        <SnoozeTaskDialog
                          applicantId={applicant.id}
                          taskId={task.id}
                          version={task.version}
                          originalDueAt={fmt(task.originalDueAt, timezone)}
                        />
                        <CancelTaskDialog applicantId={applicant.id} taskId={task.id} version={task.version} />
                      </>
                    ) : null}
                  </div>
                </div>
                {task.snoozes.length ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[12px] text-ink-faint">
                      Move history ({task.snoozes.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-[12px] text-ink-faint">
                      {task.snoozes.map((snooze) => (
                        <li key={snooze.id}>
                          {fmt(snooze.fromDueAt, timezone)} → {fmt(snooze.toDueAt, timezone)} · {snooze.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Appointments"
          description="Internal scheduling with an .ics download. This is not Google or Microsoft calendar synchronization."
          actions={
            access.act ? (
              <ScheduleAppointmentDialog
                applicantId={applicant.id}
                timezone={timezone}
                members={data.members}
                defaultRecruiterId={applicant.ownerMemberId ?? undefined}
                defaultLocal={localInputValue(addMinutes(nowInstant, 24 * 60), timezone)}
              />
            ) : null
          }
        />
        <CardBody className="space-y-2">
          {data.appointments.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={20} />}
              title="No appointments"
              description="Schedule one and the applicant gets a scoped confirmation link."
            />
          ) : null}
          {data.appointments.map((appointment) => (
            <div key={appointment.id} className="rounded-md border border-line px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-ink">
                    {fmt(appointment.startsAt, appointment.timezone)} · {appointment.purpose}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-faint">
                    {appointment.medium.replace('_', ' ').toLowerCase()}
                    {appointment.locationDetail ? ` · ${appointment.locationDetail}` : ''} · with{' '}
                    {appointment.recruiter.displayName} · {appointment.timezone}
                  </p>
                  {appointment.supersedesAppointmentId ? (
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      Replaces an earlier slot. The superseded slot is not counted as attended.
                    </p>
                  ) : null}
                  {appointment.outcome ? (
                    <p className="mt-0.5 text-[12px] text-ink-soft">
                      Outcome: {appointment.outcome.replace(/_/g, ' ').toLowerCase()}
                      {appointment.outcomeNote ? ` — ${appointment.outcomeNote}` : ''}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    Reminders:{' '}
                    {appointment.reminders.length
                      ? appointment.reminders
                          .map((r) => `${r.status} ${fmt(r.sendAt, appointment.timezone)}`)
                          .join(', ')
                      : 'none'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      appointment.state === 'CONFIRMED' || appointment.state === 'COMPLETED'
                        ? 'ready'
                        : appointment.state === 'NO_SHOW'
                          ? 'review'
                          : appointment.state === 'CANCELED'
                            ? 'neutral'
                            : 'pending'
                    }
                  >
                    {appointment.state.replace('_', ' ').toLowerCase()}
                  </Badge>
                  <a
                    href={`/api/appointments/${appointment.id}/ics`}
                    className="touch-target inline-flex items-center rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px]"
                  >
                    Download .ics
                  </a>
                  {access.act && ['PROPOSED', 'SCHEDULED', 'CONFIRMED'].includes(appointment.state) ? (
                    <>
                      <AppointmentOutcomeDialog applicantId={applicant.id} appointmentId={appointment.id} />
                      <RescheduleAppointmentDialog
                        applicantId={applicant.id}
                        appointmentId={appointment.id}
                        timezone={appointment.timezone}
                        purpose={appointment.purpose}
                      />
                      <CancelAppointmentDialog applicantId={applicant.id} appointmentId={appointment.id} />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function ActivityPanel({ data, timezone }: { data: CaseFileData; timezone: string }) {
  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Every change on this case, with who made it. Metadata only — it is not a second copy of the conversation."
      />
      <CardBody>
        {data.activity.length === 0 ? (
          <EmptyState icon={<Info size={20} />} title="Nothing recorded yet" description="Activity appears as work happens." />
        ) : (
          <ol className="space-y-1.5">
            {data.activity.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span className="w-44 shrink-0 text-[12px] text-ink-faint">{fmt(event.occurredAt, timezone)}</span>
                <span className="font-medium text-ink">{event.action}</span>
                <span className="text-ink-faint">by {event.actorLabel ?? event.actorKind}</span>
                {event.category === 'SECURITY' ? <Badge tone="neutral">security</Badge> : null}
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
