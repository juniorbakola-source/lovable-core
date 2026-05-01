import React from "react";

export default function Dashboard({ data }: any) {
  return (
    <div style={{ padding: 20 }}>
      <h1>S&OP Dashboard</h1>

      {data.map((sku: any, index: number) => (
        <div key={index} style={{ border: "1px solid #ddd", margin: 10, padding: 10 }}>
          <h3>{sku.name}</h3>
          <p>Projected Stock: {sku.projected}</p>
          <p>Reorder Point: {sku.rop}</p>

          {sku.projected < sku.rop ? (
            <p style={{ color: "red" }}>⚠️ Reorder Required</p>
          ) : (
            <p style={{ color: "green" }}>✅ Stock OK</p>
          )}
        </div>
      ))}
    </div>
  );
}
