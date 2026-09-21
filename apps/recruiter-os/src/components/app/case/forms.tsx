'use client';
import * as React from 'react';
import {
  CalendarPlus,
  CheckCircle2,
  Clock,
  MessageSquarePlus,
  PhoneCall,
  Pencil,
  RefreshCw,
  ShieldCheck,
  StickyNote,
  UserCog,
  Link2,
  Merge,
} from 'lucide-react';
import { Badge, Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, FieldError } from '@/components/ui/form';
import {
  addNoteAction,
  approveDraftAction,
  cancelAppointmentAction,
  cancelMessageAction,
  cancelTaskAction,
  completeTaskAction,
  createDraftAction,
  createTaskAction,
  editBriefItemAction,
  editDraftAction,
  issueIntakeLinkAction,
  logCallAction,
  mergeCasesAction,
  notDuplicateAction,
  reassignAction,
  recordAppointmentOutcomeAction,
  recordConsentAction,
  regenerateBriefAction,
  rescheduleAppointmentAction,
  resolveFlagAction,
  reviewBriefAction,
  scheduleAppointmentAction,
  sendMessageAction,
  setStatusAction,
  snoozeTaskAction,
  updateCaseAction,
} from '@/server/actions/case-actions';

function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function AddNoteDialog({ applicantId }: { applicantId: string }) {
  return (
    <Dialog
      title="Add a staff note"
      description="Staff notes are private to authorized staff and are never sent to an external AI provider by default."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <StickyNote size={14} aria-hidden="true" /> Add note
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={addNoteAction} submitLabel="Save note" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Field label="Note" htmlFor="note-body" required>
                <Textarea id="note-body" name="body" required rows={5} />
                <FieldError state={state} name="body" />
              </Field>
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" name="sensitive" className="mt-1" />
                <span>
                  Mark as sensitive. Restricted to staff with the sensitive-source grant and excluded
                  from brief preparation.
                </span>
              </label>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export function DraftMessageDialog({
  applicantId,
  contactOptions,
  suggestedBody,
  briefId,
}: {
  applicantId: string;
  contactOptions: Array<{ value: string; label: string }>;
  suggestedBody?: string | null;
  briefId?: string | null;
}) {
  return (
    <Dialog
      title="Prepare a message"
      description="Saving a draft is not sending. It has to be approved, then queued."
      trigger={(open) => (
        <Button size="sm" variant="primary" onClick={open}>
          <MessageSquarePlus size={14} aria-hidden="true" /> Prepare message
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={createDraftAction} submitLabel="Save draft" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              {briefId ? <Hidden name="aiBriefId" value={briefId} /> : null}
              <Field label="Send to" htmlFor="draft-to" required>
                <Select id="draft-to" name="toValue" required>
                  {contactOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <FieldError state={state} name="toValue" />
              </Field>
              <Field
                label="Message"
                htmlFor="draft-body"
                required
                hint={
                  suggestedBody
                    ? 'Pre-filled from the prepared brief. Edit it freely — it is your message once you approve it.'
                    : undefined
                }
              >
                <Textarea id="draft-body" name="body" required rows={5} defaultValue={suggestedBody ?? ''} />
                <FieldError state={state} name="body" />
              </Field>
              {suggestedBody ? (
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" name="aiGenerated" defaultChecked className="mt-1" />
                  <span>Record that this text started from AI preparation.</span>
                </label>
              ) : null}
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditDraftDialog({
  applicantId,
  messageId,
  version,
  body,
  wasApproved,
}: {
  applicantId: string;
  messageId: string;
  version: number;
  body: string;
  wasApproved: boolean;
}) {
  return (
    <Dialog
      title="Edit this message"
      description={
        wasApproved
          ? 'This message is approved. Editing it cancels that approval — you will need to approve the new text.'
          : undefined
      }
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Pencil size={14} aria-hidden="true" /> Edit
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={editDraftAction} submitLabel="Save changes" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Hidden name="messageId" value={messageId} />
              <Hidden name="expectedVersion" value={version} />
              {wasApproved ? (
                <Notice tone="pending">
                  Approval covers one exact text. Saving this clears it.
                </Notice>
              ) : null}
              <Field label="Message" htmlFor="edit-body" required>
                <Textarea id="edit-body" name="body" required rows={5} defaultValue={body} />
                <FieldError state={state} name="body" />
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ApproveMessageForm({
  applicantId,
  messageId,
  version,
}: {
  applicantId: string;
  messageId: string;
  version: number;
}) {
  return (
    <ActionForm action={approveDraftAction} submitLabel="Approve" submitVariant="ready" className="inline">
      <Hidden name="applicantId" value={applicantId} />
      <Hidden name="messageId" value={messageId} />
      <Hidden name="expectedVersion" value={version} />
    </ActionForm>
  );
}

export function SendMessageDialog({
  applicantId,
  messageId,
}: {
  applicantId: string;
  messageId: string;
}) {
  return (
    <Dialog
      title="Send or schedule"
      description="Permission, opt-out state, approved text, provider enablement and the contact window are all re-checked immediately before dispatch."
      trigger={(open) => (
        <Button size="sm" variant="primary" onClick={open}>
          Send…
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={sendMessageAction} submitLabel="Queue it" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="messageId" value={messageId} />
          <Field
            label="Send at"
            htmlFor="send-at"
            hint="Leave empty to send as soon as the worker picks it up."
          >
            <Input id="send-at" name="sendAt" type="datetime-local" />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CancelMessageDialog({
  applicantId,
  messageId,
}: {
  applicantId: string;
  messageId: string;
}) {
  return (
    <Dialog
      title="Cancel this message"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Cancel
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={cancelMessageAction} submitLabel="Cancel message" submitVariant="danger" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="messageId" value={messageId} />
          <Field label="Reason" htmlFor="cancel-reason" required>
            <Input id="cancel-reason" name="reason" required />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export function LogCallDialog({
  applicantId,
  phoneOptions,
}: {
  applicantId: string;
  phoneOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <Dialog
      title="Record a call outcome"
      description="Opening the dialler does not record anything. What happened is what you enter here."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <PhoneCall size={14} aria-hidden="true" /> Record call
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={logCallAction} submitLabel="Save call" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Field label="Number called" htmlFor="call-to" required>
                <Select id="call-to" name="toValue" required>
                  {phoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What happened" htmlFor="call-outcome" required>
                <Select id="call-outcome" name="outcome" required defaultValue="NO_ANSWER">
                  <option value="CONNECTED">Spoke with the applicant</option>
                  <option value="VOICEMAIL">Left a voicemail</option>
                  <option value="NO_ANSWER">No answer</option>
                  <option value="BUSY">Busy</option>
                  <option value="FAILED">Call failed</option>
                </Select>
                <FieldError state={state} name="outcome" />
              </Field>
              <Field label="Length in seconds" htmlFor="call-duration">
                <Input id="call-duration" name="durationSeconds" type="number" min={0} max={7200} />
              </Field>
              <Field label="Note" htmlFor="call-note">
                <Textarea id="call-note" name="note" rows={3} />
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function CreateTaskDialog({ applicantId, now }: { applicantId: string; now: string }) {
  return (
    <Dialog
      title="Add a follow-up"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Clock size={14} aria-hidden="true" /> Add follow-up
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={createTaskAction} submitLabel="Create follow-up" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Field label="Type" htmlFor="task-type" required>
                <Select id="task-type" name="type" required defaultValue="FOLLOW_UP">
                  <option value="FOLLOW_UP">Follow-up</option>
                  <option value="CALLBACK">Callback</option>
                  <option value="APPOINTMENT_PREP">Appointment preparation</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="What needs doing" htmlFor="task-title" required>
                <Input id="task-title" name="title" required />
                <FieldError state={state} name="title" />
              </Field>
              <Field label="Why" htmlFor="task-reason" required hint="Shown in the priority queue.">
                <Input id="task-reason" name="reason" required />
                <FieldError state={state} name="reason" />
              </Field>
              <Field label="Due" htmlFor="task-due" required>
                <Input id="task-due" name="dueAt" type="datetime-local" required defaultValue={now} />
                <FieldError state={state} name="dueAt" />
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CompleteTaskDialog({
  applicantId,
  taskId,
  version,
  title,
}: {
  applicantId: string;
  taskId: string;
  version: number;
  title: string;
}) {
  return (
    <Dialog
      title="Complete this follow-up"
      description="A follow-up is only complete with a recorded outcome."
      trigger={(open) => (
        <Button size="sm" variant="ready" onClick={open}>
          <CheckCircle2 size={14} aria-hidden="true" /> Complete
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={completeTaskAction} submitLabel="Complete" submitVariant="ready" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="taskId" value={taskId} />
          <Hidden name="expectedVersion" value={version} />
          <p className="text-[13px] text-ink-soft">{title}</p>
          <Field label="Outcome" htmlFor="complete-outcome" required>
            <Select id="complete-outcome" name="outcome" required defaultValue="RESOLVED">
              <option value="SPOKE_WITH_APPLICANT">Spoke with the applicant</option>
              <option value="LEFT_VOICEMAIL">Left a voicemail</option>
              <option value="NO_ANSWER">No answer</option>
              <option value="SENT_MESSAGE">Sent a message</option>
              <option value="APPOINTMENT_SET">Set an appointment</option>
              <option value="RESOLVED">Resolved</option>
              <option value="NOT_NEEDED">No longer needed</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Note" htmlFor="complete-note">
            <Textarea id="complete-note" name="note" rows={3} />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function SnoozeTaskDialog({
  applicantId,
  taskId,
  version,
  originalDueAt,
}: {
  applicantId: string;
  taskId: string;
  version: number;
  originalDueAt: string;
}) {
  return (
    <Dialog
      title="Move this follow-up"
      description="Moving it needs a reason and a new date. The date originally promised is kept."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Move
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={snoozeTaskAction} submitLabel="Move it" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Hidden name="taskId" value={taskId} />
              <Hidden name="expectedVersion" value={version} />
              <Notice tone="neutral">Originally promised for {originalDueAt}. That stays on the record.</Notice>
              <Field label="New date" htmlFor="snooze-due" required>
                <Input id="snooze-due" name="newDueAt" type="datetime-local" required />
                <FieldError state={state} name="newDueAt" />
              </Field>
              <Field label="Reason" htmlFor="snooze-reason" required>
                <Input id="snooze-reason" name="reason" required />
                <FieldError state={state} name="reason" />
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CancelTaskDialog({
  applicantId,
  taskId,
  version,
}: {
  applicantId: string;
  taskId: string;
  version: number;
}) {
  return (
    <Dialog
      title="Cancel this follow-up"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Cancel
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={cancelTaskAction} submitLabel="Cancel it" submitVariant="danger" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="taskId" value={taskId} />
          <Hidden name="expectedVersion" value={version} />
          <Field label="Reason" htmlFor="cancel-task-reason" required>
            <Input id="cancel-task-reason" name="reason" required />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

const MEDIUM_OPTIONS = (
  <>
    <option value="IN_PERSON">In person</option>
    <option value="PHONE">Phone</option>
    <option value="VIDEO">Video</option>
  </>
);

export function ScheduleAppointmentDialog({
  applicantId,
  timezone,
  members,
  defaultRecruiterId,
  defaultLocal,
}: {
  applicantId: string;
  timezone: string;
  members: Array<{ id: string; displayName: string }>;
  defaultRecruiterId?: string;
  /** Wall clock of the case timezone, prepared on the server. */
  defaultLocal: string;
}) {
  return (
    <Dialog
      title="Schedule an appointment"
      description="Times are stored as an instant plus the zone they were agreed in. Daylight-saving gaps and overlaps are reported, not guessed."
      trigger={(open) => (
        <Button size="sm" variant="primary" onClick={open}>
          <CalendarPlus size={14} aria-hidden="true" /> Schedule
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={scheduleAppointmentAction} submitLabel="Schedule" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Field label="Recruiter" htmlFor="appt-recruiter" required>
                <Select id="appt-recruiter" name="recruiterMemberId" required defaultValue={defaultRecruiterId}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Local date and time" htmlFor="appt-local" required>
                  <Input id="appt-local" name="local" type="datetime-local" required defaultValue={defaultLocal} />
                  <FieldError state={state} name="local" />
                </Field>
                <Field label="Timezone" htmlFor="appt-tz" required hint="The zone the time was agreed in.">
                  <Input id="appt-tz" name="timezone" required defaultValue={timezone} />
                  <FieldError state={state} name="timezone" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Length in minutes" htmlFor="appt-duration" required>
                  <Input
                    id="appt-duration"
                    name="durationMinutes"
                    type="number"
                    min={10}
                    max={240}
                    defaultValue={45}
                    required
                  />
                </Field>
                <Field label="Type" htmlFor="appt-medium" required>
                  <Select id="appt-medium" name="medium" required defaultValue="IN_PERSON">
                    {MEDIUM_OPTIONS}
                  </Select>
                </Field>
              </div>
              <Field label="Where / how" htmlFor="appt-location">
                <Input id="appt-location" name="locationDetail" />
              </Field>
              <Field label="Purpose" htmlFor="appt-purpose" required>
                <Input id="appt-purpose" name="purpose" required defaultValue="Initial conversation" />
              </Field>
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" name="acceptAmbiguous" className="mt-1" />
                <span>
                  If this local time happens twice because the clocks go back, use the earlier one.
                </span>
              </label>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function RescheduleAppointmentDialog({
  applicantId,
  appointmentId,
  timezone,
  purpose,
}: {
  applicantId: string;
  appointmentId: string;
  timezone: string;
  purpose: string;
}) {
  return (
    <Dialog
      title="Reschedule"
      description="The old slot is canceled with its reminders, and the lineage is kept — a superseded slot never counts as attended."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Reschedule
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={rescheduleAppointmentAction} submitLabel="Reschedule" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Hidden name="appointmentId" value={appointmentId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New local date and time" htmlFor="re-local" required>
                  <Input id="re-local" name="local" type="datetime-local" required />
                  <FieldError state={state} name="local" />
                </Field>
                <Field label="Timezone" htmlFor="re-tz" required>
                  <Input id="re-tz" name="timezone" required defaultValue={timezone} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Length in minutes" htmlFor="re-duration" required>
                  <Input id="re-duration" name="durationMinutes" type="number" min={10} max={240} defaultValue={45} required />
                </Field>
                <Field label="Type" htmlFor="re-medium" required>
                  <Select id="re-medium" name="medium" required defaultValue="IN_PERSON">
                    {MEDIUM_OPTIONS}
                  </Select>
                </Field>
              </div>
              <Field label="Purpose" htmlFor="re-purpose" required>
                <Input id="re-purpose" name="purpose" required defaultValue={purpose} />
              </Field>
              <Field label="Reason for moving it" htmlFor="re-reason" required>
                <Input id="re-reason" name="reason" required />
              </Field>
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" name="acceptAmbiguous" className="mt-1" />
                <span>Accept the earlier occurrence if the clocks go back that hour.</span>
              </label>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function AppointmentOutcomeDialog({
  applicantId,
  appointmentId,
}: {
  applicantId: string;
  appointmentId: string;
}) {
  return (
    <Dialog
      title="Record what happened"
      trigger={(open) => (
        <Button size="sm" variant="ready" onClick={open}>
          Record outcome
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm
          action={recordAppointmentOutcomeAction}
          submitLabel="Save outcome"
          submitVariant="ready"
          onSuccess={close}
        >
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="appointmentId" value={appointmentId} />
          <Field label="Outcome" htmlFor="appt-outcome" required>
            <Select id="appt-outcome" name="outcome" required defaultValue="ATTENDED">
              <option value="ATTENDED">Attended</option>
              <option value="NO_SHOW">Did not attend</option>
              <option value="CANCELED_BY_APPLICANT">Canceled by the applicant</option>
              <option value="CANCELED_BY_RECRUITER">Canceled by us</option>
            </Select>
          </Field>
          <Field label="Note" htmlFor="appt-outcome-note">
            <Textarea id="appt-outcome-note" name="note" rows={3} />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CancelAppointmentDialog({
  applicantId,
  appointmentId,
}: {
  applicantId: string;
  appointmentId: string;
}) {
  return (
    <Dialog
      title="Cancel the appointment"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Cancel
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={cancelAppointmentAction} submitLabel="Cancel appointment" submitVariant="danger" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="appointmentId" value={appointmentId} />
          <Field label="Reason" htmlFor="appt-cancel-reason" required>
            <Input id="appt-cancel-reason" name="reason" required />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="byApplicant" />
            <span>The applicant asked to cancel</span>
          </label>
        </ActionForm>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export function BriefReviewForm({
  applicantId,
  briefId,
  action,
  label,
}: {
  applicantId: string;
  briefId: string;
  action: 'approve' | 'reject';
  label: string;
}) {
  return (
    <ActionForm
      action={reviewBriefAction}
      submitLabel={label}
      submitVariant={action === 'approve' ? 'ready' : 'secondary'}
      className="inline"
    >
      <Hidden name="applicantId" value={applicantId} />
      <Hidden name="briefId" value={briefId} />
      <Hidden name="action" value={action} />
    </ActionForm>
  );
}

export function RegenerateBriefForm({ applicantId }: { applicantId: string }) {
  return (
    <ActionForm action={regenerateBriefAction} submitLabel="Regenerate" className="inline">
      <Hidden name="applicantId" value={applicantId} />
      <span className="sr-only">
        <RefreshCw size={12} aria-hidden="true" />
      </span>
    </ActionForm>
  );
}

export function EditBriefItemDialog({
  applicantId,
  briefItemId,
  currentText,
}: {
  applicantId: string;
  briefItemId: string;
  currentText: string;
}) {
  return (
    <Dialog
      title="Correct this line"
      description="Your correction is stored beside the generated text and is carried forward when the brief is regenerated."
      trigger={(open) => (
        <Button size="sm" variant="ghost" onClick={open} aria-label="Correct this line">
          <Pencil size={13} aria-hidden="true" /> Correct
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={editBriefItemAction} submitLabel="Save correction" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="briefItemId" value={briefItemId} />
          <Field label="Corrected text" htmlFor="brief-item-text" required>
            <Textarea id="brief-item-text" name="text" rows={4} required defaultValue={currentText} />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Review flags, ownership, status, intake links
// ---------------------------------------------------------------------------

export function ResolveFlagDialog({
  applicantId,
  flagId,
  kind,
}: {
  applicantId: string;
  flagId: string;
  kind: string;
}) {
  return (
    <Dialog
      title="Resolve this review"
      description="Say what you did. Automated conversation resumes only when nothing else is waiting on a person."
      trigger={(open) => (
        <Button size="sm" variant="primary" onClick={open}>
          <ShieldCheck size={14} aria-hidden="true" /> Resolve
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={resolveFlagAction} submitLabel="Resolve" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="flagId" value={flagId} />
          <Badge tone="review">{kind.replace(/_/g, ' ').toLowerCase()}</Badge>
          <Field label="Resolution" htmlFor="flag-resolution" required>
            <Select id="flag-resolution" name="resolution" required defaultValue="RESOLVED">
              <option value="RESOLVED">Handled it</option>
              <option value="DISMISSED">Not needed</option>
            </Select>
          </Field>
          <Field label="What you did" htmlFor="flag-reason" required>
            <Textarea id="flag-reason" name="reason" rows={3} required />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ReassignDialog({
  applicantId,
  members,
  currentOwnerId,
}: {
  applicantId: string;
  members: Array<{ id: string; displayName: string; staffRole: string }>;
  currentOwnerId: string | null;
}) {
  return (
    <Dialog
      title="Change the accountable owner"
      description="Open follow-ups move with the case, so nothing is left owned by the previous recruiter."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <UserCog size={14} aria-hidden="true" /> Reassign
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={reassignAction} submitLabel="Reassign" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Field label="New owner" htmlFor="reassign-member" required>
            <Select id="reassign-member" name="toMemberId" required>
              {members
                .filter((m) => m.id !== currentOwnerId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} — {m.staffRole.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Reason" htmlFor="reassign-reason" required>
            <Input id="reassign-reason" name="reason" required />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function StatusDialog({
  applicantId,
  currentStatus,
  version,
}: {
  applicantId: string;
  currentStatus: string;
  version: number;
}) {
  const [status, setStatus] = React.useState(currentStatus);
  return (
    <Dialog
      title="Change workflow status"
      description="Workflow status is separate from review flags and contact permissions. Closing is an operational state with a reason — never a statement about whether someone is eligible to serve."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Change status
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={setStatusAction} submitLabel="Save status" onSuccess={close}>
          {(state) => (
            <>
              <Hidden name="applicantId" value={applicantId} />
              <Hidden name="expectedVersion" value={version} />
              <Field label="Status" htmlFor="status-select" required>
                <Select
                  id="status-select"
                  name="status"
                  required
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="NEW_INQUIRY">New inquiry</option>
                  <option value="INTAKE_IN_PROGRESS">Intake in progress</option>
                  <option value="READY_FOR_RECRUITER">Ready for recruiter</option>
                  <option value="CONTACT_ATTEMPTED">Contact attempted</option>
                  <option value="TWO_WAY_CONVERSATION">Two-way conversation</option>
                  <option value="APPOINTMENT_SCHEDULED">Appointment scheduled</option>
                  <option value="AWAITING_APPLICANT">Awaiting applicant</option>
                  <option value="CLOSED">Closed</option>
                </Select>
                <FieldError state={state} name="status" />
              </Field>
              {status === 'CLOSED' ? (
                <Field label="Closure reason" htmlFor="closure-reason" required>
                  <Select id="closure-reason" name="closureReason" required defaultValue="UNABLE_TO_REACH">
                    <option value="APPLICANT_REQUESTED_STOP">The applicant asked us to stop</option>
                    <option value="APPLICANT_WITHDREW">The applicant withdrew</option>
                    <option value="UNABLE_TO_REACH">Unable to reach</option>
                    <option value="REFERRED_ELSEWHERE">Referred elsewhere</option>
                    <option value="HANDED_OFF_TO_OFFICIAL_SYSTEM">Handed off to the official system</option>
                    <option value="OTHER">Other</option>
                  </Select>
                  <FieldError state={state} name="closureReason" />
                </Field>
              ) : null}
              <Field label="Note" htmlFor="status-reason">
                <Input id="status-reason" name="reason" />
              </Field>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function IntakeLinkForm({ applicantId }: { applicantId: string }) {
  return (
    <ActionForm action={issueIntakeLinkAction} submitLabel="Issue intake link" className="inline">
      <Hidden name="applicantId" value={applicantId} />
      <span className="sr-only">
        <Link2 size={12} aria-hidden="true" />
      </span>
    </ActionForm>
  );
}

export function RecordConsentDialog({
  applicantId,
  contactOptions,
}: {
  applicantId: string;
  contactOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <Dialog
      title="Record a contact permission"
      description="Records exactly what the person agreed to, for which channel and purpose, with the disclosure version they were given."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Record permission
        </Button>
      )}
      width="sm"
    >
      {(close) => (
        <ActionForm action={recordConsentAction} submitLabel="Record it" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Field label="Contact" htmlFor="consent-contact" required>
            <Select id="consent-contact" name="contactValue" required>
              {contactOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Purpose" htmlFor="consent-purpose" required>
            <Select id="consent-purpose" name="purpose" required defaultValue="CALLBACK_CALL">
              <option value="CALLBACK_CALL">Phone callback</option>
              <option value="RECRUITER_SMS">Recruiter text messages</option>
              <option value="INTAKE_SMS">Intake link by text</option>
              <option value="APPOINTMENT_REMINDER_SMS">Appointment reminders by text</option>
              <option value="EMAIL_UPDATES">Email updates</option>
            </Select>
          </Field>
          <Field label="Agreed?" htmlFor="consent-granted" required>
            <Select id="consent-granted" name="granted" required defaultValue="yes">
              <option value="yes">Yes, they agreed</option>
              <option value="no">No / they withdrew it</option>
            </Select>
          </Field>
          <Field label="How you recorded it" htmlFor="consent-note" required>
            <Input id="consent-note" name="note" required placeholder="e.g. said yes on the phone today" />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function MergeDialog({
  survivingApplicantId,
  candidates,
}: {
  survivingApplicantId: string;
  candidates: Array<{ id: string; label: string; candidateId: string; signalDetail: string }>;
}) {
  return (
    <Dialog
      title="Resolve a possible duplicate"
      description="A shared phone number or a matching name is not proof of identity. Merging is explicit and preserves provenance; the strictest contact permissions are kept until reviewed."
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Merge size={14} aria-hidden="true" /> Review duplicate
        </Button>
      )}
    >
      {() => (
        <div className="space-y-4">
          {candidates.map((candidate) => (
            <div key={candidate.candidateId} className="space-y-2 rounded-md border border-line p-3">
              <p className="text-[13.5px] font-medium text-ink">{candidate.label}</p>
              <p className="text-[12.5px] text-ink-faint">{candidate.signalDetail}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={mergeCasesAction} submitLabel="Merge into this case" submitVariant="danger">
                  <Hidden name="survivingApplicantId" value={survivingApplicantId} />
                  <Hidden name="mergedApplicantId" value={candidate.id} />
                  <Field label="Why they are the same person" htmlFor={`merge-${candidate.candidateId}`} required>
                    <Input id={`merge-${candidate.candidateId}`} name="reason" required />
                  </Field>
                </ActionForm>
                <ActionForm action={notDuplicateAction} submitLabel="Not the same person">
                  <Hidden name="candidateId" value={candidate.candidateId} />
                  <Field label="Why not" htmlFor={`notdup-${candidate.candidateId}`} required>
                    <Input id={`notdup-${candidate.candidateId}`} name="reason" required />
                  </Field>
                </ActionForm>
              </div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export function EditCaseDialog({
  applicantId,
  version,
  displayName,
  preferredName,
  generalLocation,
  timezone,
  timezoneConfirmed,
}: {
  applicantId: string;
  version: number;
  displayName: string;
  preferredName: string | null;
  generalLocation: string | null;
  timezone: string | null;
  timezoneConfirmed: boolean;
}) {
  return (
    <Dialog
      title="Edit case details"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Pencil size={14} aria-hidden="true" /> Edit details
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={updateCaseAction} submitLabel="Save" onSuccess={close}>
          <Hidden name="applicantId" value={applicantId} />
          <Hidden name="expectedVersion" value={version} />
          <Field label="Name" htmlFor="edit-name" required>
            <Input id="edit-name" name="displayName" required defaultValue={displayName} />
          </Field>
          <Field label="Preferred name" htmlFor="edit-preferred">
            <Input id="edit-preferred" name="preferredName" defaultValue={preferredName ?? ''} />
          </Field>
          <Field label="General location" htmlFor="edit-location" hint="City or area only.">
            <Input id="edit-location" name="generalLocation" defaultValue={generalLocation ?? ''} />
          </Field>
          <Field label="Timezone" htmlFor="edit-tz" hint="IANA name, e.g. America/Chicago.">
            <Input id="edit-tz" name="timezone" defaultValue={timezone ?? ''} />
          </Field>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="timezoneConfirmed" defaultChecked={timezoneConfirmed} className="mt-1" />
            <span>
              Confirmed with the applicant. Until this is ticked, quiet-hour checks use the
              organization’s conservative policy instead of guessing.
            </span>
          </label>
        </ActionForm>
      )}
    </Dialog>
  );
}
