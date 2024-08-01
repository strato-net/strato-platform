import React from "react";
import {  Button, Row, Col } from "antd";
import { dummyData } from "./constant";
import { Images } from "../../images";
import "./ordersTable.css"

const TransactionResponsive = () => {
  const typeColor = {
    Order: "#2A53FF",
    Transfer: "#FF0000",
    Redemption: "#001C76"
  }

  const StratsIcon = <img src={Images.logo} alt="" className="mx-1 w-3 h-3" />

  const handleMore = (val) => {
    console.log("handleMore", val);
  }

  return (
    <div className="flex flex-col gap-y-10 w-full ">
    {dummyData.map(({imageURL, assetName, qty, reference, type, totalPrice})=>{
      console.log("item", imageURL[0]);
     return <Row className="bg-red-300 w-full h-32 rounded-xl px-4 py-2 shadow-2xl border-2" >
     <Col span={6} className="flex justify-center bg-grey-400">
       <img src={imageURL[0]} alt="" className="rounded-xl shadow-2xl w-16 border-0"  />
     </Col>
     <Col span={7} offset={1} className="flex flex-col justify-between" >
       <p className="text-base font-bold"> {assetName} </p>
       <p style={{color:'#13188A'}} className="font-semibold"> {reference} </p>
       <p style={{color:'#827474'}} className="font-medium"> Token Description....</p>
       <span style={{color:'#13188A'}} className="font-semibold" onClick={()=>{handleMore(assetName)}}>More +/- </span>
     </Col>
     <Col span={10} className="flex flex-col justify-between">
      <Button className="block ml-auto text-white" size="middle" style={{backgroundColor:`${typeColor[type]}`}}> {type} </Button>
      <p className="text-right flex justify-end items-center"> $ {totalPrice} ({totalPrice*100} {StratsIcon}) </p>
      <p className="text-right">Qty: {qty}</p>
      <p className="text-right">10/12/2024</p>
     </Col>
   </Row>
    })}
    </div>
  );
};

export default TransactionResponsive;
