import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import '../../styles/Admin/AdminAccountDevices.css';
import '../../styles/Admin/AdminAccountDevices.css';
import Toast from '../../components/Toast';

type MapRow = {
  userId: string;
  teamId: string | number;
  serialNumber: string;
  notes?: string;
  assignedAtUtc?: string;
  deviceName?: string;
  model?: string;
  device?: {
    model?: string;
  } | null;
};

type UserLite = {
  id: string;
  fullName?: string;
  email: string;
};

type DeviceLite = {
  serialNumber: string;
  model?: string;
  assignedToUserId?: string | null;
};

type ComboOption = {
  value: string;
  label?: string;
  meta?: string;
};

type ToastState = {
  message: string;
  type: 'success' | 'error' | 'info';
};

type ConfirmAction = {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
};

function normText(v: unknown) {
  return String(v ?? '').trim();
}

function toNumberId(v: string) {
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getErrorMessage(e: any, fallback: string) {
  const data = e?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  return data?.message || data?.error || data?.detail || e?.message || fallback;
}

function formatDateTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', { hour12: false });
}

function getRowModel(row: MapRow) {
  return row.model || row.device?.model || '';
}

function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  inputMode,
  onEnter,
  onPick,
  emptyText = 'Không có dữ liệu',
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  onEnter?: () => void;
  onPick?: (value: string) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const keyword = dirty ? value.trim().toLowerCase() : '';

  const visibleOptions = useMemo(() => {
    if (!keyword) return options.slice(0, 120);

    return options
      .filter(opt => {
        const haystack = `${opt.value} ${opt.label ?? ''} ${opt.meta ?? ''}`.toLowerCase();
        return haystack.includes(keyword);
      })
      .slice(0, 120);
  }, [keyword, options]);

  const pick = (nextValue: string) => {
    onChange(nextValue);
    onPick?.(nextValue);
    setOpen(false);
    setDirty(false);
  };

  return (
    <div className="aad-combo">
      <input
        value={value}
        onChange={e => {
          setDirty(true);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          // Khi focus lần đầu: xổ toàn bộ option, không lọc theo value hiện tại.
          setDirty(false);
setOpen(true);
        }}
        onClick={() => {
          // Khi input đang có sẵn value, click lại vẫn xổ toàn bộ option.
          // User vẫn có thể gõ để chuyển sang chế độ lọc.
          setDirty(false);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setOpen(false);
            setDirty(false);
            onEnter?.();
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setDirty(false);
          }
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
      />

      {open && (
        <div className="aad-combo-menu">
          {visibleOptions.length === 0 ? (
            <div className="aad-combo-empty">{emptyText}</div>
          ) : (
            visibleOptions.map(opt => (
              <button
                key={`${opt.value}-${opt.meta ?? ''}`}
                type="button"
                className="aad-combo-option"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(opt.value)}
              >
                <span className="aad-combo-main">{opt.label || opt.value}</span>
                {opt.meta && <span className="aad-combo-meta">{opt.meta}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminAccountDevices() {
  const [teamId, setTeamId] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);

  const [rows, setRows] = useState<MapRow[]>([]);
  const [serials, setSerials] = useState<string[]>([]);
  const [teamDevices, setTeamDevices] = useState<DeviceLite[]>([]);
  const [q, setQ] = useState('');

  const [users, setUsers] = useState<UserLite[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');

  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [busyAssign, setBusyAssign] = useState(false);
  const [editingNameKey, setEditingNameKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyNameKey, setBusyNameKey] = useState<string | null>(null);

  const [selectedUsers, setSelectedUsers] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [busyRebalance, setBusyRebalance] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const emailById = useMemo(
    () => Object.fromEntries(users.map(u => [u.id, u.email] as const)),
    [users]
  );

  const nameById = useMemo(
    () => Object.fromEntries(users.map(u => [u.id, u.fullName ?? ''] as const)),
    [users]
  );

  const selectedUser = useMemo(
() => users.find(x => x.email.toLowerCase() === selectedEmail.trim().toLowerCase()),
    [users, selectedEmail]
  );

  const selectedUserCount = useMemo(
    () => Object.values(selectedUsers).filter(Boolean).length,
    [selectedUsers]
  );

  const uniqueAssignedUsers = useMemo(
    () => new Set(rows.map(r => r.userId)).size,
    [rows]
  );

  const teamIdOptions = useMemo<ComboOption[]>(
    () => teamIds.map(tid => ({ value: tid, label: tid, meta: 'Team ID' })),
    [teamIds]
  );

  const deviceOptions = useMemo<ComboOption[]>(() => {
    // Ưu tiên danh sách devices từ /options/{teamId}.
    // Đồng thời merge thêm serial đang có trong mapping để tránh trường hợp
    // Devices collection không trả về vì deviceState/teamId chưa đồng bộ.
    const bySerial = new Map<string, ComboOption>();

    for (const d of teamDevices) {
      const sn = normText(d.serialNumber).toUpperCase();
      if (!sn) continue;
      bySerial.set(sn, {
        value: sn,
        label: sn,
        meta: [d.model, d.assignedToUserId ? 'đã gán' : 'chưa gán']
          .filter(Boolean)
          .join(' • '),
      });
    }

    for (const r of rows) {
      const sn = normText(r.serialNumber).toUpperCase();
      if (!sn || bySerial.has(sn)) continue;
      const model = getRowModel(r);
      bySerial.set(sn, {
        value: sn,
        label: sn,
        meta: [model, 'đang mapping'].filter(Boolean).join(' • '),
      });
    }

    return Array.from(bySerial.values()).sort((a, b) =>
      a.value.localeCompare(b.value)
    );
  }, [teamDevices, rows]);

  const serialOptions = deviceOptions;

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    if (!keyword) return rows;

    return rows.filter(r => {
      const name = nameById[r.userId] || '';
      const email = emailById[r.userId] || '';
      const model = getRowModel(r);
      return (
        name.toLowerCase().includes(keyword) ||
        email.toLowerCase().includes(keyword) ||
        r.serialNumber.toLowerCase().includes(keyword) ||
        model.toLowerCase().includes(keyword) ||
        (r.notes || '').toLowerCase().includes(keyword)
      );
    });
  }, [rows, q, nameById, emailById]);

  const userGroups = useMemo(() => {
    const map = new Map<string, {
      userId: string;
      name: string;
      email: string;
      rows: MapRow[];
      models: string[];
      latestAssignedAt?: string;
    }>();

    for (const r of filtered) {
      const userId = r.userId;
      const name = nameById[userId] || '(no name)';
      const email = emailById[userId] || userId;
      const model = getRowModel(r);

      if (!map.has(userId)) {
        map.set(userId, {
          userId,
          name,
          email,
          rows: [],
          models: [],
          latestAssignedAt: r.assignedAtUtc,
        });
      }

      const g = map.get(userId)!;
      g.rows.push(r);
if (model && !g.models.includes(model)) g.models.push(model);

      const current = g.latestAssignedAt ? new Date(g.latestAssignedAt).getTime() : 0;
      const next = r.assignedAtUtc ? new Date(r.assignedAtUtc).getTime() : 0;
      if (next > current) g.latestAssignedAt = r.assignedAtUtc;
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, nameById, emailById]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setBootLoading(true);
      try {
        const serialsReq = api.get('/api/sensordata/GetDeviceSerials').catch(() => ({ data: [] }));

        const teamIdsReq = api
          .get('/api/admin/account-device/team-ids')
          .catch(() => ({ data: [] }));

        const usersReq = api
          .get('/api/admin/users', { params: { onlyActive: true } })
          .catch(async err => {
            if (err?.response?.status === 404) {
              const all = await api.get('/api/admin/accounts');
              const filteredAccounts = (all.data || []).filter((x: any) =>
                (x.roleName || '').toLowerCase() === 'user' && x.isActive
              );
              return { data: filteredAccounts };
            }
            throw err;
          });

        const [sRes, uRes, tRes] = await Promise.all([serialsReq, usersReq, teamIdsReq]);
        if (!mounted) return;

        const fixedSerials = Array.isArray(sRes.data)
          ? sRes.data.map(String).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b))
          : [];
        setSerials(fixedSerials);

        const us = Array.isArray(uRes.data)
          ? uRes.data
              .map((x: any) => ({
                id: String(x.id ?? x.accountId ?? x._id ?? ''),
                fullName: x.fullName ?? x.name ?? x.userName ?? '',
                email: String(x.email ?? '').trim(),
              }))
              .filter((x: UserLite) => x.id && x.email)
          : [];
        setUsers(us);

        const tids = Array.isArray(tRes.data)
          ? tRes.data
              .map((x: any) => (typeof x === 'string' || typeof x === 'number' ? x : x.teamId))
              .filter((x: any) => x !== undefined && x !== null && String(x).trim() !== '')
              .map(String)
          : [];

        const uniqueTeamIds = Array.from(new Set(tids)).sort((a, b) => Number(a) - Number(b));
        setTeamIds(uniqueTeamIds);

        if (!teamId && uniqueTeamIds.length === 1) {
          setTeamId(uniqueTeamIds[0]);
        }
      } catch (e) {
        if (!mounted) return;
        console.error(e);
        setSerials([]);
        setUsers([]);
        setTeamIds([]);
        setToast({ message: 'Không tải được dữ liệu khởi tạo.', type: 'error' });
      } finally {
        if (mounted) setBootLoading(false);
      }
})();

    return () => {
      mounted = false;
    };
  }, []);

  const loadMaps = async (teamIdOverride?: string) => {
    const tid = toNumberId(teamIdOverride ?? teamId);
    if (!tid) {
      setToast({ message: 'Nhập Team ID hợp lệ để tải danh sách.', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const [mapRes, optRes] = await Promise.all([
        api.get('/api/admin/account-device/by-team', { params: { teamId: tid } }),
        api.get(`/api/admin/account-device/options/${encodeURIComponent(String(tid))}`).catch(() => ({ data: null })),
      ]);

      setRows(Array.isArray(mapRes.data) ? mapRes.data : []);

      const devs = Array.isArray((optRes as any).data?.devices)
        ? (optRes as any).data.devices
            .map((x: any) => ({
              serialNumber: String(x.serialNumber ?? '').trim().toUpperCase(),
              model: x.model ? String(x.model) : '',
              assignedToUserId: x.assignedToUserId ?? null,
            }))
            .filter((x: DeviceLite) => x.serialNumber)
        : [];

      setTeamDevices(devs);
      setSelectedUsers({});
      setExpandedGroups({});
      setToast({ message: 'Đã tải danh sách mapping và thiết bị trong team.', type: 'success' });
    } catch (e) {
      console.error(e);
      setToast({ message: getErrorMessage(e, 'Không tải được danh sách mapping.'), type: 'error' });
      setRows([]);
      setTeamDevices([]);
      setExpandedGroups({});
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    const tid = toNumberId(teamId);
    const sn = serialNumber.trim().toUpperCase();

    if (!tid || !selectedEmail.trim() || !sn) {
      setToast({ message: 'Vui lòng nhập Team ID, chọn Email và Serial.', type: 'error' });
      return;
    }

    if (!selectedUser) {
      setToast({ message: 'Email không hợp lệ hoặc không tồn tại trong hệ thống.', type: 'error' });
      return;
    }

    setBusyAssign(true);
    try {
      await api.post('/api/admin/account-device/assign', {
        userId: selectedUser.id,
        teamId: tid,
        serialNumber: sn,
        notes: notes.trim() || undefined,
      });

      setSerialNumber('');
      setNotes('');
      await loadMaps();
      setToast({ message: 'Đã gán thiết bị cho user.', type: 'success' });
    } catch (e: any) {
      console.error(e);
      setToast({ message: getErrorMessage(e, 'Không thể gán thiết bị.'), type: 'error' });
    } finally {
      setBusyAssign(false);
    }
  };

  const mappingKey = (row: MapRow) =>
    `${row.userId}|${String(row.teamId)}|${row.serialNumber.toUpperCase()}`;

  const beginRename = (row: MapRow) => {
    setEditingNameKey(mappingKey(row));
    setEditingName(String(row.notes || ""));
  };

  const saveDeviceName = async (row: MapRow) => {
    const key = mappingKey(row);
    const nextName = editingName.trim();

    if (nextName.length > 80) {
      setToast({ message: "Tên thiết bị tối đa 80 ký tự.", type: "error" });
      return;
    }

    setBusyNameKey(key);
    try {
      await api.put("/api/device-names/admin", {
        userId: row.userId,
        teamId: Number(row.teamId),
        serialNumber: row.serialNumber,
        name: nextName || null,
      });

      setRows(prev =>
        prev.map(item =>
          mappingKey(item) === key
            ? { ...item, notes: nextName || undefined }
            : item
        )
      );

      setEditingNameKey(null);
      setEditingName("");
      setToast({
        message: nextName
          ? `Đã đặt tên “${nextName}” cho ${row.serialNumber}.`
          : `Đã xóa tên của ${row.serialNumber}.`,
        type: "success",
      });
    } catch (e) {
      console.error(e);
      setToast({
        message: getErrorMessage(e, "Không thể cập nhật tên thiết bị."),
        type: "error",
      });
    } finally {
      setBusyNameKey(null);
    }
  };

  const handleRemove = (uid: string, sn: string) => {
    setConfirmAction({
      title: 'Xóa mapping thiết bị?',
      message: `User: ${emailById[uid] ?? uid}\nSerial: ${sn}`,
      confirmText: 'Xóa mapping',
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete('/api/admin/account-device/remove', {
            data: { userId: uid, serialNumber: sn },
});
          await loadMaps();
          setToast({ message: 'Đã xoá mapping.', type: 'success' });
        } catch (e) {
          console.error(e);
          setToast({ message: getErrorMessage(e, 'Không thể xoá mapping.'), type: 'error' });
        }
      },
    });
  };

  const handleToggleUserSelect = (uid: string, checked: boolean) => {
    setSelectedUsers(prev => ({ ...prev, [uid]: checked }));
  };

  const handleRebalance = () => {
    const tid = toNumberId(teamId);
    if (!tid) {
      setToast({ message: 'Nhập Team ID hợp lệ trước khi rebalance.', type: 'error' });
      return;
    }

    const participants = Object.entries(selectedUsers)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (!participants.length) {
      setConfirmAction({
        title: 'Rebalance toàn team?',
        message: 'Bạn chưa chọn user nào. Hệ thống sẽ rebalance toàn bộ user trong team hiện tại.',
        confirmText: 'Rebalance toàn team',
        danger: true,
        onConfirm: async () => doRebalance([]),
      });
      return;
    }

    setConfirmAction({
      title: 'Rebalance user đã chọn?',
      message: `Bạn đang chọn ${participants.length} user để rebalance trong Team ID ${tid}.`,
      confirmText: 'Rebalance',
      danger: true,
      onConfirm: async () => doRebalance(participants),
    });
  };

  const doRebalance = async (participants: string[]) => {
    const tid = toNumberId(teamId);
    if (!tid) return;

    setBusyRebalance(true);
    try {
      await api.post(`/api/admin/account-device/rebalance/${encodeURIComponent(String(tid))}`, {
        userIds: participants.length ? participants : undefined,
      });
      await loadMaps();
      setToast({ message: 'Đã rebalance phân bổ thiết bị.', type: 'success' });
    } catch (e) {
      console.error(e);
      setToast({ message: getErrorMessage(e, 'Không thể rebalance.'), type: 'error' });
    } finally {
      setBusyRebalance(false);
    }
  };

  const clearFilters = () => {
    setQ('');
    setSelectedUsers({});
    setExpandedGroups({});
  };

  const handleTeamIdChange = (value: string) => {
    const nextTeamId = value.replace(/[^0-9]/g, '');
    setTeamId(nextTeamId);
    setQ('');
    setRows([]);
    setTeamDevices([]);
    setSelectedUsers({});
    setExpandedGroups({});
  };

  return (
    <div className="aad-page">
      <div className="aad-hero">
        <div>
          <div className="aad-eyebrow">Admin Console</div>
          <h1>Gán thiết bị LogTag cho tài khoản</h1>
          <p>Quản lý Team ID, phân bổ serial cho user và kiểm tra mapping hiện tại.</p>
        </div>

        <div className="aad-hero-actions">
          <button className="aad-btn aad-btn-light" onClick={clearFilters} type="button">
            Làm mới bộ lọc
          </button>
<button className="aad-btn aad-btn-primary" onClick={() => loadMaps()} disabled={loading || !teamId.trim()} type="button">
            {loading ? 'Đang tải...' : 'Tải danh sách'}
          </button>
        </div>
      </div>

      <div className="aad-stats">
        <div className="aad-stat-card">
          <span>Team ID</span>
          <b>{teamId || '—'}</b>
        </div>
        <div className="aad-stat-card">
          <span>Mapping</span>
          <b>{rows.length}</b>
        </div>
        <div className="aad-stat-card">
          <span>User đã gán</span>
          <b>{uniqueAssignedUsers}</b>
        </div>
        <div className="aad-stat-card">
          <span>Serial trong team</span>
          <b>{deviceOptions.length}</b>
        </div>
      </div>

      <div className="aad-layout">
        <section className="aad-panel aad-panel-main">
          <div className="aad-panel-head">
            <div>
              <h2>Bộ lọc Team</h2>
              <p>Chọn Team ID có sẵn hoặc nhập Team ID mới.</p>
            </div>
            {bootLoading && <span className="aad-pill">Đang tải dữ liệu...</span>}
          </div>

          <div className="aad-control-grid">
            <div className="aad-field aad-field-wide">
              <label>Team ID</label>
              <div className="aad-input-action">
                <ComboInput
                  value={teamId}
                  onChange={handleTeamIdChange}
                  options={teamIdOptions}
                  placeholder="Click để chọn Team ID hoặc nhập tay"
                  inputMode="numeric"
                  onEnter={() => loadMaps()}
                  emptyText="Chưa có Team ID khớp, bạn vẫn nhập tay được."
                />
                <button className="aad-btn aad-btn-primary" onClick={() => loadMaps()} disabled={loading} type="button">
                  {loading ? 'Đang tải...' : 'Tải'}
                </button>
              </div>

              <div className="aad-help">
                {teamIds.length
                  ? `Click vào ô để xổ ${teamIds.length} Team ID đang có, hoặc nhập tay nếu cần.`
                  : 'Chưa có Team ID trong danh sách, bạn vẫn có thể nhập tay.'}
              </div>
            </div>

            <div className="aad-field">
              <label>Tìm nhanh thiết bị</label>
              <ComboInput
                value={q}
                onChange={setQ}
                options={deviceOptions}
                placeholder={teamId ? 'Click để chọn thiết bị trong team hoặc nhập mã' : 'Chọn Team ID rồi bấm Tải trước'}
                emptyText={teamId ? 'Không có thiết bị khớp trong team này.' : 'Chưa chọn Team ID.'}
              />
              <div className="aad-help">
                {deviceOptions.length
                  ? `Click để xổ ${deviceOptions.length} thiết bị trong team hiện tại.`
                  : teamId
? 'Chưa tải danh sách thiết bị trong team. Bấm Tải trước.'
                    : `Đang có ${serials.length} serial trong hệ thống.`}
              </div>
            </div>
          </div>
        </section>

        <section className="aad-panel aad-panel-side">
          <div className="aad-panel-head compact">
            <div>
              <h2>Gán nhanh</h2>
              <p>Chọn user và serial để gán vào team.</p>
            </div>
          </div>

          <div className="aad-form-stack">
            <div className="aad-field">
              <label>User email</label>
              <select title="Chọn email" value={selectedEmail} onChange={e => setSelectedEmail(e.target.value)}>
                <option value="">-- chọn email --</option>
                {users.map(u => (
                  <option key={u.id} value={u.email}>
                    {(u.fullName ? `${u.fullName} — ` : '') + u.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="aad-field">
              <label>Serial</label>
              <ComboInput
                value={serialNumber}
                onChange={v => setSerialNumber(v.toUpperCase())}
                options={serialOptions}
                placeholder={teamId ? 'Click để chọn serial trong team hoặc nhập tay' : 'Chọn Team ID rồi bấm Tải trước'}
                emptyText={teamId ? 'Không có serial khớp trong team này.' : 'Chưa chọn Team ID.'}
              />
            </div>

            <div className="aad-field">
              <label>Tên thiết bị / Ghi chú</label>
              <input value={notes} maxLength={80} onChange={e => setNotes(e.target.value)} placeholder="Ví dụ: Tủ vaccine A, Kho lạnh số 2..." />
            </div>

            <button className="aad-btn aad-btn-primary aad-btn-full" onClick={handleAssign} disabled={busyAssign} type="button">
              {busyAssign ? 'Đang gán...' : 'Gán thiết bị cho user'}
            </button>
          </div>
        </section>
      </div>

      <section className="aad-panel">
        <div className="aad-table-head">
          <div>
            <h2>Mapping hiện tại</h2>
            <p>
              {teamId ? <>Team <b>{teamId}</b></> : 'Chưa chọn Team ID'}
              {' '}• Hiển thị {filtered.length}/{rows.length} dòng
            </p>
          </div>

          <div className="aad-table-actions">
            <span className="aad-pill">Đã chọn {selectedUserCount} user</span>
            <button className="aad-btn aad-btn-light" onClick={() => setSelectedUsers({})} type="button">
              Bỏ chọn
            </button>
            <button className="aad-btn aad-btn-danger" onClick={handleRebalance} disabled={busyRebalance || !teamId} type="button">
              {busyRebalance ? 'Đang rebalance...' : 'Rebalance phân bổ'}
            </button>
          </div>
        </div>

        <div className="aad-smart-wrap">
          {filtered.length === 0 ? (
<div className="aad-empty-card">
              <div className="aad-empty-icon">⌕</div>
              <div>
                <b>Không có mapping nào</b>
                <p>Chọn Team ID và bấm “Tải danh sách”, hoặc đổi từ khóa tìm kiếm.</p>
              </div>
            </div>
          ) : (
            <div className="aad-user-grid">
              {userGroups.map(g => {
                const checked = !!selectedUsers[g.userId];
                const expanded = !!expandedGroups[g.userId];
                const visibleRows = expanded ? g.rows : g.rows.slice(0, 8);
                const hiddenCount = Math.max(0, g.rows.length - visibleRows.length);
                const initial = g.name.trim().charAt(0).toUpperCase() || 'U';

                return (
                  <article
                    key={g.userId}
                    className={"aad-user-card" + (checked ? " is-selected" : "")}
                  >
                    <div className="aad-user-card-top">
                      <label className="aad-select-user">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => handleToggleUserSelect(g.userId, e.target.checked)}
                          title="Chọn user này để rebalance"
                        />
                      </label>

                      <div className="aad-avatar aad-avatar-lg">{initial}</div>

                      <div className="aad-user-card-main">
                        <div className="aad-user-card-name">{g.name}</div>
                        <div className="aad-mono aad-muted">{g.email}</div>
                      </div>

                      <div className="aad-device-count">
                        <b>{g.rows.length}</b>
                        <span>thiết bị</span>
                      </div>
                    </div>

                    <div className="aad-card-meta-row">
                      <span className="aad-mini-pill">{g.models.length ? g.models.join(', ') : 'Không rõ model'}</span>
                      <span className="aad-mini-pill">Gán gần nhất: {formatDateTime(g.latestAssignedAt)}</span>
                    </div>

                    <div className="aad-device-chip-grid">
                      {visibleRows.map((r, i) => {
                        const model = getRowModel(r);
                        return (
                          <div key={`${r.userId}-${r.serialNumber}-${i}`} className="aad-device-chip aad-device-chip--named">
                            <div className="aad-device-chip-text">
                              <span className="aad-serial compact">{r.serialNumber}</span>
                              <small>
                                {model || '—'}
                                {r.notes ? ` • Tên: ${r.notes}` : ' • Chưa đặt tên'}
                              </small>
                            </div>

                            <div className="aad-chip-actions">
                              <button
                                className="aad-chip-rename"
                                onClick={() => beginRename(r)}
                                title="Đặt hoặc đổi tên thiết bị"
                                type="button"
                              >
                                ✎
                              </button>
                              <button
                                className="aad-chip-remove"
                                onClick={() => handleRemove(r.userId, r.serialNumber)}
                                title="Xóa mapping này"
                                type="button"
                              >
                                ×
                              </button>
                            </div>

                            {editingNameKey === mappingKey(r) && (
                              <div className="aad-device-name-editor">
                                <input
                                  autoFocus
                                  value={editingName}
                                  maxLength={80}
                                  onChange={e => setEditingName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void saveDeviceName(r);
                                    }
                                    if (e.key === 'Escape') {
                                      setEditingNameKey(null);
                                      setEditingName('');
                                    }
                                  }}
                                  placeholder="Tên tủ / vị trí thiết bị"
                                />
                                <button
                                  type="button"
                                  className="aad-name-save"
                                  disabled={busyNameKey === mappingKey(r)}
                                  onClick={() => void saveDeviceName(r)}
                                >
                                  {busyNameKey === mappingKey(r) ? '...' : 'Lưu'}
                                </button>
                                <button
                                  type="button"
                                  className="aad-name-cancel"
                                  onClick={() => {
                                    setEditingNameKey(null);
                                    setEditingName('');
                                  }}
                                >
                                  Hủy
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {g.rows.length > 8 && (
                      <button
                        className="aad-show-more"
                        onClick={() =>
                          setExpandedGroups(prev => ({
                            ...prev,
                            [g.userId]: !expanded,
                          }))
                        }
                        type="button"
                      >
                        {expanded ? 'Thu gọn danh sách' : `Xem thêm ${hiddenCount} thiết bị`}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {confirmAction && (
        <div className="aad-confirm-overlay" role="dialog" aria-modal="true">
          <div className="aad-confirm-box">
            <div className="aad-confirm-icon">!</div>
            <h3>{confirmAction.title}</h3>
            <p>{confirmAction.message}</p>
            <div className="aad-confirm-actions">
              <button
                className={confirmAction.danger ? 'aad-btn aad-btn-danger' : 'aad-btn aad-btn-primary'}
                onClick={async () => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  await action.onConfirm();
                }}
                type="button"
              >
                {confirmAction.confirmText || 'Xác nhận'}
              </button>
              <button className="aad-btn aad-btn-light" onClick={() => setConfirmAction(null)} type="button">
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
          durationMs={toast.type === 'success' ? 2000 : 3500}
        />
      )}
    </div>
  );
}