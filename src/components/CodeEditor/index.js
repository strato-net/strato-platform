import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import MonacoEditor from 'react-monaco-editor';
import {Button} from '@blueprintjs/core';
import { compileCodeFromEditor, changeCreateActionState } from './codeEditor.actions';
import CreateContract from '../CreateContract';

class CodeEditor extends Component {
    constructor(props) {
        super(props);
    }

    editorWillMount = (monaco) => {
        console.log('Languagues:', monaco.languages.getLanguages())
    } 

    render() {
        const requireConfig = {
            url: 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.1/require.min.js',
            paths: {
                vs: 'https://as.alipayobjects.com/g/cicada/monaco-editor-mirror/0.6.1/min/vs'
            }
        };
       
        return (
            <div className="container-fluid">
                <div className="row pt-dark">
                    <div className="row">
                        <div className="col-md-3 text-left">
                            <h3>Contract Editor</h3>
                        </div>
                        <div className="col-md-8 text-right smd-pad-8">
                            <div className="smd-pad-4">
                                <Button onClick={() => {
                                    mixpanelWrapper.track("compile_contract_code_click");
                                    this.props.compileCodeFromEditor(
                                        'Greeter',
                                        this.props.codeEditorData.sourceCode,
                                        false
                                      );
                                }} className="pt-intent-primary"
                                    text="Compile" />
                                <CreateContract enableCreateContract={this.props.codeEditorData.enableCreateAction} style={{display: 'inline-block'}} textFromEditor={this.props.codeEditorData.sourceCode} sourceFromEditor={this.props.codeEditorData.response&&this.props.codeEditorData.response.src}/>
                            </div>
                        </div>
                    </div>
                    <div className="row">
                        <MonacoEditor
                            width={'80%'}
                            height="200"
                            language="solidity"
                            defaultValue={this.props.codeEditorData.sourceCode}
                            requireConfig={requireConfig}
                            editorWillMount={this.editorWillMount}
                            onChange={(value, e) => {
                                this.props.changeCreateActionState(false,value)
                            }}
                        />
                    </div>
                    Result:
                    <div className="row">
                        {this.props.codeEditorData.codeCompileSuccess?'Contract compiled successfully': this.props.codeEditorData.response}
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
    changeCreateActionState
})(CodeEditor));
