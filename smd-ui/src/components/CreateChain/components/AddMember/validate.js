export function validate(values) {
  const errors = {};

  if (!values.username) {
    errors.username = 'required';
  }

  if (!values.address) {
    errors.address = 'required';
  }

  if (!values.enode) {
    errors.enode = 'required';
  }

  return errors;
}