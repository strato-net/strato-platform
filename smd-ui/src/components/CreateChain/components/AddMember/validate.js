export function validate(values, userSelected) {
  const errors = {};

  if (userSelected && !values.username) {
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