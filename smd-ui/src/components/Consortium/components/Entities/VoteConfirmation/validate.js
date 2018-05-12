export function validate(values) {
    const errors = {};
  
    if (!values.entity) {
      errors.entity = "Please enter your username";
    }
    if (!values.password) {
      errors.password = "Please enter your password";
    }

    return errors;
  }