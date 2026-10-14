import * as signalR from "@microsoft/signalr";

/**
 * Singleton SignalR connection.
 *
 * Luồng:
 *
 * LogTag Webhook
 *      ↓
 * ASP.NET Core Backend
 *      ↓
 * LogTagHub
 *      ↓
 * Group: serial:{SERIAL}
 *      ↓
 * ReadingUpdate
 *      ↓
 * React User UI
 *
 * Lưu ý:
 * - FE KHÔNG nhận webhook trực tiếp.
 * - FE chỉ nhận dữ liệu realtime thông qua SignalR.
 * - Backend đã tự join các serial được phép trong OnConnectedAsync().
 * - Không cần FE tự invoke JoinSerial() cho luồng bình thường.
 *
 * Ưu điểm:
 * - Tránh tạo nhiều connection khi React StrictMode render 2 lần.
 * - Tự reset connection nếu hubUrl/options thay đổi.
 * - Mặc định dùng negotiation + WebSockets + LongPolling fallback.
 * - Phù hợp cả local IIS Express và VPS/nginx.
 */

let _conn: signalR.HubConnection | null = null;
let _connKey: string | null = null;
let _starting: Promise<void> | null = null;

/* =========================================================
 * Event names
 * ========================================================= */

export const LOGTAG_HUB_EVENTS = {
  ReadingUpdate: "ReadingUpdate",
  ReceiveStatusUpdate: "ReceiveStatusUpdate",
  ReceiveAlert: "ReceiveAlert",
  ReceiveAdminEvent: "ReceiveAdminEvent",
} as const;

/* =========================================================
 * Types
 * ========================================================= */

/**
 * Payload Backend đang gửi cho ReadingUpdate.
 *
 * Backend hiện tại gửi:
 * {
 *   SerialNumber,
 *   DateUtc,
 *   Temperature,
 *   Humidity
 * }
 */
export type LogTagReadingPayload = {
  SerialNumber?: string | null;
  DateUtc?: string | null;
  Temperature?: number | null;
  Humidity?: number | null;

  // Cho phép Backend bổ sung field mới mà không phá FE.
  [key: string]: unknown;
};

export type HubEventHandler<T = unknown> = (payload: T) => void;

export type LogTagHubEventHandlers = {
  onReadingUpdate?: HubEventHandler<LogTagReadingPayload>;
  onStatusUpdate?: HubEventHandler<unknown>;
  onAlert?: HubEventHandler<unknown>;
  onAdminEvent?: HubEventHandler<unknown>;
};

/**
 * Ép LongPolling nếu WebSocket local bị lỗi.
 */
export type HubOptions = {
  forceLongPolling?: boolean;

  /**
   * Ép WebSocket only.
   *
   * Chỉ dùng khi server/proxy chắc chắn hỗ trợ WebSocket.
   */
  forceWebSockets?: boolean;
};

/* =========================================================
 * Helpers
 * ========================================================= */

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function cleanHubUrl(hubUrl: string): string {
  return hubUrl.trim().replace(/\/+$/, "");
}

function buildConnectionKey(
  hubUrl: string,
  opts?: HubOptions
): string {
  return JSON.stringify({
    hubUrl: cleanHubUrl(hubUrl),
    forceLongPolling: !!opts?.forceLongPolling,
    forceWebSockets: !!opts?.forceWebSockets,
  });
}

/* =========================================================
 * Reset connection
 * ========================================================= */

/**
 * Dừng và xóa singleton connection.
 *
 * Dùng khi:
 * - logout
 * - đổi account
 * - đổi hub URL
 * - đổi transport options
 */
export async function resetLogTagConnection(): Promise<void> {
  const conn = _conn;

  _conn = null;
  _connKey = null;
  _starting = null;

  if (conn) {
    try {
      await conn.stop();
    } catch {
      // ignore
    }
  }
}

/* =========================================================
 * Get / create connection
 * ========================================================= */

/**
 * Khởi tạo hoặc lấy Singleton SignalR connection.
 */
