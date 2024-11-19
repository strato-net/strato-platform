import React, { useState, useEffect } from 'react';
import { Row, Typography, Divider } from 'antd';
import { useItemState, useItemDispatch } from '../../contexts/item';
import { PlusCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { actions as itemsActions } from '../../contexts/item/actions';
import { v4 as uuidv4 } from 'uuid';

const { Text } = Typography;

const NestedComponent = () => {
  const itemDispatch = useItemDispatch();
  const [addr, setAddr] = useState('');
  const [expandedKeys, setExpandedKeys] = useState([]);

  const { rawMaterials, actualRawMaterials } = useItemState();

  useEffect(() => {
    let rawMaterialList = processRawMaterials();
    itemsActions.setActualRawMaterials(itemDispatch, rawMaterialList);
  }, [rawMaterials]);

  const processRawMaterials = () => {
    let rawMaterialList = [];
    if (addr !== '') {
      for (var i = 0; i < actualRawMaterials.length; i++) {
        let result = updateMaterial(actualRawMaterials[i]);
        if (result) {
          rawMaterialList = actualRawMaterials;
          rawMaterialList[i] = result;
          break;
        }
      }
    } else {
      rawMaterialList = rawMaterials.map((e) => {
        return { ...e, key: uuidv4() };
      });
    }
    return rawMaterialList;
  };

  const updateMaterial = (obj) => {
    if (obj.key === addr) {
      let newList = rawMaterials.map((e) => {
        return { ...e, key: uuidv4() };
      });
      let newObj = { ...obj, children: newList };
      setAddr('');
      return newObj;
    } else {
      if (Object.hasOwn(obj, 'children')) {
        for (var j = 0; j < obj.children.length; j++) {
          let result = updateMaterial(obj.children[j]);
          if (result) {
            let newChildren = obj.children;
            newChildren[j] = result;

            let newObj = { ...obj, children: newChildren };
            return newObj;
          }
        }
      }
    }
  };

  const callSubMaterial = (record) => {
    if (!expandedKeys.includes(record.key)) {
      if (!record.children) {
        setAddr(record.key);
        itemsActions.fetchItemRawMaterials(
          itemDispatch,
          record.rawMaterialProductId,
          record.rawMaterialSerialNumber
        );
      }
      setExpandedKeys([...expandedKeys, record.key]);
    } else {
      var keys = expandedKeys;
      keys.splice(keys.indexOf(record.key), 1);
      setExpandedKeys([...keys]);
    }
  };

  const ExpandedView = ({ elem, level }) => {
    let marginVal = level * 50;

    return (
      <>
        <Row className="w-full flex items-center my-2">
          <div className="flex flex-auto justify-center items-center gap-2 text-center">
            <div
              className="cursor-pointer"
              style={{ marginLeft: marginVal }}
              onClick={() => callSubMaterial(elem)}
            >
              {expandedKeys.includes(elem.key) ? (
                <MinusCircleOutlined />
              ) : (
                <PlusCircleOutlined />
              )}
            </div>
            <p className="text-primaryB">
              {decodeURIComponent(elem.rawMaterialProductName)}
            </p>
          </div>
          <div
            className="flex-auto text-center"
            style={{ marginLeft: marginVal }}
          >
            <Text className="text-primaryB">
              {elem.rawMaterialSerialNumber}
            </Text>
          </div>
        </Row>
        <Divider className="mx-0 my-3" />
        {elem.children && expandedKeys.includes(elem.key) ? (
          elem.children.length === 0 ? (
            <>
              <Row className="justify-center">
                <Text className="text-primaryC">No raw materials found</Text>
              </Row>
              <Divider className="mx-0 my-3" />
            </>
          ) : (
            elem.children.map((childElem) => {
              let currentLevel = level + 1;
              return (
                <ExpandedView
                  elem={childElem}
                  level={currentLevel}
                  key={childElem.key}
                />
              );
            })
          )
        ) : null}
      </>
    );
  };

  return (
    <>
      <Row className="flex items-center">
        <div className="flex-auto text-center">
          <Text className="text-primaryC text-sm ml-4 transformation">
            RAW MATERIALS
          </Text>
        </div>
        <div className="flex-auto text-center">
          <Text className="text-primaryC text-sm ml-4 transformation">
            SERIAL NUMBER
          </Text>
        </div>
      </Row>
      <Divider className="mx-0 my-3" />
      {actualRawMaterials.map((elem) => (
        <ExpandedView elem={elem} level={0} key={elem.key} />
      ))}
      <div className="mb-44"></div>
    </>
  );
};

export default NestedComponent;
