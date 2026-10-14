export const fmtLocal = (dt: Date) =>
  dt.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const getUserId = () =>
  localStorage.getItem("accountId") || localStorage.getItem("uid") || "";

export const getUserIdHeader = () => {
  const uid = getUserId();
  return uid ? { "X-User-Id": uid } : {};
};

export const accessTokenFactory = () => getUserId();