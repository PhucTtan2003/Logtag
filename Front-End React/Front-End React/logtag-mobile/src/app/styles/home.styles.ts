import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f3f6fb",
  },

  loginKeyboard: {
    flex: 1,
  },

  loginScrollContent: {
    flexGrow: 1,
  },

  authShell: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f3f6fb",
  },

  authBadge: {
    width: 76,
    height: 76,
    borderRadius: 28,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 18,
  },

  authBadgeText: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
  },

  loginTitle: {
    color: "#0f172a",
    fontSize: 34,
    fontWeight: "900",
    textAlign: "center",
  },

  loginSubtitle: {
    color: "#64748b",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 26,
  },

  formCard: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 5,
  },

  label: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 12,
  },

  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#0f172a",
    fontSize: 15,
  },

  errorText: {
    color: "#b91c1c",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    marginTop: 14,
    marginBottom: 14,
    fontSize: 13,
    fontWeight: "800",
  },

  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 22,
  },

  primaryButtonDisabled: {
    opacity: 0.6,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },

  scroll: {
    flex: 1,
    backgroundColor: "#f3f6fb",
  },

  scrollContent: {
    paddingTop: 88,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },

  layout: {
    width: "100%",
    maxWidth: 1280,
    alignSelf: "center",
  },

  topBar: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 16,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 22,
    elevation: 3,
  },

  topLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },

  avatarText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },

  titleBlock: {
    flex: 1,
  },

  overline: {
    color: "#2563eb",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  pageTitle: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 3,
  },

  subText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },

  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },

  iconButtonText: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "900",
  },

  logoutButton: {
    backgroundColor: "#ef4444",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },

  logoutText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },

  pulseCard: {
    borderRadius: 30,
    padding: 22,
    marginBottom: 16,
    overflow: "hidden",
  },

  pulseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    marginBottom: 20,
  },

  pulseKicker: {
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 8,
  },

  pulseTitle: {
    color: "#ffffff",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
  },

  pulseSub: {
    color: "#dbeafe",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
    marginTop: 8,
    maxWidth: 680,
  },

  pulseLiveBadge: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  pulseLiveDot: {
    color: "#22c55e",
    fontSize: 12,
  },

  pulseLiveText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },

  pulseStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },

  pulseMetric: {
    flex: 1,
    minWidth: 130,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: 22,
    padding: 16,
  },

  pulseMetricValue: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "900",
  },

  pulseMetricLabel: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },

  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },

  actionCard: {
    flexGrow: 1,
    flexBasis: 220,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 16,
    flexDirection: "row",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 2,
  },

  actionIcon: {
    fontSize: 24,
  },

  actionTextBox: {
    flex: 1,
  },

  actionTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "900",
  },

  actionDesc: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
    fontWeight: "700",
  },

  sectionRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    marginTop: 4,
  },

  sectionTitle: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "900",
  },

  sectionSub: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },

  sectionRight: {
    color: "#2563eb",
    fontSize: 13,
    fontWeight: "900",
  },

  livePanel: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 18,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 22,
    elevation: 3,
  },

  liveHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },

  liveTitle: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "900",
  },

  liveSerial: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },

  selectedMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 6,
  },

  miniMetric: {
    flex: 1,
    minWidth: 150,
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  miniMetricLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },

  miniMetricValue: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "900",
  },

  miniMetricValueSmall: {
    fontSize: 14,
  },

  devicesStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },

  filterPill: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },

  filterPillActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },

  filterPillText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "900",
  },

  filterPillTextActive: {
    color: "#ffffff",
  },

  deviceList: {
    gap: 12,
  },

  deviceCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },

  deviceCardSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#f8fbff",
  },

  deviceCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },

  deviceInfo: {
    flex: 1,
  },

  deviceName: {
    color: "#0f172a",
    fontSize: 17,
    fontWeight: "900",
  },

  deviceSerial: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 5,
  },

  statusBadge: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
  },

  statusOnline: {
    backgroundColor: "#dcfce7",
  },

  statusWarning: {
    backgroundColor: "#ffedd5",
  },

  statusOffline: {
    backgroundColor: "#fee2e2",
  },

  statusText: {
    color: "#0f172a",
    fontSize: 11,
    fontWeight: "900",
  },

  deviceMetrics: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },

  smallMetric: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    padding: 12,
  },

  smallLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 5,
  },

  smallValue: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "900",
  },

  updatedText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },

  hintText: {
    color: "#2563eb",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 8,
  },

  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  emptyTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "900",
  },

  emptyDesc: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 6,
  },
});