// src/pages/ProductList.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  ChevronRight,
  Copy,
  Grid2X2,
  List,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import api from "../api/axios";
import WarrantyModal from "../components/Warranty/WarrantyModal";
import "../styles/Admin/ProductList.css";

interface Device {
  serialNumber: string;
  model: string;
  description?: string;
}

type ViewMode = "grid" | "list";
type SortMode = "serial" | "model" | "description";

const normalizeText = (value?: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const cleanDevice = (d: any): Device => ({
  serialNumber: String(d?.serialNumber ?? d?.serial ?? "").trim(),
  model: String(d?.model ?? "").trim(),
  description: String(d?.description ?? d?.note ?? d?.notes ?? "").trim(),
});

const getInitial = (value: string) => {
  const text = String(value || "?").trim();
  return text ? text.slice(0, 2).toUpperCase() : "??";
};

const isEmptyDescription = (value?: string) => {
  const text = normalizeText(value);
  return !text || text === "khong co" || text === "none" || text === "null";
};

export default function ProductList() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [modelFilter, setModelFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("serial");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const fetchDevices = async () => {
    setLoading(true);
    setErr("");

    try {
      const res = await api.get("/api/warranty/get-all-devices");
      const fixed: Device[] = (Array.isArray(res.data) ? res.data : [])
        .map(cleanDevice)
        .filter((x: Device) => x.serialNumber);

      setDevices(fixed);
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.response?.data ||
        error?.message ||
        "Không tải được danh sách thiết bị.";

      setErr(String(message));
      console.error("⚠️ Lỗi tải thiết bị:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDevices();
  }, []);

  const modelOptions = useMemo(() => {
    const s = new Set<string>();
    for (const d of devices) if (d.model) s.add(d.model);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [devices]);

  const stats = useMemo(() => {
    const total = devices.length;
    const models = modelOptions.length;
    const withNote = devices.filter((d) => !isEmptyDescription(d.description)).length;
    const missingNote = total - withNote;

    return { total, models, withNote, missingNote };
  }, [devices, modelOptions.length]);

  const visibleDevices = useMemo(() => {
    const keyword = normalizeText(query);

    const filtered = devices.filter((d) => {
      const matchModel = !modelFilter || d.model === modelFilter;
      if (!matchModel) return false;
      if (!keyword) return true;

      return [d.serialNumber, d.model, d.description]
        .map(normalizeText)
        .some((x) => x.includes(keyword));
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "model") {
        return (
          a.model.localeCompare(b.model) ||
          a.serialNumber.localeCompare(b.serialNumber)
        );
      }

      if (sortMode === "description") {
        return (
          String(a.description ?? "").localeCompare(String(b.description ?? "")) ||
          a.serialNumber.localeCompare(b.serialNumber)
        );
      }

      return a.serialNumber.localeCompare(b.serialNumber);
    });
  }, [devices, modelFilter, query, sortMode]);

  const copySerial = async (serial: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard?.writeText(serial);
    } catch {
      // Trình duyệt cũ có thể không hỗ trợ clipboard API — bỏ qua để không chặn UI.
    }
  };

  const clearFilters = () => {
    setQuery("");
    setModelFilter("");
    setSortMode("serial");
  };

  return (
    <div className="plx-page">
      <section className="plx-hero">
        <div className="plx-hero-copy">
          <div className="plx-kicker">
            <Sparkles size={16} /> WARRANTY COMMAND CENTER
          </div>
          <h2>Danh sách thiết bị</h2>
          <p>
            Theo dõi thiết bị, lọc nhanh theo model và mở hồ sơ bảo hành chỉ bằng một lần chạm.
          </p>
        </div>

        <button
          type="button"
          className="plx-refresh"
          onClick={() => void fetchDevices()}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "plx-spin" : ""} />
          {loading ? "Đang tải" : "Làm mới"}
        </button>
      </section>

      <section className="plx-stats" aria-label="Tổng quan thiết bị">
        <div className="plx-stat-card primary">
          <span>Tổng thiết bị</span>
          <strong>{stats.total}</strong>
          <small>Đang quản lý</small>
        </div>
        <div className="plx-stat-card">
          <span>Model</span>
          <strong>{stats.models}</strong>
          <small>Nhóm thiết bị</small>
        </div>
        <div className="plx-stat-card">
          <span>Có ghi chú</span>
          <strong>{stats.withNote}</strong>
          <small>Đủ thông tin</small>
        </div>
        <div className="plx-stat-card warning">
          <span>Thiếu ghi chú</span>
          <strong>{stats.missingNote}</strong>
          <small>Cần bổ sung</small>
        </div>
      </section>

      <section className="plx-control-panel">
        <div className="plx-searchbox">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm serial, model hoặc ghi chú..."
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm">
              <X size={16} />
            </button>
          )}
        </div>

        <label className="plx-select-wrap">
          <span>Model</span>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            title="Lọc theo model"
          >
            <option value="">Tất cả model</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="plx-select-wrap compact">
          <span>Sắp xếp</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            title="Sắp xếp danh sách"
          >
            <option value="serial">Theo serial</option>
            <option value="model">Theo model</option>
            <option value="description">Theo ghi chú</option>
          </select>
        </label>

        <div className="plx-view-toggle" aria-label="Chọn kiểu hiển thị">
          <button
            type="button"
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
            title="Dạng thẻ"
          >
            <Grid2X2 size={17} />
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
            title="Dạng danh sách"
          >
            <List size={17} />
          </button>
        </div>
      </section>

      <div className="plx-model-pills" aria-label="Lọc nhanh theo model">
        <button
          type="button"
          className={!modelFilter ? "active" : ""}
          onClick={() => setModelFilter("")}
        >
          Tất cả <b>{devices.length}</b>
        </button>
        {modelOptions.slice(0, 8).map((m) => {
          const count = devices.filter((d) => d.model === m).length;
          return (
            <button
              key={m}
              type="button"
              className={modelFilter === m ? "active" : ""}
              onClick={() => setModelFilter(m)}
              title={m}
            >
              {m || "Không rõ"} <b>{count}</b>
            </button>
          );
        })}
      </div>

      <div className="plx-result-line">
        <span>
          Hiển thị <b>{visibleDevices.length}</b> / {devices.length} thiết bị
        </span>
        {(query || modelFilter || sortMode !== "serial") && (
          <button type="button" onClick={clearFilters}>
            Xóa bộ lọc
          </button>
        )}
      </div>

      {err && <div className="plx-error">{err}</div>}

      {loading && devices.length === 0 ? (
        <div className="plx-skeleton-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="plx-skeleton-card" key={i} />
          ))}
        </div>
      ) : visibleDevices.length === 0 ? (
        <div className="plx-empty">
          <div className="plx-empty-icon">🔎</div>
          <h3>Không tìm thấy thiết bị</h3>
          <p>Thử đổi model, nhập serial khác hoặc xóa bộ lọc hiện tại.</p>
          <button type="button" onClick={clearFilters}>Xóa bộ lọc</button>
        </div>
      ) : (
        <div className={`plx-device-grid ${viewMode === "list" ? "is-list" : ""}`}>
          {visibleDevices.map((device, index) => {
            const hasNote = !isEmptyDescription(device.description);

            return (
              <article
                key={device.serialNumber}
                className="plx-device-card"
                style={{ ["--delay" as any]: `${Math.min(index * 28, 240)}ms` }}
                onClick={() => setSelectedDevice(device)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedDevice(device);
                  }
                }}
              >
                <div className="plx-avatar">
                  <Box size={18} />
                  <span>{getInitial(device.model || device.serialNumber)}</span>
                </div>

                <div className="plx-card-body">
                  <div className="plx-card-top">
                    <div>
                      <div className="plx-serial-label">SERIAL NUMBER</div>
                      <h3>{device.serialNumber}</h3>
                    </div>
                    <span className="plx-status-chip">
                      <ShieldCheck size={14} /> Sẵn sàng
                    </span>
                  </div>

                  <div className="plx-info-grid">
                    <div>
                      <span>Model</span>
                      <b>{device.model || "Chưa có model"}</b>
                    </div>
                    <div>
                      <span>Ghi chú</span>
                      <b className={!hasNote ? "muted" : ""}>
                        {hasNote ? device.description : "Không có"}
                      </b>
                    </div>
                  </div>

                  <div className="plx-card-actions">
                    <button
                      type="button"
                      className="plx-copy-btn"
                      onClick={(e) => void copySerial(device.serialNumber, e)}
                    >
                      <Copy size={15} /> Copy serial
                    </button>

                    <span className="plx-open-warranty">
                      <Wrench size={15} /> Mở bảo hành <ChevronRight size={16} />
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedDevice && (
        <WarrantyModal
          deviceId={selectedDevice.serialNumber}
          deviceName={`Thiết bị ${selectedDevice.serialNumber}`}
          onClose={() => setSelectedDevice(null)}
        />
      )}

      <div className="plx-footer-note">
        <PackageCheck size={16} /> Nhấn vào một thiết bị để mở yêu cầu bảo hành.
      </div>
    </div>
  );
}