export function getLogTagConnection(
  hubUrl: string,
  accessToken?: () => string | null,
  opts?: HubOptions
): signalR.HubConnection {
  const cleanUrl = cleanHubUrl(hubUrl);
  const nextKey = buildConnectionKey(cleanUrl, opts);

  /**
   * Nếu cùng URL/options:
   * dùng lại connection hiện tại.
   */
  if (_conn && _connKey === nextKey) {
    return _conn;
  }

  /**
   * Nếu URL/options thay đổi:
   * bỏ connection cũ.
   */
  if (_conn && _connKey !== nextKey) {
    const oldConn = _conn;

    _conn = null;
    _starting = null;
    _connKey = null;

    try {
      oldConn.stop().catch(() => {});
    } catch {
      // ignore
    }
  }

  /* =======================================================
   * Transport
   * ======================================================= */

  let transport: signalR.HttpTransportType;

  if (opts?.forceLongPolling) {
    transport = signalR.HttpTransportType.LongPolling;
  } else if (opts?.forceWebSockets) {
    transport = signalR.HttpTransportType.WebSockets;
  } else {
    /**
     * Mặc định:
     *
     * WebSockets
     *      ↓ nếu không được
     * LongPolling
     */
    transport =
      signalR.HttpTransportType.WebSockets |
      signalR.HttpTransportType.LongPolling;
  }

  /* =======================================================
   * HTTP connection options
   * ======================================================= */

  const httpOptions: signalR.IHttpConnectionOptions = {
    /**
     * Backend hiện tại dùng cookie/CORS nên giữ credentials.
     */
    withCredentials: true,

    transport,

    ...(accessToken
      ? {
          accessTokenFactory: () => accessToken() ?? "",
        }
      : {}),

    /**
     * Chỉ skip negotiation khi ép WebSocket only.
     */
    ...(opts?.forceWebSockets
      ? {
          skipNegotiation: true,
        }
      : {}),
  };

  /* =======================================================
   * Build connection
   * ======================================================= */

  _conn = new signalR.HubConnectionBuilder()
    .withUrl(cleanUrl, httpOptions)
    .withAutomaticReconnect([
      0,
      2000,
      5000,
      10000,
      30000,
    ])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  /**
   * Keep alive:
   *
   * Server ping khoảng 15s.
   * Client timeout 60s.
   */
  _conn.keepAliveIntervalInMilliseconds = 15000;
  _conn.serverTimeoutInMilliseconds = 60000;

  /* =======================================================
   * Connection lifecycle logs
   * ======================================================= */

  _conn.onclose((err) => {
    if (err) {
      console.warn(
        "[hub] ❌ closed with error:",
        err
      );
    } else {
      console.log("[hub] ⏹ closed");
    }
  });

  _conn.onreconnecting((err) => {
    if (err) {
      console.warn(
        "[hub] 🔄 reconnecting:",
        err
      );
    } else {
      console.warn(
        "[hub] 🔄 reconnecting..."
      );
    }
  });

  _conn.onreconnected((connectionId) => {
    console.log(
      "[hub] ✅ reconnected:",
      connectionId
    );

    /**
     * Không tự gọi JoinSerial().
     *
     * Backend là nơi quản lý quyền/group.
     *
     * Nếu sau này Backend yêu cầu refresh group
     * sau reconnect thì có thể gọi:
     *
     * refreshLogTagGroups(_conn!)
     *
     * sau khi RefreshGroups backend được làm idempotent.
     */
  });

  _connKey = nextKey;

  return _conn;
}

/* =========================================================
 * Ensure started
 * ========================================================= */

/**
 * Đảm bảo connection đã Connected.
 *
 * Có retry để tránh lỗi tạm thời khi:
 * - mạng chậm
 * - nginx chưa sẵn sàng
 * - IIS Express đang restart
 * - VPS network chập chờn
 */
