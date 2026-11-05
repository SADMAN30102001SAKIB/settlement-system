import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker-provider.js';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import { z } from 'zod';

const allowed = new Set([
  'ads_account_get_activity_logs',
  'ads_catalog_event_source_get',
  'ads_catalog_event_source_get_catalogs',
  'ads_catalog_event_source_get_health',
  'ads_catalog_event_source_get_recommendations',
  'ads_catalog_get_businesses',
  'ads_catalog_get_data_sources',
  'ads_catalog_get_diagnostics',
  'ads_catalog_get_dynamic_ads_health',
  'ads_catalog_get_feed_rules',
  'ads_catalog_get_product_feed_upload_sessions',
  'ads_catalog_list_catalogs',
  'ads_catalog_list_dpa_eligible_catalogs',
  'ads_catalog_list_partner_integrations',
  'ads_catalog_list_product_feeds',
  'ads_catalog_list_product_sets',
  'ads_catalog_list_products',
  'ads_experiment_abtest_get_test',
  'ads_experiment_check_eligibility',
  'ads_experiment_lift_get_test',
  'ads_experiment_list_tests',
  'ads_get_ad_account_custom_audiences',
  'ads_get_ad_account_pages',
  'ads_get_ad_accounts',
  'ads_get_ad_entities',
  'ads_get_ad_images',
  'ads_get_ad_preview',
  'ads_get_ad_videos',
  'ads_get_creative_ads',
  'ads_get_creatives',
  'ads_get_custom_audience',
  'ads_get_custom_audience_adsets',
  'ads_get_customconversions',
  'ads_get_dataset_details',
  'ads_get_dataset_quality',
  'ads_get_dataset_stats',
  'ads_get_datasets',
  'ads_get_errors',
  'ads_get_field_context',
  'ads_get_help_article',
  'ads_get_ig_accounts',
  'ads_get_ig_media',
  'ads_get_opportunity_score',
  'ads_get_pages_for_business',
  'ads_get_user_pages',
  'ads_insights_advertiser_context',
  'ads_insights_anomaly_signal',
  'ads_insights_auction_ranking_benchmarks',
  'ads_insights_industry_benchmark',
  'ads_insights_performance_trend',
  'ads_insights_performance_vs_peers',
  'ads_library_search',
  'ads_pixel_event_read',
  'ads_pixel_parameter_read',
]);
const record = z.record(z.string(), z.unknown());
const fieldSchema = z.object({
  name: z.string(),
  levels: z.array(z.string()),
  filterable: z.boolean(),
  sortable: z.boolean(),
  supported_filter_operators: z.array(z.string()),
  enum_values: z
    .array(z.object({ value: z.string() }))
    .nullable()
    .optional(),
});

