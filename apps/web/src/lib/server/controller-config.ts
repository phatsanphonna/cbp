import {
  CBP_ANSIBLE_TOKEN,
  CBP_CONTROLLER_TOKEN,
} from "$app/env/private";

const controllerTokenPattern = /^[A-Za-z0-9_-]{43,128}$/;
export function getControllerToken() {
  return CBP_CONTROLLER_TOKEN &&
    controllerTokenPattern.test(CBP_CONTROLLER_TOKEN)
    ? CBP_CONTROLLER_TOKEN
    : null;
}

export function getAnsibleToken() {
  const token = CBP_ANSIBLE_TOKEN;
  return token && controllerTokenPattern.test(token) && token !== getControllerToken() ? token : null;
}