export async function ensureStarted(
  conn: signalR.HubConnection,
  timeoutMs: number = 15000,
  maxRetries: number = 2
): Promise<void> {
  if (
    conn.state === signalR.HubConnectionState.Connected
  ) {
    return;
  }

  /**
   * Nếu connection này đang được start,
   * dùng lại promise hiện tại.
   */
  if (_starting) {
    return _starting;
  }

  const startOnce = async (): Promise<void> => {
    /**
     * Nếu đang Connecting/Reconnecting,
     * chờ một chút trước khi kiểm tra lại.
     */
    if (
      conn.state === signalR.HubConnectionState.Connecting ||
      conn.state === signalR.HubConnectionState.Reconnecting
    ) {
      await sleep(300);
    }

    if (
      conn.state === signalR.HubConnectionState.Connected
    ) {
      return;
    }

    /**
     * Nếu đang ở trạng thái khác Disconnected,
     * stop trước rồi start lại.
     */
    if (
      conn.state !==
      signalR.HubConnectionState.Disconnected
    ) {
      try {
        await conn.stop();
      } catch {
        // ignore
      }

      await sleep(300);
    }

    const startPromise = conn.start();

    let timeoutHandle:
      | ReturnType<typeof setTimeout>
      | undefined;

    try {
      await Promise.race([
        startPromise,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `hub start timeout after ${timeoutMs}ms`
              )
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  _starting = (async () => {
    try {
      let attempt = 0;

      while (true) {
        try {
          await startOnce();

          console.log(
            "[hub] ✅ connected"
          );

          return;
        } catch (err) {
          attempt++;

          console.warn(
            `[hub] ⚠️ start failed (attempt ${attempt}/${maxRetries + 1})`,
            err
          );

          if (attempt > maxRetries) {
            throw err;
          }

          const delay = Math.min(
            2000 * attempt,
            5000
          );

          await sleep(delay);
        }
      }
    } finally {
      _starting = null;
    }
  })();

  return _starting;
}

/* =========================================================
 * ReadingUpdate
 * ========================================================= */

/**
 * Đăng ký nhận ReadingUpdate.
 *
 * Backend:
 *
 * Webhook
 *   ↓
 * Backend
 *   ↓
 * LogTagHub
 *   ↓
 * serial:{serial}
 *   ↓
 * ReadingUpdate
 *   ↓
 * handler này
 */
export function onReadingUpdate(
  conn: signalR.HubConnection,
  handler: HubEventHandler<LogTagReadingPayload>
): () => void {
  const wrappedHandler = (
    payload: LogTagReadingPayload
  ) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(
        "[hub] ReadingUpdate handler error:",
        err
      );
    }
  };

  conn.on(
    LOGTAG_HUB_EVENTS.ReadingUpdate,
    wrappedHandler
  );

  /**
   * Trả về unsubscribe.
   */
  return () => {
    conn.off(
      LOGTAG_HUB_EVENTS.ReadingUpdate,
      wrappedHandler
    );
  };
}

/* =========================================================
 * StatusUpdate
 * ========================================================= */

export function onStatusUpdate(
  conn: signalR.HubConnection,
  handler: HubEventHandler<unknown>
): () => void {
  const wrappedHandler = (payload: unknown) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(
        "[hub] ReceiveStatusUpdate handler error:",
        err
      );
    }
  };

  conn.on(
    LOGTAG_HUB_EVENTS.ReceiveStatusUpdate,
    wrappedHandler
  );

  return () => {
    conn.off(
      LOGTAG_HUB_EVENTS.ReceiveStatusUpdate,
      wrappedHandler
    );
  };
}

/* =========================================================
 * Alert
 * ========================================================= */

export function onAlert(
  conn: signalR.HubConnection,
  handler: HubEventHandler<unknown>
): () => void {
  const wrappedHandler = (payload: unknown) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(
        "[hub] ReceiveAlert handler error:",
        err
      );
    }
  };

  conn.on(
    LOGTAG_HUB_EVENTS.ReceiveAlert,
    wrappedHandler
  );

  return () => {
    conn.off(
      LOGTAG_HUB_EVENTS.ReceiveAlert,
      wrappedHandler
    );
  };
}

/* =========================================================
 * Admin event
 * ========================================================= */

