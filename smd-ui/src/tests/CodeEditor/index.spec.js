import React from 'react';
import CodeEditor, { mapStateToProps } from '../../components/CodeEditor/index';
import { extAbi, error, selectedTabContent, codeEditor, sourceCodeUndefinedImport } from './codeEditorMock';
import { createStore, combineReducers } from 'redux'
import { reducer as formReducer } from 'redux-form'

describe('CodeEditor: index', () => {
  let files
  const readAsText = jest.fn();
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  beforeAll(() => {
    localStorage.clear();
    files = [
      {
        name: 'file1.sol',
        size: 1111,
        type: ''
      }
    ]
    const fileContents = 'file contents';
    const expectedFinalState = { fileContents: fileContents };
    const file = new Blob([fileContents], { type: 'text/plain' });
    const addEventListener = jest.fn((_, evtHandler) => { evtHandler(); });
    const dummyFileReader = { addEventListener, readAsText, result: fileContents };
    window.FileReader = jest.fn(() => dummyFileReader);
  });

  test('render codeEditor with default values', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor
    }
    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      codeEditor: codeEditor,
      chains: {
        selectedChain: "abcdefg",
        chainIds: [],
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  describe('simulate events', () => {

    test('compile SolidVM code', () => {
      const props = {
        selectedTabContent: selectedTabContent,
        codeEditorData: codeEditor,
        onCompileFileLocally: jest.fn(),
        removeTab: jest.fn(),
        changeCreateActionState: jest.fn(),
        onTabChange: jest.fn(),
        onChangeFileName: jest.fn(),
        addNewFileTab: jest.fn(),
        fetchChainDetailSelect: jest.fn(),
        selectChain: jest.fn(),
        fetchChainIds: jest.fn(),
        selectedChain: "abcdefg",
        chainIds: ["abcdefg"],
        store,
      }
      const wrapper = shallow(
        <CodeEditor.WrappedComponent {...props} />
      ).dive().dive().dive();
      const popOver = wrapper.find('Popover').at(0)
      wrapper.find('Button').at(0).simulate('click')
      expect(props.onCompileFileLocally).toHaveBeenCalled()
      wrapper.find('Button').at(1).simulate('click')
      wrapper.find('Button').at(2).simulate('click')
      wrapper.find('Button').at(3).simulate('click')
  
      wrapper.find('span').at(0).simulate('click')
      expect(props.removeTab).toHaveBeenCalled()
  
      const monacoEditor = wrapper.find('Tab2').at(1).dive().find('MonacoEditor')
      monacoEditor.simulate('change', { target: { value: 'abc', index: 1 } })
      expect(props.changeCreateActionState).toHaveBeenCalled()
  
      wrapper.find('Tabs2').at(0).simulate('change', { target: { newTab: 1, prevTab: 0 } })
      expect(props.onTabChange).toHaveBeenCalled()
  
      const input = popOver.dive().find('input')
      expect(input.value).toBe(undefined)
      input.simulate('change', { target: { value: 'tanuj' } })
      expect(props.onChangeFileName).toHaveBeenCalled()
  
      const button = popOver.dive().find('Overlay').find('Button')
      button.simulate('click')
      expect(props.addNewFileTab).toHaveBeenCalled()
  
      props.codeEditorData['sourceCode'] = undefined
      wrapper.find('Button').at(0).simulate('click')
      expect(props.onCompileFileLocally).toHaveBeenCalled()
  
      props.codeEditorData['sourceCode'] = sourceCodeUndefinedImport
      wrapper.find('Button').at(0).simulate('click')
      expect(props.onCompileFileLocally).toHaveBeenCalled()
    })

    // const props = {
    //   selectedTabContent: selectedTabContent,
    //   codeEditorData: codeEditor,
    //   onCompileFileLocally: jest.fn(),
    //   removeTab: jest.fn(),
    //   changeCreateActionState: jest.fn(),
    //   onTabChange: jest.fn(),
    //   onChangeFileName: jest.fn(),
    //   addNewFileTab: jest.fn(),
    //   // selectedChain: "abcdefg",
    //   // chainIds: ["abcdefg"],
    //   // chains: {}
    // }
    // const wrapper = shallow(
    //   <CodeEditor.WrappedComponent {...props} />
    // );
    

    // wrapper.find('span').at(0).simulate('click')
    // expect(props.removeTab).toHaveBeenCalled()

    // const monacoEditor = wrapper.find('Tab2').at(1).dive().find('MonacoEditor')
    // monacoEditor.simulate('change', { target: { value: 'abc', index: 1 } })
    // expect(props.changeCreateActionState).toHaveBeenCalled()

    // wrapper.find('Tabs2').at(0).simulate('change', { target: { newTab: 1, prevTab: 0 } })
    // expect(props.onTabChange).toHaveBeenCalled()

    // const input = popOver.dive().find('input')
    // expect(input.value).toBe(undefined)
    // input.simulate('change', { target: { value: 'tanuj' } })
    // expect(props.onChangeFileName).toHaveBeenCalled()

    // const button = popOver.dive().find('Overlay').find('Button')
    // button.simulate('click')
    // expect(props.addNewFileTab).toHaveBeenCalled()

    // props.codeEditorData['sourceCode'] = undefined
    // wrapper.find('Button').at(0).simulate('click')
    // expect(props.onCompileFileLocally).toHaveBeenCalled()

    // props.codeEditorData['sourceCode'] = sourceCodeUndefinedImport
    // wrapper.find('Button').at(0).simulate('click')
    // expect(props.onCompileFileLocally).toHaveBeenCalled()

  });

  test('.sol file drop', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn(),
      fetchChainDetailSelect: jest.fn(),
      selectChain: jest.fn(),
      fetchChainIds: jest.fn(),
      selectedChain: "adfads",
      chainIds: ["adfads"],
      store,
    }
    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    ).dive().dive().dive();
    console.log(wrapper)
    const dropzone = wrapper.find('.dropzone')
    console.log(dropzone)
    dropzone.simulate('drop', files)
    expect(readAsText).toHaveBeenCalled()

  });

  test('other file eg. text file drop', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn(),
      fetchChainDetailSelect: jest.fn(),
      selectChain: jest.fn(),
      fetchChainIds: jest.fn(),
      selectedChain: "adfads",
      chainIds: ["adfads"],
      store,
    }
    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    ).dive().dive().dive();
    files[0]['name'] = 'pqr.txt'
    const dropzone = wrapper.find('Dropzone')
    dropzone.simulate('drop', files)
    expect(readAsText).toHaveBeenCalled()
  });

  test('multiple file drop', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn(),
      fetchChainDetailSelect: jest.fn(),
      selectChain: jest.fn(),
      fetchChainIds: jest.fn(),
      selectedChain: "adfads",
      chainIds: ["adfads"],
      store,
    }
    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    ).dive().dive().dive();
    files.push({
      name: 'file2.sol',
      size: 1111,
      type: ''
    })
    const dropzone = wrapper.find('Dropzone')
    dropzone.simulate('drop', files)
    expect(readAsText).toHaveBeenCalled()
  });

  test('local storage', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn(),
      fetchChainDetailSelect: jest.fn(),
      selectChain: jest.fn(),
      fetchChainIds: jest.fn(),
      selectedChain: "adfads",
      chainIds: ["adfads"],
      store,
    }
    var wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />, { lifecycleExperimental: true }
    ).dive().dive().dive();
    window.onbeforeunload()
    expect(Object.keys(localStorage.__STORE__).length).toBe(1)
  });

  test('save local state method call', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn(),
      fetchChainDetailSelect: jest.fn(),
      selectChain: jest.fn(),
      fetchChainIds: jest.fn(),
      selectedChain: "adfads",
      chainIds: ["adfads"],
      store,
    }
    const options = {
      lifecycleExperimental: true,
      disableLifecycleMethods: false
    };
    var wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />, options
    ).dive().dive().dive();
    wrapper.instance().saveLocalState = jest.fn()
    wrapper.instance().componentDidUpdate()
    expect(wrapper.instance().saveLocalState).toHaveBeenCalled()
  });

})