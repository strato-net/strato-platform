export function validate(values) {
  const errors = {};

  if (!values.tempPassword) {
    errors.tempPassword = "Temporary password required";
  }

  return errors;
}