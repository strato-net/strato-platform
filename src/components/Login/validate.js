export const loginValidate = (values) => {
  const errors = {};

  if (!values.username) {
    errors.username = 'Please enter a username';
  } else if (values.username.length < 2 || values.username.length > 15) {
    errors.username = "Username must be at least 2 characters and 15 characters max";
  }
  if (!values.password) {
    errors.password = 'Please enter a password';
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters";
  }

  return errors;
};

export const firstTimeLoginValidate = (values) => {
  const errors = {};
  if (!values.email) {
    errors.email = 'Please enter a email address';
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(values.email)) {
    errors.email = 'Please enter a valid email address';
  }

  return errors;
};