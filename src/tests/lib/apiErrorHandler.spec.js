import { handleApiError } from '../../lib/apiErrorHandler';

describe('Lib: apiErrorHandler', () => {

  test('with error', () => {
    const response = {
      error: 'error'
    };

    handleApiError(response).then((result) => {
      expect(result).toMatchSnapshot();
    });
  });

  test('with response', () => {
    const response = {
      data: 'Here is response data'
    };

    handleApiError(response).then((result) => {
      expect(result).toMatchSnapshot();
    });
  });

});