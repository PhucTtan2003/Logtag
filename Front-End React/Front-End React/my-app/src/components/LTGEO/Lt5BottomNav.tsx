import React from "react";
import "../../styles/Ltgeo/Lt5BottomNav.css";

interface Props {
  viewMode: "table" | "chart";
  onChange: (mode: "table" | "chart") => void;
}

const Lt5BottomNav: React.FC<Props> = ({ viewMode, onChange }) => {
  return (
    <div className="lt5-bottom-nav">
      <div
        className={`lt5-bottom-item ${viewMode === "table" ? "active" : ""}`}
        onClick={() => onChange("table")}
      >
        <span>📋</span>
        Table
      </div>

      <div
        className={`lt5-bottom-item ${viewMode === "chart" ? "active" : ""}`}
        onClick={() => onChange("chart")}
      >
        <span>📈</span>
        Chart
      </div>
    </div>
  );
};

export default Lt5BottomNav;