import { auditResult } from '@cbp/database/audit';
import { describe, expect, test } from 'bun:test';
import { auditTargetKind, collectAuditTargetIds, parseAuditFilters } from './audit-view.ts';

const uuid = '0b6f7c1e-5a2d-4c3b-9e8f-1a2b3c4d5e6f';

describe('parseAuditFilters', () => {
  test('keeps valid values and turns days into zoned bounds', () => {
    const { values, filters } = parseAuditFilters(
      new URLSearchParams('actor= Ann &action=Remove host&result=denied&from=2026-11-01&to=2026-11-02'),
      'Asia/Bangkok',
    );
    expect(values).toEqual({
      actor: 'Ann',
      action: 'Remove host',
      result: 'denied',
      from: '2026-11-01',
      to: '2026-11-02',
    });
    expect(filters.from?.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(filters.to?.toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  test('drops "any", unknown results, malformed dates and bad zones', () => {
    const { filters } = parseAuditFilters(
      new URLSearchParams('action=any&result=drop table&from=yesterday&to=2026-13-45'),
      'Not/AZone',
    );
    expect(filters).toEqual({
      actor: undefined,
      action: undefined,
      result: undefined,
      from: undefined,
      to: undefined,
    });
  });
});

test('auditResult buckets HTTP statuses', () => {
  expect([200, 303, 400, 401, 403, 404, 409, 500, 503].map(auditResult)).toEqual([
    'succeeded',
    'succeeded',
    'rejected',
    'denied',
    'denied',
    'rejected',
    'rejected',
    'error',
    'error',
  ]);
});

describe('audit targets', () => {
  test('uses the action to tell runs and hosts from the page entity', () => {
    expect(auditTargetKind('/certificates/[id]', 'Deploy certificate via Ansible')).toBe('run');
    expect(auditTargetKind('/certificates/[id]', 'Remove certificate')).toBe('certificate');
    expect(auditTargetKind('/deployments/[id]', 'Cancel queued deployment')).toBe('job');
    expect(auditTargetKind('/ansible-credentials', 'Unbind Ansible credential')).toBe('host');
    expect(auditTargetKind('/ansible-credentials', 'Create Ansible credential')).toBe('credential');
    expect(auditTargetKind('/signin', 'Sign in')).toBeUndefined();
  });

  test('collects only ids that fit the lookup column', () => {
    expect(
      collectAuditTargetIds([
        { route: '/certificates/[id]', action: 'Remove certificate', targetId: uuid },
        { route: '/certificates/[id]', action: 'Remove certificate', targetId: '12' },
        { route: '/groups', action: 'Rename group', targetId: '7' },
        { route: '/users', action: 'Remove user', targetId: 'abc_123' },
        { route: '/alerts', action: 'Clear alert', targetId: uuid },
        { route: '/signin', action: 'Sign in', targetId: null },
      ]),
    ).toEqual({
      certificate: [uuid],
      run: [],
      host: [],
      user: ['abc_123'],
      group: [7],
      channel: [],
    });
  });
});
