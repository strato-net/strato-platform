import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import MonacoEditor from 'react-monaco-editor';
import { Button, Tab2, Tabs2, Popover, Position, Icon, Switch } from '@blueprintjs/core';
import { onCompileFileLocally, onChangeFileName, contractNameChange, compileCodeFromEditor, changeCreateActionState, addNewFileTab, removeTab, onTabChange } from './codeEditor.actions';
import { getSelectedTabContent } from './codeEditor.selector';
import CreateContract from '../CreateContract';
import DeployDapp from '../DeployDapp';
import { getImportStatements, getFileAndReplaceWithImport } from '../../lib/FileParser.js';
import { downloadFile } from '../../lib/fileHandler.js';
import Dropzone from 'react-dropzone';
import { toasts } from "../Toasts";
import debounce from 'lodash/debounce';
import ReactGA from 'react-ga4';
import { fetchChainDetailSelect, selectChain, fetchChainIds } from "../Chains/chains.actions"
import HexText from '../HexText';
import { Field, reduxForm } from 'redux-form';

class CodeEditor extends Component {
  constructor() {
    super()
    this.timeout = null;
    this.saveLocalState = null
    this.state = {
      chainLimit: 25,
      chainOffset: 0,
      useSearch: true,
      chainSearchQueryField: "chainid",
      chainQuery: "",
    }
  }

  componentDidMount() {
    mixpanelWrapper.track('code_editor_load');
    ReactGA.send({hitType: "pageview", page: "/code_editor", title: "Contract Editor"});
    // this.props.fetchChainIds(this.chainLimit, this.chainOffset);
    this.saveLocalState = debounce(this.saveToLocalStorage, 500)
    window.onbeforeunload = (e) => {
      this.saveToLocalStorage()
    };
  }

  componentDidUpdate() {
      this.saveLocalState && this.saveLocalState()
  }

  onChainSearch = () => {
    if (this.state.useSearch) {
      this.setState({chainQuery : ""})
      this.props.fetchChainIds(this.chainLimit, this.chainOffset);
    }
    this.props.fetchChainDetailSelect(this.state.chainQuery, this.state.chainSearchQueryField)
  }

  toggleChainQueryType = (e) => {
    this.setState({ useSearch : !this.state.useSearch })
  }

  onNextChainClick = () => {
    const { chainOffset, chainLimit } = this.state;
    const newOffset = chainOffset + chainLimit;
    this.setState({ chainOffset: newOffset }, () => {
      this.props.fetchChainIds(this.state.chainLimit, this.state.chainOffset);
    });
  };

  onPrevChainClick = () => {
    const { chainOffset, chainLimit } = this.state;
    const newOffset = Math.max(0, chainOffset - chainLimit);
    this.setState({ chainOffset: newOffset }, () => {
      this.props.fetchChainIds(this.state.chainLimit, this.state.chainOffset);
    });
  };

  saveToLocalStorage() {
    try {
      const serializedState = JSON.stringify(this.props.codeEditorData);
      localStorage.setItem('code_editor_state', serializedState);
    } catch (err) {
      console.log('error:', err)
    }
  }

  renderPopUpContent = () => {
    return (
      <div className="row">
        <input
          className="pt-input .modifier"
          type="text"
          placeholder="Enter file name"
          dir="auto"
          onChange={(e) => this.props.onChangeFileName(e.target.value)} />
        <Button
          className="pt-intent-primary pt-popover-dismiss"
          text="Add file"
          onClick={() => {
            this.props.codeEditorData.fileName && this.props.codeEditorData.fileName.length > 0 && this.props.addNewFileTab(this.props.codeEditorData.fileName, '')
          }} />
      </div>
    )
  }

