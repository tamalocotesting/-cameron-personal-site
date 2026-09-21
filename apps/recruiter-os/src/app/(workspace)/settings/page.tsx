import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { getSettings } from '@/server/services/settings';
import { formatInZone } from '@/lib/time';
import { SettingsForm } from '@/components/app/settings/SettingsForm';
import { IntakeApprovalForm } from '@/components/app/settings/IntakeApprovalForm';

export const dynamic = 'force-dynamic';

export default async function OrganizationSettingsPage() {
  const ctx = await requireStaffContext();
  const settings = await getSettings(ctx.member.organizationId);
  if (!settings) return <Notice tone="review">Organization settings are missing. Re-run the seed or bootstrap.</Notice>;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Organization and workflow"
          description="Timezone, contact windows, routing, seats and AI enablement."
        />
        <CardBody>
          <SettingsForm
            settings={{
              defaultTimezone: settings.defaultTimezone,
              quietHoursStartMinute: settings.quietHoursStartMinute,
              quietHoursEndMinute: settings.quietHoursEndMinute,
              unknownTimezonePolicy: settings.unknownTimezonePolicy,
              routingStrategy: settings.routingStrategy,
              seatLimit: settings.seatLimit,
              minimumIntakeAge: settings.minimumIntakeAge,
              youthPolicyNote: settings.youthPolicyNote,
              citizenshipQuestionsEnabled: settings.citizenshipQuestionsEnabled,
              aiPreparationEnabled: settings.aiPreparationEnabled,
              aiProvider: settings.aiProvider as 'local-rules' | 'anthropic',
              aiApprovedCategories: settings.aiApprovedCategories,
              automationEnabled: settings.automationEnabled,
              textBackEnabled: settings.textBackEnabled,
              textBackWindowMinutes: settings.textBackWindowMinutes,
              textBackMaxQuestions: settings.textBackMaxQuestions,
              version: settings.version,
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Recorded question-set approval"
          description="An internal governance record of this organization's own review."
        />
        <CardBody className="space-y-3">
          <Notice tone="pending">
            Recording an approval here documents a decision your organization made. It does not and
            cannot create official authorization to collect information from real applicants, and it is
            not a substitute for your own approval process.
          </Notice>
          {settings.intakeApprovalRecordedAt ? (
            <p className="text-[13px] text-ink">
              Recorded {formatInZone(settings.intakeApprovalRecordedAt, ctx.timezone)}
              {settings.intakeApprovalNote ? ` — ${settings.intakeApprovalNote}` : ''}
            </p>
          ) : (
            <p className="text-[13px] text-ink-faint">Nothing recorded yet.</p>
          )}
          <IntakeApprovalForm />
        </CardBody>
      </Card>
    </div>
  );
}
