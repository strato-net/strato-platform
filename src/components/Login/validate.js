const validate = (values) => {
  const errors = {};

  if (!values.email) {
    errors.email = 'Please enter an username';
  }
  if (!values.password) {
    errors.password = 'Please enter an password';
  }

  return errors;
};

export default validate;