  handleFileDrop = (files) => {
    if (files.length > 1) {
      toasts.show({ message: 'Expected a .sol file, got multiple files' });
      return;
    }
    const regex = new RegExp(/.sol$/, 'i');
    if (!regex.test(files[0].name)) {
      toasts.show({ message: 'Please upload a .sol file' });
      return;
    }
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const fileAsBinaryString = reader.result
        const fileName = files[0].name.replace('.sol', '')
        this.props.addNewFileTab(fileName, fileAsBinaryString)
      };
      reader.onabort = () => toasts.show({ message: 'file reading was aborted' })
      reader.onerror = () => toasts.show({ message: 'file reading has failed' })
      reader.readAsText(file);
    });
  }

  // onTextUpdate() {
  //   clearTimeout(this.timeout);
  //   this.timeout = setTimeout(() => {
  //     this.compileCode();
  //   }, 3000);
  // }

  compileCode(codeType) {
    this.props.onCompileFileLocally('')
    try {
      if (this.props.codeEditorData.sourceCode === undefined || this.props.codeEditorData.sourceCode.length === 0) {
        throw new Error("Can't compile. Source is undefined")
      }
      const code = getFileAndReplaceWithImport(this.props.codeEditorData.sourceCode, this.props.codeEditorData.tab)
      // const newFileList = getImportStatements(code)
      // if (newFileList.length > 0) {
      //   throw new Error("Can't find the imported file.")
      // }
      mixpanelWrapper.track("compile_contract_code_click");
      this.props.compileCodeFromEditor(code, codeType);
    } catch (e) {
      this.props.onCompileFileLocally(`${e}`)
    }
  }

  renderFileHandlerButtons() {
    return (
      <div className="row smd-pad-vertical-4">
        <div className="pt-button-group">
          <div className="smd-pad-4">
            <Popover
              position={Position.TOP}
              content={this.renderPopUpContent()}
              popoverClassName={"popoverClassName"}
              popoverWillClose={() => this.props.onChangeFileName(undefined)}
            >
              <Button className="pt-icon-add"
                text="Add File"
              />
            </Popover>
          </div>
          <Dropzone
            className="dropzone smd-pad-4"
            onDrop={(files, e) => { this.handleFileDrop(files) }}
          >
            <Button className="pt-icon-add-to-folder"
              text="Import File"
            />
          </Dropzone>
          <div className="smd-pad-4">
            <Button className="pt-icon-download"
              text="Download File"
              onClick={() => {
                this.props.selectedTabContent && downloadFile(this.props.selectedTabContent.title, this.props.selectedTabContent.text)
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  render() {
    const options = {
      theme: 'vs-dark',
      automaticLayout: true
    };
    const requireConfig = {
      url: 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.1/require.min.js',
      paths: {
        vs: 'vs'
      }
    };
    var sourceCode = undefined
    try {
      sourceCode = this.props.codeEditorData.sourceCode &&
        getFileAndReplaceWithImport(this.props.codeEditorData.sourceCode, this.props.codeEditorData.tab)
    } catch (e) {
      //console.log('Exception')
    }
    const tabData = this.props.codeEditorData.tab
    const tabMenus = tabData.map((item, index) => {
      return <Tab2 id={index} key={index} title={item.title} panel={<MonacoEditor
        className="col-md-4 text-center"
        width={'100%'}
        height={window.innerHeight - 320 < 480 ? 480 : window.innerHeight - 320}
        value={item.text}
        language="sol"
        requireConfig={requireConfig}
        options={options}
        onChange={(value, e) => {
          this.props.changeCreateActionState(false, value, index);
          // disable hot compile
          //this.onTextUpdate();
        }} />}>
        <span className="pt-icon-standard pt-icon-cross pt-align-right smd-pad-8"
          onClick={() => {
            this.props.removeTab(index)
          }}>
        </span>
      </Tab2>
    })
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-md-2 text-left">
            <h3>Contract Editor</h3>
          </div>
          <div className="text-right col-md-10">
            <div className='smd-pad-16 ' style={{display: "inline-block"}}>
              {/* <Popover
                position={Position.BOTTOM}
                content={
                  <div>
                  <Button className="pt-intent-primary smd-margin-8" 
                    text="SolidVM" 
                    onClick={() => {this.compileCode("SolidVM")}}/>
                  <Button className="pt-intent-primary smd-margin-8" 
                    text="EVM" 
                    onClick={() => {this.compileCode("EVM")}}/>
                  </div>
                }
                > */}
                <Button
                  className="pt-intent-primary"
                  disabled={false}
                  onClick={() => {this.compileCode("SolidVM")}}
                  text="Compile">
                    {/* <Icon style={{margin: 0, padding: 0}} iconName="caret-down"/> */}
                </Button>
              {/* </Popover> */}
            </div>
          
            <DeployDapp
              onChangeEditorContractName={this.props.contractNameChange}
              contractNameFromEditor={this.props.codeEditorData.contractName}
              enableCreateContract={this.props.codeEditorData.enableCreateAction}
              textFromEditor={sourceCode}
              sourceFromEditor={this.props.codeEditorData.response && this.props.codeEditorData.response.src} />
            <CreateContract
              onChangeEditorContractName={this.props.contractNameChange}
              contractNameFromEditor={this.props.codeEditorData.contractName}
              enableCreateContract={this.props.codeEditorData.enableCreateAction}
              textFromEditor={sourceCode}
              sourceFromEditor={this.props.codeEditorData.response && this.props.codeEditorData.response.src} />
          </div>
        </div>
        {this.renderFileHandlerButtons()}
        <div className="row">
          <div className="col-md-12">
            <Tabs2
              id="editor-tab"
              selectedTabId={this.props.codeEditorData.currentTabSelected}
              onChange={(newTab, prevTab, event) => this.props.onTabChange(prevTab, newTab)}>
              {tabMenus}
            </Tabs2>
          </div>
        </div>
        <div className="row">
          <div className="col-md-12">
            <pre className="pt-text-muted" style={{ height: '110px', fontSize: '11px' }}>
              {
                this.props.codeEditorData.localCompileException.length > 0 ? this.props.codeEditorData.localCompileException : (this.props.codeEditorData.codeCompileSuccess
                  ? ' Contract compiled successfully'
                  : this.props.codeEditorData.response
                    ? ' ' + this.props.codeEditorData.response
                    : '')
              }
            </pre>
          </div>
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    selectedTabContent: getSelectedTabContent(state.codeEditor),
    codeEditorData: state.codeEditor,
    selectedChain: state.chains.selectedChain,
    chainIds: state.chains.chainIds,
  };
}

const formed = reduxForm({ form: 'CodeEditor' })(CodeEditor);
export default withRouter(connect(mapStateToProps, 
  { onCompileFileLocally, 
    onChangeFileName, 
    contractNameChange, 
    compileCodeFromEditor, 
    changeCreateActionState, 
    addNewFileTab, 
    removeTab, 
    onTabChange,
    fetchChainDetailSelect,
    selectChain,
    fetchChainIds,
  })(formed));
