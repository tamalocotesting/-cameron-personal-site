'use client';
import { ActionForm } from '@/components/ui/form';
import { requeueReconciliationAction, retryJobAction } from '@/server/actions/workspace-actions';

export function OperationsForms({ kind, id }: { kind: 'retry-job' | 'reconcile'; id: string }) {
  if (kind === 'retry-job') {
    return (
      <ActionForm action={retryJobAction} submitLabel="Re-queue job">
        <input type="hidden" name="outboxId" value={id} />
      </ActionForm>
    );
  }
  return (
    <ActionForm action={requeueReconciliationAction} submitLabel="Reconcile with the provider">
      <input type="hidden" name="messageId" value={id} />
    </ActionForm>
  );
}
