import React from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";
import { LtgeoReading } from "../../models/LtgeoReadings";
import "../../styles/Ltgeo/LT5Chart.css"; // nhớ import CSS

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
);

interface Props {
  readings: LtgeoReading[];
}

// Parse chuỗi dateUtc một cách an toàn, luôn coi là UTC
function parseUtcDate(raw: string): Date {
  if (!raw) return new Date(NaN);

  const hasOffset = /[zZ]|[+\-]\d\d:?\d\d$/.test(raw);
  const iso = hasOffset ? raw : raw + "Z";
  return new Date(iso);
}

// Formatter ép về múi giờ Việt Nam (Asia/Ho_Chi_Minh)
const vnTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
});

const Lt5Chart: React.FC<Props> = ({ readings }) => {
  if (!readings || readings.length === 0) return <div>Không có dữ liệu.</div>;

  const sorted = [...readings].sort(
    (a, b) =>
      parseUtcDate(a.dateUtc).getTime() - parseUtcDate(b.dateUtc).getTime()
  );

  const labels = sorted.map((x) =>
    vnTimeFormatter.format(parseUtcDate(x.dateUtc))
  );

  const data = {
    labels,
    datasets: [
      {
        label: "Temperature (°C)",
        data: sorted.map((x) => x.temperature),
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.15)",
        pointRadius: 1.5,
        pointHoverRadius: 4,
        pointHitRadius: 8,
        tension: 0.3,
        yAxisID: "y",
      },
      {
        label: "Humidity (%)",
        data: sorted.map((x) => x.humidity ?? 0),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.18)",
        pointRadius: 1.5,
        pointHoverRadius: 4,
        pointHitRadius: 8,
        tension: 0.3,
        yAxisID: "y1",
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        position: "top",
        labels: {
          usePointStyle: true,
          boxWidth: 10,
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          title(items) {
            const idx = items[0]?.dataIndex ?? 0;
            const d = parseUtcDate(sorted[idx].dateUtc);
            return vnTimeFormatter.format(d);
          },
          label(item) {
            const label = item.dataset.label || "";
            const v = item.parsed.y;
            if (label.includes("Humidity")) return `${label}: ${v} %`;
            return `${label}: ${v} °C`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          autoSkip: true,
          maxTicksLimit: 10,
          maxRotation: 0,
          minRotation: 0,
        },
      },
      y: {
        position: "left",
        title: {
          display: true,
          text: "Temperature (°C)",
        },
        grid: {
          color: "rgba(148, 163, 184, 0.3)",
        },
      },
      y1: {
        position: "right",
        title: {
          display: true,
          text: "Humidity (%)",
        },
        grid: {
          drawOnChartArea: false,
        },
        min: 0,
        max: 100,
        ticks: {
          callback(value) {
            return value + "%";
          },
        },
      },
    },
  };

 return (
  <div className="lt5-chart-wrapper">
    <div className="lt5-chart-inner">
      <Line data={data} options={options} />
    </div>
  </div>
);

};

export default Lt5Chart;
