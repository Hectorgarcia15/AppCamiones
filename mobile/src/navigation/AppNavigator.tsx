import React from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { navigationRef } from "./NavigationService";
import HomeScreen from "../screens/HomeScreen";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import DashboardScreen from "../screens/DashboardScreen";
import TrucksScreen from "../screens/TrucksScreen";
import TruckDetailScreen from "../screens/TruckDetailScreen";
import LiveMapScreen from "../screens/LiveMapScreen";
import RouteAlertDetailScreen from "../screens/RouteAlertDetailScreen";
import SpeedAlertDetailScreen from "../screens/SpeedAlertDetailScreen";
import ProfileScreen from "../screens/ProfileScreen";

const Stack = createNativeStackNavigator();

const MyTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#0f172a",
  },
};

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator initialRouteName="Dashboard" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="Trucks" component={TrucksScreen} />
      <Stack.Screen name="TruckDetail" component={TruckDetailScreen} />
      <Stack.Screen name="LiveMap" component={LiveMapScreen} />
      <Stack.Screen name="RouteAlertDetail" component={RouteAlertDetailScreen} />
      <Stack.Screen name="SpeedAlertDetail" component={SpeedAlertDetailScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0b54f3" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={MyTheme} ref={navigationRef}>
      {user ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0f172a",
    justifyContent: "center",
    alignItems: "center",
  },
});