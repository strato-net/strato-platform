import { isOauthEnabled } from "../../../lib/checkMode";

export function validate(values) {

  const errors = {};

  if (!isOauthEnabled() && !values.username) {
    errors.username = 'Select username';
  }

  if (!isOauthEnabled() && !values.address) {
    errors.address = 'Address required';
  }

  if (!isOauthEnabled() && !values.password) {
    errors.password = 'Password required';
  }

  if (!values.content) {
    errors.content = 'Attach file';
  }

  if (!values.provider) {
    errors.provider = 'Select provider';
  }

  if (!values.description) {
    errors.description = 'Attach file';
  }

  return errors;
}