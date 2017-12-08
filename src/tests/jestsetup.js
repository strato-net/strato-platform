import Adapter from 'enzyme-adapter-react-15';
import Enzyme, { shallow, render, mount, configure } from 'enzyme';

configure({ adapter: new Adapter() });
// Make Enzyme functions available in all test files without importing
global.shallow = shallow;
global.render = render;
global.mount = mount;