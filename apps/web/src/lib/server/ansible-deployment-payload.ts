type AnsibleCredentials = {
  sshUsername: string;
  sshPassword: string;
  becomeMethod: 'sudo' | 'su';
  suPassword?: string;
};

function isPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    Buffer.byteLength(value) <= 1024 && !/[\0\r\n]/.test(value);
}

export function readAnsibleCredentials(fields: FormData) {
  const sshUsername = fields.get('sshUsername');
  const sshPassword = fields.get('sshPassword');
  const becomeMethod = fields.get('becomeMethod');
  const suPassword = fields.get('suPassword');
  if (typeof sshUsername !== 'string' || !sshUsername.trim() ||
      Buffer.byteLength(sshUsername) > 256 || /[\0\r\n]/.test(sshUsername))
    return { message: 'Provide a valid SSH username.' };
  if (!isPassword(sshPassword))
    return { message: 'Provide the SSH password.' };
  if (becomeMethod !== 'sudo' && becomeMethod !== 'su')
    return { message: 'Choose sudo or su as the become method.' };
  if (becomeMethod === 'su' && !isPassword(suPassword))
    return { message: 'Provide the root su password when the become method is su.' };
  if (becomeMethod === 'sudo' && suPassword !== null && suPassword !== '')
    return { message: 'A root su password is only used with the su become method.' };
  return {
    credentials: {
      sshUsername: sshUsername.trim(),
      sshPassword,
      becomeMethod,
      ...(becomeMethod === 'su' ? { suPassword: suPassword as string } : {}),
    },
  };
}

export function packAnsibleDeployment(privateKey: string, credentials?: AnsibleCredentials) {
  return credentials ? JSON.stringify({ privateKey, credentials }) : privateKey;
}

export function unpackAnsibleDeployment(value: string) {
  if (value.startsWith('-----BEGIN ')) return { privateKey: value };
  const { privateKey, credentials } = JSON.parse(value);
  const sshUsername: unknown = credentials?.sshUsername;
  const sshPassword: unknown = credentials?.sshPassword;
  const becomeMethod: unknown = credentials?.becomeMethod;
  const suPassword: unknown = credentials?.suPassword;
  if (typeof privateKey !== 'string' || typeof sshUsername !== 'string' ||
      !sshUsername.trim() || Buffer.byteLength(sshUsername) > 256 ||
      !isPassword(sshPassword) || (becomeMethod !== 'sudo' && becomeMethod !== 'su') ||
      (becomeMethod === 'su' && !isPassword(suPassword)) ||
      (becomeMethod === 'sudo' && suPassword !== undefined))
    throw new Error('Invalid Ansible deployment payload');
  return {
    privateKey,
    credentials: {
      sshUsername,
      sshPassword,
      becomeMethod,
      ...(becomeMethod === 'su' ? { suPassword: suPassword as string } : {}),
    },
  };
}
