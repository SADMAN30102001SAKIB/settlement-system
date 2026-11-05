import { expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createTools, formatResult } from './tools';

const tool = (name: string): Tool => ({
  name,
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, destructiveHint: false },
});
it('fails closed on writes, unknown tools, missing annotations and unrequested schemas', () => {
  const tools = createTools([
    tool('ads_get_ad_accounts'),
    tool('ads_create_campaign'),
    tool('ads_get_unknown'),
    { ...tool('ads_get_creatives'), annotations: { readOnlyHint: true } },
  ]);
  expect(tools.names).toEqual(['ads_get_ad_accounts']);
  expect(() => tools.validate('ads_get_ad_accounts', {})).toThrow('schema');
  expect(() => tools.schema('ads_create_campaign')).toThrow('not permitted');
  tools.schema('ads_get_ad_accounts');
  expect(tools.validate('ads_get_ad_accounts', {})).toEqual({});
  expect(() => tools.validate('ads_get_ad_accounts', [])).toThrow();
});
it('enforces full argument schemas without runtime code generation', () => {
  const tools = createTools([
    {
      ...tool('ads_get_ad_accounts'),
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['limit'],
        additionalProperties: false,
      },
    },
  ]);
  tools.schema('ads_get_ad_accounts');
  for (const args of [
    {},
    { limit: 0 },
    { limit: '20' },
    { limit: 101 },
    { limit: 2, surprise: true },
  ])
    expect(() => tools.validate('ads_get_ad_accounts', args)).toThrow();
  expect(tools.validate('ads_get_ad_accounts', { limit: 20 })).toEqual({
    limit: 20,
  });
});
it('verifies projections, levels, filters, enums and sorting from successful metadata', () => {
  const tools = createTools([tool('ads_get_ad_entities')]);
  tools.schema('ads_get_ad_entities');
  const args = { level: 'campaign', fields: ['spend'] };
  expect(() => tools.validate('ads_get_ad_entities', args)).toThrow(
    'Unverified',
  );
  tools.remember({ error_category: 'DENIED', fields: [{ name: 'spend' }] });
  expect(() => tools.validate('ads_get_ad_entities', args)).toThrow(
    'Unverified',
  );
  tools.remember({
    fields: [
      {
        name: 'spend',
        levels: ['campaign', 'ad_account'],
        filterable: true,
        sortable: true,
        supported_filter_operators: ['GREATER_THAN'],
      },
      {
        name: 'status',
        levels: ['campaign'],
        filterable: true,
        sortable: false,
        supported_filter_operators: ['IN'],
        enum_values: [{ value: 'ACTIVE' }],
      },
    ],
  });
  expect(tools.validate('ads_get_ad_entities', args)).toEqual(args);
  for (const query of [
    { ...args, level: 'ad' },
    { ...args, fields: ['invented', 'label'] },
    { ...args, sort: 'spend_desc' },
    { ...args, sort: 'ad.spend_descending' },
    { ...args, sort: 'status_descending' },
    {
      ...args,
      filtering: [{ field: 'status', operator: 'IN', value: ['PAUSED'] }],
    },
    { ...args, filtering: [{ field: 'spend', operator: 'IN', value: ['1'] }] },
    { ...args, level: 'account', sort: 'spend_descending' },
  ])
    expect(() => tools.validate('ads_get_ad_entities', query)).toThrow();
  expect(
    tools.validate('ads_get_ad_entities', {
      ...args,
      sort: 'spend_descending',
    }),
  ).toBeDefined();
});
it('preserves zeros, nulls, missing fields, empty rows and domain errors', () => {
  const result = formatResult(
    {
      content: [],
      structuredContent: {
        ad_entities: JSON.stringify([{ spend: 0, cpm: null }]),
      },
    },
    { fields: ['spend', 'cpm', 'impressions'] },
    'ads_get_ad_entities',
  );
  expect(result.evidence).toMatchObject({
    row_count: 1,
    fields_with_null_values: ['cpm'],
    fields_missing_in_some_rows: ['impressions'],
  });
  expect(result.output).toContain('0');
  expect(
    formatResult(
      {
        content: [],
        structuredContent: { error_category: 'PERMISSION_DENIED' },
      },
      {},
      '',
    ).isError,
  ).toBe(true);
  expect(
    formatResult(
      { content: [{ type: 'text', text: 'x'.repeat(30001) }] },
      {},
      '',
    ).truncated,
  ).toBe(true);
});
