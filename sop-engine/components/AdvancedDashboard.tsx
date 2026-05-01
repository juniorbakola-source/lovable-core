import React from "react";

export default function AdvancedDashboard({ data }: any) {
  const totalValue = data.reduce((sum: number, sku: any) => sum + (sku.value || 0), 0);
  const riskItems = data.filter((sku: any) => sku.projected < sku.rop).length;

  return (
    <div style={{ padding: 20 }}>
      <h1>Executive S&OP Dashboard</h1>

      <div style={{ display: "flex", gap: 20 }}>
        <div>💰 Total Inventory Value: {totalValue}</div>
        <div>⚠️ Risk SKUs: {riskItems}</div>
      </div>

      <h2>SKU Details</h2>
      {data.map((sku: any, index: number) => (
        <div key={index} style={{ border: "1px solid #ccc", margin: 10, padding: 10 }}>
          <strong>{sku.name}</strong>
          <p>Projected: {sku.projected}</p>
          <p>ROP: {sku.rop}</p>
          <p>Value: {sku.value}</p>

          {sku.projected < sku.rop ? (
            <span style={{ color: "red" }}>High Risk</span>
          ) : (
            <span style={{ color: "green" }}>OK</span>
          )}
        </div>
      ))}
    </div>
  );
}
