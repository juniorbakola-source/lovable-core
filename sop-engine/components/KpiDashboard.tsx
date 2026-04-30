import React from "react";

export default function KpiDashboard({ kpis }: any) {
  return (
    <div style={{ padding: 20 }}>
      <h1>Global Dashboard</h1>
      <div style={{ display: "flex", gap: 20 }}>
        <div>Total Stock Value: {kpis.totalValue}</div>
        <div>Stockout Risks: {kpis.riskSKUs}</div>
        <div>Recommended Orders: {kpis.orders}</div>
        <div>Active POs: {kpis.activePO}</div>
      </div>
    </div>
  );
}