export function onAdminEvent(
  conn: signalR.HubConnection,
  handler: HubEventHandler<unknown>
): () => void {
  const wrappedHandler = (payload: unknown) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(
        "[hub] ReceiveAdminEvent handler error:",
        err
      );
    }
  };

  conn.on(
    LOGTAG_HUB_EVENTS.ReceiveAdminEvent,
    wrappedHandler
  );

  return () => {
    conn.off(
      LOGTAG_HUB_EVENTS.ReceiveAdminEvent,
      wrappedHandler
    );
  };
}

/* =========================================================
 * Subscribe all LogTag events
 * ========================================================= */

/**
 * Tiện ích để đăng ký tất cả event một lần.
 *
 * Ví dụ:
 *
 * const unsubscribe = subscribeLogTagEvents(conn, {
 *   onReadingUpdate: (data) => {
 *     console.log("Reading:", data);
 *   },
 *
 *   onStatusUpdate: (data) => {
 *     console.log("Status:", data);
 *   },
 *
 *   onAlert: (data) => {
 *     console.log("Alert:", data);
 *   }
 * });
 *
 * return () => unsubscribe();
 */
export function subscribeLogTagEvents(
  conn: signalR.HubConnection,
  handlers: LogTagHubEventHandlers
): () => void {
  const unsubscribeReading =
    handlers.onReadingUpdate
      ? onReadingUpdate(
          conn,
          handlers.onReadingUpdate
        )
      : () => {};

  const unsubscribeStatus =
    handlers.onStatusUpdate
      ? onStatusUpdate(
          conn,
          handlers.onStatusUpdate
        )
      : () => {};

  const unsubscribeAlert =
    handlers.onAlert
      ? onAlert(
          conn,
          handlers.onAlert
        )
      : () => {};

  const unsubscribeAdmin =
    handlers.onAdminEvent
      ? onAdminEvent(
          conn,
          handlers.onAdminEvent
        )
      : () => {};

  /**
   * Cleanup toàn bộ listener.
   */
  return () => {
    unsubscribeReading();
    unsubscribeStatus();
    unsubscribeAlert();
    unsubscribeAdmin();
  };
}

/* =========================================================
 * Refresh groups
 * ========================================================= */

/**
 * Yêu cầu Backend cập nhật lại quyền/group của user.
 *
 * Dùng khi:
 * - Admin vừa assign device
 * - Admin vừa remove device
 * - mapping thiết bị thay đổi
 *
 * Backend hiện tại có method RefreshGroups().
 */
export async function refreshLogTagGroups(
  conn: signalR.HubConnection
): Promise<void> {
  if (
    conn.state !==
    signalR.HubConnectionState.Connected
  ) {
    return;
  }

  try {
    await conn.invoke("RefreshGroups");

    console.log(
      "[hub] 🔄 groups refreshed"
    );
  } catch (err) {
    console.error(
      "[hub] ❌ RefreshGroups failed:",
      err
    );
  }
}

/* =========================================================
 * Ping
 * ========================================================= */

/**
 * Ping Backend Hub.
 *
 * Có thể dùng để kiểm tra connection.
 */
export async function pingLogTagHub(
  conn: signalR.HubConnection
): Promise<Date | string | null> {
  if (
    conn.state !==
    signalR.HubConnectionState.Connected
  ) {
    return null;
  }

  try {
    return await conn.invoke<Date>("Ping");
  } catch (err) {
    console.warn(
      "[hub] Ping failed:",
      err
    );

    return null;
  }
}

/* =========================================================
 * Safe stop
 * ========================================================= */

/**
 * Dừng connection an toàn.
 */
export async function safeStop(): Promise<void> {
  await resetLogTagConnection();

  console.log(
    "[hub] ⏹ stopped"
  );
}

/* =========================================================
 * Raw connection
 * ========================================================= */

/**
 * Truy cập connection hiện tại.
 */
export function currentConnection():
  | signalR.HubConnection
  | null {
  return _conn;
}

/* =========================================================
 * State helpers
 * ========================================================= */

export function isLogTagConnected(): boolean {
  return (
    _conn?.state ===
    signalR.HubConnectionState.Connected
  );
}

export function isLogTagConnecting(): boolean {
  return (
    _conn?.state ===
      signalR.HubConnectionState.Connecting ||
    _conn?.state ===
      signalR.HubConnectionState.Reconnecting
  );
}