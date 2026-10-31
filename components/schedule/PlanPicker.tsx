import { CLIENT_PLANS, ClientPlan, PaymentId, PlanSection, formatCop, paymentOf, requestLabel } from "@/utils/clientPlans"
import { cancelPlanRequest, pendingPlan, requestPlan, useClassSchedule } from "@/utils/classScheduleStore"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type Step =
  | { kind: "list" }
  | { kind: "detail"; plan: ClientPlan; pay: PaymentId }
  | { kind: "confirm"; plan: ClientPlan; pay: PaymentId }
  | { kind: "sent" }

// "Choose your plan": the plans as a list, one plan's detail, then a
// confirmation that sends the request. There's no payment in the app: the
// coach gets the request and activates the plan once the athlete pays.
export function PlanPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const st = useClassSchedule()
  const [step, setStep] = useState<Step>({ kind: "list" })
  useEffect(() => { if (visible) setStep({ kind: "list" }) }, [visible])
  const pending = pendingPlan(st)
  const tall = step.kind === "detail"

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={[s.sheet, tall && { height: "92%" }, { paddingBottom: 20 + insets.bottom }]}>
        <View style={s.grab} />

        {step.kind === "list" && (
          <>
            <View style={s.head}>
              <Text style={[s.title, { flex: 1 }]}>Choose your plan</Text>
              <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            {pending && (
              <View style={[s.note, s.noteYellow]}>
                <Text style={s.noteTitle}>Request sent</Text>
                <Text style={s.noteLine}>{requestLabel(pending.plan, pending.payment)}</Text>
                <Text style={s.small}>Your coach activates it once you pay.</Text>
                <Pressable hitSlop={8} disabled={st.busy} onPress={cancelPlanRequest}>
                  <Text style={s.cancel}>{st.busy ? "Cancelling…" : "Cancel request"}</Text>
                </Pressable>
              </View>
            )}
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
              {CLIENT_PLANS.map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => setStep({ kind: "detail", plan: p, pay: p.payments[0].id })}
                  style={({ pressed }) => [s.plan, i === 0 && s.planBest, pressed && { opacity: 0.85 }]}
                >
                  <View style={s.between}>
                    <Text style={s.planName}>{p.name}</Text>
                    <Text style={s.planName}>{formatCop(p.payments[0].price)}</Text>
                  </View>
                  <View style={s.between}>
                    <Text style={[s.small, { flex: 1 }]}>{p.summary}</Text>
                    {p.tag?.tone === "badge" && <Text style={s.badge}>{p.tag.text}</Text>}
                  </View>
                  {p.tag?.tone === "yellow" && <Text style={s.tagYellow}>{p.tag.text}</Text>}
                </Pressable>
              ))}
              <Text style={[s.small, { textAlign: "center" }]}>Prices in COP · Tap a plan to see details</Text>
            </ScrollView>
          </>
        )}

        {step.kind === "detail" && (
          <>
            <Pressable style={s.back} hitSlop={8} onPress={() => setStep({ kind: "list" })}>
              <Ionicons name="chevron-back" size={20} color={C.green} />
              <Text style={s.backText}>Plans</Text>
            </Pressable>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 20, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 4 }}>
                <Text style={s.bigTitle}>{step.plan.name}</Text>
                <Text style={s.lead}>{step.plan.detail}</Text>
              </View>
              {step.plan.sections.map((sec, i) => <Section key={i} sec={sec} />)}
              {step.plan.payments.length > 1 && (
                <View style={{ gap: 10 }}>
                  <Text style={s.kicker}>HOW TO PAY</Text>
                  {step.plan.payments.map((o) => (
                    <Pressable
                      key={o.id}
                      onPress={() => setStep({ ...step, pay: o.id })}
                      style={[s.pay, o.id === step.pay && s.payOn]}
                      accessibilityState={{ selected: o.id === step.pay }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.payLabel}>{o.label}</Text>
                        <Text style={s.small}>{o.sub}</Text>
                      </View>
                      <Text style={s.payPrice}>{formatCop(o.price)}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
            <View style={s.footer}>
              <Big
                label={pending ? "Request already sent" : step.plan.payments.length > 1 ? "Choose this plan" : `Choose · ${formatCop(step.plan.payments[0].price)}`}
                disabled={!!pending}
                onPress={() => setStep({ kind: "confirm", plan: step.plan, pay: step.pay })}
              />
            </View>
          </>
        )}

        {step.kind === "confirm" && (() => {
          const pay = paymentOf(step.plan.id, step.pay)!.pay
          return (
            <View style={{ gap: 16, paddingTop: 8 }}>
              <Text style={[s.title, { textAlign: "center" }]}>Confirm your plan</Text>
              <View style={s.box}>
                <View style={s.between}><Text style={s.rowLabel}>Plan</Text><Text style={s.rowValue}>{step.plan.name}</Text></View>
                {step.plan.payments.length > 1 && (
                  <View style={s.between}><Text style={s.rowLabel}>Payment</Text><Text style={s.rowValue}>{pay.label}</Text></View>
                )}
                <View style={s.line} />
                <View style={s.between}><Text style={[s.rowLabel, { fontSize: 17 }]}>Total</Text><Text style={s.total}>{formatCop(pay.price)}</Text></View>
              </View>
              <Text style={[s.small, { textAlign: "center", fontSize: 14, lineHeight: 20 }]}>
                Your coach gets your request and activates the plan once you pay.
              </Text>
              <Big
                label="Send request"
                busy={st.busy}
                onPress={async () => { if (await requestPlan(step.plan.id, step.pay)) setStep({ kind: "sent" }) }}
              />
              <Pressable style={s.ghost} onPress={() => setStep({ kind: "detail", plan: step.plan, pay: step.pay })}>
                <Text style={s.ghostText}>Back</Text>
              </Pressable>
            </View>
          )
        })()}

        {step.kind === "sent" && (
          <View style={{ gap: 14, alignItems: "center", paddingTop: 12 }}>
            <View style={s.okCircle}><Ionicons name="checkmark" size={30} color={C.green} /></View>
            <Text style={s.title}>Request sent</Text>
            <Text style={[s.lead, { textAlign: "center" }]}>We&apos;ll let you know when your coach activates it.</Text>
            <View style={{ alignSelf: "stretch", marginTop: 4 }}><Big label="Done" onPress={onClose} /></View>
          </View>
        )}
      </View>
    </Modal>
  )
}

function Section({ sec }: { sec: PlanSection }) {
  if (sec.kind === "note") {
    const yellow = sec.tone === "yellow"
    return (
      <View style={[s.note, yellow ? s.noteYellow : s.noteGreen]}>
        {sec.title && <Text style={[s.kicker, yellow && { color: C.yellow }]}>{sec.title.toUpperCase()}</Text>}
        {sec.lines.map((l, i) => (
          <Text key={l} style={!sec.title && i > 0 ? s.small : [s.noteLine, !sec.title && { fontWeight: "700" }]}>{l}</Text>
        ))}
      </View>
    )
  }
  return (
    <View style={{ gap: sec.kind === "check" || sec.kind === "cross" ? 12 : 10 }}>
      <Text style={s.kicker}>{sec.title.toUpperCase()}</Text>
      {sec.kind === "text" && <Text style={[s.item, { lineHeight: 21 }]}>{sec.text}</Text>}
      {sec.kind === "rows" && sec.rows.map(([k, v]) => (
        <View key={k} style={[s.between, { gap: 16 }]}>
          <Text style={[s.item, { color: C.textSecondary }]}>{k}</Text>
          <Text style={[s.item, { flex: 1, textAlign: "right" }]}>{v}</Text>
        </View>
      ))}
      {(sec.kind === "check" || sec.kind === "cross") && sec.items.map((it) => {
        const [text, sub] = typeof it === "string" ? [it, null] : it
        const cross = sec.kind === "cross"
        return (
          <View key={text} style={s.tick}>
            <Ionicons name={cross ? "close" : "checkmark"} size={20} color={cross ? C.textSecondary : C.green} />
            <View style={{ flex: 1 }}>
              <Text style={[s.item, cross && { color: C.textSecondary }]}>{text}</Text>
              {sub && <Text style={s.small}>{sub}</Text>}
            </View>
          </View>
        )
      })}
    </View>
  )
}

// The big green button of the pop-ups.
function Big({ label, disabled, busy, onPress }: { label: string; disabled?: boolean; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.big, (disabled || busy) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator color={C.bg} /> : <Text style={s.bigText}>{label}</Text>}
    </Pressable>
  )
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10, gap: 12, maxHeight: "92%",
  },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.surfaceHigh, alignSelf: "center", marginBottom: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.3 },
  bigTitle: { fontSize: 26, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.4 },
  lead: { fontSize: 15, color: C.textSecondary },
  kicker: { fontSize: 13, fontWeight: "800", letterSpacing: 0.6, color: C.textSecondary },
  small: { fontSize: 13, color: C.textSecondary },
  item: { fontSize: 15, color: C.textPrimary },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  plan: { gap: 6, backgroundColor: C.surfaceHigh, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  planBest: { borderColor: C.green },
  planName: { fontSize: 17, fontWeight: "800", color: C.textPrimary },
  badge: {
    fontSize: 11, fontWeight: "800", letterSpacing: 0.5, color: C.bg, backgroundColor: C.green,
    borderRadius: 6, overflow: "hidden", paddingVertical: 3, paddingHorizontal: 7,
  },
  tagYellow: { fontSize: 13, fontWeight: "700", color: C.yellow },
  back: { flexDirection: "row", alignItems: "center", gap: 2, height: 36, alignSelf: "flex-start" },
  backText: { fontSize: 16, fontWeight: "700", color: C.green },
  tick: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  note: { gap: 6, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  noteYellow: { backgroundColor: "rgba(254,215,102,0.08)", borderColor: "rgba(254,215,102,0.35)" },
  noteGreen: { backgroundColor: "rgba(111,207,151,0.08)", borderColor: "rgba(111,207,151,0.35)" },
  noteTitle: { fontSize: 13, fontWeight: "800", letterSpacing: 0.6, color: C.yellow },
  noteLine: { fontSize: 15, color: C.textPrimary },
  cancel: { fontSize: 14, fontWeight: "700", color: C.textSecondary, marginTop: 2 },
  pay: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 14, backgroundColor: C.surfaceHigh, borderWidth: 1.5, borderColor: C.border,
  },
  payOn: { borderColor: C.green },
  payLabel: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  payPrice: { fontSize: 16, fontWeight: "800", color: C.textPrimary },
  footer: { paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  big: { height: 52, borderRadius: 14, backgroundColor: C.green, alignItems: "center", justifyContent: "center" },
  bigText: { fontSize: 16, fontWeight: "800", color: C.bg },
  box: { gap: 10, backgroundColor: C.surfaceHigh, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  rowLabel: { fontSize: 15, color: C.textSecondary },
  rowValue: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  line: { height: 1, backgroundColor: C.border },
  total: { fontSize: 17, fontWeight: "800", color: C.textPrimary },
  ghost: { height: 44, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 15, fontWeight: "700", color: C.textSecondary },
  okCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(111,207,151,0.15)", alignItems: "center", justifyContent: "center" },
})
