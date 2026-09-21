'use client';
import { useRouter } from 'next/navigation';
import { Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { ActionForm, FieldError } from '@/components/ui/form';
import { pauseIntakeAction, submitAnswerAction } from '@/server/actions/intake-actions';

type Question = {
  key: string;
  type: string;
  prompt: string;
  helpText: string | null;
  required: boolean;
  options: string[];
  consentPurpose: string | null;
  disclosureText: string | null;
  index: number;
  total: number;
};

/**
 * One question at a time. The human-request control stays visible throughout,
 * and so does the ability to skip anything that is not operationally required.
 */
export function QuestionForm({ question }: { question: Question }) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <ActionForm
        action={submitAnswerAction}
        submitLabel="Continue"
        pendingLabel="Saving…"
        onSuccess={() => router.refresh()}
      >
        {(state) => (
          <>
            <input type="hidden" name="questionKey" value={question.key} />

            {question.type === 'CONSENT' ? (
              <fieldset className="space-y-2">
                <legend className="text-[15px] font-medium text-ink">{question.prompt}</legend>
                {question.disclosureText ? (
                  <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                    {question.disclosureText}
                  </p>
                ) : null}
                <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
                  <input type="radio" name="consentGranted" value="yes" required />
                  <span>Yes, that is fine</span>
                </label>
                <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
                  <input type="radio" name="consentGranted" value="no" />
                  <span>No thanks</span>
                </label>
                <FieldError state={state} name={question.key} />
              </fieldset>
            ) : question.type === 'SINGLE_SELECT' ? (
              <Field label={question.prompt} htmlFor={`q-${question.key}`} required={question.required} hint={question.helpText}>
                <Select id={`q-${question.key}`} name="valueOptions" required={question.required} defaultValue="">
                  <option value="" disabled>
                    Choose one
                  </option>
                  {question.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
                <FieldError state={state} name={question.key} />
              </Field>
            ) : question.type === 'MULTI_SELECT' ? (
              <fieldset className="space-y-1.5">
                <legend className="text-[15px] font-medium text-ink">{question.prompt}</legend>
                {question.helpText ? <p className="text-[12.5px] text-ink-faint">{question.helpText}</p> : null}
                {question.options.map((option) => (
                  <label key={option} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                    <input type="checkbox" name="valueOptions" value={option} />
                    <span>{option}</span>
                  </label>
                ))}
                <FieldError state={state} name={question.key} />
              </fieldset>
            ) : question.type === 'LONG_TEXT' ? (
              <Field label={question.prompt} htmlFor={`q-${question.key}`} required={question.required} hint={question.helpText}>
                <Textarea id={`q-${question.key}`} name="valueText" rows={4} required={question.required} />
                <FieldError state={state} name={question.key} />
              </Field>
            ) : (
              <Field label={question.prompt} htmlFor={`q-${question.key}`} required={question.required} hint={question.helpText}>
                <Input
                  id={`q-${question.key}`}
                  name="valueText"
                  required={question.required}
                  inputMode={question.type === 'PHONE' ? 'tel' : question.type === 'EMAIL' ? 'email' : 'text'}
                  autoComplete={
                    question.type === 'PHONE' ? 'tel' : question.type === 'EMAIL' ? 'email' : 'off'
                  }
                />
                <FieldError state={state} name={question.key} />
              </Field>
            )}
          </>
        )}
      </ActionForm>

      {!question.required ? (
        <ActionForm
          action={submitAnswerAction}
          submitLabel="Skip this one"
          submitVariant="secondary"
          onSuccess={() => router.refresh()}
        >
          <input type="hidden" name="questionKey" value={question.key} />
          <input type="hidden" name="skip" value="true" />
        </ActionForm>
      ) : null}

      <div className="space-y-2 border-t border-line pt-3">
        <Notice tone="neutral">
          Prefer to talk to a person? Type that in the box above and send it — the questions stop and a
          recruiter picks it up.
        </Notice>
        <ActionForm action={pauseIntakeAction} submitLabel="Save and finish later" submitVariant="secondary" />
      </div>
    </div>
  );
}
