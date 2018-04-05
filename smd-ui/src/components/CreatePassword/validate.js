export function validate(values) {
  const errors = {};

  if (!values.password) {
    errors.password = "Password Required";
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Must Confirm Password";
  }

  if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords Do Not Match";
  }

  return errors;
}