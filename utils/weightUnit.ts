// The athlete's weight unit (kg / lb), remembered on the device so it's picked
// once rather than every S&C block. Best effort: storage errors fall back to kg.

import AsyncStorage from "@react-native-async-storage/async-storage"

export type WeightUnit = "kg" | "lb"

const KEY = "sc.weightUnit"

export async function loadWeightUnit(): Promise<WeightUnit> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "lb" ? "lb" : "kg"
  } catch {
    return "kg"
  }
}

export async function saveWeightUnit(unit: WeightUnit): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, unit)
  } catch { /* best effort */ }
}
