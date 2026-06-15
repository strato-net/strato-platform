import { handleApiError } from '../../lib/apiErrorHandler';

describe('Lib: apiErrorHandler', () => {

  test('with error', async () => {
    const response = {
      error: 'error'
    };

    await expect(handleApiError(response)).rejects.toMatchSnapshot();
  });

  test('with response', async () => {
    const response = {
      data: 'Here is response data'
    };

    await expect(handleApiError(response)).resolves.toMatchSnapshot();
  });

});