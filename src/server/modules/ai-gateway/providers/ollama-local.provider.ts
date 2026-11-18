import {
  AiGatewayError,
  type AiGatewayRequest,
  type AiProvider,
} from '../provider.interface.ts';
import type {
  AiAdvisoryResponse,
  AiProviderHealth,
} from '../../../../shared/types/domain.ts';

export interface OllamaLocalProviderOptions {
  getBaseUrl?: () => string;
  getModel?: () => string;
  isDeployedRuntime?: () => boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isLocalhostUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1'
    );
  } catch {
    return true;
  }
}

export class OllamaLocalProvider implements AiProvider {
  readonly id = 'ollama_local' as const;
  private readonly getBaseUrl: () => string;
  private readonly getModel: () => string;
  private readonly isDeployedRuntime: () => boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaLocalProviderOptions = {}) {
    this.getBaseUrl =
      options.getBaseUrl ??
      (() => (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''));
    this.getModel =
      options.getModel ?? (() => process.env.OLLAMA_MODEL || 'llama3.2');
    this.isDeployedRuntime =
      options.isDeployedRuntime ??
      (() => {
        const appUrl = process.env.APP_URL || '';
        const isCloudRun = Boolean(process.env.K_SERVICE);
        return (
          isCloudRun ||
          (process.env.NODE_ENV === 'production' &&
            Boolean(appUrl) &&
            !isLocalhostUrl(appUrl))
        );
      });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async getHealth(checkReachability = false): Promise<AiProviderHealth> {
    const baseUrl = this.getBaseUrl();
    const model = this.getModel();
    const localhostBlockedInCloud =
      this.isDeployedRuntime() && isLocalhostUrl(baseUrl);

    if (localhostBlockedInCloud) {
      return {
        providerId: this.id,
        label: 'Local Ollama',
        tier: 'local_dev',
        configured: false,
        reachable: false,
        model,
        note: 'Deployed server cannot access a developer’s localhost Ollama instance. Use local development or set a reachable OLLAMA_BASE_URL.',
      };
    }

    let reachable: boolean | undefined;
    if (checkReachability) {
      try {
        const res = await this.fetchImpl(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(2000),
        });
        reachable = res.ok;
      } catch {
        reachable = false;
      }
    }

    return {
      providerId: this.id,
      label: 'Local Ollama',
      tier: 'local_dev',
      configured: true,
      ...(reachable !== undefined ? { reachable } : {}),
      model,
      note:
        reachable === false
          ? `Configured for local dev (${model}), but Ollama is not currently reachable.`
          : `Local development HTTP provider configured (${model}).`,
    };
  }

  async generateAdvisory(request: AiGatewayRequest): Promise<AiAdvisoryResponse> {
    const started = Date.now();
    const baseUrl = this.getBaseUrl();
    const model = this.getModel();

    if (this.isDeployedRuntime() && isLocalhostUrl(baseUrl)) {
      throw new AiGatewayError(
        503,
        'AI_OLLAMA_LOCALHOST_IN_CLOUD',
        'Local Ollama (localhost) cannot be reached from a deployed cloud server.',
        'Switch to Gemini API Free Tier, Mock Test mode, or configure a private self-hosted OLLAMA_BASE_URL.'
      );
    }

    try {
      const response = await this.fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            {
              role: 'system',
              content: `You are FIELD FUSSION agricultural advisor (advisory only). Country=${request.context.country}, District=${request.context.district ?? 'unspecified'}, Unit=${request.context.preferredAreaUnit}, Language=${request.context.preferredLanguage}.`,
            },
            {
              role: 'user',
              content: request.prompt,
            },
          ],
        }),
      });

      if (response.status === 404) {
        throw new AiGatewayError(
          404,
          'AI_OLLAMA_MODEL_NOT_FOUND',
          `Local Ollama model "${model}" is not installed.`,
          `Run "ollama pull ${model}" locally or change OLLAMA_MODEL.`
        );
      }

      if (!response.ok) {
        throw new AiGatewayError(
          502,
          'AI_OLLAMA_HTTP_ERROR',
          `Local Ollama returned status ${response.status}.`,
          'Check your local Ollama server logs.'
        );
      }

      const data = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const content = data.message?.content?.trim();
      if (!content) {
        throw new AiGatewayError(
          502,
          'AI_EMPTY_RESPONSE',
          'Ollama returned an empty message.'
        );
      }

      return {
        requestId: request.requestId,
        providerId: this.id,
        model,
        isSimulated: false,
        responseSource: 'real_ai_model',
        advisoryText: content,
        uncertaintyNote:
          'Local open-source model advisory — validate recommendations with an agricultural expert before field execution.',
        requiresApproval: Boolean(request.includeDraftSuggestion),
        privacyNotice:
          'Processed via local Ollama HTTP endpoint with minimized farm context.',
        usage: {
          latencyMs: Date.now() - started,
          inputTokens: data.prompt_eval_count,
          outputTokens: data.eval_count,
        },
      };
    } catch (error) {
      if (error instanceof AiGatewayError) {
        throw error;
      }

      throw new AiGatewayError(
        503,
        'AI_OLLAMA_UNREACHABLE',
        'Could not connect to the local Ollama service.',
        'Start Ollama locally (ollama serve) or switch to Gemini Free Tier / Mock Test mode.'
      );
    }
  }
}
