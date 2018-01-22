import Adapter from 'enzyme-adapter-react-15';
import Enzyme, { shallow, render, mount, configure } from 'enzyme';
import moment from 'moment-timezone';
require('isomorphic-fetch');
require('jest-localstorage-mock');

var expect = require('expect');
global.fetch = require('jest-fetch-mock');

configure({ adapter: new Adapter() });
moment.tz.setDefault('EST');
// Make Enzyme functions available in all test files without importing
global.shallow = shallow;
global.render = render;
global.mount = mount;

Object.values = (obj) => Object.keys(obj).map(key => obj[key])

expect.extend({
  toBeType(received, argument) {
    const initialType = typeof received;
    const type = initialType === "object" ? Array.isArray(received) ? "array" : initialType : initialType;
    return type === argument ? {
      message: () => `expected ${received} to be type ${argument}`,
      pass: true
    } : {
        message: () => `expected ${received} to be type ${argument}`,
        pass: false
      };
  }
});