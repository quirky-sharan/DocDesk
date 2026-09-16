import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle, Ban, BatteryCharging, Bot, CheckCircle2, CircleSlash, Clock,
  ExternalLink, Gauge, KeyRound, Pin, RefreshCw, Sparkles, TrendingUp, Zap,
} from 'lucide-react';
import { api } from '../api/client';
import {
  Badge, Button, Card, CardHeader, Empty, ErrorNote, PageHeader,
  SegmentedControl, Spinner, useToast,
} from '../components/ui';
import { formatInteger, formatRelative } from '../lib/format';
import { cn } from '../lib/cn';
import { EASE_OUT } from '../lib/motion';
import brand from '@shared/brand.json';

/**
 * Where the AI stands, in sentences rather than status codes.
 *
 * The thing this page exists to prevent: "it stopped working" with no way to
 * find out why. Every provider says what state it is in and, where there is
 * something the owner can do, exactly what that is - which key, in which file,
 * from which page. A daily allowance that resets on its own says so, so nobody
 * goes looking for a problem that is not there.
 */

const STATE = {
  ready: { label: 'Ready', tone: 'green', icon: CheckCircle2 },
  busy: { label: 'Busy', tone: 'amber', icon: Clock },
  quota_daily: { label: "Today's allowance used", tone: 'amber', icon: BatteryCharging },
  credits_exhausted: { label: 'Out of credit', tone: 'red', icon: AlertTriangle },
  auth: { label: 'Key refused', tone: 'red', icon: KeyRound },
  down: { label: 'Not answering', tone: 'red', icon: AlertTriangle },
  not_configured: { label: 'Not set up', tone: 'slate', icon: CircleSlash },
  disabled: { label: 'Turned off', tone: 'slate', icon: Ban },
  unknown: { label: 'Not checked', tone: 'slate', icon: Clock },
};

