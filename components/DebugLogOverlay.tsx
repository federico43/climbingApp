import { clearDebugLogs, formatDebugLogs, getDebugLogs, installDebugLogCapture, LogEntry, subscribeDebugLogs } from "@/utils/debugLog"
import { useEffect, useState } from "react"
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native"

installDebugLogCapture()

const LEVEL_COLOR: Record<LogEntry["level"], string> = {
  log: "rgba(255,255,255,0.75)",
  warn: "#FED766",
  error: "#FF6B6B",
}

// Small always-on debug affordance for reading console.log/warn/error output
// on-device with no Metro/Xcode console attached — a floating button that
// opens a scrollable log list, with a Share button (opens the native share
// sheet, which on iOS includes "Copy") to get the text off the device.
// Meant as a temporary debugging aid — safe to delete once the underlying
// issue it's being used to chase is resolved.
export function DebugLogOverlay() {
  const [visible, setVisible] = useState(false)
  const [, forceRender] = useState(0)

  useEffect(() => subscribeDebugLogs(() => forceRender((n) => n + 1)), [])

  const logs = getDebugLogs()

  return (
    <>
      <Pressable style={styles.fab} onPress={() => setVisible(true)} hitSlop={8}>
        <Text style={styles.fabText}>🐞{logs.length > 0 ? ` ${logs.length}` : ""}</Text>
      </Pressable>

      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Debug logs ({logs.length})</Text>
            <View style={styles.headerBtns}>
              <Pressable style={styles.headerBtn} onPress={() => clearDebugLogs()}>
                <Text style={styles.headerBtnText}>Clear</Text>
              </Pressable>
              <Pressable
                style={styles.headerBtn}
                onPress={() => Share.share({ message: formatDebugLogs() || "No logs captured yet." })}
              >
                <Text style={styles.headerBtnText}>Share</Text>
              </Pressable>
              <Pressable style={styles.headerBtn} onPress={() => setVisible(false)}>
                <Text style={styles.headerBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {logs.length === 0 && <Text style={styles.emptyText}>No logs captured yet.</Text>}
            {logs.map((e, i) => (
              <Text key={i} style={[styles.logLine, { color: LEVEL_COLOR[e.level] }]}>
                [{new Date(e.atMs).toLocaleTimeString()}] {e.message}
              </Text>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", bottom: 8, left: 8, zIndex: 999,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  fabText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  modalRoot: { flex: 1, backgroundColor: "#0b0b0b", paddingTop: 56 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  headerTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  headerBtns: { flexDirection: "row", gap: 8 },
  headerBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  headerBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 4 },
  emptyText: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  logLine: { fontSize: 11, fontFamily: "Menlo", lineHeight: 15 },
})