export function decode(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function formatResult(
  result: CallToolResult,
  args: Record<string, unknown>,
  name: string,
) {
  const text = result.content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  const data = record.safeParse(result.structuredContent ?? decode(text));
  const raw = text || JSON.stringify(result.structuredContent ?? {});
  const rows = data.success ? data.data['ad_entities'] : undefined;
  const parsed = z
    .array(record)
    .safeParse(typeof rows === 'string' ? decode(rows) : rows);
  const fields = z.array(z.string()).safeParse(args['fields']);
  return {
    output: raw.slice(0, 30000),
    truncated: raw.length > 30000,
    isError:
      result.isError === true ||
      Boolean(
        data.success && (data.data['error_category'] ?? data.data['error']),
      ),
    ...(name === 'ads_get_ad_entities' && parsed.success
      ? {
          evidence: {
            row_count: parsed.data.length,
            returned_fields: [
              ...new Set(parsed.data.flatMap((r) => Object.keys(r))),
            ],
            fields_with_null_values: [
              ...new Set(
                parsed.data.flatMap((r) =>
                  Object.keys(r).filter((k) => r[k] === null),
                ),
              ),
            ],
            fields_missing_in_some_rows: fields.success
              ? fields.data.filter((k) =>
                  parsed.data.some((r) => !Object.hasOwn(r, k)),
                )
              : [],
            limit:
              'Null/missing means unavailable, not zero. No cause or current entity status is established. Truncated output is incomplete.',
          },
        }
      : {}),
  };
}

export function createTools(definitions: Tool[]) {
  const tools = new Map(
    definitions
      .filter(
        (t) =>
          allowed.has(t.name) &&
          t.annotations?.readOnlyHint === true &&
          t.annotations.destructiveHint === false,
      )
      .map((t) => [t.name, t]),
  );
  const loaded = new Set<string>();
  const verified = new Map<string, z.infer<typeof fieldSchema>>();
  const validators = new Map<
    string,
    ReturnType<CfWorkerJsonSchemaValidator['getValidator']>
  >();
  return {
    names: [...tools.keys()],
    guide: [...tools.values()]
      .map(
        (t) =>
          `${t.name}: ${(t.description ?? 'Read-only Meta data.').split(/\r?\n/)[0]?.slice(0, 180) ?? ''}`,
      )
      .join('\n'),
    schema(name: string) {
      const tool = tools.get(name);
      if (!tool)
        throw new Error(
          'This Meta tool is not permitted. Only reviewed read-only tools are available.',
        );
      loaded.add(name);
      return {
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    },
    remember(value: unknown) {
      const data = record.safeParse(value);
      if (!data.success || data.data['error'] || data.data['error_category'])
        return;
      const fields = z.array(fieldSchema).safeParse(data.data['fields']);
      if (!fields.success) return;
      const unknown = z
        .array(z.string())
        .safeParse(data.data['unknown_fields']);
      if (unknown.success)
        for (const name of unknown.data) verified.delete(name);
      for (const field of fields.data) verified.set(field.name, field);
    },
    validate(name: string, input: unknown) {
      const tool = tools.get(name);
      if (!tool || !loaded.has(name))
        throw new Error(
          'Load get_meta_tool_schema for a permitted tool before calling it.',
        );
      const args = record.parse(input);
      let validate = validators.get(name);
      if (!validate) {
        validate = new CfWorkerJsonSchemaValidator().getValidator(
          tool.inputSchema as JsonSchemaType,
        );
        validators.set(name, validate);
      }
      const validation = validate(args);
      if (!validation.valid)
        throw new Error(
          `Arguments do not match the tool schema: ${validation.errorMessage}`,
        );
      if (name !== 'ads_get_ad_entities' || args['object_state'] === 'draft')
        return args;
      const level =
        args['level'] === 'account'
          ? 'ad_account'
          : z.string().min(1).parse(args['level']);
      const fields = z.array(z.string()).min(1).parse(args['fields']);
      const missing = fields.filter((f) => !verified.has(f));
      if (missing.length)
        throw new Error(
          `Unverified fields: ${missing.join(', ')}. Call ads_get_field_context with all these fields first.`,
        );
      function getField(name: string, qualified = false) {
        let canonical = name;
        if (qualified && name.includes('.')) {
          const [scope, ...parts] = name.split('.');
          if ((scope === 'account' ? 'ad_account' : scope) !== level)
            throw new Error('Field scope does not match the requested level.');
          canonical = parts.join('.');
        }
        const field = verified.get(canonical);
        if (!field?.levels.includes(level))
          throw new Error(
            `Verify ${name} for the requested level with ads_get_field_context.`,
          );
        return field;
      }
      for (const name of fields) getField(name);
      const filters =
        args['filtering'] === undefined
          ? []
          : z
              .array(
                z.object({
                  field: z.string(),
                  operator: z.string(),
                  value: z.array(z.string()),
                }),
              )
              .parse(args['filtering']);
      if (
        level === 'ad_account' &&
        (filters.length || args['sort'] !== undefined)
      )
        throw new Error('Account-level filtering and sorting are unsupported.');
      for (const filter of filters) {
        const field = getField(filter.field, true);
        if (
          !field.filterable ||
          !field.supported_filter_operators.includes(filter.operator)
        )
          throw new Error(`Unsupported filter for ${filter.field}.`);
        if (
          field.enum_values?.length &&
          filter.value.some(
            (v) => !field.enum_values?.some((e) => e.value === v),
          )
        )
          throw new Error(`Unsupported enum value for ${filter.field}.`);
      }
      if (args['sort'] !== undefined) {
        const match = /^(.+)_(ascending|descending)$/.exec(
          z.string().parse(args['sort']),
        );
        if (!match?.[1] || !getField(match[1], true).sortable)
          throw new Error(
            'Use a verified sortable field followed by _ascending or _descending.',
          );
      }
      return args;
    },
  };
}
