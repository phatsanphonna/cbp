import { expect, test } from 'bun:test';
import { pickAutoDeployTargets } from './auto-deploy-targets.js';

test('auto-deploy picks one supported Agent endpoint per host', () => {
  const result = pickAutoDeployTargets([
    { id: '1', hostId: 'a', endpoint: 'a:443', engine: 'Nginx', method: 'Agent' },
    { id: '2', hostId: 'a', endpoint: 'a:8443', engine: 'Nginx', method: 'Agent' },
    { id: '3', hostId: 'b', endpoint: 'b:443', engine: 'Nginx', method: 'Ansible' },
    { id: '4', hostId: null, endpoint: 'c:443', engine: 'Nginx', method: 'Agent' },
    { id: '5', hostId: 'd', endpoint: 'd:443', engine: 'IIS', method: 'Agent' },
    { id: '6', hostId: 'e', endpoint: 'e:443', engine: null, method: 'Manual' },
    { id: '7', hostId: 'f', endpoint: 'f:443', engine: 'HAProxy', method: 'Agent' },
  ]);
  expect(result.targets.map(({ id }) => id)).toEqual(['1', '7']);
  expect(result.skipped).toEqual(['a:8443', 'b:443', 'c:443', 'd:443']);
});
