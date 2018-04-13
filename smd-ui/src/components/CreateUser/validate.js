export function validate(values) {

  const errors = {};
  
  if (!values.email) {
    errors.email = 'Please enter a email address';
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(values.email)) {
    errors.email = 'Please enter a valid email address';
  }

  return errors;
}