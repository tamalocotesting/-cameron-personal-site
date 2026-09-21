'use client';
import { Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { ActionForm, FieldError } from '@/components/ui/form';
import { updateSettingsAction } from '@/server/actions/workspace-actions';

const AI_CATEGORIES = [
  ['intake_answers', 'Intake answers'],
  ['applicant_messages', 'Applicant messages'],
  ['recruiter_messages', 'Recruiter messages'],
  ['call_outcomes', 'Call outcomes (no recordings or transcripts exist)'],
  ['staff_notes', 'Staff notes — off by default'],
] as const;

export function SettingsForm({
  settings,
}: {
  settings: {
    defaultTimezone: string;
    quietHoursStartMinute: number;
    quietHoursEndMinute: number;
    unknownTimezonePolicy: 'BLOCK' | 'REVIEW';
    routingStrategy: 'ROUND_ROBIN' | 'FALLBACK_ONLY';
    seatLimit: number;
    minimumIntakeAge: number | null;
    youthPolicyNote: string | null;
    citizenshipQuestionsEnabled: boolean;
    aiPreparationEnabled: boolean;
    aiProvider: 'local-rules' | 'anthropic';
    aiApprovedCategories: string[];
    automationEnabled: boolean;
    textBackEnabled: boolean;
    textBackWindowMinutes: number;
    textBackMaxQuestions: number;
    version: number;
  };
}) {
  return (
    <ActionForm action={updateSettingsAction} submitLabel="Save settings">
      {(state) => (
        <>
          <input type="hidden" name="expectedVersion" value={settings.version} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Default timezone"
              htmlFor="s-tz"
              required
              hint="Used when an applicant's own timezone is unknown."
            >
              <Input id="s-tz" name="defaultTimezone" required defaultValue={settings.defaultTimezone} />
              <FieldError state={state} name="defaultTimezone" />
            </Field>
            <Field label="Seat limit" htmlFor="s-seats" required>
              <Input id="s-seats" name="seatLimit" type="number" min={1} required defaultValue={settings.seatLimit} />
            </Field>
            <Field label="Quiet hours begin (minutes past midnight)" htmlFor="s-qstart" required>
              <Input
                id="s-qstart"
                name="quietHoursStartMinute"
                type="number"
                min={0}
                max={1439}
                required
                defaultValue={settings.quietHoursStartMinute}
              />
            </Field>
            <Field label="Quiet hours end" htmlFor="s-qend" required>
              <Input
                id="s-qend"
                name="quietHoursEndMinute"
                type="number"
                min={0}
                max={1439}
                required
                defaultValue={settings.quietHoursEndMinute}
              />
            </Field>
          </div>

          <Field
            label="When the recipient's timezone is unknown"
            htmlFor="s-unknown-tz"
            required
            hint="A conservative documented policy. The product never guesses a window from an area code."
          >
            <Select id="s-unknown-tz" name="unknownTimezonePolicy" required defaultValue={settings.unknownTimezonePolicy}>
              <option value="BLOCK">Apply the office window and block outside it</option>
              <option value="REVIEW">Require a recruiter to decide the timing</option>
            </Select>
          </Field>

          <Field label="Routing for a new inquiry" htmlFor="s-routing" required>
            <Select id="s-routing" name="routingStrategy" required defaultValue={settings.routingStrategy}>
              <option value="ROUND_ROBIN">Round-robin across present recruiters by open workload</option>
              <option value="FALLBACK_ONLY">Always the fallback owner</option>
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Minimum intake age"
              htmlFor="s-age"
              hint="Deployment configuration. There is no universal default; leave blank if your organization has not set one."
            >
              <Input id="s-age" name="minimumIntakeAge" type="number" min={0} max={99} defaultValue={settings.minimumIntakeAge ?? ''} />
            </Field>
            <Field label="Youth policy note" htmlFor="s-youth">
              <Textarea id="s-youth" name="youthPolicyNote" rows={2} defaultValue={settings.youthPolicyNote ?? ''} />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              name="citizenshipQuestionsEnabled"
              defaultChecked={settings.citizenshipQuestionsEnabled}
              className="mt-1"
            />
            <span>
              Allow citizenship questions in an approved question set. Off by default; nothing is ever
              inferred about citizenship either way.
            </span>
          </label>

          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="automationEnabled" defaultChecked={settings.automationEnabled} className="mt-1" />
            <span>
              Allow approved administrative templates to be sent without a recruiter (acknowledgment,
              intake invitation, appointment reminder only).
            </span>
          </label>

          <fieldset className="space-y-1.5 rounded-md border border-line p-3">
            <legend className="px-1 text-[13px] font-medium text-ink">
              Answering a call nobody picked up
            </legend>
            <p className="text-[12px] text-ink-faint">
              When an inbound call is not answered, send the caller one automated text saying so and
              offering to take a few details by text. Answering by text is optional and the caller
              has to say yes; the callback task is created either way. Whether to text somebody who
              called you is a decision for your organization — this is off unless you turn it on.
            </p>

            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                name="textBackEnabled"
                defaultChecked={settings.textBackEnabled}
                className="mt-1"
              />
              <span>Reply to unanswered inbound calls with one automated text.</span>
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Reply window (minutes)"
                htmlFor="s-tb-window"
                required
                hint="Past this, the call is too old to answer with a text and the recruiter calls back instead."
              >
                <Input
                  id="s-tb-window"
                  name="textBackWindowMinutes"
                  type="number"
                  min={1}
                  max={240}
                  required
                  defaultValue={settings.textBackWindowMinutes}
                />
              </Field>
              <Field
                label="Most questions to ask by text"
                htmlFor="s-tb-max"
                required
                hint="The script stops here and hands what it has to the recruiter."
              >
                <Input
                  id="s-tb-max"
                  name="textBackMaxQuestions"
                  type="number"
                  min={1}
                  max={30}
                  required
                  defaultValue={settings.textBackMaxQuestions}
                />
              </Field>
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              name="aiPreparationEnabled"
              defaultChecked={settings.aiPreparationEnabled}
              className="mt-1"
            />
            <span>Enable AI brief preparation.</span>
          </label>

          <Field label="Brief provider" htmlFor="s-ai-provider" required>
            <Select id="s-ai-provider" name="aiProvider" required defaultValue={settings.aiProvider}>
              <option value="local-rules">Local rules (deterministic, no external request)</option>
              <option value="anthropic">Anthropic (requires server credentials and a configured model)</option>
            </Select>
          </Field>

          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium text-ink">Approved data categories</legend>
            <p className="text-[12px] text-ink-faint">
              Only these categories may be submitted to a brief provider. Sensitive free text is
              excluded regardless of what is ticked here.
            </p>
            {AI_CATEGORIES.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="aiApprovedCategories"
                  value={value}
                  defaultChecked={settings.aiApprovedCategories.includes(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <Notice tone="neutral">
            What a provider does with data it receives is its contract with you. Application code cannot
            guarantee a provider&apos;s retention or training behaviour, and this product does not claim
            to — see INTEGRATIONS.md.
          </Notice>
        </>
      )}
    </ActionForm>
  );
}
