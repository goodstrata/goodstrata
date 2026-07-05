import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { type as t, useTheme } from "../../src/components";
import { useUnreadNotificationsCount } from "./notifications";

export default function TabsLayout() {
  const theme = useTheme();
  // Shares the query cache with the Notifications screen — the badge and the
  // inbox can never disagree, and no extra endpoint is needed.
  const unread = useUnreadNotificationsCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontFamily: t.label.fontFamily, fontSize: 11 },
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.line },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          // Focused tabs swap to the filled glyph — tint alone is not enough
          // affordance (colour-blind users; every reference tab bar pairs both).
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "business" : "business-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "notifications" : "notifications-outline"}
              color={color}
              size={size}
            />
          ),
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.crit,
            color: theme.onAccent,
            fontFamily: t.label.fontFamily,
            fontSize: 10,
          },
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "ellipsis-horizontal-circle" : "ellipsis-horizontal-circle-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
