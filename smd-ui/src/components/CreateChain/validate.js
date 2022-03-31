export function validate(values) {
  const errors = {};

  if (!values.chainName) {
    errors.chainName = 'required';
  }

  if (values.members && !values.members.length) {
    errors.members = 'at least add one member';
  }

  return errors;
}