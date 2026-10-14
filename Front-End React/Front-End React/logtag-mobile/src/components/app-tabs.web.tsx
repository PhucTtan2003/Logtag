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
import { ThemedView } from "./themed-view";

import { MaxContentWidth, Spacing } from "../constants/theme";
import { api } from "../components/api/client";

export default function AppTabs() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;

    try {
      setLoggingOut(true);

      try {
        await api.post("/api/auth/logout");
      } catch {
        // Nếu backend logout lỗi, vẫn cho thoát giao diện.
      }

      router.replace("/");
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
      <TabSlot style={{ height: "100%" }} />

      <TabList asChild>
        <CustomTabList onLogout={handleLogout} loggingOut={loggingOut}>
          <TabTrigger name="home" href="/" asChild>
            <TabButton icon="📊">Dashboard</TabButton>
          </TabTrigger>

          <TabTrigger name="devices" href="/devices" asChild>
            <TabButton icon="📡">Thiết bị</TabButton>
          </TabTrigger>

          <TabTrigger name="notifications" href="/notifications" asChild>
            <TabButton icon="🔔">Thông báo</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

type AppTabButtonProps = TabTriggerSlotProps & {
  icon?: string;
};

export function TabButton({
  children,
  isFocused,
  icon,
  ...props
}: AppTabButtonProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.tabPressable,
        pressed && styles.pressed,
      ]}
    >
      <ThemedView
        type={isFocused ? "backgroundSelected" : "backgroundElement"}
        style={[styles.tabButtonView, isFocused && styles.tabButtonViewActive]}
      >
        {icon ? (
          <ThemedText type="small" style={styles.tabIcon}>
            {icon}
          </ThemedText>
        ) : null}

        <ThemedText
          type="small"
          themeColor={isFocused ? "text" : "textSecondary"}
          style={styles.tabText}
        >
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

type CustomTabListProps = TabListProps & {
  onLogout: () => void;
  loggingOut: boolean;
};

export function CustomTabList({
  onLogout,
  loggingOut,
  children,
  ...props
}: CustomTabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <View style={styles.brandBlock}>
          <View style={styles.brandLogo}>
            <ThemedText type="smallBold" style={styles.brandLogoText}>
              LT
            </ThemedText>
          </View>

          <View style={styles.brandTextBlock}>
            <ThemedText type="smallBold" style={styles.brandText}>
              LogTag Mobile
            </ThemedText>

            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.brandSubText}
            >
              Cold Chain
            </ThemedText>
          </View>
        </View>

        <View style={styles.menuCenter}>{children}</View>

        <Pressable
          onPress={onLogout}
          disabled={loggingOut}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.pressed,
            loggingOut && styles.logoutButtonDisabled,
          ]}
        >
          <ThemedText type="small" style={styles.logoutIcon}>
            ⏻
          </ThemedText>

          <ThemedText type="smallBold" style={styles.logoutText}>
            {loggingOut ? "Đang thoát..." : "Đăng xuất"}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: "absolute",
    width: "100%",
    padding: Spacing.three,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    zIndex: 20,
  },

  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
    flexDirection: "row",
    alignItems: "center",
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
  },

  brandBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginRight: "auto",
  },

  brandLogo: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
  },

  brandLogoText: {
    color: "#ffffff",
  },

  brandTextBlock: {
    justifyContent: "center",
  },

  brandText: {
    fontWeight: "900",
  },

  brandSubText: {
    fontSize: 11,
  },

  menuCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },

  tabPressable: {
    borderRadius: Spacing.three,
  },

  pressed: {
    opacity: 0.7,
  },

  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },

  tabButtonViewActive: {
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.35)",
  },

  tabIcon: {
    fontSize: 13,
  },

  tabText: {
    fontWeight: "700",
  },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    marginLeft: "auto",
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: "#7f1d1d",
  },

  logoutButtonDisabled: {
    opacity: 0.6,
  },

  logoutIcon: {
    color: "#ffffff",
    fontSize: 13,
  },

  logoutText: {
    color: "#ffffff",
  },
});