export default function AiPage() {
  const [tab, setTab] = useState('providers');
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState(null);
  const [usage, setUsage] = useState(null);
  const [events, setEvents] = useState([]);
  const [agreement, setAgreement] = useState(null);
  const [scoreboard, setScoreboard] = useState(null);
  const [error, setError] = useState(null);
  const [probing, setProbing] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [s, m, u, e, a, b] = await Promise.all([
        api.ai.status(),
        api.ai.models(),
        api.ai.usage(7),
        api.ai.events({ limit: 25 }),
        api.ai.agreement(14),
        api.ai.scoreboard(),
      ]);
      setStatus(s); setModels(m); setUsage(u);
      setEvents(e.items || []); setAgreement(a); setScoreboard(b);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const probe = async () => {
    setProbing(true);
    try {
      await api.ai.discover();
      await load();
      toast.success('Checked every provider');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProbing(false);
    }
  };

  if (!status && !error) {
    return <div className="grid h-64 place-items-center"><Spinner /></div>;
  }

  const working = status?.providers?.filter((p) => p.status === 'ready').length || 0;

  return (
    <>
      <PageHeader
        eyebrow={brand.receptionist}
        title="AI & models"
        subtitle="Which services are up, what is left of each free allowance, and what it has cost."
        icon={Bot}
      >
        <Button variant="secondary" icon={RefreshCw} loading={probing} onClick={probe}>Check now</Button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {status?.deterministicOnly && (
        <Card className="mb-5 flex items-start gap-3 p-4" style={{ background: 'var(--warning-soft)' }}>
          <Sparkles size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="text-[14px] font-semibold text-warning">Working without a language model</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink">
              {brand.receptionist} still answers opening hours, what you offer, where you are and what is booked
              today, straight from your records, and will take a message for anything else. Add a free key below to
              switch the rest back on.
            </p>
          </div>
        </Card>
      )}

      <div className="mb-5">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          ariaLabel="What to show"
          options={[
            { value: 'providers', label: `Providers${working ? ` (${working})` : ''}` },
            { value: 'models', label: 'Models' },
            { value: 'usage', label: 'Usage' },
            { value: 'events', label: `What changed${events.length ? ` (${events.length})` : ''}` },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
        >
          {tab === 'providers' && <Providers status={status} onChange={load} />}
          {tab === 'models' && <Models models={models} scoreboard={scoreboard} status={status} onChange={load} />}
          {tab === 'usage' && <Usage usage={usage} agreement={agreement} />}
          {tab === 'events' && <Events events={events} onSeen={load} />}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function Providers({ status, onChange }) {
  const toast = useToast();

  const toggle = async (provider) => {
    try {
      await api.ai.setProviderEnabled(provider.key, provider.status === 'disabled');
      await onChange();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {status.providers.map((provider) => {
        const state = STATE[provider.status] || STATE.unknown;
        const Icon = state.icon;
        return (
          <Card key={provider.key} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold tracking-[-0.01em]">{provider.label}</p>
                {provider.summary !== state.label && (
                  <p className="mt-0.5 text-[13px] text-ink-2">{provider.summary}</p>
                )}
              </div>
              <Badge tone={state.tone} icon><Icon size={12} aria-hidden="true" /> {state.label}</Badge>
            </div>

            {provider.action && (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{provider.action}</p>
            )}

            {provider.budgets?.length > 0 && (
              <div className="mt-4 space-y-2.5">
                {provider.budgets.map((budget) => (
                  <Allowance key={`${budget.model}-${budget.kind}`} budget={budget} />
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {provider.models > 0 && (
                <span className="text-[12.5px] text-ink-3">{provider.models} models</span>
              )}
              {provider.latencyMs != null && (
                <span className="text-[12.5px] text-ink-3">· {provider.latencyMs} ms</span>
              )}
              <div className="ml-auto flex gap-2">
                {provider.console && (
                  <a href={provider.console} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                    {provider.keyVar ? 'Get a key' : 'Install it'} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
                {provider.configured && (
                  <Button size="sm" variant="quiet" onClick={() => toggle(provider)}>
                    {provider.status === 'disabled' ? 'Switch on' : 'Switch off'}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * How much of a free allowance is left.
 *
 * The refill mode is shown because it changes what the number means: a
 * per-minute bucket at 10% will be full again in under a minute, and a daily
 * one at 10% will not.
 */
function Allowance({ budget }) {
  const percent = Math.max(0, Math.min(100, budget.percent ?? 0));
  const kind = { tpm: 'tokens a minute', tpd: 'tokens a day', rpm: 'requests a minute', rpd: 'requests a day' }[budget.kind] || budget.kind;
  const tone = percent > 50 ? 'var(--status-good)' : percent > 15 ? 'var(--status-warning)' : 'var(--status-critical)';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-ink-2">{budget.model}</span>
        <span className="shrink-0 tabular-nums text-ink-3">
          {formatInteger(budget.available)} / {formatInteger(budget.limit)} {kind}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: tone }}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        />
      </div>
      {budget.refillMode === 'continuous' ? (
        <p className="mt-1 text-[11.5px] text-ink-3">Refills continuously</p>
      ) : (
        budget.resetAt && <p className="mt-1 text-[11.5px] text-ink-3">Back {formatRelative(budget.resetAt)}</p>
      )}
    </div>
  );
}

function Models({ models, scoreboard, status, onChange }) {
  const toast = useToast();
  const pinned = status?.overrides?.pinnedModel || null;

  if (!models?.items?.length) {
    return <Empty icon={Bot} title="No models found yet" message="Add a provider key and press Check now." />;
  }

  const scoreFor = (row) =>
    scoreboard?.scoreboard?.find((s) => s.model === row.model && s.provider_key === row.provider_key);

  const pin = async (model) => {
    try {
      await api.ai.setOverrides({ pinned_model: pinned === model ? null : model });
      await onChange();
      toast.success(pinned === model ? 'No longer pinned' : `Always using ${model}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        className="mb-0 p-5"
        title="What each model can do"
        subtitle="Found by asking each provider. Nothing here is typed in by hand."
        icon={Gauge}
      />
      <div className="overflow-x-auto" data-lenis-prevent>
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-2.5 font-medium">Model</th>
              <th className="px-3 py-2.5 font-medium">Tier</th>
              <th className="px-3 py-2.5 font-medium">Can do</th>
              <th className="px-3 py-2.5 font-medium">Context</th>
              <th className="px-3 py-2.5 font-medium">Benchmark</th>
              <th className="px-5 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {models.items.map((row) => {
              const score = scoreFor(row);
              const isPinned = pinned === row.model;
              return (
                <tr
                  key={`${row.provider_key}-${row.model}`}
                  className={cn('border-t border-[var(--line)]', !row.is_enabled && 'opacity-55')}
                >
                  <td className="px-5 py-3">
                    <p className="font-medium">{row.model}</p>
                    <p className="text-[12px] text-ink-3">{row.provider_label}</p>
                    {row.last_error && <p className="mt-0.5 text-[12px] text-warning">{row.last_error}</p>}
                  </td>
                  <td className="px-3 py-3">
                    {row.tier ? <Badge tone="slate">{row.tier}</Badge> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-ink-2">
                    {(row.capabilities || []).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink-2">
                    {row.context_window ? formatInteger(row.context_window) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {score?.blocked ? (
                      <Badge tone="red" icon><Ban size={12} aria-hidden="true" /> Blocked</Badge>
                    ) : score ? (
                      <Badge tone={score.percent >= 80 ? 'green' : 'amber'}>{score.percent}%</Badge>
                    ) : (
                      <span className="text-[12.5px] text-ink-3">Not run</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      size="sm"
                      variant={isPinned ? 'secondary' : 'quiet'}
                      icon={Pin}
                      onClick={() => pin(row.model)}
                      aria-label={isPinned ? `Stop always using ${row.model}` : `Always use ${row.model}`}
                    >
                      {isPinned ? 'Pinned' : ''}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Usage({ usage, agreement }) {
  if (!usage) return <Spinner />;

  const totals = (usage.byModel || []).reduce(
    (sum, row) => ({
      calls: sum.calls + Number(row.calls || 0),
      tokens: sum.tokens + Number(row.tokens_in || 0) + Number(row.tokens_out || 0),
      errors: sum.errors + Number(row.errors || 0),
    }),
    { calls: 0, tokens: 0, errors: 0 }
  );

  const drifting = agreement && agreement.rate > agreement.threshold;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Requests" value={formatInteger(totals.calls)} hint={`Last ${usage.days} days`} icon={Zap} />
        <Stat label="Tokens" value={formatInteger(totals.tokens)} hint="What it would have cost, if it cost" icon={TrendingUp} />
        <Stat label="Failed" value={formatInteger(totals.errors)} hint={totals.calls ? `${Math.round((totals.errors / totals.calls) * 100)}% of requests` : 'None yet'} icon={AlertTriangle} />
      </div>

      {!usage.byModel?.length ? (
        <Empty icon={Gauge} title="Nothing used yet" message="Ask Receptionist AI something and it shows up here." />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="mb-0 p-5" title="By model" subtitle={`Last ${usage.days} days`} />
          <div className="overflow-x-auto" data-lenis-prevent>
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 font-medium">Requests</th>
                  <th className="px-3 py-2.5 font-medium">Tokens in</th>
                  <th className="px-3 py-2.5 font-medium">Tokens out</th>
                  <th className="px-3 py-2.5 font-medium">Typical</th>
                  <th className="px-5 py-2.5 font-medium">Slowest 5%</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModel.map((row) => (
                  <tr key={`${row.provider_key}-${row.model}`} className="border-t border-[var(--line)]">
                    <td className="px-5 py-3">
                      <p className="font-medium">{row.model}</p>
                      <p className="text-[12px] text-ink-3">{row.provider_key}</p>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{formatInteger(row.calls)}</td>
                    <td className="px-3 py-3 tabular-nums text-ink-2">{formatInteger(row.tokens_in)}</td>
                    <td className="px-3 py-3 tabular-nums text-ink-2">{formatInteger(row.tokens_out)}</td>
                    <td className="px-3 py-3 tabular-nums">{row.p50_ms ? `${row.p50_ms} ms` : '—'}</td>
                    <td className="px-5 py-3 tabular-nums text-ink-2">{row.p95_ms ? `${row.p95_ms} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <CardHeader
          title="Rules against model"
          subtitle="DocDesk works out what you meant twice - once with plain rules, once with the model. They should mostly agree."
          className="mb-3"
        />
        {!agreement?.byDay?.length ? (
          <p className="text-[13.5px] text-ink-3">Nothing to compare yet.</p>
        ) : (
          <>
            <p className={cn('text-[26px] font-semibold tracking-[-0.02em]', drifting && 'text-warning')}>
              {Math.round(agreement.rate * 100)}%
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              {drifting
                ? 'They are disagreeing more than usual. That normally means the wording it works from needs a look, and it is worth reading a few recent conversations.'
                : 'Disagreement is within the normal range.'}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, icon: Icon }) {
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2 text-ink-3">
        <Icon size={15} aria-hidden="true" />
        <span className="text-[12.5px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-[28px] font-semibold tabular-nums tracking-[-0.02em]">{value}</p>
      <p className="mt-1 text-[12.5px] text-ink-3">{hint}</p>
    </Card>
  );
}

function Events({ events, onSeen }) {
  useEffect(() => {
    const unseen = events.filter((e) => !e.seen).map((e) => e.id);
    if (unseen.length) api.ai.markEventsSeen(unseen).then(onSeen).catch(() => {});
    // Marking them read once on open is the point; re-running on every change
    // would fight with the reload it triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!events.length) {
    return <Empty icon={CheckCircle2} title="Nothing has changed" message="When a provider goes down, runs out or gets switched, it is written here in plain English." />;
  }

  return (
    <div className="space-y-2.5">
      {events.map((event) => (
        <Card key={event.id} className="flex items-start gap-3 p-4">
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ background: event.seen ? 'rgb(var(--c-text-3))' : 'rgb(var(--c-accent))' }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-relaxed">{event.message}</p>
            <p className="mt-1 text-[12px] text-ink-3">
              {formatRelative(event.created_at)}
              {event.provider_key ? ` · ${event.provider_key}` : ''}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}
