import { expect, test } from 'bun:test';
import {
  packAnsibleDeployment,
  readAnsibleCredentials,
  unpackAnsibleDeployment,
} from './ansible-deployment-payload.js';

const privateKey = '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n';

test('Ansible preserves the passwords and supports existing jobs with a key only', () => {
  const form = new FormData();
  expect(readAnsibleCredentials(form)).toEqual({
    message: 'Provide a valid SSH username.',
  });
  expect(unpackAnsibleDeployment(packAnsibleDeployment(privateKey))).toEqual({
    privateKey,
  });

  form.set('sshUsername', ' deploy ');
  form.set('sshPassword', ' ssh password ');
  form.set('becomeMethod', 'su');
  form.set('suPassword', '{{ root password }}');
  const { credentials } = readAnsibleCredentials(form);
  expect(credentials).toEqual({
    sshUsername: 'deploy',
    sshPassword: ' ssh password ',
    becomeMethod: 'su',
    suPassword: '{{ root password }}',
  });
  expect(unpackAnsibleDeployment(packAnsibleDeployment(privateKey, credentials))).toEqual({
    privateKey,
    credentials,
  });
});

test('Ansible requires a complete pair of single-line passwords', () => {
  const form = new FormData();
  form.set('sshPassword', 'ssh password');
  expect(readAnsibleCredentials(form).message).toBeDefined();
  form.set('suPassword', 'invalid\npassword');
  expect(readAnsibleCredentials(form).message).toBeDefined();
});
