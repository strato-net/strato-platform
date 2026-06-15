import React, { Component } from 'react'
import { Button, Dialog, Tooltip, Position } from '@blueprintjs/core'
import HexText from '../../../../HexText'
import { CopyToClipboard } from 'react-copy-to-clipboard';

export default class ContractSource extends Component {

    constructor(props) {
        super(props)
        this.state = {
            isModalOpen: false,
            srcCopied: false,
        }
    }

    toggleModalOpen() {
        this.setState({isModalOpen : !this.state.isModalOpen})
    }

    render() {

        const contractSource = '' // TODO: Fetch contract source
        const contractName = this.props.contract.name || ''
        const address = this.props.contract.address || ''
        const codeHash = this.props.contract.codeHash ? this.props.contract.codeHash.digest : ''
        const vm = 'SolidVM'
        return (
            <Button 
                intent='intent'
                onClick={() => {this.toggleModalOpen()}}
                iconName='pt-icon-document-open'
            >
                Show More Contract Info
                <Dialog
                    title={`${contractName} - Contract Information`}
                    isOpen={this.state.isModalOpen}
                    onClose={() => {this.toggleModalOpen()}}
                    className='pt-dark'
                >
                    <div className='pt-dialog-body'>
                    <div className='row'>
                        <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                                Address
                            </label>
                        </div>
                        <div className="col-sm-9 smd-pad-4">
                            <HexText
                                value={address}
                            />
                        </div>   
                    </div>
                    <div className='row'>
                        <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                                Shard ID
                            </label>
                        </div>
                        <div className="col-sm-9 smd-pad-4">
                            {
                                this.props.contract.chainId ?
                                <HexText
                                    value={this.props.contract.chainId}
                                /> 
                                : 'Main Chain'
                            }
                        </div>   
                    </div>
                    <div className='row'>
                        <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                                Code Hash
                            </label>
                        </div>
                        <div className="col-sm-9 smd-pad-4">
                            <HexText
                                value={codeHash}
                            />
                        </div>   
                    </div>
                    <div className='row'>
                        <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                                VM
                            </label>
                        </div>
                        <div className="col-sm-9 smd-pad-4">
                            {vm}
                        </div>   
                    </div>
                    <div className='row'>
                        <div className='col-sm-12'>
                            <label className="pt-label label-margin">
                                Contract Source
                                <CopyToClipboard
                                    text={this.props.contract.bin}
                                    onCopy={() => { this.setState({ srcCopied: true }); }}>
                                    <span
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            event.preventDefault();
                                        }}
                                    >
                                        <Tooltip
                                            content={this.state.srcCopied ? 'Copied!' : 'Copy to clipboard'}
                                            position={Position.TOP}
                                            className="smd-pointer"
                                        >
                                            <span
                                                className="pt-icon pt-icon-clipboard"
                                                style={{marginLeft: '4px'}}
                                                onMouseOut={(e) => { this.setState({ srcCopied: false }); }}>
                                            </span>
                                        </Tooltip>
                                    </span>
                                </CopyToClipboard>
                            </label>
                        </div>
                    </div>
                    <div className='row'>
                        <div className='col-sm-12'>
                            <pre>
                                {contractSource}
                            </pre>
                        </div>
                    </div>
                    </div>
                </Dialog>
            </Button>
        )
    }
}
