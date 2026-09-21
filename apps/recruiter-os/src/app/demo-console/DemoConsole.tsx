'use client';
import { useState } from 'react';
import { Button, Field, Input, Notice, Select } from '@/components/ui';

type SimulationResult = { ok: boolean; detail: string } | null;

/**
 * A number field that accepts an existing demo contact or a new one.
 *
 * A select of known contacts cannot demonstrate the thing that matters most:
 * somebody calling for the first time, from a number the workspace has never
 * seen.
 */
function NumberField({
  id,
  label,
  value,
  onChange,
  contacts,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  contacts: Array<{ value: string; label: string }>;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      required
      hint="Pick someone from the demo data, or type a number nobody has contacted before."
    >
      <Input
        id={id}
        list={`${id}-known`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="+15125550123"
      />
      <datalist id={`${id}-known`}>
        {contacts.map((contact) => (
          <option key={contact.value} value={contact.value}>
            {contact.label}
          </option>
        ))}
      </datalist>
    </Field>
  );
}

export function DemoConsole({
  contacts,
  messages,
}: {
  contacts: Array<{ value: string; label: string }>;
  messages: Array<{ id: string; label: string }>;
}) {
  const [result, setResult] = useState<SimulationResult>(null);
  const [pending, setPending] = useState<string | null>(null);

  const [smsFrom, setSmsFrom] = useState(contacts[0]?.value ?? '');
  const [smsBody, setSmsBody] = useState('Hi, is someone there? I had a question.');
  const [callFrom, setCallFrom] = useState(contacts[0]?.value ?? '');
  const [callStatus, setCallStatus] = useState<'no-answer' | 'busy' | 'failed' | 'completed'>('no-answer');
  const [messageId, setMessageId] = useState(messages[0]?.id ?? '');
  const [status, setStatus] = useState('delivered');
  const [optOutFrom, setOptOutFrom] = useState(contacts[0]?.value ?? '');

  async function simulate(kind: string, payload: Record<string, unknown>) {
    setPending(kind);
    setResult(null);
    try {
      const response = await fetch('/api/demo/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, ...payload }),
      });
      const body = (await response.json()) as { detail?: string; error?: string };
      setResult({ ok: response.ok, detail: body.detail ?? body.error ?? 'Done.' });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {result ? <Notice tone={result.ok ? 'ready' : 'review'}>{result.detail}</Notice> : null}

      <section className="space-y-2 rounded-md border border-line p-3">
        <h2 className="text-[13px] font-semibold text-ink">Inbound text message</h2>
        <NumberField id="sim-sms-from" label="From" value={smsFrom} onChange={setSmsFrom} contacts={contacts} />
        <Field label="Body" htmlFor="sim-sms-body" required>
          <Input id="sim-sms-body" value={smsBody} onChange={(e) => setSmsBody(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          disabled={pending !== null}
          onClick={() => simulate('inbound_sms', { from: smsFrom, body: smsBody })}
        >
          {pending === 'inbound_sms' ? 'Sending…' : 'Deliver inbound text'}
        </Button>
      </section>

      <section className="space-y-2 rounded-md border border-line p-3">
        <h2 className="text-[13px] font-semibold text-ink">Inbound call</h2>
        <p className="text-[12.5px] text-ink-faint">
          The forwarded leg&apos;s status is what decides whether a human answered. A parent call reports
          &ldquo;completed&rdquo; either way.
        </p>
        <NumberField id="sim-call-from" label="From" value={callFrom} onChange={setCallFrom} contacts={contacts} />
        <Field label="Forwarded leg outcome" htmlFor="sim-call-status" required>
          <Select
            id="sim-call-status"
            value={callStatus}
            onChange={(e) => setCallStatus(e.target.value as typeof callStatus)}
          >
            <option value="no-answer">no-answer (nobody picked up)</option>
            <option value="busy">busy</option>
            <option value="failed">failed</option>
            <option value="completed">completed with duration (a human answered)</option>
          </Select>
        </Field>
        <Button
          variant="primary"
          disabled={pending !== null}
          onClick={() => simulate('missed_call', { from: callFrom, dialCallStatus: callStatus })}
        >
          {pending === 'missed_call' ? 'Ringing…' : 'Place inbound call'}
        </Button>
      </section>

      <section className="space-y-2 rounded-md border border-line p-3">
        <h2 className="text-[13px] font-semibold text-ink">Delivery status callback</h2>
        <p className="text-[12.5px] text-ink-faint">
          Send these out of order to see that a late &ldquo;sent&rdquo; does not undo a
          &ldquo;delivered&rdquo;.
        </p>
        <Field label="Message" htmlFor="sim-msg" required>
          <Select id="sim-msg" value={messageId} onChange={(e) => setMessageId(e.target.value)}>
            {messages.map((message) => (
              <option key={message.id} value={message.id}>
                {message.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider status" htmlFor="sim-status" required>
          <Select id="sim-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="queued">queued</option>
            <option value="sent">sent</option>
            <option value="delivered">delivered</option>
            <option value="undelivered">undelivered</option>
            <option value="failed">failed</option>
          </Select>
        </Field>
        <Button
          variant="primary"
          disabled={pending !== null || !messageId}
          onClick={() => simulate('delivery_status', { messageId, status })}
        >
          {pending === 'delivery_status' ? 'Reporting…' : 'Report status'}
        </Button>
      </section>

      <section className="space-y-2 rounded-md border border-line p-3">
        <h2 className="text-[13px] font-semibold text-ink">Opt-out and opt-in keywords</h2>
        <p className="text-[12.5px] text-ink-faint">
          STOP suppresses every SMS purpose for that number and cancels anything pending. The carrier
          answers the keyword itself, so the app deliberately adds no reply of its own.
        </p>
        <NumberField id="sim-opt-from" label="From" value={optOutFrom} onChange={setOptOutFrom} contacts={contacts} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={pending !== null}
            onClick={() => simulate('opt_out', { from: optOutFrom })}
          >
            {pending === 'opt_out' ? 'Sending…' : 'Send STOP'}
          </Button>
          <Button
            variant="ready"
            disabled={pending !== null}
            onClick={() => simulate('opt_in', { from: optOutFrom })}
          >
            {pending === 'opt_in' ? 'Sending…' : 'Send START'}
          </Button>
        </div>
      </section>
    </div>
  );
}
