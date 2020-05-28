import { isOauthEnabled } from "../../../lib/checkMode";

export default function validate(values) {
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

  if (!values.contractAddress) {
    errors.contractAddress = "Can't be blank";
  }

  return errors;
}