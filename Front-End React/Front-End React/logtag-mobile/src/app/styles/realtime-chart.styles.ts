import { StyleSheet } from "react-native";

export const chartColors = {
  axis: "#cbd5e1",
  grid: "#e2e8f0",
  line: "#2563eb",
  dot: "#2563eb",
  textMuted: "#64748b",
};

export const chartStyles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginTop: 14,
    marginBottom: 18,

    // shadow iOS
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,

    // shadow Android
    elevation: 4,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },

  title: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "900",
  },

  subtitle: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 5,
    fontWeight: "600",
  },

  refreshButton: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
  },

  refreshText: {
    color: "#2563eb",
    fontSize: 12,
    fontWeight: "900",
  },

  latestRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },

  latestBox: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  latestLabel: {
    color: "#64748b",
    fontSize: 12,
    marginBottom: 6,
    fontWeight: "700",
  },

  latestValue: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "900",
  },

  centerBox: {
    minHeight: 190,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  mutedText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },

  errorBox: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
  },

  errorText: {
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "800",
  },

  chartBox: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#f8fafc",
    borderRadius: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  footerText: {
    color: "#64748b",
    fontSize: 11,
    marginTop: 10,
    textAlign: "center",
    fontWeight: "600",
  },
});