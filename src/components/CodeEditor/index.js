import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import MonacoEditor from 'react-monaco-editor';
import { Button, Tab2, Tabs2, Popover } from '@blueprintjs/core';
import { compileCodeFromEditor, changeCreateActionState, addNewFileTab, removeTab, onTabChange } from './codeEditor.actions';
import CreateContract from '../CreateContract';

class CodeEditor extends Component {

    render() {
        const options = {
            theme: 'vs-dark',
            automaticLayout: true,
            language: 'vs/basic-languages/src/solidity'
        };

        const requireConfig = {
            url: 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.1/require.min.js',
            paths: {
                vs: 'https://as.alipayobjects.com/g/cicada/monaco-editor-mirror/0.6.1/min/vs'
            }
        };
        const tabData = this.props.codeEditorData.tab
        const tabMenus = tabData.map((item, index) =>
            <Tab2 id={index} title={item.title} panel={<MonacoEditor
                className="col-md-4 text-center"
                width={'100%'}
                height="400"
                defaultValue={item.text}
                language='vs/basic-languages/src/solidity'
                requireConfig={requireConfig}
                editorWillMount={this.editorWillMount}
                options={options}
                onChange={(value, e) => {
                    this.props.changeCreateActionState(false, value, index)
                }} />}>
                <span className="pt-icon-standard pt-icon-cross pt-align-right smd-pad-8"
                    onClick={() => {
                       this.props.removeTab(index)
                    }}>
                </span>
            </Tab2>
        )

        return (
            <div className="container-fluid">
                <div className="row pt-dark">
                    <div className="row">
                        <div className="col-md-4 text-left">
                            <h3>Contract Editor</h3>
                        </div>
                        <div className="col-md-8 text-right smd-pad-8">
                            <div className="smd-pad-8">
                                <Button onClick={() => {
                                    mixpanelWrapper.track("compile_contract_code_click");
                                    this.props.compileCodeFromEditor(
                                        'Greeter',
                                        this.props.codeEditorData.sourceCode,
                                        false
                                    );
                                }} className="pt-intent-primary"
                                    text="Compile" />
                                <CreateContract contractNameFromEditor={this.props.codeEditorData.contractName} enableCreateContract={this.props.codeEditorData.enableCreateAction} textFromEditor={this.props.codeEditorData.sourceCode} sourceFromEditor={this.props.codeEditorData.response && this.props.codeEditorData.response.src} />
                            </div>
                        </div>
                    </div>
                    <div className="row">
                        <div className="col-md-6">
                            {/* onClick={() => {
                                        this.props.addNewFileTab()
                                    }} */}
                            <Popover
                                content={
                                    <div className="smd-pad-8" style={{ height: 50 }}>
                                        <input className="pt-input .modifier" type="text" placeholder="Enter File Name" dir="auto" />
                                        <button type="button" className="pt-button pt-icon-add">Add</button>
                                    </div>}
                                target={<Button className="pt-icon-add"
                                    text="Add File"
                                />}
                            />
                        </div>
                    </div>
                    <div className="row" style={{ margin: 20 }}>
                        <Tabs2 id="Tabs2Example" defaultSelectedTabId={this.props.codeEditorData.lastTabSelected} onChange = {(newTab,prevTab,event) => this.props.onTabChange(prevTab,newTab)}>
                            {tabMenus}
                        </Tabs2>
                    </div>
                    <div style={{ margin: 20 }}>
                        Result:
                        {this.props.codeEditorData.codeCompileSuccess ? ' Contract compiled successfully' : this.props.codeEditorData.response ? ' ' + this.props.codeEditorData.response : ''}
                    </div>
                </div>

            </div>
        );
    }
}

function mapStateToProps(state) {
    return {
        codeEditorData: state.codeEditor,
    };
}

export default withRouter(connect(mapStateToProps, {
    compileCodeFromEditor,
    changeCreateActionState,
    addNewFileTab,
    removeTab,
    onTabChange
})(CodeEditor));
