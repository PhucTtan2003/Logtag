import React, { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import {
  AlertCircle,
  CheckCircle2,
  Hash,
  Loader2,
  LockKeyhole,
  PlusCircle,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import "../styles/Admin/RegisterDevicePanel.css";

type Props = {
  onSuccess?: () => Promise<void> | void;
  onClose?: () => void;
};

type MessageState = {
  kind: "ok" | "err" | "info";
  text: string;
};

const normalizeSerial = (s: string) => {
  const up = (s || "").trim().toUpperCase().replace(/\s+/g, "");
  if (up.endsWith("-CH1") || up.endsWith("-CH2")) return up.slice(0, -4);
  return up;
};

const serialLooksValid = (serial: string) => /^[A-Z0-9-]{8,}$/i.test(serial);

const RegisterDevicePanel: React.FC<Props> = ({ onSuccess, onClose }) => {
  const envTeam = process.env.REACT_APP_LOGTAG_TEAMID ?? "";

  const [teamId, setTeamId] = useState<string>(String(envTeam || ""));
  const [serialReg, setSerialReg] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<MessageState | null>(null);

  const isTeamLocked = !!envTeam;

  const teamIdNum = useMemo(() => {
    const n = Number(teamId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [teamId]);

  const serialClean = useMemo(() => normalizeSerial(serialReg), [serialReg]);
  const serialValid = useMemo(() => serialLooksValid(serialClean), [serialClean]);

  const canSubmit = !busy && !!teamIdNum && serialValid;

  const helperText = useMemo(() => {
    if (!serialReg.trim()) return "Nhập serial trên thân thiết bị hoặc từ LogTag Online.";
    if (!serialValid) return "Serial cần tối thiểu 8 ký tự, chỉ nên gồm chữ, số hoặc dấu gạch ngang.";
    if (serialClean !== serialReg.trim().toUpperCase()) return `Hệ thống sẽ chuẩn hóa thành ${serialClean}.`;
    return "Serial hợp lệ, có thể đăng ký.";
  }, [serialReg, serialValid, serialClean]);

  const handleReset = () => {
    if (busy) return;
    setSerialReg("");
    setDesc("");
    setMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setMsg({
        kind: "err",
        text: !teamIdNum
          ? "Vui lòng nhập TeamId hợp lệ."
          : "Vui lòng kiểm tra lại SerialNumber trước khi đăng ký.",
      });
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const payload = {
        teamId: teamIdNum!,
        serialNumber: serialClean,
        deviceDescription: desc.trim() || undefined,
      };

      const res = await api.post("/api/logtag/register-device", payload);
      const savedSerial = res?.data?.result?.serialNumber || serialClean;

      setMsg({
        kind: "ok",
        text: `Đăng ký thành công thiết bị ${savedSerial}.`,
      });

      setSerialReg("");
      setDesc("");
      await onSuccess?.();
    } catch (err: any) {
      setMsg({
        kind: "err",
        text: err?.response?.data?.message || err?.message || "Có lỗi xảy ra khi đăng ký thiết bị.",
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="rdx" role="dialog" aria-label="Đăng ký thiết bị LogTag">
      <div className="rdx-card">
        <button
          type="button"
          className="rdx-close"
          aria-label="Đóng"
          onClick={() => onClose?.()}
        >
          <X size={21} />
        </button>

        <div className="rdx-hero">
          <div className="rdx-hero-icon">
            <PlusCircle size={24} />
          </div>

          <div className="rdx-hero-copy">
            <span className="rdx-kicker">
              <Sparkles size={14} /> Device onboarding
            </span>
            <h2>Đăng ký thiết bị LogTag</h2>
            <p>
              Thêm thiết bị vào team LogTag Online, chuẩn hóa serial tự động và đồng bộ lại danh sách sau khi đăng ký.
            </p>
          </div>
        </div>

        <form className="rdx-form" onSubmit={handleSubmit} noValidate>
          <div className="rdx-layout">
            <section className="rdx-panel rdx-panel-main">
              <div className="rdx-panel-head">
                <div className="rdx-panel-mark">
                  <ShieldCheck size={19} />
                </div>
                <div>
                  <h3>Thông tin thiết bị</h3>
                  <p>Nhập serial gốc, hệ thống sẽ bỏ hậu tố kênh như -CH1/-CH2 nếu có.</p>
                </div>
              </div>

              <div className="rdx-grid-2">
                <label className="rdx-field">
                  <span>SerialNumber</span>
                  <div className="rdx-input-wrap">
                    <Hash size={17} />
                    <input
                      placeholder="VD: A0D8065324CT"
                      value={serialReg}
                      onChange={(e) => setSerialReg(e.target.value)}
                      spellCheck={false}
                      autoCapitalize="characters"
                      autoComplete="off"
                      disabled={busy}
                    />
                  </div>
                  <small className={serialReg.trim() && !serialValid ? "is-danger" : ""}>
                    {helperText}
                  </small>
                </label>

                <label className="rdx-field">
                  <span>Mô tả thiết bị</span>
                  <div className="rdx-input-wrap">
                    <ServerCog size={17} />
                    <input
                      placeholder="VD: Kho lạnh A, khu B..."
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <small>Không bắt buộc, nhưng nên nhập để dễ nhận diện thiết bị.</small>
                </label>
              </div>

              {msg && (
                <div className={`rdx-message rdx-message-${msg.kind}`} role="status" aria-live="polite">
                  {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span>{msg.text}</span>
                </div>
              )}

              <div className="rdx-actions">
                <button
                  type="button"
                  className="rdx-btn rdx-btn-soft"
                  onClick={handleReset}
                  disabled={busy || (!serialReg && !desc && !msg)}
                >
                  <RotateCcw size={16} /> Đặt lại
                </button>

                <button type="submit" className="rdx-btn rdx-btn-primary" disabled={!canSubmit}>
                  {busy ? (
                    <>
                      <Loader2 className="rdx-spin" size={17} /> Đang đăng ký…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={17} /> Đăng ký thiết bị
                    </>
                  )}
                </button>
              </div>
            </section>

            <aside className="rdx-panel rdx-side">
              <div className="rdx-team-card">
                <div className="rdx-team-icon">
                  {isTeamLocked ? <LockKeyhole size={21} /> : <ServerCog size={21} />}
                </div>

                <div className="rdx-team-copy">
                  <span>TeamId</span>
                  <label className="rdx-team-input" aria-label="TeamId">
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="16922"
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value.replace(/[^\d]/g, ""))}
                      disabled={isTeamLocked || busy}
                      title={
                        isTeamLocked
                          ? `TeamId được cố định từ env: ${teamId}`
                          : "Nhập TeamId"
                      }
                    />
                  </label>
                  <small>
                    {isTeamLocked
                      ? "TeamId đang được khóa bằng biến môi trường."
                      : "Admin có thể nhập TeamId cần đăng ký."}
                  </small>
                </div>
              </div>

              <div className="rdx-preview">
                <span>Preview payload</span>
                <div className="rdx-preview-row">
                  <small>Team</small>
                  <b>{teamIdNum ?? "—"}</b>
                </div>
                <div className="rdx-preview-row">
                  <small>Serial</small>
                  <b>{serialClean || "—"}</b>
                </div>
                <div className="rdx-preview-row">
                  <small>Mô tả</small>
                  <b>{desc.trim() || "Không có"}</b>
                </div>
              </div>
            </aside>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegisterDevicePanel;