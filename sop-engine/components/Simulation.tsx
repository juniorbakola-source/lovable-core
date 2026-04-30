import React, { useState } from "react";

export default function Simulation() {
  const [demandIncrease, setDemandIncrease] = useState(0);

  return (
    <div style={{ padding: 20 }}>
      <h1>Simulation Lab</h1>

      <label>Increase Demand (%)</label>
      <input
        type="number"
        value={demandIncrease}
        onChange={(e) => setDemandIncrease(Number(e.target.value))}
      />

      <p>Impact preview: Demand increases by {demandIncrease}%</p>
    </div>
  );
}
