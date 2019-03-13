import {isModeOauth} from "../../../lib/checkMode";

export default function validate(values) {
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
  
  if (!values.contractAddress) {
    errors.contractAddress = "Can't be blank";
  }

  return errors;
}