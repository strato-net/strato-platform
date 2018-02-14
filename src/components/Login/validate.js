const validate = (values) => {
  const errors = {};

  if (!values.username) {
    errors.username = 'Please enter an username';
  }
  if (!values.password) {
    errors.password = 'Please enter an password';
  }

  return errors;
};

export default validate;