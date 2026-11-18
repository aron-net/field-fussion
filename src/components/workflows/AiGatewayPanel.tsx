import React, { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  InlineAlert,
  MetadataLine,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
} from '../../design-system/components.tsx';
import { useFieldFussion } from '../../context/FieldFussionContext.tsx';
import type {
  AiAdvisoryResponse,
  AiGatewayStatus,
  AiProviderId,
} from '../../shared/types/domain.ts';

export function AiGatewayPanel() {
  const {
    aiStatus,
    refreshAiStatus,
    switchAiProvider,
    requestAiAdvisory,
    resolveAiDraft,
    activeOrganisation,
    isOnline,
  } = useFieldFussion();

  const [status, setStatus] = useState<AiGatewayStatus | null>(aiStatus);
  const [probing, setProbing] = useState(false);
  const [switching, setSwitching] = useState<AiProviderId | null>(null);
  const [prompt, setPrompt] = useState('');
  const [includeDraft, setIncludeDraft] = useState(true);
  const [useOrgContext, setUseOrgContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<AiAdvisoryResponse | null>(null);
  const [resolvingDraft, setResolvingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadStatus = useCallback(
    async (probe = false) => {
      if (!isOnline) return;
      setProbing(true);
      setError(null);
      try {
        const next = await refreshAiStatus(probe);
        setStatus(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load AI gateway status.');
      } finally {
        setProbing(false);
      }
    },
    [isOnline, refreshAiStatus]
  );

  useEffect(() => {
    setStatus(aiStatus);
  }, [aiStatus]);

  useEffect(() => {
    loadStatus(false);
  }, [loadStatus]);

  const handleSwitch = async (providerId: AiProviderId) => {
    setError(null);
    setFeedback(null);
    setSwitching(providerId);
    try {
      const updated = await switchAiProvider(providerId);
      setStatus(updated);
      setFeedback(`Switched active AI gateway provider to ${providerId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch AI provider.');
    } finally {
      setSwitching(null);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim().length < 3) {
      setError('Enter at least 3 characters for your agricultural advisory question.');
      return;
    }

    setError(null);
    setFeedback(null);
    setSending(true);
    try {
      const res = await requestAiAdvisory({
        prompt: prompt.trim(),
        organisationId: useOrgContext && activeOrganisation ? activeOrganisation.id : undefined,
        includeDraftSuggestion: includeDraft,
      });
      setResponse(res);
      await loadStatus(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI advisory request failed.');
    } finally {
      setSending(false);
    }
  };

  const handleResolveDraft = async (decision: 'confirm' | 'dismiss') => {
    if (!response?.proposedDraft) return;
    setResolvingDraft(true);
    setError(null);
    try {
      const result = await resolveAiDraft(response.proposedDraft.draftId, decision);
      setResponse({
        ...response,
        proposedDraft: {
          ...response.proposedDraft,
          status: result.status,
        },
      });
      setFeedback(
        result.status === 'confirmed'
          ? 'Advisory draft confirmed and recorded in audit log.'
          : 'Advisory draft dismissed and recorded in audit log.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve draft.');
    } finally {
      setResolvingDraft(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">
            Unified AI Gateway (Free AI First)
          </h2>
          <p className="text-sm text-ink-muted">
            Provider-independent advisory gateway supporting Gemini Free Tier, Local Ollama, and Mock Test mode without paid billing.
          </p>
        </div>
        <SecondaryButton
          onClick={() => loadStatus(true)}
          loading={probing}
          disabled={!isOnline}
          className="min-h-[40px] text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Check Providers
        </SecondaryButton>
      </div>

      {error && <InlineAlert variant="error" message={error} />}
      {feedback && <InlineAlert variant="success" message={feedback} />}

      {status && status.activeProvider === 'mock' && (
        <InlineAlert
          variant="info"
          title="Free Development Mode Active (Simulated Provider)"
          message="AI_PROVIDER=mock and AI_PAID_ENABLED=false. No paid AI calls are made and GEMINI_API_KEY is not required. Gemini Free Tier and Local Ollama remain registered for future activation."
        />
      )}

      {status && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {status.providers.map((provider) => {
            const isActive = status.activeProvider === provider.providerId;
            const isPaidDisabled = provider.tier === 'paid_disabled';

            return (
              <SurfaceCard key={provider.providerId} className="p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">{provider.label}</h3>
                    <span className="text-xs font-mono text-ink-muted">
                      {isActive ? 'Active' : provider.configured ? 'Ready' : 'Not active'}
                    </span>
                  </div>
                  <MetadataLine
                    items={[
                      `Model: ${provider.model}`,
                      provider.reachable === true
                        ? 'Reachable'
                        : provider.reachable === false
                          ? 'Unreachable'
                          : null,
                    ]}
                  />
                  <p className="text-xs text-ink-muted leading-relaxed">{provider.note}</p>
                  {provider.providerId === 'gemini_free' && status.modelPolicy.verifiedFreeModels.length > 0 && (
                    <p className="text-[11px] font-mono text-ink-muted">
                      Verified free allowlist: {status.modelPolicy.verifiedFreeModels.join(', ')}
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-border-hairline flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-ink-muted">
                    {provider.providerId}
                  </span>
                  {isActive ? (
                    <span className="text-xs font-medium text-leaf-600">
                      Selected Gateway
                    </span>
                  ) : (
                    <SecondaryButton
                      onClick={() => handleSwitch(provider.providerId)}
                      loading={switching === provider.providerId}
                      disabled={!isOnline || isPaidDisabled}
                      className="min-h-[36px] px-3 py-1 text-xs"
                    >
                      {isPaidDisabled ? 'Disabled (Paid Gate)' : 'Use Provider'}
                    </SecondaryButton>
                  )}
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {status && (
        <SurfaceCard className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-ink">
              AI Gateway Policy &amp; Model Classification
            </h3>
            <span className="text-[11px] font-mono text-ink-muted">
              {status.simulationStatus.isSimulatedMode
                ? 'Response mode: simulated'
                : 'Response mode: real_ai_model'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-canvas border border-border-hairline space-y-1">
              <p className="font-medium text-ink">Verified Free Models</p>
              <p className="font-mono text-ink-muted">
                {status.modelPolicy.verifiedFreeModels.length > 0
                  ? status.modelPolicy.verifiedFreeModels.join(', ')
                  : 'None enabled'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-canvas border border-border-hairline space-y-1">
              <p className="font-medium text-ink">Unverified Models (Blocked)</p>
              <p className="font-mono text-ink-muted">
                {status.modelPolicy.unverifiedModels.length > 0
                  ? status.modelPolicy.unverifiedModels.join(', ')
                  : 'None configured (all unverified IDs blocked)'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-canvas border border-border-hairline space-y-1">
              <p className="font-medium text-ink">Paid-Only Models (Blocked)</p>
              <p className="font-mono text-ink-muted break-words">
                {status.modelPolicy.paidOnlyModels.join(', ')}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-canvas border border-border-hairline space-y-1">
              <p className="font-medium text-ink">Simulation Status</p>
              <p className="text-ink-muted">{status.simulationStatus.description}</p>
            </div>
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard className="p-5 space-y-4">
        <div className="flex items-start gap-2.5 text-xs text-ink-muted">
          <ShieldCheck className="w-4 h-4 text-leaf-600 shrink-0 mt-0.5" />
          <span>
            API keys remain strictly server-side. Personal email, phone, and financial records are stripped before external AI calls. All outputs require human confirmation before any action.
          </span>
        </div>

        <form onSubmit={handleSend} className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink">
              Test Advisory Request (Routed Through Active Provider)
            </span>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. What pre-planting soil moisture checks are recommended for maize in Lira?"
              className="w-full px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDraft}
                  onChange={(e) => setIncludeDraft(e.target.checked)}
                  className="w-4 h-4 accent-forest-900"
                />
                <span>Include confirmation-gated draft</span>
              </label>

              {activeOrganisation && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useOrgContext}
                    onChange={(e) => setUseOrgContext(e.target.checked)}
                    className="w-4 h-4 accent-forest-900"
                  />
                  <span>Scope to {activeOrganisation.name}</span>
                </label>
              )}
            </div>

            <PrimaryButton
              type="submit"
              loading={sending}
              disabled={!isOnline}
              className="min-h-[42px]"
            >
              Run Advisory Query
            </PrimaryButton>
          </div>
        </form>

        {response && (
          <div className="p-4 rounded-xl bg-canvas border border-border-hairline space-y-3">
            {response.isSimulated && (
              <InlineAlert
                variant="info"
                title="Simulated Response — Not a Real AI Model"
                message={
                  response.simulatedNotice ??
                  'This output was generated by the deterministic Mock AI Provider for Free Development Mode testing, not by a real AI model.'
                }
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MetadataLine
                items={[
                  response.isSimulated
                    ? 'Simulated Output (Mock)'
                    : 'Real AI Model Output',
                  response.providerId,
                  response.model,
                  `${response.usage.latencyMs}ms`,
                ]}
              />
            </div>
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
              {response.advisoryText}
            </p>
            <p className="text-xs text-ink-muted">{response.uncertaintyNote}</p>
            <p className="text-[11px] text-ink-muted">{response.privacyNotice}</p>

            {response.proposedDraft && (
              <div className="p-3 rounded-lg bg-white border border-border-hairline flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-ink">
                    Confirmation Required ({response.proposedDraft.status})
                  </p>
                  <p className="text-xs text-ink-muted">
                    {response.proposedDraft.summary}
                  </p>
                </div>
                {response.proposedDraft.status === 'pending_confirmation' && (
                  <div className="flex items-center gap-2">
                    <PrimaryButton
                      onClick={() => handleResolveDraft('confirm')}
                      loading={resolvingDraft}
                      className="min-h-[36px] px-3 py-1 text-xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Confirm
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={() => handleResolveDraft('dismiss')}
                      loading={resolvingDraft}
                      className="min-h-[36px] px-3 py-1 text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                      Dismiss
                    </SecondaryButton>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SurfaceCard>

      {status && (
        <SurfaceCard className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border-hairline flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">
              Privacy-Safe Gateway Usage &amp; Error Logs
            </h3>
            <span className="text-[11px] text-ink-muted">
              Prompt text is never logged
            </span>
          </div>
          {status.recentLogs.length === 0 ? (
            <div className="p-4 text-xs text-ink-muted">
              No AI gateway requests logged in this server session yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border-hairline bg-canvas text-ink-muted">
                    <th className="py-2 px-4 font-medium">Time</th>
                    <th className="py-2 px-4 font-medium">Provider</th>
                    <th className="py-2 px-4 font-medium">Model</th>
                    <th className="py-2 px-4 font-medium">Status</th>
                    <th className="py-2 px-4 font-medium text-right">Latency</th>
                    <th className="py-2 px-4 font-medium text-right">Prompt Chars</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-hairline">
                  {status.recentLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-4 font-mono tabular-nums text-ink-muted whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2 px-4 font-mono text-ink">{log.providerId}</td>
                      <td className="py-2 px-4 font-mono text-ink-muted">{log.model}</td>
                      <td className="py-2 px-4 text-ink">
                        {log.status}
                        {log.errorCode ? ` (${log.errorCode})` : ''}
                      </td>
                      <td className="py-2 px-4 font-mono tabular-nums text-right">
                        {log.latencyMs}ms
                      </td>
                      <td className="py-2 px-4 font-mono tabular-nums text-right">
                        {log.promptCharCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}
