import Congrats from '../../components/Congrats';

describe('Congrats: index', () => {

  test('blueprint', () => {
    const props = {
      handleContinue: jest.fn()
    };

    expect(Congrats(props)).toMatchSnapshot();
  });

});