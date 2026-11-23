import { CBP_CONTROLLER_TOKEN, CBP_DEPLOYMENT_ENCRYPTION_KEY } from '$app/env/private';

const controllerTokenPattern = /^[A-Za-z0-9_-]{43,128}$/;
export function getControllerToken() {
  return CBP_CONTROLLER_TOKEN && controllerTokenPattern.test(CBP_CONTROLLER_TOKEN) ? CBP_CONTROLLER_TOKEN : null;
}

export function deploymentEncryptionKey() {
  const value = CBP_DEPLOYMENT_ENCRYPTION_KEY;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const key = Buffer.from(value, 'base64url');
  return key.toString('base64url') === value ? key : null;
}
