import { FlaskConical, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui';

/**
 * The mode strip. Persistent, and deliberately plain about what it means:
 * in DEMO mode nothing reaches a real person, and the data is fictional.
 */
export function ModeBanner({
  appMode,
  dataScope,
  clock,
  workerHealthy,
  workerDetail,
  demoTools,
}: {
  appMode: 'DEMO' | 'LIVE';
  dataScope: 'DEMO' | 'LIVE';
  clock: string;
  workerHealthy: boolean;
  workerDetail: string;
  demoTools: boolean;
}) {
  const demo = appMode === 'DEMO' || dataScope === 'DEMO';
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
      {demo ? (
        <Badge tone="pending" icon={<FlaskConical size={12} />}>
          Demo mode — fictional data, simulated messaging
        </Badge>
      ) : (
        <Badge tone="accent" icon={<Radio size={12} />}>
          Live mode — real providers where enabled and verified
        </Badge>
      )}

      {demo ? (
        <span className="text-[12px] text-ink-faint">
          Outbound messaging and external AI are blocked, even if credentials exist.
        </span>
      ) : null}

      {demoTools ? (
        <Badge tone="review" icon={<TriangleAlert size={12} />}>
          Demo tools enabled — isolated deployment only
        </Badge>
      ) : null}

      <span className="ml-auto flex items-center gap-2">
        <span className="text-[12px] text-ink-faint">Clock: {clock}</span>
        {workerHealthy ? (
          <Badge tone="ready" icon={<ShieldCheck size={12} />}>
            Worker running
          </Badge>
        ) : (
          <Badge tone="review" icon={<TriangleAlert size={12} />}>
            {workerDetail}
          </Badge>
        )}
      </span>
    </div>
  );
}
