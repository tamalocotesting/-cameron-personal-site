import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;

  if (!params.token) {
    return (
      <Card>
        <CardHeader title="Reset link problem" />
        <CardBody>
          <Notice tone="review">
            {params.error
              ? 'That reset link is no longer valid. Request a new one.'
              : 'This page needs a reset link from your email.'}
          </Notice>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Choose a new password" description="At least 12 characters." />
      <CardBody>
        <ResetPasswordForm token={params.token} />
      </CardBody>
    </Card>
  );
}
