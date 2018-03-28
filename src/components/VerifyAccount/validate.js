export function validate(values) {
  const errors = {};

  if (!values.OTP) {
    errors.OTP = "OTP Required";
  }

  return errors;
}