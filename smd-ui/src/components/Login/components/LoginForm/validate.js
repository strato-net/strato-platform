export const validate = (values) => {
  const errors = {};

  if (!values.username) {
    errors.username = 'Please enter a username';
  } else if (values.username.length < 2 || values.username.length > 320) {
    errors.username = "Username must be at least 2 characters and 320 characters max";
  }
  if (!values.password) {
    errors.password = 'Please enter a password';
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters";
  }

  return errors;
};