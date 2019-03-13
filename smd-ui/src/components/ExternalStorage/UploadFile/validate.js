import {isModeOauth} from "../../../lib/checkMode";

export function validate(values) {

  const errors = {};

  if (!isModeOauth() && !values.username) {
    errors.username = 'Select username';
  }

  if (!isModeOauth() && !values.address) {
    errors.address = 'Address required';
  }

  if (!isModeOauth() && !values.password) {
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