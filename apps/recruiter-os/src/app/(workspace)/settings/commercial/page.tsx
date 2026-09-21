import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { getCommercialMetadata } from '@/server/services/settings';
import { CommercialForm } from '@/components/app/settings/CommercialForm';

export const dynamic = 'force-dynamic';

export default async function CommercialPage() {
  const ctx = await requireStaffContext();
  const record = await getCommercialMetadata(ctx.member.organizationId);

  return (
    <div className="space-y-3">
      <Notice tone="pending" title="An editable hypothesis, not established pricing">
        The often-quoted $3,000 setup / $1,000 monthly / five-recruiter shape is a starting assumption to
        be tested, not a price this product stands behind. Nothing here charges anyone: there is no
        payment processing, no checkout and no marketing site in this build, and individual recruiters
        never buy accounts.
      </Notice>

      <Card>
        <CardHeader
          title="Commercial metadata"
          description="Administrator-only bookkeeping, stored alongside the organization."
        />
        <CardBody>
          <CommercialForm
            values={{
              implementationFee: record?.implementationFeeCents != null ? record.implementationFeeCents / 100 : null,
              monthlyFee: record?.monthlyFeeCents != null ? record.monthlyFeeCents / 100 : null,
              licensedSeats: record?.licensedSeats ?? null,
              contractStart: record?.contractStart?.toISOString().slice(0, 10) ?? '',
              contractEnd: record?.contractEnd?.toISOString().slice(0, 10) ?? '',
              note: record?.note ?? '',
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
