type AnsibleCredentials = { sshPassword: string; suPassword: string };

function isPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    Buffer.byteLength(value) <= 1024 && !/[\0\r\n]/.test(value);
}

export function readAnsibleCredentials(fields: FormData) {
  const sshPassword = fields.get('sshPassword');
  const suPassword = fields.get('suPassword');
  if ((sshPassword === null || sshPassword === '') && (suPassword === null || suPassword === ''))
    return {};
  if (!isPassword(sshPassword) || !isPassword(suPassword)) {
    return { message: 'Provide both the SSH and root su passwords, or leave both blank.' };
  }
  return { credentials: { sshPassword, suPassword } };
}

export function packAnsibleDeployment(privateKey: string, credentials?: AnsibleCredentials) {
  return credentials ? JSON.stringify({ privateKey, credentials }) : privateKey;
}

export function unpackAnsibleDeployment(value: string) {
  if (value.startsWith('-----BEGIN ')) return { privateKey: value };
  const { privateKey, credentials } = JSON.parse(value);
  const sshPassword: unknown = credentials?.sshPassword;
  const suPassword: unknown = credentials?.suPassword;
  if (typeof privateKey !== 'string' || !isPassword(sshPassword) || !isPassword(suPassword))
    throw new Error('Invalid Ansible deployment payload');
  return { privateKey, credentials: { sshPassword, suPassword } };
}
