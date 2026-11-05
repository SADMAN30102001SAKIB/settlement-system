import { loadEnvFile } from 'node:process';
import { expect, it } from 'vitest';
import { runChat } from './engine';

it.skipIf(!process.env['AI_LIVE_ENV_FILE'])(
  'connects real Gemini to real Meta using the integrated engine',
  async () => {
    const file = process.env['AI_LIVE_ENV_FILE'];
    if (!file) throw new Error('AI_LIVE_ENV_FILE is required.');
    loadEnvFile(file);
    const geminiKey = process.env['GEMINI_API_KEY'],
      metaToken = process.env['META_ACCESS_TOKEN'],
      gatewayToken = process.env['AI_GATEWAY_TOKEN'];
    if (!geminiKey || !metaToken || !gatewayToken)
      throw new Error(
        'The live test requires provider and gateway credentials.',
      );
    const events: string[] = [];
    try {
      const result = await runChat({
        geminiKey,
        metaToken,
        gatewayToken,
        history: [],
        question:
          'List the Meta advertising accounts I can access. Only list account names and IDs. Do not query performance or change anything.',
        signal: AbortSignal.timeout(90000),
        check: async () => {
          await Promise.resolve();
        },
        emit: async (event) => {
          events.push(event.type === 'status' ? event.text : event.type);
          await Promise.resolve();
        },
      });
      expect(result.answer.length > 0).toBe(true);
      expect(events.includes('delta')).toBe(true);
      expect(
        result.history.some((content) =>
          content.parts?.some(
            (part) =>
              part.functionResponse?.name === 'read_meta_ads' &&
              part.functionResponse.response?.['tool'] ===
                'ads_get_ad_accounts' &&
              part.functionResponse.response['isError'] === false,
          ),
        ),
      ).toBe(true);
    } catch (error) {
      throw new Error(
        (error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'Live provider failure'
        )
          .replaceAll(geminiKey, '[redacted]')
          .replaceAll(metaToken, '[redacted]')
          .replaceAll(gatewayToken, '[redacted]')
          .slice(0, 1400),
      );
    }
  },
  100000,
);
