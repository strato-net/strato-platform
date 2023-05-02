import React, { useState } from "react";
import {
  Modal,
  Card,
  DropZone,
  ProgressBar,
  Stack,
  Thumbnail,
  Caption
} from "@shopify/polaris";
import {
  NoteMinor
} from "@shopify/polaris-icons";
import { usePapaParse } from "react-papaparse";

const ImportCSVModal = ({
  dispatch,
  actions,
  isAssetImportInProgress,
  assetsUploaded,
  assetsUploadedErrors,
  isImportAssetsModalOpen
}) => {
  const { readString } = usePapaParse();
  const [files, setFiles] = useState([]);
  const [isValidated, setValidated] = useState(true);
  const [assetData, setAssetData] = useState([]);


  const onFileLoad = (_dropFiles, acceptedFiles, _rejectedFiles) => {
    setFiles((files) => [...files, ...acceptedFiles])

    const file = acceptedFiles[0];
    if (file.type !== "text/csv") {
      this.props.setUserMessage(
        "Invalid file type. File must be of type text/csv"
      );
      return;
    }

    setValidated(true);
    const reader = new FileReader();
    reader.onload = evt => {
      const contents = readString(evt.target.result, { header: true });

      if (contents.data.length === 0) {
        actions.setMessage(dispatch, "No records to import")
        return;
      }


      
      if (!contents.data[0]['eventTypeId']) {
        actions.setMessage(dispatch, "Missing required column 'eventTypeId'");
        return;
      }

      
      if (!contents.data[0]['itemSerialNumber']) {
        actions.setMessage(dispatch, "Missing required column 'itemSerialNumber'");
        return;
      }

      
      if (!contents.data[0]['itemNFTAddress']) {
        actions.setMessage(dispatch, "Missing required column 'itemNFTAddress'");
        return;
      }

      
      if (!contents.data[0]['date']) {
        actions.setMessage(dispatch, "Missing required column 'date'");
        return;
      }

      
      if (!contents.data[0]['inventoryId']) {
        actions.setMessage(dispatch, "Missing required column 'inventoryId'");
        return;
      }

      
      if (!contents.data[0]['productId']) {
        actions.setMessage(dispatch, "Missing required column 'productId'");
        return;
      }

      
      if (!contents.data[0]['summary']) {
        actions.setMessage(dispatch, "Missing required column 'summary'");
        return;
      }

      
      if (!contents.data[0]['certifiedBy']) {
        actions.setMessage(dispatch, "Missing required column 'certifiedBy'");
        return;
      }

      
      if (!contents.data[0]['certifiedDate']) {
        actions.setMessage(dispatch, "Missing required column 'certifiedDate'");
        return;
      }

      
      if (!contents.data[0]['createdAt']) {
        actions.setMessage(dispatch, "Missing required column 'createdAt'");
        return;
      }


      const assetData = [];
      for (let i = 0; i < contents.data.length - 1; i++) {
        const row = contents.data[i];

        assetData.push({
          eventArgs: {
            eventTypeId: row['eventTypeId'],
            itemSerialNumber: row['itemSerialNumber'],
            itemNFTAddress: row['itemNFTAddress'],
            date: row['date'],
            inventoryId: row['inventoryId'],
            productId: row['productId'],
            summary: row['summary'],
            certifiedBy: row['certifiedBy'],
            certifiedDate: row['certifiedDate'],
            createdAt: row['createdAt'],
          },
          isPublic: false
        });
      }

      setAssetData(assetData);
    };
    reader.readAsText(file, "UTF-8");

  };

  const primaryAction = {
    content: "Import",
    disabled: !isValidated || isAssetImportInProgress || assetData.length === 0,
    onAction: () => actions.importAssets(dispatch, assetData)
  };

  const fileUpload = !files.length && <DropZone.FileUpload actionTitle="Add File" />;
  const uploadedFiles = files.length > 0 && (
    <div>
      <Stack vertical>
        {files.map((file, index) => (
          <Stack alignment="center" key={index}>
            <Thumbnail
              size="small"
              alt={file.name}
              source={NoteMinor}
            />
            <div>
              {file.name} <Caption>{file.size} bytes</Caption>
            </div>
          </Stack>
        ))}
      </Stack>
    </div>
  );

  const closeModal = () => {
    setValidated(false);
    setAssetData([]);
    actions.closeImportCSVmodal(dispatch)
  }

  return (
    <Modal
      open={isImportAssetsModalOpen}
      onClose={() => closeModal()}
      title={"Import Assets"}
      primaryAction={primaryAction}
      secondaryActions={[
        {
          content: assetsUploadedErrors.length ? 'Ok' : 'cancel',
          onAction: closeModal,
          disabled: isAssetImportInProgress
        }
      ]}
    >
      <Card>
        <Card.Section>
          {assetsUploadedErrors.length ? <div></div> : <div>
            <div className="upload-container">
              <DropZone
                type="file"
                accept=".csv"
                onDrop={onFileLoad}
                allowMultiple={false}
              >
                {uploadedFiles}
                {fileUpload}
              </DropZone>
            </div>
          </div>
          }
          <div>
            <br />
            {isValidated && assetData.length > 0 ? (
              <div>
                <p>
                  {isAssetImportInProgress
                    ? `${assetsUploaded} / ${assetData.length} records imported`
                    : `Click on IMPORT button to ingest ${assetData.length} records`}
                </p>
                <ProgressBar progress={(assetsUploaded * 100) / assetData.length} color="success" />
              </div>
            ) : (
              <div></div>
            )}
          </div>
        </Card.Section>
      </Card>
    </Modal >
  );
};

export default ImportCSVModal;
