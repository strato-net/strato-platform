export function validate(values) {
  const errors = {};

  if (!values.chainName) {
    errors.chainName = 'required';
  }

  if (values.members && !values.members.length) {
    errors.members = 'atleast add one member';
  }

  return errors;
}