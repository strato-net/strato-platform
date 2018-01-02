import { handleApiError } from '../../lib/apiErrorHandler';

test('should handleApiError error', () => {
  const response = {
    error: 'error'
  }

  handleApiError(response).then((result) => {
    expect(result).toMatchSnapshot();
  })
});

test('should handleApiError error', () => {
  const response = {
    data: 'Here is response data'
  }

  handleApiError(response).then((result) => {
    expect(result).toMatchSnapshot();
  });
});
