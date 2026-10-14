import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from "expo-router/ui";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "./themed-text";
import { api } from "./api/client";

export default function AppTabs() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;

    try {
      setLoggingOut(true);

      try {
        await api.post("/api/auth/logout");
      } catch {
        // Vẫn cho thoát giao diện nếu backend logout lỗi
      }

      router.replace("/user/home");
    } catch (err) {
      if (Platform.OS === "web") {
        console.log("LOGOUT ERROR:", err);
      } else {
        Alert.alert("Lỗi", "Không thể đăng xuất. Vui lòng thử lại.");
      }
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <Tabs>
      <TabSlot style={styles.slot} />

      <TabList asChild>
        <CustomTabList onLogout={handleLogout} loggingOut={loggingOut}>
          <TabTrigger name="home" href="/user/home" asChild>
            <TabButton icon="⌂">Trang chủ</TabButton>
          </TabTrigger>

          <TabTrigger name="devices" href={"/user/devices" as any} asChild>
            <TabButton icon="⌁">Thiết bị</TabButton>
          </TabTrigger>

         <TabTrigger name="notifications" href={"/user/notifications" as any} asChild>
            <TabButton icon="◉">Thông báo</TabButton>

          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

type AppTabButtonProps = TabTriggerSlotProps & {
  icon: string;
};

function TabButton({
  children,
  icon,
  isFocused,
  ...props
}: AppTabButtonProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.tabButton,
        isFocused && styles.tabButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconBubble, isFocused && styles.iconBubbleActive]}>
        <ThemedText
          style={[styles.tabIcon, isFocused && styles.tabIconActive]}
        >
          {icon}
        </ThemedText>
      </View>

      <ThemedText
        style={[styles.tabText, isFocused && styles.tabTextActive]}
        numberOfLines={1}
      >
        {children}
      </ThemedText>
    </Pressable>
  );
}

type CustomTabListProps = TabListProps & {
  onLogout: () => void;
  loggingOut: boolean;
};

function CustomTabList({
  children,
  onLogout,
  loggingOut,
  ...props
}: CustomTabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <View style={styles.dock}>
        {children}

        <Pressable
          onPress={onLogout}
          disabled={loggingOut}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.pressed,
            loggingOut && styles.disabled,
          ]}
        >
          <View style={styles.logoutIconBubble}>
            <ThemedText style={styles.logoutIcon}>⏻</ThemedText>
          </View>

          <ThemedText style={styles.logoutText} numberOfLines={1}>
            {loggingOut ? "..." : "Thoát"}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    height: "100%",
  },

  tabListContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 16,
    zIndex: 100,
    alignItems: "center",
    paddingHorizontal: 14,
  },

  dock: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 30,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",

    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.95)",

    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 26,
    elevation: 12,
  },

  tabButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
  },

  tabButtonActive: {
    backgroundColor: "#eff6ff",
  },

  iconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },

  iconBubbleActive: {
    backgroundColor: "#2563eb",
  },

  tabIcon: {
    color: "#64748b",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 20,
  },

  tabIconActive: {
    color: "#ffffff",
  },

  tabText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
  },

  tabTextActive: {
    color: "#2563eb",
    fontWeight: "900",
  },

  logoutButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    backgroundColor: "#fff1f2",
  },

  logoutIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dc2626",
  },

  logoutIcon: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },

  logoutText: {
    color: "#b91c1c",
    fontSize: 11,
    fontWeight: "900",
  },

  pressed: {
    opacity: 0.72,
  },

  disabled: {
    opacity: 0.55,
  },
});