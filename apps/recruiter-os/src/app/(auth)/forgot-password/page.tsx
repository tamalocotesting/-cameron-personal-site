import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { env } from '@/env';

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader
        title="Reset your password"
        description="We will email a reset link if that address has an account."
      />
      <CardBody className="space-y-3">
        <ForgotPasswordForm />
        {env.SMTP_HOST === 'localhost' ? (
          <Notice tone="neutral">
            Local development captures mail in Mailpit. Open{' '}
            <a
              className="text-accent underline underline-offset-2"
              href="http://localhost:8025"
              target="_blank"
              rel="noreferrer"
            >
              http://localhost:8025
            </a>{' '}
            to read the message.
          </Notice>
        ) : null}
      </CardBody>
    </Card>
  );
}
