import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../../api/axios";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eraser,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
  Shuffle,
  Sparkles,
  SquareDashed,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useAdminAccount } from "../../../hooks/useAdminAccount";
import "../../../styles/Admin/RebalancePanel.css";
import Toast from "../../../components/Toast";

type TeamDistributionRow = {
  userId: string;
  fullName: string;
  count: number;
  serials: string[];
};

type ToastState = {
  message: string;
  type: "success" | "error" | "info";
};

type TeamOption = {
  id: string;
  label: string;
  subtitle: string;
};

const TEAMS: TeamOption[] = [
  { id: "16922", label: "Main Team", subtitle: "Thiết bị LogTag chính" },
  { id: "17953", label: "LT5 Team", subtitle: "LT5 / LTGeo" },
];

const apiPrefix = "/api/logtag/devices";

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const getEmployeeId = (emp: any) =>
  String(emp?.id || emp?.accountId || emp?._id || "");

const getInitials = (name?: string) => {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "?";
  return parts
    .slice(-2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
};

const compactId = (id?: string) => {
  if (!id) return "—";
  return id.length > 16 ? `${id.slice(0, 7)}…${id.slice(-5)}` : id;
};

const formatSerialPreview = (serials: string[]) => {
  if (!serials.length) return "Chưa có serial";
  if (serials.length <= 3) return serials.join(", ");
  return `${serials.slice(0, 3).join(", ")} +${serials.length - 3}`;
};

const RebalancePanel: React.FC = () => {
  const { users } = useAdminAccount();

  const [teamId, setTeamId] = useState<string>(TEAMS[0].id);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [serialQuery, setSerialQuery] = useState("");

  const [busyRebalance, setBusyRebalance] = useState(false);
  const [distribution, setDistribution] = useState<TeamDistributionRow[]>([]);
  const [loadingDist, setLoadingDist] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const accounts = Array.isArray(users) ? users : [];

  const employees = useMemo(
    () =>
      accounts.filter(
        (u: any) => normalizeText(u.roleName || u.role || "") === "employee"
      ),
    [accounts]
  );

  const currentTeam = useMemo(
    () => TEAMS.find((team) => team.id === teamId) ?? TEAMS[0],
    [teamId]
  );

  const filteredEmployees = useMemo(() => {
    const keyword = normalizeText(employeeQuery);
    if (!keyword) return employees;

    return employees.filter((emp: any) =>
      [emp.fullName, emp.email, getEmployeeId(emp), emp.phone]
        .map(normalizeText)
        .some((x) => x.includes(keyword))
    );
  }, [employees, employeeQuery]);

  const fetchDistribution = useCallback(async () => {
    const tid = Number(teamId);
    if (!Number.isFinite(tid) || tid <= 0) return;

    try {
      setLoadingDist(true);
      const res = await api.get(`${apiPrefix}/team/${tid}/distribution`);
      setDistribution(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      setDistribution([]);
      setToast({
        message: err?.response?.data?.message || "Không tải được phân bổ.",
        type: "error",
      });
    } finally {
      setLoadingDist(false);
    }
  }, [teamId]);

  useEffect(() => {
    setDistribution([]);
    void fetchDistribution();
  }, [fetchDistribution]);

  const toggleEmployee = (id: string) => {
    if (!id) return;
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectVisibleEmployees = () => {
    const ids = filteredEmployees.map(getEmployeeId).filter(Boolean);
    setSelectedEmployeeIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const clearSelection = () => setSelectedEmployeeIds([]);

  const callRebalance = async () => {
    const tid = Number(teamId);
    if (!Number.isFinite(tid) || tid <= 0) {
      setToast({ message: "TeamId không hợp lệ.", type: "error" });
      return;
    }

    setBusyRebalance(true);
    try {
      const payload: { teamId: number; participants?: string[] } = { teamId: tid };
      if (selectedEmployeeIds.length > 0) payload.participants = selectedEmployeeIds;

      const res = await api.post(`${apiPrefix}/rebalance`, payload);
      setToast({
        message: res.data?.message || "Đã chia đều thiết bị thành công.",
        type: "success",
      });
      await fetchDistribution();
    } catch (err: any) {
      setToast({
        message: `Lỗi chia đều: ${err?.response?.data?.message || err.message}`,
        type: "error",
      });
    } finally {
      setBusyRebalance(false);
    }
  };

  const callAssignAndRebalance = async () => {
    const tid = Number(teamId);
    if (!Number.isFinite(tid) || tid <= 0) {
      setToast({ message: "TeamId không hợp lệ.", type: "error" });
      return;
    }

    if (selectedEmployeeIds.length !== 1) {
      setToast({
        message: "Chọn đúng 1 nhân viên để thêm vào nhóm rồi chia lại.",
        type: "error",
      });
      return;
    }

    setBusyRebalance(true);
    try {
      const res = await api.post(`${apiPrefix}/assign-one-and-rebalance`, {
        teamId: tid,
        accountId: selectedEmployeeIds[0],
      });

      setToast({
        message: res.data?.message || "Đã thêm người và chia lại thành công.",
        type: "success",
      });
      await fetchDistribution();
    } catch (err: any) {
      setToast({
        message: `Lỗi thêm người & chia lại: ${
          err?.response?.data?.message || err.message
        }`,
        type: "error",
      });
    } finally {
      setBusyRebalance(false);
    }
  };

  const callClearMappings = () => {
    const tid = Number(teamId);
    if (!Number.isFinite(tid) || tid <= 0) {
      setToast({ message: "TeamId không hợp lệ.", type: "error" });
      return;
    }
    setShowConfirm(true);
  };

  const doClearMappings = async () => {
    const tid = Number(teamId);
    setShowConfirm(false);
    setBusyRebalance(true);

    try {
      const res = await api.delete(`${apiPrefix}/team/${tid}/clear`);
      setToast({
        message: res.data?.message || "Đã xoá toàn bộ mapping.",
        type: "success",
      });
      setDistribution([]);
    } catch (err: any) {
      setToast({
        message: `Lỗi xoá: ${err?.response?.data?.message || err.message}`,
        type: "error",
      });
    } finally {
      setBusyRebalance(false);
    }
  };

  const totalDevices = useMemo(
    () => distribution.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
    [distribution]
  );

  const mappedMembers = distribution.length;
  const selectedMembers = selectedEmployeeIds.length;
  const maxCount = Math.max(1, ...distribution.map((row) => Number(row.count) || 0));
  const minCount = distribution.length
    ? Math.min(...distribution.map((row) => Number(row.count) || 0))
    : 0;
  const avgCount = distribution.length ? totalDevices / distribution.length : 0;
  const imbalance = distribution.length ? maxCount - minCount : 0;
  const fairnessScore = distribution.length
    ? Math.max(0, Math.round(100 - (imbalance / Math.max(1, maxCount)) * 100))
    : 0;

  const visibleDistribution = useMemo(() => {
    const keyword = normalizeText(serialQuery);
    const rows = [...distribution].sort((a, b) => {
      const diff = (Number(b.count) || 0) - (Number(a.count) || 0);
      if (diff !== 0) return diff;
      return String(a.fullName || "").localeCompare(String(b.fullName || ""));
    });

    if (!keyword) return rows;

    return rows.filter((row) =>
      [row.fullName, row.userId, ...(row.serials || [])]
        .map(normalizeText)
        .some((x) => x.includes(keyword))
    );
  }, [distribution, serialQuery]);

  const selectedEmployeeNames = useMemo(() => {
    const idSet = new Set(selectedEmployeeIds);
    return employees
      .filter((emp: any) => idSet.has(getEmployeeId(emp)))
      .map((emp: any) => emp.fullName || emp.email || getEmployeeId(emp));
  }, [employees, selectedEmployeeIds]);

  const copyDistribution = async () => {
    if (!distribution.length) return;

    try {
      const lines = distribution.map(
        (row) => `${row.fullName} (${row.userId}): ${(row.serials || []).join(", ")}`
      );
      await navigator.clipboard.writeText(lines.join("\n"));
      setToast({ message: "Đã copy danh sách phân bổ.", type: "success" });
    } catch {
      setToast({ message: "Không copy được trên trình duyệt này.", type: "error" });
    }
  };

  const selectedSet = useMemo(() => new Set(selectedEmployeeIds), [selectedEmployeeIds]);

  return (
    <section className="rb2-shell">
      <div className="rb2-topline">
        <div>
          <span className="rb2-eyebrow">Device Assignment</span>
          <h2>Cân bằng thiết bị</h2>
          <p>
            Chọn team, chọn người tham gia và phân bổ lại thiết bị LogTag theo cách gọn,
            dễ kiểm tra, dễ thao tác.
          </p>
        </div>

        <div className="rb2-top-actions">
          <button
            type="button"
            className="rb2-btn rb2-btn-ghost"
            onClick={fetchDistribution}
            disabled={loadingDist || busyRebalance}
          >
            {loadingDist ? <Loader2 className="rb2-spin" size={16} /> : <RefreshCcw size={16} />}
            Tải lại
          </button>
          <button
            type="button"
            className="rb2-btn rb2-btn-ghost"
            onClick={copyDistribution}
            disabled={!distribution.length}
          >
            <Copy size={16} /> Copy phân bổ
          </button>
        </div>
      </div>

      <div className="rb2-summary-strip">
        <div className="rb2-summary-main">
          <div className="rb2-summary-icon">
            <SquareDashed size={21} />
          </div>
          <div>
            <b>{currentTeam.label}</b>
            <span>{currentTeam.subtitle} • Team ID {currentTeam.id}</span>
          </div>
        </div>

        <div className="rb2-metrics">
          <div>
            <span>Thiết bị</span>
            <b>{totalDevices}</b>
          </div>
          <div>
            <span>Người mapping</span>
            <b>{mappedMembers}</b>
          </div>
          <div>
            <span>Đang chọn</span>
            <b>{selectedMembers}</b>
          </div>
          <div>
            <span>Cân bằng</span>
            <b>{fairnessScore}%</b>
          </div>
        </div>
      </div>

      <div className="rb2-layout">
        <aside className="rb2-panel rb2-control-panel">
          <div className="rb2-panel-head">
            <div>
              <h3>Điều phối</h3>
              <p>Thiết lập team và phạm vi nhân viên.</p>
            </div>
            <span className="rb2-live-pill"><Sparkles size={14} /> Active</span>
          </div>

          <div className="rb2-team-switch" role="tablist" aria-label="Chọn team">
            {TEAMS.map((team) => (
              <button
                key={team.id}
                type="button"
                className={`rb2-team-option ${team.id === teamId ? "is-active" : ""}`}
                onClick={() => setTeamId(team.id)}
                role="tab"
                aria-selected={team.id === teamId}
              >
                <span>{team.label}</span>
                <b>{team.id}</b>
              </button>
            ))}
          </div>

          <label className="rb2-field">
            <span>TeamId</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {TEAMS.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label} — {team.id}
                </option>
              ))}
            </select>
          </label>

          <div className="rb2-guideline">
            <ShieldCheck size={16} />
            <span>
              Không chọn ai thì hệ thống dùng mapping hiện có. Có chọn nhân viên thì chỉ
              nhóm được chọn tham gia chia lại.
            </span>
          </div>

          <div className="rb2-selected-card">
            <div className="rb2-selected-title">
              <Users size={16} /> Người tham gia
            </div>
            {selectedEmployeeNames.length ? (
              <div className="rb2-selected-list">
                {selectedEmployeeNames.slice(0, 7).map((name) => (
                  <span key={name}>{name}</span>
                ))}
                {selectedEmployeeNames.length > 7 && (
                  <span>+{selectedEmployeeNames.length - 7}</span>
                )}
              </div>
            ) : (
              <p>Tự động theo mapping hiện tại của team.</p>
            )}
          </div>

          <div className="rb2-command-grid">
            <button
              type="button"
              className="rb2-btn rb2-btn-primary"
              onClick={callRebalance}
              disabled={busyRebalance}
            >
              {busyRebalance ? <Loader2 className="rb2-spin" size={16} /> : <Shuffle size={16} />}
              Chia đều
            </button>
            <button
              type="button"
              className="rb2-btn rb2-btn-soft"
              onClick={callAssignAndRebalance}
              disabled={busyRebalance}
            >
              {busyRebalance ? <Loader2 className="rb2-spin" size={16} /> : <UserPlus size={16} />}
              Thêm 1 người
            </button>
            <button
              type="button"
              className="rb2-btn rb2-btn-danger"
              onClick={callClearMappings}
              disabled={busyRebalance}
            >
              {busyRebalance ? <Loader2 className="rb2-spin" size={16} /> : <XCircle size={16} />}
              Xóa mapping
            </button>
          </div>
        </aside>

        <section className="rb2-panel rb2-people-panel">
          <div className="rb2-panel-head rb2-panel-head-line">
            <div>
              <h3>Danh sách nhân viên</h3>
              <p>{filteredEmployees.length}/{employees.length} nhân viên khả dụng</p>
            </div>
            <div className="rb2-small-actions">
              <button type="button" onClick={selectVisibleEmployees}>Chọn đang lọc</button>
              <button type="button" onClick={clearSelection}>Bỏ chọn</button>
            </div>
          </div>

          <div className="rb2-search">
            <Search size={16} />
            <input
              value={employeeQuery}
              onChange={(e) => setEmployeeQuery(e.target.value)}
              placeholder="Tìm tên, email, ID nhân viên..."
            />
            {employeeQuery && (
              <button type="button" onClick={() => setEmployeeQuery("")} aria-label="Xóa tìm kiếm">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="rb2-people-list">
            {filteredEmployees.map((emp: any) => {
              const id = getEmployeeId(emp);
              const active = selectedSet.has(id);
              const name = emp.fullName || "Không tên";
              return (
                <button
                  key={id}
                  type="button"
                  className={`rb2-person ${active ? "is-active" : ""}`}
                  onClick={() => toggleEmployee(id)}
                  aria-pressed={active}
                >
                  <span className="rb2-avatar">{getInitials(name)}</span>
                  <span className="rb2-person-info">
                    <b>{name}</b>
                    <small>{emp.email || compactId(id)}</small>
                  </span>
                  <span className="rb2-check">{active && <CheckCircle2 size={18} />}</span>
                </button>
              );
            })}

            {!filteredEmployees.length && (
              <div className="rb2-empty-mini">Không tìm thấy nhân viên phù hợp.</div>
            )}
          </div>
        </section>
      </div>

      <section className="rb2-panel rb2-distribution-panel">
        <div className="rb2-panel-head rb2-panel-head-line">
          <div>
            <h3>Phân bổ hiện tại</h3>
            <p>
              {loadingDist
                ? "Đang tải mapping mới nhất..."
                : `${visibleDistribution.length}/${distribution.length} dòng phân bổ • lệch tối đa ${imbalance}`}
            </p>
          </div>
          <div className="rb2-dist-tools">
            <div className="rb2-search rb2-search-compact">
              <Search size={15} />
              <input
                value={serialQuery}
                onChange={(e) => setSerialQuery(e.target.value)}
                placeholder="Tìm serial / nhân viên"
              />
              {serialQuery && (
                <button type="button" onClick={() => setSerialQuery("")} aria-label="Xóa tìm kiếm serial">
                  <X size={13} />
                </button>
              )}
            </div>
            <span className="rb2-score-pill">TB {avgCount.toFixed(1)} thiết bị/người</span>
          </div>
        </div>

        {loadingDist ? (
          <div className="rb2-skeleton-list">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="rb2-skeleton" key={i} />
            ))}
          </div>
        ) : visibleDistribution.length === 0 ? (
          <div className="rb2-empty-state">
            <Eraser size={25} />
            <h4>Chưa có dữ liệu phân bổ</h4>
            <p>Chọn team hoặc bấm “Tải lại” để đồng bộ mapping mới nhất.</p>
          </div>
        ) : (
          <div className="rb2-dist-table" role="table">
            <div className="rb2-dist-head" role="row">
              <span>Nhân viên</span>
              <span>Số thiết bị</span>
              <span>Serial</span>
            </div>

            {visibleDistribution.map((row) => {
              const count = Number(row.count) || 0;
              const ratio = Math.min(1, count / maxCount);
              const serials = Array.isArray(row.serials) ? row.serials : [];
              const visibleSerials = serials.slice(0, 8);
              const hiddenCount = Math.max(0, serials.length - visibleSerials.length);

              return (
                <article className="rb2-dist-row" key={row.userId} role="row">
                  <div className="rb2-dist-user">
                    <span className="rb2-avatar rb2-avatar-lg">{getInitials(row.fullName)}</span>
                    <div>
                      <b>{row.fullName || "Không tên"}</b>
                      <small title={row.userId}>{compactId(row.userId)}</small>
                    </div>
                  </div>

                  <div className="rb2-meter">
                    <div className="rb2-meter-top">
                      <b>{count}</b>
                      <span>{Math.round(ratio * 100)}%</span>
                    </div>
                    <div className="rb2-meter-track">
                      <span style={{ width: `${ratio * 100}%` }} />
                    </div>
                  </div>

                  <div className="rb2-serials" title={serials.join(", ")}>
                    <span className="rb2-serial-preview">{formatSerialPreview(serials)}</span>
                    <div className="rb2-serial-chip-row">
                      {visibleSerials.map((serial) => (
                        <span key={serial}>{serial}</span>
                      ))}
                      {hiddenCount > 0 && <span className="rb2-more">+{hiddenCount}</span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showConfirm && (
        <div className="rb2-confirm-overlay" role="dialog" aria-modal="true">
          <div className="rb2-confirm-box">
            <div className="rb2-confirm-icon">
              <AlertTriangle size={24} />
            </div>
            <h3>Xóa toàn bộ phân bổ?</h3>
            <p>
              Mapping của <strong>{currentTeam.label}</strong> — ID <strong>{currentTeam.id}</strong> sẽ
              bị xoá. Thao tác này nên dùng khi cần reset lại từ đầu.
            </p>
            <div className="rb2-confirm-actions">
              <button type="button" className="rb2-btn rb2-btn-danger" onClick={doClearMappings}>
                Xác nhận xóa
              </button>
              <button type="button" className="rb2-btn rb2-btn-ghost" onClick={() => setShowConfirm(false)}>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={toast.type === "success" ? 2000 : 3000}
        />
      )}
    </section>
  );
};

export default RebalancePanel;
