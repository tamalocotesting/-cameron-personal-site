'use client';
import { Field, Input, Textarea } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import { updateCommercialAction } from '@/server/actions/workspace-actions';

export function CommercialForm({
  values,
}: {
  values: {
    implementationFee: number | null;
    monthlyFee: number | null;
    licensedSeats: number | null;
    contractStart: string;
    contractEnd: string;
    note: string;
  };
}) {
  return (
    <ActionForm action={updateCommercialAction} submitLabel="Save">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Implementation fee (USD)" htmlFor="c-impl">
          <Input id="c-impl" name="implementationFee" type="number" min={0} step="1" defaultValue={values.implementationFee ?? ''} />
        </Field>
        <Field label="Monthly fee (USD)" htmlFor="c-monthly">
          <Input id="c-monthly" name="monthlyFee" type="number" min={0} step="1" defaultValue={values.monthlyFee ?? ''} />
        </Field>
        <Field label="Licensed seats" htmlFor="c-seats">
          <Input id="c-seats" name="licensedSeats" type="number" min={1} defaultValue={values.licensedSeats ?? ''} />
        </Field>
        <Field label="Contract start" htmlFor="c-start">
          <Input id="c-start" name="contractStart" type="date" defaultValue={values.contractStart} />
        </Field>
        <Field label="Contract end" htmlFor="c-end">
          <Input id="c-end" name="contractEnd" type="date" defaultValue={values.contractEnd} />
        </Field>
      </div>
      <Field label="Note" htmlFor="c-note">
        <Textarea id="c-note" name="note" rows={3} defaultValue={values.note} />
      </Field>
    </ActionForm>
  );
}
